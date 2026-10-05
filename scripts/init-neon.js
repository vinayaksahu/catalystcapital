require('dotenv').config();
const { db, initDatabase } = require('../backend/src/db/database');
const bcrypt = require('bcryptjs');

async function main() {
  console.log('====================================================');
  console.log('🐘 CATALYST CAPITAL - NEON POSTGRESQL INITIALIZER');
  console.log('====================================================');

  if (!process.env.DATABASE_URL) {
    console.warn('⚠️ WARNING: DATABASE_URL is not defined in your environment or .env file.');
    console.log('Running on local fallback mode...');
  } else {
    console.log('🔗 Connecting to Neon PostgreSQL...');
  }

  try {
    // 1. Initialize Tables & System Settings
    console.log('📦 Creating database tables (users, plans, investments, transactions, withdrawals)...');
    await initDatabase();
    console.log('✅ Tables initialized successfully!');

    // 2. Ensure Super Admin exists
    const adminUser = await db.get("SELECT id, username, email FROM users WHERE username = 'admin'");
    if (!adminUser) {
      console.log('👤 Creating default Super Admin account...');
      const passwordHash = await bcrypt.hash('Password@123', 10);
      await db.run(`
        INSERT INTO users (username, email, password_hash, full_name, phone, role, referral_code, wallet_balance, roi_balance, commission_balance, status)
        VALUES ('admin', 'admin@catalystcapital.com', ?, 'Catalyst Administrator', '+91 9876543210', 'admin', 'CATADMIN', 10000.0, 0, 0, 'active')
      `, [passwordHash]);
      console.log('✅ Admin created: admin@catalystcapital.com / Password@123 (Ref: CATADMIN)');
    } else {
      console.log('ℹ️ Super Admin already exists.');
    }

    // 3. Verify Plans
    const plans = await db.all('SELECT id, name, price, duration_days, daily_roi, total_roi FROM plans ORDER BY price ASC');
    console.log(`\n📋 Verified ${plans.length} Catalyst Capital Investment Plans:`);
    for (const p of plans) {
      console.log(`   - ${p.name}: $${p.price} | ${p.duration_days} Days | $${p.daily_roi}/day (Total: $${p.total_roi})`);
    }

    console.log('\n====================================================');
    console.log('🎉 Neon PostgreSQL is ready for production on Vercel!');
    console.log('====================================================');
    process.exit(0);
  } catch (err) {
    console.error('❌ Failed to initialize database:', err);
    process.exit(1);
  }
}

main();
