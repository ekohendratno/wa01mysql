const moment = require('moment-timezone');
const { Boom } = require('@hapi/boom');
const { generateAPIKey, generateDeviceID } = require('../lib/Generate');
const { calculateLastActive } = require('../lib/Utils');

class DeviceManager {
    constructor(pool) {
        this.pool = pool;
    }


    async registerDevice(apiKey, deviceName, phone, packageId) {
        const connection = await this.pool.getConnection();
        try {
            const [user] = await connection.query(
                'SELECT uid FROM users WHERE api_key = ?',
                [apiKey]
            );
            if (!user[0]) throw new Error('Invalid API key');

            const userId = user[0].uid;

            const [packages] = await connection.query(
                'SELECT id, name, price FROM packages WHERE id = ?',
                [packageId]
            );
            if (packages.length === 0) throw new Error('Paket tidak ditemukan');

            const packageDetails = packages[0];
            const packagePrice = parseFloat(packageDetails.price);

            const [balances] = await connection.query(
                'SELECT balance FROM balances WHERE uid = ?',
                [userId]
            );
            const balance = balances[0]?.balance || 0;

            if (balance < packagePrice) {
                throw new Error('Saldo tidak mencukupi. Silakan top-up terlebih dahulu.');
            }

            await connection.beginTransaction();
            await connection.query(
                'UPDATE balances SET balance = balance - ? WHERE uid = ?',
                [packagePrice, userId]
            );

            const description = `Pembelian Paket Device (${packageDetails.name})`;
            await connection.query(
                'INSERT INTO transactions (uid, description, amount, status, whatIs) VALUES (?, ?, ?, ?, ?)',
                [userId, description, -packagePrice, 'success', '-']
            );

            const deviceKey = generateDeviceID();
            await connection.query(
                'INSERT INTO devices (uid, name, phone, device_key, packageId) VALUES (?, ?, ?, ?, ?)',
                [userId, deviceName, phone, deviceKey, packageId]
            );

            // Commit transaksi
            await connection.commit();

            return {
                status: true,
                message: 'Device berhasil ditambahkan.',
                data: {
                    device_key: deviceKey,
                    name: deviceName
                }
            };
        } catch (error) {
            await connection.rollback();
            console.error('Error registering device:', error);
            throw error;
        } finally {
            connection.release();
        }
    }

    async removeDevice(apiKey, deviceKey) {
        const connection = await this.pool.getConnection();
        try {
            const [user] = await connection.query(
                'SELECT uid FROM users WHERE api_key = ?',
                [apiKey]
            );

            if (!user[0]) throw new Boom('Invalid API key', { statusCode: 401 });

            const [result] = await connection.query(
                'DELETE FROM devices WHERE uid = ? AND device_key = ?',
                [user[0].uid, deviceKey]
            );

            if (result.affectedRows === 0) {
                throw new Boom('Device not found', { statusCode: 404 });
            }

            return { status: true };
        } catch (error) {
            console.error('Error removing device:', error);
            throw error.isBoom ? error : new Boom('Database error', { statusCode: 500 });
        } finally {
            connection.release();
        }
    }

    async updateDeviceStatus(deviceKey, status) {
        const connection = await this.pool.getConnection();
        try {
            await connection.query(
                'UPDATE devices SET status = ?, updated_at = NOW() WHERE device_key = ?',
                [status, deviceKey]
            );
        } catch (error) {
            console.error('Error updating device status:', error);
        } finally {
            connection.release();
        }
    }

