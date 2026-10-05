const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const dbPath = path.join(__dirname, '..', '..', 'catalyst.db');
const db = new DatabaseSync(dbPath);

// Enable foreign keys and WAL mode for reliability
db.exec('PRAGMA foreign_keys = ON;');

function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      phone TEXT,
      role TEXT DEFAULT 'user', -- 'user' or 'admin'
      referral_code TEXT UNIQUE NOT NULL,
      sponsor_id INTEGER REFERENCES users(id),
      wallet_balance REAL DEFAULT 0.0,      -- Deposit / Active funds
      roi_balance REAL DEFAULT 0.0,         -- Accumulated ROI income
      commission_balance REAL DEFAULT 0.0,  -- Team & Referral income
      usdt_address TEXT,                    -- TRC20/BEP20 address for withdrawals
      status TEXT DEFAULT 'active',         -- 'active', 'suspended'
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
      status TEXT DEFAULT 'active', -- 'active', 'completed', 'cancelled'
      last_roi_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      amount REAL NOT NULL,
      type TEXT NOT NULL, -- 'deposit', 'investment', 'daily_roi', 'referral_roi', 'team_commission', 'withdrawal'
      wallet_type TEXT NOT NULL, -- 'wallet_balance', 'roi_balance', 'commission_balance'
      description TEXT,
      reference_id TEXT,
      from_user_id INTEGER REFERENCES users(id),
      level INTEGER,
      status TEXT DEFAULT 'completed', -- 'pending', 'completed', 'rejected'
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS deposits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      amount REAL NOT NULL,
      tx_hash TEXT,
      network TEXT DEFAULT 'USDT-TRC20',
      status TEXT DEFAULT 'completed', -- 'pending', 'completed', 'rejected'
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS withdrawals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      amount REAL NOT NULL,
      fee REAL DEFAULT 0.0, -- Stated fee 0%
      net_amount REAL NOT NULL,
      wallet_type TEXT DEFAULT 'roi_balance',
      usdt_address TEXT NOT NULL,
      network TEXT DEFAULT 'USDT-TRC20',
      tx_hash TEXT,
      status TEXT DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
      admin_note TEXT,
      processed_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Insert default Catalyst Capital Investment Plans if not exists
  const existingPlans = db.prepare('SELECT COUNT(*) as count FROM plans').get();
  if (existingPlans.count === 0) {
    const plans = [
      { name: 'Plan 1', price: 25, duration: 25, daily: 0.50, color: '#38bdf8' },
      { name: 'Plan 2', price: 35, duration: 60, daily: 1.00, color: '#2dd4bf' },
      { name: 'Plan 3', price: 55, duration: 120, daily: 1.50, color: '#a855f7' },
      { name: 'Plan 4', price: 115, duration: 7, daily: 2.50, color: '#f59e0b' },
      { name: 'Plan 5', price: 225, duration: 15, daily: 4.50, color: '#ef4444' },
      { name: 'Plan 6', price: 350, duration: 25, daily: 6.00, color: '#6366f1' },
    ];

    const insertPlan = db.prepare(`
      INSERT INTO plans (name, price, duration_days, daily_roi, total_roi, color)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const p of plans) {
      const totalRoi = p.duration * p.daily;
      insertPlan.run(p.name, p.price, p.duration, p.daily, totalRoi, p.color);
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
    { key: 'usdt_deposit_address', value: 'TYDzsXDvGgT3vXkX7q5sK8y1jN9pLmQ6wZ' },
    { key: 'company_name', value: 'Catalyst Capital Partners Private Limited' }
  ];

  const insertSetting = db.prepare(`
    INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)
  `);

  for (const s of settings) {
    insertSetting.run(s.key, s.value);
  }
}

initDatabase();

module.exports = { db, initDatabase };
