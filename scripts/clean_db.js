require('dotenv').config();
const bcrypt = require('bcryptjs');
const { db, initDatabase } = require('../backend/src/db/database');

async function cleanDatabase() {
  console.log('==================================================');
  console.log('🧹 Catalyst Capital - Purging all non-admin users');
  console.log(`Database Target: ${db.isPostgres ? 'Neon Postgres' : 'SQLite'}`);
  console.log('==================================================');

  await initDatabase();

  const passwordHash = await bcrypt.hash('Password@123', 10);

  // 1. Check if admin exists
  let admin = await db.get("SELECT * FROM users WHERE username = 'admin' OR role = 'admin' LIMIT 1");

  if (!admin) {
    console.log('⚠️ Admin user not found! Creating master admin...');
    await db.run(`
      INSERT INTO users (username, email, password_hash, full_name, phone, role, referral_code, wallet_balance, roi_balance, commission_balance, status)
      VALUES ('admin', 'admin@catalystcapital.com', ?, 'Catalyst Administrator', '+91 9876543210', 'admin', 'CATADMIN', 10000.0, 0, 0, 'active')
    `, [passwordHash]);
    admin = await db.get("SELECT * FROM users WHERE username = 'admin' LIMIT 1");
    console.log(`✅ Admin created with ID ${admin.id}`);
  } else {
    // Ensure admin has role 'admin', username 'admin', active status, and password 'Password@123'
    await db.run(`
      UPDATE users 
      SET password_hash = ?, role = 'admin', username = 'admin', status = 'active'
      WHERE id = ?
    `, [passwordHash, admin.id]);
    console.log(`✅ Verified and updated master Admin (ID: ${admin.id}, Username: admin)`);
  }

  // 2. Delete all records associated with non-admin users
  console.log('🗑️ Removing dependent records for non-admin users...');
  await db.run("DELETE FROM transactions WHERE user_id != ? OR (from_user_id IS NOT NULL AND from_user_id != ?)", [admin.id, admin.id]);
  await db.run("DELETE FROM investments WHERE user_id != ?", [admin.id]);
  await db.run("DELETE FROM withdrawals WHERE user_id != ?", [admin.id]);
  await db.run("DELETE FROM deposits WHERE user_id != ?", [admin.id]);

  // 3. Delete all non-admin users
  console.log('🗑️ Deleting all non-admin users...');
  const deleteRes = await db.run("DELETE FROM users WHERE id != ?", [admin.id]);
  console.log(`✅ Removed non-admin users from database.`);

  // 4. Verify remaining users
  const remainingUsers = await db.all("SELECT id, username, email, role, referral_code, wallet_balance FROM users");
  console.log('--------------------------------------------------');
  console.log('👥 Current Users in Database:');
  console.table(remainingUsers);
  console.log('--------------------------------------------------');
  console.log('🎉 Database cleaned! ONLY admin user remains.');
  // Also clean local SQLite file if it exists
  const fs = require('node:fs');
  const path = require('node:path');
  const sqliteFile = path.join(__dirname, '..', 'catalyst.db');
  if (fs.existsSync(sqliteFile)) {
    try {
      const { DatabaseSync } = require('node:sqlite');
      const sdb = new DatabaseSync(sqliteFile);
      sdb.exec('PRAGMA foreign_keys = OFF;');
      let sAdmin = sdb.prepare("SELECT * FROM users WHERE username = 'admin' OR role = 'admin'").get();
      if (!sAdmin) {
        sdb.prepare("INSERT INTO users (username, email, password_hash, full_name, phone, role, referral_code, wallet_balance, status) VALUES ('admin', 'admin@catalystcapital.com', ?, 'Catalyst Administrator', '+91 9876543210', 'admin', 'CATADMIN', 10000.0, 'active')").run(passwordHash);
        sAdmin = sdb.prepare("SELECT * FROM users WHERE username = 'admin'").get();
      } else {
        sdb.prepare("UPDATE users SET password_hash = ?, role = 'admin', username = 'admin', status = 'active' WHERE id = ?").run(passwordHash, sAdmin.id);
      }
      sdb.prepare('DELETE FROM users WHERE id != ?').run(sAdmin.id);
      sdb.prepare('DELETE FROM transactions WHERE user_id != ?').run(sAdmin.id);
      sdb.prepare('DELETE FROM investments WHERE user_id != ?').run(sAdmin.id);
      sdb.prepare('DELETE FROM withdrawals WHERE user_id != ?').run(sAdmin.id);
      sdb.prepare('DELETE FROM deposits WHERE user_id != ?').run(sAdmin.id);
      sdb.exec('PRAGMA foreign_keys = ON;');
      console.log('📁 Local SQLite (catalyst.db) also purged to ONLY Admin!');
    } catch (e) {
      console.warn('Note on SQLite purge:', e.message);
    }
  }
}

cleanDatabase()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ Error cleaning database:', err);
    process.exit(1);
  });