    async getDevices(apiKey, where = {}) {
        const connection = await this.pool.getConnection();
        try {
            const [users] = await connection.query(
                'SELECT uid FROM users WHERE api_key = ? LIMIT 1',
                [apiKey]
            );
            if (users.length === 0) {
                throw new Boom('Invalid API key', { statusCode: 401 });
            }
            const uid = users[0].uid;

            let query = `
                SELECT id, name, phone, device_key, status, created_at, updated_at 
                FROM devices 
                WHERE uid = ?
            `;
            const queryParams = [uid];

            if (where.status) {
                query += ' AND status = ?';
                queryParams.push(where.status);
            }

            const [devices] = await connection.query(query, queryParams);


            const result = devices.map(device => {
                const lastActive = calculateLastActive(device.updated_at);
                return {
                    ...device,
                    last_active: lastActive
                };
            });

            return result;

        } catch (error) {
            console.error('Error retrieving devices:', error);
            throw error.isBoom ? error : new Boom('Database error', { statusCode: 500 });
        } finally {
            connection.release();
        }
    }


    async getDevice(apiKey, deviceKey) {
        const connection = await this.pool.getConnection();
        try {
            const [users] = await connection.query(
                'SELECT uid FROM users WHERE api_key = ? LIMIT 1',
                [apiKey]
            );

            if (users.length === 0) {
                throw new Boom('Invalid API key', { statusCode: 401 });
            }

            const uid = users[0].uid;
            const [devices] = await connection.query(
                'SELECT id, name, phone, device_key, status, created_at, updated_at ' +
                'FROM devices WHERE uid = ? AND device_key = ?',
                [uid, deviceKey]
            );

            const device = devices[0];

            const lastActive = calculateLastActive(device.updated_at);
            return {
                ...device,
                last_active: lastActive
            };

        } catch (error) {
            console.error('Error retrieving devices:', error);
            throw error.isBoom ? error : new Boom('Database error', { statusCode: 500 });
        } finally {
            connection.release();
        }
    }


    // Fungsi untuk mendapatkan jumlah perangkat aktif
    async getActiveDeviceCount(apiKey) {
        const connection = await this.pool.getConnection();
        try {
            // Validasi API key
            const [users] = await connection.query(
                'SELECT uid FROM users WHERE api_key = ? LIMIT 1',
                [apiKey]
            );
            if (users.length === 0) {
                throw new Boom('Invalid API key', { statusCode: 401 });
            }
            const userId = users[0].uid;

            // Hitung jumlah perangkat aktif
            const [activeDevices] = await connection.query(
                'SELECT COUNT(*) AS activeCount FROM devices WHERE uid = ? AND status = ?',
                [userId, 'connected']
            );

            return activeDevices[0].activeCount || 0;
        } catch (error) {
            console.error('Error retrieving active device count:', error);
            throw error.isBoom ? error : new Boom('Database error', { statusCode: 500 });
        } finally {
            connection.release();
        }
    }

    // Fungsi untuk mendapatkan daftar perangkat dengan last_active
    async getDevicesWithLastActive(apiKey) {
        if (!apiKey) {
            throw new Boom('API key is required', { statusCode: 400 });
        }
    
        const connection = await this.pool.getConnection();
        try {
            // Validasi API key
            const [users] = await connection.query(
                'SELECT uid FROM users WHERE api_key = ? LIMIT 1',
                [apiKey]
            );
            if (users.length === 0) {
                throw new Boom('Invalid API key', { statusCode: 401 });
            }
            const userId = users[0].uid;
    
            // Ambil satu perangkat terakhir yang aktif berdasarkan updated_at terbaru
            const [devices] = await connection.query(
                'SELECT id, name, phone, device_key, status, created_at, updated_at FROM devices WHERE uid = ? ORDER BY updated_at DESC LIMIT 1',
                [userId]
            );
    
            // Jika tidak ada perangkat, kembalikan null
            if (devices.length === 0) {
                return null;
            }
    
            const device = devices[0];
    
            return {
                ...device,
                last_active: device.updated_at ? moment(device.updated_at).fromNow() : 'Tidak tersedia',
            };
    
        } catch (error) {
            console.error('Error retrieving latest active device:', error);
            throw error.isBoom ? error : new Boom('Database error', { statusCode: 500 });
        } finally {
            connection.release();
        }
    }
    


}

module.exports = DeviceManager;