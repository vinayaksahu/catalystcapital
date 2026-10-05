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
      VALUES ('admin', 'admin@catalystcapital.com', ?, 'Catalyst Administrator', '+91 9876543210', 'admin', 'CATADMIN', 10000.0, 0, 0, 'active')
    `, [passwordHash]);
    admin = await getUserByUsername('admin');
    console.log('✅ Created Admin: admin@catalystcapital.com / Password@123 (Ref: CATADMIN)');
  } else {
    console.log('ℹ️ Admin already exists');
  }

  // 2. Create Level 1: Rahul Sharma (Sponsor: admin)
  let user1 = await getUserByUsername('rahul');
  if (!user1) {
    await db.run(`
      INSERT INTO users (username, email, password_hash, full_name, phone, role, referral_code, sponsor_id, wallet_balance, roi_balance, commission_balance, status, usdt_address)
      VALUES ('rahul', 'rahul@example.com', ?, 'Rahul Sharma', '+91 9811122233', 'user', 'CAT1001', ?, 500.0, 0, 0, 'active', 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t')
    `, [passwordHash, admin.id]);
    user1 = await getUserByUsername('rahul');
    console.log('✅ Created Level 1 User: rahul (Ref: CAT1001, Sponsor: Admin)');

    // Activate Plan 6 ($350, 25 days, $6/day)
    await walletService.purchasePlan(user1.id, 6);
    console.log('  -> Rahul activated Plan 6 ($350)');
  } else {
    console.log('ℹ️ Rahul already exists');
  }

  // 3. Create Level 2: Priya Patel (Sponsor: rahul)
  let user2 = await getUserByUsername('priya');
  if (!user2) {
    await db.run(`
      INSERT INTO users (username, email, password_hash, full_name, phone, role, referral_code, sponsor_id, wallet_balance, roi_balance, commission_balance, status, usdt_address)
      VALUES ('priya', 'priya@example.com', ?, 'Priya Patel', '+91 9822233344', 'user', 'CAT2002', ?, 300.0, 0, 0, 'active', 'TJY8eZ7P6bQ7w1j9kXm3x4n5v6c7d8e9')
    `, [passwordHash, user1.id]);
    user2 = await getUserByUsername('priya');
    console.log('✅ Created Level 2 User: priya (Ref: CAT2002, Sponsor: rahul)');

    // Activate Plan 5 ($225, 15 days, $4.50/day)
    await walletService.purchasePlan(user2.id, 5);
    console.log('  -> Priya activated Plan 5 ($225)');
  } else {
    console.log('ℹ️ Priya already exists');
  }

  // 4. Create Level 3: Amit Verma (Sponsor: priya)
  let user3 = await getUserByUsername('amit');
  if (!user3) {
    await db.run(`
      INSERT INTO users (username, email, password_hash, full_name, phone, role, referral_code, sponsor_id, wallet_balance, roi_balance, commission_balance, status, usdt_address)
      VALUES ('amit', 'amit@example.com', ?, 'Amit Verma', '+91 9833344455', 'user', 'CAT3003', ?, 200.0, 0, 0, 'active', 'TPY4mZ8x1vQ5n7k8j9l3w4e5r6t7y8u9')
    `, [passwordHash, user2.id]);
    user3 = await getUserByUsername('amit');
    console.log('✅ Created Level 3 User: amit (Ref: CAT3003, Sponsor: priya)');

    // Activate Plan 4 ($115, 7 days, $2.50/day)
    await walletService.purchasePlan(user3.id, 4);
    console.log('  -> Amit activated Plan 4 ($115)');
  } else {
    console.log('ℹ️ Amit already exists');
  }

  // 5. Create Level 3 second branch: Neha Gupta (Sponsor: priya)
  let user4 = await getUserByUsername('neha');
  if (!user4) {
    await db.run(`
      INSERT INTO users (username, email, password_hash, full_name, phone, role, referral_code, sponsor_id, wallet_balance, roi_balance, commission_balance, status, usdt_address)
      VALUES ('neha', 'neha@example.com', ?, 'Neha Gupta', '+91 9844455566', 'user', 'CAT3004', ?, 100.0, 0, 0, 'active', 'TXW9vN2m4xL8p0k7j6h5g4f3d2s1a9q8')
    `, [passwordHash, user2.id]);
    user4 = await getUserByUsername('neha');
    console.log('✅ Created Level 3 User: neha (Ref: CAT3004, Sponsor: priya)');

    // Activate Plan 1 ($25, 25 days, $0.50/day)
    await walletService.purchasePlan(user4.id, 1);
    console.log('  -> Neha activated Plan 1 ($25)');
  } else {
    console.log('ℹ️ Neha already exists');
  }

  console.log('🎉 Seeding successfully completed!');
  process.exit(0);
}

seed().catch(err => {
  console.error('Seed error:', err);
  process.exit(1);
});
