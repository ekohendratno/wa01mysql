const mysql = require('mysql2/promise');
const crypto = require('crypto');

class InitData {
    constructor(pool) {
        this.pool = pool;
        this.initDatabase();
    }

    async initDatabase() {
        const connection = await this.pool.getConnection();
        try {
            console.log("🔹 Inisialisasi database...");

            // Buat tabel users jika belum ada
            await connection.query(`
                CREATE TABLE IF NOT EXISTS users (
                    uid INT AUTO_INCREMENT PRIMARY KEY,
                    name VARCHAR(100) NOT NULL,
                    email VARCHAR(100) UNIQUE NOT NULL,
                    phone VARCHAR(20) NOT NULL,
                    ref VARCHAR(100),
                    password VARCHAR(255) NOT NULL,
                    api_key VARCHAR(100) UNIQUE NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `);
            console.log("✅ Tabel 'users' siap digunakan.");

            // Buat tabel messages jika belum ada
            await connection.query(`
                CREATE TABLE IF NOT EXISTS messages (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    uid INT NOT NULL,
                    device_id INT NOT NULL,
                    type VARCHAR(50) NOT NULL,
                    number VARCHAR(50) NOT NULL,
                    message TEXT NOT NULL,
                    status VARCHAR(50) DEFAULT 'pending',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (uid) REFERENCES users(uid) ON DELETE CASCADE
                );
            `);
            console.log("✅ Tabel 'messages' siap digunakan.");

            // Buat tabel devices jika belum ada
            await connection.query(`
                CREATE TABLE IF NOT EXISTS devices (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    uid INT NOT NULL,
                    name VARCHAR(100) NOT NULL,
                    status VARCHAR(50) DEFAULT 'inactive',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (uid) REFERENCES users(uid) ON DELETE CASCADE
                );
            `);
            console.log("✅ Tabel 'devices' siap digunakan.");

            // Buat tabel autoreply jika belum ada
            await connection.query(`
                CREATE TABLE IF NOT EXISTS autoreply (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    uid INT NOT NULL,
                    keyword VARCHAR(255) NOT NULL,
                    reply TEXT NOT NULL,
                    status VARCHAR(50) DEFAULT 'active',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (uid) REFERENCES users(uid) ON DELETE CASCADE
                );
            `);
            console.log("✅ Tabel 'autoreply' siap digunakan.");

            // Buat tabel logs jika belum ada
            await connection.query(`
                CREATE TABLE IF NOT EXISTS logs (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    uid INT NOT NULL,
                    action VARCHAR(255) NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (uid) REFERENCES users(uid) ON DELETE CASCADE
                );
            `);
            console.log("✅ Tabel 'logs' siap digunakan.");

            // Cek apakah tabel users kosong
            const [rows] = await connection.query("SELECT COUNT(*) AS count FROM users");
            if (rows[0].count === 0) {
                const hashedPassword = crypto.randomBytes(16).toString('hex');
                await connection.query(`
                    INSERT INTO users (name, email, phone, ref, password, api_key) VALUES
                    ('Admin', 'admin@example.com', '123456789', 'None', ?, ?);
                `, [hashedPassword, this.generateAPIKey()]);
                console.log("✅ Data awal berhasil dimasukkan.");
            } else {
                console.log("ℹ️ Data awal sudah ada.");
            }
        } catch (error) {
            console.error("❌ Error inisialisasi database:", error);
        } finally {
            connection.release();
        }
    }

    generateAPIKey() {
        return crypto.randomBytes(16).toString('hex');
    }
}

module.exports = InitData;
