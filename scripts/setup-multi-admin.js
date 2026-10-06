const bcrypt = require('bcryptjs');
const { db, initDatabase } = require('../backend/src/db/database');

async function setupMultiAdminSchema() {
  await initDatabase();

  console.log('Ensuring team_admin_id and team_name columns exist...');
  if (db.isPostgres) {
    await db.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS team_admin_id INTEGER REFERENCES users(id)');
    await db.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS team_name VARCHAR(100)');
  } else {
    try { await db.run('ALTER TABLE users ADD COLUMN team_admin_id INTEGER REFERENCES users(id)'); } catch(e){}
    try { await db.run('ALTER TABLE users ADD COLUMN team_name TEXT'); } catch(e){}
  }

  // 1. Super Root Admin
  const superAdmin = await db.get("SELECT id FROM users WHERE username = 'superrootadmin' OR role = 'superadmin'");
  if (!superAdmin) {
    const superHash = await bcrypt.hash('SuperRoot@2026', 10);
    await db.run(`
      INSERT INTO users (username, email, password_hash, full_name, phone, role, referral_code, wallet_balance, status)
      VALUES ('superrootadmin', 'superrootadmin@catalystcapital.fit', ?, 'Super Root Administrator', '+10000000000', 'superadmin', 'ROOTADMIN', 0, 'active')
    `, [superHash]);
    console.log('👑 Created Super Root Admin: superrootadmin / SuperRoot@2026');
  } else {
    // Ensure role is superadmin
    await db.run("UPDATE users SET role = 'superadmin' WHERE username = 'superrootadmin'");
    console.log('👑 Super Root Admin exists');
  }

  // 2. Team Admins (DF_TEAM_A, DF_TEAM_B, DF_TEAM_C)
  const defaultTeamAdmins = [
    { username: 'DF_TEAM_A', email: 'df_team_a@catalystcapital.fit', fullName: 'Team A Admin', teamName: 'Team A', ref: 'DF_TEAM_A', pass: 'Password@123' },
    { username: 'DF_TEAM_B', email: 'df_team_b@catalystcapital.fit', fullName: 'Team B Admin', teamName: 'Team B', ref: 'DF_TEAM_B', pass: 'Password@123' },
    { username: 'DF_TEAM_C', email: 'df_team_c@catalystcapital.fit', fullName: 'Team C Admin', teamName: 'Team C', ref: 'DF_TEAM_C', pass: 'Password@123' }
  ];

  for (const adm of defaultTeamAdmins) {
    const existing = await db.get("SELECT id FROM users WHERE username = ?", [adm.username]);
    if (!existing) {
      const hash = await bcrypt.hash(adm.pass, 10);
      const res = await db.run(`
        INSERT INTO users (username, email, password_hash, full_name, phone, role, referral_code, team_name, wallet_balance, status)
        VALUES (?, ?, ?, ?, '+10000000000', 'admin', ?, ?, 1000, 'active')
      `, [adm.username, adm.email, hash, adm.fullName, adm.ref, adm.teamName]);
      const newId = res.lastInsertRowid;
      await db.run("UPDATE users SET team_admin_id = ? WHERE id = ?", [newId, newId]);
      console.log(`🛡️ Created Team Admin: ${adm.username} / ${adm.pass} (${adm.teamName})`);
    } else {
      await db.run("UPDATE users SET role = 'admin', team_admin_id = id, team_name = ? WHERE id = ?", [adm.teamName, existing.id]);
      console.log(`🛡️ Updated Team Admin: ${adm.username}`);
    }
  }

  // Backfill existing users: link to DF_TEAM_A so they appear in Team A
  const teamA = await db.get("SELECT id FROM users WHERE username = 'DF_TEAM_A'");
  if (teamA) {
    await db.run("UPDATE users SET team_admin_id = ? WHERE role = 'user' AND (team_admin_id IS NULL OR team_admin_id = 0)", [teamA.id]);
    console.log(`✅ Backfilled existing users to Team A (team_admin_id: ${teamA.id})`);
  }

  // Verification printout
  const allAdmins = await db.all("SELECT id, username, email, role, team_name, referral_code, team_admin_id FROM users WHERE role IN ('superadmin', 'admin')");
  console.log('\n--- ACTIVE ADMINS IN DATABASE ---');
  console.table(allAdmins);

  process.exit(0);
}

setupMultiAdminSchema().catch(err => {
  console.error('Setup error:', err);
  process.exit(1);
});
