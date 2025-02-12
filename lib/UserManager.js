const moment = require('moment-timezone');
const { Boom } = require('@hapi/boom');

class UserManager {
    constructor(pool) {
        this.pool = pool;
    }

    

    async registerUser(name, email, phone, ref, password) {
        const connection = await this.pool.getConnection();
        try {
            const apiKey = generateAPIKey();
            const [result] = await connection.query(
                'INSERT INTO users (name, email, phone, password, api_key) VALUES (?,?,?,?)',
                [name, email, phone, password, apiKey]
            );

            return {
                uid: result.insertId,
                api_key: apiKey
            };
        } catch (error) {
            console.error('Registration error:', error);
            throw error;
        } finally {
            connection.release();
        }
    }

    

    async loginUser(username, password) {
        const connection = await this.pool.getConnection();
        try {
            const [users] = await connection.query(
                'SELECT uid, name, email, phone, api_key FROM users WHERE email = ? AND password = ? LIMIT 1',
                [username, password]
            );
            if (users.length === 0) {
                throw new Boom('Username atau password salah', { statusCode: 401 });
            }
            return users[0];
        } catch (error) {
            console.error('Login error:', error);
            throw error.isBoom ? error : new Boom('Login gagal', { statusCode: 500 });
        } finally {
            connection.release();
        }
    }

}

module.exports = UserManager;