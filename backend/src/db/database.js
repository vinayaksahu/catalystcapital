require('dotenv').config();
const { Pool, neon } = require('@neondatabase/serverless');
const path = require('node:path');

const isPostgres = !!process.env.DATABASE_URL;

let pool = null;
let sqliteDb = null;

if (isPostgres) {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  console.log('🐘 Neon PostgreSQL connection pool initialized');
} else {
  // Local fallback: native SQLite
  const { DatabaseSync } = require('node:sqlite');
  const dbPath = path.join(__dirname, '..', '..', '..', 'catalyst.db');
  sqliteDb = new DatabaseSync(dbPath);
  sqliteDb.exec('PRAGMA foreign_keys = ON;');
  console.log('📁 Local SQLite database initialized (set DATABASE_URL in .env to use Neon)');
}

/**
 * Universal Database Client supporting both Neon Postgres and Local SQLite
 */
const db = {
  isPostgres,

  async query(text, params = []) {
    if (isPostgres) {
      // Convert ? placeholders to $1, $2, $3 for Postgres
      let idx = 1;
      const pgText = text.replace(/\?/g, () => `$${idx++}`);
      const res = await pool.query(pgText, params);
      return res;
    } else {
      const stmt = sqliteDb.prepare(text);
      if (text.trim().toUpperCase().startsWith('SELECT')) {
        const rows = stmt.all(...params);
        return { rows, rowCount: rows.length };
      } else {
        const info = stmt.run(...params);
        return { rows: [], rowCount: info.changes, lastInsertRowid: info.lastInsertRowid };
      }
    }
  },

  async get(text, params = []) {
    const res = await this.query(text, params);
    if (!res.rows || res.rows.length === 0) return null;
    return this.parseNumericFields(res.rows[0]);
  },

  async all(text, params = []) {
    const res = await this.query(text, params);
    return (res.rows || []).map(r => this.parseNumericFields(r));
  },

  async run(text, params = []) {
    if (isPostgres) {
      let idx = 1;
      let pgText = text.replace(/\?/g, () => `$${idx++}`);
      // For INSERT in postgres, append RETURNING id if not present to capture inserted ID (except for tables without id like system_settings)
      if (pgText.trim().toUpperCase().startsWith('INSERT') && !pgText.toUpperCase().includes('RETURNING') && !pgText.toUpperCase().includes('SYSTEM_SETTINGS')) {
        pgText += ' RETURNING id';
      }
      const res = await pool.query(pgText, params);
      const lastInsertId = res.rows && res.rows[0] && res.rows[0].id ? res.rows[0].id : null;
      return { lastInsertRowid: lastInsertId, rowCount: res.rowCount };
    } else {
      const stmt = sqliteDb.prepare(text);
      const info = stmt.run(...params);
      return { lastInsertRowid: info.lastInsertRowid, rowCount: info.changes };
    }
  },

  // Helper to ensure NUMERIC/DECIMAL columns from Postgres are parsed as floats
  parseNumericFields(row) {
    if (!row) return row;
    const cloned = { ...row };
    const numericKeys = [
      'wallet_balance', 'roi_balance', 'commission_balance', 'price',
      'daily_roi', 'total_roi', 'amount', 'total_earned', 'fee', 'net_amount',
      'active_investment', 'active_invested', 'total_commission_from_user', 'vol', 'total'
    ];
    for (const key of numericKeys) {
      if (cloned[key] !== undefined && cloned[key] !== null) {
        cloned[key] = parseFloat(cloned[key]);
      }
    }
    return cloned;
  }
};

/**
 * Initializes database tables (Neon PostgreSQL or SQLite)
 */
