const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
require('dotenv').config();

async function createAdmin() {
    const password = 'admin123';
    const hashedPassword = await bcrypt.hash(password, 10);
    
    console.log('Plain password:', password);
    console.log('Hashed password:', hashedPassword);
    
    const connection = await mysql.createConnection({
        host: process.env.MYSQL_HOST || 'localhost',
        user: process.env.MYSQL_USER || 'root',
        password: process.env.MYSQL_PASSWORD || 'password',
        port: parseInt(process.env.MYSQL_PORT) || 3306
    });
    
    await connection.execute('USE ieg_lms');
    
    // Delete existing admin
    await connection.execute('DELETE FROM users WHERE email = ?', ['admin@iets.edu']);
    
    // Insert new admin with hashed password
    await connection.execute(
        'INSERT INTO users (name, email, password, role, status) VALUES (?, ?, ?, ?, ?)',
        ['Admin User', 'admin@iets.edu', hashedPassword, 'admin', 'active']
    );
    
    console.log('✅ Admin user created successfully!');
    
    // Verify
    const [rows] = await connection.execute('SELECT id, email, role FROM users WHERE email = ?', ['admin@iets.edu']);
    console.log('Verified:', rows);
    
    await connection.end();
}

createAdmin().catch(console.error);
