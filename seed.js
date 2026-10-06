require('dotenv').config();
const bcrypt = require('bcryptjs');
const { db, initDatabase } = require('./backend/src/db/database');
const walletService = require('./backend/src/services/walletService');

async function seed() {
  console.log('🌱 Starting Catalyst Capital Seeder...');
  console.log(`Database target: ${db.isPostgres ? 'Neon Serverless Postgres' : 'Local SQLite'}`);

  await initDatabase();

  const passwordHash = await bcrypt.hash('Password@123', 10);

  // Helper to find user by username
  const getUserByUsername = async (username) => {
    return await db.get('SELECT * FROM users WHERE username = ?', [username]);
  };

  // 1. Create Super Admin if not exists
  let admin = await getUserByUsername('admin');
  if (!admin) {
    await db.run(`
      INSERT INTO users (username, email, password_hash, full_name, phone, role, referral_code, wallet_balance, roi_balance, commission_balance, status)
      VALUES ('admin', 'vinayaksahu293@gmail.com', ?, 'Catalyst Administrator', '+91 9876543210', 'admin', 'CATADMIN', 10000.0, 0, 0, 'active')
    `, [passwordHash]);
    admin = await getUserByUsername('admin');
    console.log('✅ Created Admin: vinayaksahu293@gmail.com / Password@123 (Ref: CATADMIN)');
  } else {
    console.log('ℹ️ Admin already exists');
  }

  console.log('🎉 Seeding successfully completed! Only Master Admin exists.');
  process.exit(0);
}

seed().catch(err => {
  console.error('Seed error:', err);
  process.exit(1);
});