async function initDatabase() {
  if (isPostgres) {
    // Neon PostgreSQL Tables
    await db.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        full_name VARCHAR(255) NOT NULL,
        phone VARCHAR(50),
        role VARCHAR(50) DEFAULT 'user',
        referral_code VARCHAR(50) UNIQUE NOT NULL,
        sponsor_id INTEGER REFERENCES users(id),
        wallet_balance NUMERIC(18, 4) DEFAULT 0.0,
        roi_balance NUMERIC(18, 4) DEFAULT 0.0,
        commission_balance NUMERIC(18, 4) DEFAULT 0.0,
        usdt_address VARCHAR(255),
        status VARCHAR(50) DEFAULT 'active',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS plans (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        price NUMERIC(18, 4) NOT NULL,
        duration_days INTEGER NOT NULL,
        daily_roi NUMERIC(18, 4) NOT NULL,
        total_roi NUMERIC(18, 4) NOT NULL,
        color VARCHAR(50) DEFAULT '#00d2ff',
        is_active INTEGER DEFAULT 1,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS investments (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        plan_id INTEGER NOT NULL REFERENCES plans(id),
        amount NUMERIC(18, 4) NOT NULL,
        daily_roi NUMERIC(18, 4) NOT NULL,
        total_days INTEGER NOT NULL,
        days_credited INTEGER DEFAULT 0,
        total_earned NUMERIC(18, 4) DEFAULT 0.0,
        status VARCHAR(50) DEFAULT 'active',
        last_roi_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP WITH TIME ZONE
      );

      CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        amount NUMERIC(18, 4) NOT NULL,
        type VARCHAR(50) NOT NULL,
        wallet_type VARCHAR(50) NOT NULL,
        description TEXT,
        reference_id VARCHAR(100),
        from_user_id INTEGER REFERENCES users(id),
        level INTEGER,
        status VARCHAR(50) DEFAULT 'completed',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS deposits (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        amount NUMERIC(18, 4) NOT NULL,
        tx_hash VARCHAR(255),
        network VARCHAR(50) DEFAULT 'USDT-BEP20',
        status VARCHAR(50) DEFAULT 'pending',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS withdrawals (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        amount NUMERIC(18, 4) NOT NULL,
        fee NUMERIC(18, 4) DEFAULT 0.0,
        net_amount NUMERIC(18, 4) NOT NULL,
        wallet_type VARCHAR(50) DEFAULT 'roi_balance',
        usdt_address VARCHAR(255) NOT NULL,
        network VARCHAR(50) DEFAULT 'USDT-BEP20',
        tx_hash VARCHAR(255),
        status VARCHAR(50) DEFAULT 'pending',
        admin_note TEXT,
        processed_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS support_tickets (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        subject VARCHAR(255) NOT NULL,
        category VARCHAR(100) DEFAULT 'General',
        message TEXT NOT NULL,
        admin_reply TEXT,
        status VARCHAR(50) DEFAULT 'open',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS system_settings (
        key VARCHAR(100) PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS email_otps (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        otp VARCHAR(10) NOT NULL,
        purpose VARCHAR(50) NOT NULL,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        type VARCHAR(50) NOT NULL,
        title VARCHAR(255) NOT NULL,
        message TEXT,
        amount NUMERIC(18, 4),
        reference_id VARCHAR(100),
        is_read INTEGER DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
  } else {
    // SQLite Tables
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        full_name TEXT NOT NULL,
        phone TEXT,
        role TEXT DEFAULT 'user',
        referral_code TEXT UNIQUE NOT NULL,
        sponsor_id INTEGER REFERENCES users(id),
        wallet_balance REAL DEFAULT 0.0,
        roi_balance REAL DEFAULT 0.0,
        commission_balance REAL DEFAULT 0.0,
        usdt_address TEXT,
        status TEXT DEFAULT 'active',
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        price REAL NOT NULL,
        duration_days INTEGER NOT NULL,
        daily_roi REAL NOT NULL,
        total_roi REAL NOT NULL,
        color TEXT DEFAULT '#00d2ff',
        is_active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS investments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        plan_id INTEGER NOT NULL REFERENCES plans(id),
        amount REAL NOT NULL,
        daily_roi REAL NOT NULL,
        total_days INTEGER NOT NULL,
        days_credited INTEGER DEFAULT 0,
        total_earned REAL DEFAULT 0.0,
        status TEXT DEFAULT 'active',
        last_roi_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        amount REAL NOT NULL,
        type TEXT NOT NULL,
        wallet_type TEXT NOT NULL,
        description TEXT,
        reference_id TEXT,
        from_user_id INTEGER REFERENCES users(id),
        level INTEGER,
        status TEXT DEFAULT 'completed',
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS deposits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        amount REAL NOT NULL,
        tx_hash TEXT,
        network TEXT DEFAULT 'USDT-BEP20',
        status TEXT DEFAULT 'pending',
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS withdrawals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        amount REAL NOT NULL,
        fee REAL DEFAULT 0.0,
        net_amount REAL NOT NULL,
        wallet_type TEXT DEFAULT 'roi_balance',
        usdt_address TEXT NOT NULL,
        network TEXT DEFAULT 'USDT-BEP20',
        tx_hash TEXT,
        status TEXT DEFAULT 'pending',
        admin_note TEXT,
        processed_at TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS support_tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        subject TEXT NOT NULL,
        category TEXT DEFAULT 'General',
        message TEXT NOT NULL,
        admin_reply TEXT,
        status TEXT DEFAULT 'open',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS system_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS email_otps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL,
        otp TEXT NOT NULL,
        purpose TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT,
        amount REAL,
        reference_id TEXT,
        is_read INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);
  }

  // Insert Catalyst Capital Plans if not exists
  const existingPlans = await db.get('SELECT COUNT(*) as count FROM plans');
  if (parseInt(existingPlans.count, 10) === 0) {
    const plans = [
      { name: 'Plan 1', price: 25, duration: 25, daily: 0.50, color: '#38bdf8' },
      { name: 'Plan 2', price: 35, duration: 60, daily: 1.00, color: '#2dd4bf' },
      { name: 'Plan 3', price: 55, duration: 120, daily: 1.50, color: '#a855f7' },
      { name: 'Plan 4', price: 115, duration: 7, daily: 2.50, color: '#f59e0b' },
      { name: 'Plan 5', price: 225, duration: 15, daily: 4.50, color: '#ef4444' },
      { name: 'Plan 6', price: 350, duration: 25, daily: 6.00, color: '#6366f1' },
    ];

    for (const p of plans) {
      const totalRoi = p.duration * p.daily;
      await db.run(
        'INSERT INTO plans (name, price, duration_days, daily_roi, total_roi, color) VALUES (?, ?, ?, ?, ?, ?)',
        [p.name, p.price, p.duration, p.daily, totalRoi, p.color]
      );
    }
  }

  // Insert Default System Settings
  const settings = [
    { key: 'min_withdrawal', value: '15' },
    { key: 'withdrawal_fee_percent', value: '0' },
    { key: 'withdrawal_processing_time', value: '0-24 Hours' },
    { key: 'min_joining', value: '25' },
    { key: 'max_joining', value: '5000' },
    { key: 'team_commission_level_1', value: '6' },
    { key: 'team_commission_level_2', value: '2' },
    { key: 'team_commission_level_3', value: '1' },
    { key: 'referral_roi_level_1', value: '10' },
    { key: 'referral_roi_level_2', value: '4' },
    { key: 'referral_roi_level_3', value: '2' },
    { key: 'usdt_deposit_address', value: '0x71C87050fA86BD1b297bB3B6a8d6C9081B1A53b5' },
    { key: 'company_name', value: 'Catalyst Capital Partners Private Limited' }
  ];

  for (const s of settings) {
    if (isPostgres) {
      await db.run('INSERT INTO system_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING', [s.key, s.value]);
    } else {
      await db.run('INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)', [s.key, s.value]);
    }
  }

  // Ensure deposit address is updated to BEP-20 if previously set to TRC20 address
  await db.run("UPDATE system_settings SET value = '0x71C87050fA86BD1b297bB3B6a8d6C9081B1A53b5' WHERE key = 'usdt_deposit_address' AND (value LIKE 'TYD%' OR value LIKE 'T%')");
}

module.exports = { db, initDatabase, pool };
