const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || 'localhost',
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'iets_lms',
  port: parseInt(process.env.MYSQL_PORT) || 3306,
  waitForConnections: true, connectionLimit: 5
});

async function seed() {
  let conn;
  try {
    console.log('\n╔══════════════════════════════════════════════╗');
    console.log('║  🎓 IEG LMS — Seeding Admin Only            ║');
    console.log('╚══════════════════════════════════════════════╝\n');
    conn = await pool.getConnection();

    // Only Admin — no students, no teachers, no courses
    console.log('👤 Creating admin...');
    const adminPwd = await bcrypt.hash('Admin@123', 12);
    await conn.execute(
      'INSERT IGNORE INTO users (name, email, password, role, status, is_verified) VALUES (?, ?, ?, "admin", "active", 1)',
      ['Administrator', 'admin@iets.edu', adminPwd]
    );

    console.log('\n╔══════════════════════════════════════════════╗');
    console.log('║  ✅ Done!                                    ║');
    console.log('╠══════════════════════════════════════════════╣');
    console.log('║  Admin: admin@iets.edu / Admin@123           ║');
    console.log('║                                              ║');
    console.log('║  Add teachers & students from the portal     ║');
    console.log('╚══════════════════════════════════════════════╝\n');

    conn.release();
    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Seed failed:', err.message);
    if (conn) conn.release();
    await pool.end();
    process.exit(1);
  }
}

seed();