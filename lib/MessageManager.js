const moment = require('moment-timezone');
const { Boom } = require('@hapi/boom');

class MessageManager {
    constructor(pool) {
        this.pool = pool;
    }


    async getMessages(apiKey, status = '') {
        const connection = await this.pool.getConnection();
        try {
            // Fetch user by API key
            const [users] = await connection.query(
                'SELECT uid FROM users WHERE api_key = ? LIMIT 1',
                [apiKey]
            );
            if (users.length === 0) {
                throw new Boom('Invalid API key', { statusCode: 401 });
            }

            const uid = users[0].uid;
            const todayStart = moment().tz('Asia/Jakarta').startOf('day').format('YYYY-MM-DD HH:mm:ss');
            const todayEnd = moment().tz('Asia/Jakarta').endOf('day').format('YYYY-MM-DD HH:mm:ss');

            let query = 'SELECT * FROM messages WHERE uid = ? AND created_at BETWEEN ? AND ?';
            const queryParams = [uid, todayStart, todayEnd];

            // If a status is specified, filter by status
            if (status !== 'all') {
                query += ' AND status = ?';
                queryParams.push(status);
            }

            query += ' ORDER BY created_at DESC';

            // Fetch the messages
            const [messages] = await connection.query(query, queryParams);

            // Fetch counts for each status (sent, pending, failed, processing)
            const [statusCounts] = await connection.query(
                'SELECT status, COUNT(*) AS count FROM messages WHERE uid = ? AND created_at BETWEEN ? AND ? GROUP BY status',
                [uid, todayStart, todayEnd]
            );

            const counts = {};
            statusCounts.forEach(row => {
                counts[row.status] = row.count;
            });

            // Set default counts for any missing statuses
            ['sent', 'pending', 'failed', 'processing'].forEach(s => {
                counts[s] = counts[s] || 0;
            });

            // Calculate total count by summing all status counts
            const totalCount = Object.values(counts).reduce((total, count) => total + count, 0);

            // Combine counts and totalCount into a single object
            counts.totalCount = totalCount;

            // Return both the messages and the combined counts object
            return { messages, counts };
        } catch (error) {
            console.error('Error retrieving messages:', error);
            throw error.isBoom ? error : new Boom('Database error', { statusCode: 500 });
        } finally {
            connection.release();
        }
    }





    async registerMessage(apiKey, deviceKey, messageData) {
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
                'SELECT id FROM devices WHERE uid = ? AND device_key = ? LIMIT 1',
                [uid, deviceKey]
            );
            if (devices.length === 0) {
                throw new Boom('Invalid Device Key', { statusCode: 401 });
            }
            const deviceId = devices[0].id;
            const { isGroup, to, text } = messageData;
            let type = 'personal';
            if (isGroup) {
                type = 'group';
            } else {
                const recipients = to.split(',').map((recipient) => recipient.trim());
                if (recipients.length > 1) {
                    type = 'bulk';
                }
            }

            const [result] = await connection.query(
                'INSERT INTO messages (uid, device_id, type, number, message, created_at) ' +
                'VALUES (?, ?, ?, ?, ?, NOW())',
                [uid, deviceId, type, to, text]
            );

            return {
                status: true,
                message: 'Message registered successfully',
                messageId: result.insertId
            };
        } catch (error) {
            console.error('Error registering message:', error);
            throw error.isBoom ? error : new Boom('Database error', { statusCode: 500 });
        } finally {
            connection.release();
        }
    }


    async removeMessage(apiKey, id) {
        const connection = await this.pool.getConnection();
        try {
            const [user] = await connection.query(
                'SELECT uid FROM users WHERE api_key = ?',
                [apiKey]
            );

            if (!user[0]) throw new Boom('Invalid API key', { statusCode: 401 });

            const [result] = await connection.query(
                'DELETE FROM messages WHERE uid = ? AND id = ?',
                [user[0].uid, id]
            );

            if (result.affectedRows === 0) {
                throw new Boom('Message not found', { statusCode: 404 });
            }

            return { status: true };
        } catch (error) {
            console.error('Error removing message:', error);
            throw error.isBoom ? error : new Boom('Database error', { statusCode: 500 });
        } finally {
            connection.release();
        }
    }

    async retryMessage(apiKey, id) {
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
            const uid = users[0].uid;
    
            // Periksa apakah pesan ada dan milik pengguna
            const [messages] = await connection.query(
                'SELECT id, status FROM messages WHERE uid = ? AND id = ? LIMIT 1',
                [uid, id]
            );
            if (messages.length === 0) {
                throw new Boom('Message not found', { statusCode: 404 });
            }
    
            const message = messages[0];
            if (message.status !== 'failed' && message.status !== 'pending') {
                throw new Boom('Message cannot be retried', { statusCode: 400 });
            }
    
            // Update status pesan menjadi "pending"
            await connection.query(
                'UPDATE messages SET status = ?, updated_at = NOW() WHERE id = ?',
                ['pending', id]
            );
    
            return {
                status: true,
                message: 'Message status updated to pending for retry',
            };
        } catch (error) {
            console.error('Error confirming retry:', error);
            throw error.isBoom ? error : new Boom('Database error', { statusCode: 500 });
        } finally {
            connection.release();
        }
    }


    
    // Fungsi untuk mendapatkan jumlah pesan berdasarkan status
    async getMessageCounts(apiKey) {
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

            // Hitung jumlah pesan berdasarkan status
            const [messageCounts] = await connection.query(
                'SELECT status, COUNT(*) AS count FROM messages WHERE uid = ? GROUP BY status',
                [userId]
            );

            // Format hasil menjadi objek dengan kunci status
            const counts = {};
            messageCounts.forEach(row => {
                counts[row.status] = row.count;
            });

            // Tambahkan default value untuk status yang mungkin tidak ada
            const defaultStatuses = ['sent', 'pending', 'failed', 'processing'];
            defaultStatuses.forEach(status => {
                counts[status] = counts[status] || 0;
            });

            return counts;
        } catch (error) {
            console.log('Error retrieving message counts:');
            throw error.isBoom ? error : new Boom('Database error', { statusCode: 500 });
        } finally {
            connection.release();
        }
    }

}

module.exports = MessageManager;