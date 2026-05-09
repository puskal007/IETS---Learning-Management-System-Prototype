const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
require('dotenv').config();

async function fixPassword() {
    const connection = await mysql.createConnection({
        host: process.env.MYSQL_HOST || 'localhost',
        user: process.env.MYSQL_USER || 'root',
        password: process.env.MYSQL_PASSWORD || 'password',
        port: parseInt(process.env.MYSQL_PORT) || 3306
    });
    
    await connection.execute('USE ieg_lms');
    
    // Hash the plain text password 'admin123'
    const hashedPassword = await bcrypt.hash('admin123', 12);
    console.log('New hashed password:', hashedPassword);
    
    // Update the admin user
    const [result] = await connection.execute(
        'UPDATE users SET password = ? WHERE email = ?',
        [hashedPassword, 'admin@iets.edu']
    );
    
    console.log('✅ Password updated! Rows affected:', result.affectedRows);
    
    // Verify the update
    const [users] = await connection.execute('SELECT email, role, LEFT(password, 20) as pwd_prefix FROM users WHERE email = ?', ['admin@iets.edu']);
    console.log('Updated user:', users[0]);
    
    await connection.end();
}

fixPassword().catch(console.error);
