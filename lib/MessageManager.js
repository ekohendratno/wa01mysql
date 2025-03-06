const moment = require('moment-timezone');
const { Boom } = require('@hapi/boom');
const { isValidGroupId, isValidPhoneNumber } = require('../lib/Utils');

class MessageManager {
    constructor(pool, sessionManager) {
        this.pool = pool;
        this.sessionManager = sessionManager;
    }


    async getMessages(apiKey, status = '') {
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
            const todayStart = moment().tz('Asia/Jakarta').startOf('day').format('YYYY-MM-DD HH:mm:ss');
            const todayEnd = moment().tz('Asia/Jakarta').endOf('day').format('YYYY-MM-DD HH:mm:ss');

            let query = 'SELECT * FROM messages WHERE uid = ? AND created_at BETWEEN ? AND ?';
            const queryParams = [uid, todayStart, todayEnd];

            if (status !== 'all') {
                query += ' AND status = ?';
                queryParams.push(status);
            }

            query += ' ORDER BY created_at DESC';

            const [messages] = await connection.query(query, queryParams);
            const [statusCounts] = await connection.query(
                'SELECT status, COUNT(*) AS count FROM messages WHERE uid = ? AND created_at BETWEEN ? AND ? GROUP BY status',
                [uid, todayStart, todayEnd]
            );

            const counts = {};
            statusCounts.forEach(row => {
                counts[row.status] = row.count;
            });

            ['sent', 'pending', 'failed', 'processing'].forEach(s => {
                counts[s] = counts[s] || 0;
            });

            const totalCount = Object.values(counts).reduce((total, count) => total + count, 0);
            counts.totalCount = totalCount;
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

            // Ambil waktu sekarang dengan timezone Asia/Jakarta
            const createdAt = moment().tz("Asia/Jakarta").format("YYYY-MM-DD HH:mm:ss");

            const [result] = await connection.query(
                'INSERT INTO messages (uid, device_id, type, number, message, created_at) ' +
                'VALUES (?, ?, ?, ?, ?, ?)',
                [uid, deviceId, type, to, text, createdAt]
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

            // Ambil waktu sekarang dengan timezone Asia/Jakarta
            const updatedAt = moment().tz("Asia/Jakarta").format("YYYY-MM-DD HH:mm:ss");

            // Update status pesan menjadi "pending"
            await connection.query(
                'UPDATE messages SET status = ?, updated_at = ? WHERE id = ?',
                ['pending', updatedAt, id]
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


    async getMessageCounts(apiKey) {
        const connection = await this.pool.getConnection();
        try {
            const [users] = await connection.query(
                'SELECT uid FROM users WHERE api_key = ? LIMIT 1',
                [apiKey]
            );
            if (users.length === 0) {
                throw new Boom('Invalid API key', { statusCode: 401 });
            }
            const userId = users[0].uid;

            const [messageCounts] = await connection.query(
                'SELECT status, COUNT(*) AS count FROM messages WHERE uid = ? GROUP BY status',
                [userId]
            );

            const counts = {};
            messageCounts.forEach(row => {
                counts[row.status] = row.count;
            });

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

    async sendMessage(apiKey, deviceKey, to, text, group = false) {
        const session = this.sessionManager.getSession(deviceKey);
        if (!session || !session.connected) {
            throw new Error("Session not found or not connected.");
        }

        const recipients = to.split(',').map((recipient) => recipient.trim());
        const invalidRecipients = [];
        const results = [];

        for (const recipient of recipients) {
            try {
                if (group) {
                    if (!isValidGroupId(recipient)) {
                        invalidRecipients.push(recipient);
                        results.push({
                            recipient,
                            status: false,
                            message: "Invalid Group ID format."
                        });
                        continue;
                    }
                    await session.socket.sendMessage(recipient, { text });
                } else {
                    if (!isValidPhoneNumber(recipient)) {
                        invalidRecipients.push(recipient);
                        results.push({
                            recipient,
                            status: false,
                            message: "Invalid phone number format."
                        });
                        continue;
                    }

                    const formattedNumber = recipient.includes("@s.whatsapp.net")
                        ? recipient
                        : `${recipient}@s.whatsapp.net`;
                    await session.socket.sendMessage(formattedNumber, { text });
                }

                results.push({
                    recipient,
                    status: true,
                    message: "Message sent successfully."
                });
            } catch (error) {
                results.push({
                    recipient,
                    status: false,
                    message: `Failed to send message: ${error.message}`
                });
            }
        }

        return {
            status: true,
            message: "Message processing completed.",
            data: {
                results,
                invalidRecipients
            }
        };
    }


    async getMessageStatistics(apiKey) {
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
    
            // Ambil data statistik berdasarkan status pesan
            const [statistics] = await connection.query(
                `SELECT status, COUNT(*) AS count 
                 FROM messages 
                 WHERE uid = ? AND created_at >= NOW() - INTERVAL 7 DAY 
                 GROUP BY status`,
                [uid]
            );
    
            // Ambil jumlah pesan per hari selama 7 hari terakhir
            const [dailyStats] = await connection.query(
                `SELECT DATE(created_at) AS date, 
                        SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent,
                        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
                        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
                 FROM messages 
                 WHERE uid = ? AND created_at >= NOW() - INTERVAL 7 DAY 
                 GROUP BY DATE(created_at)
                 ORDER BY DATE(created_at) ASC`,
                [uid]
            );
    
            // Format statistik berdasarkan status
            const stats = {
                sent: 0,
                pending: 0,
                failed: 0,
                total: 0,
                daily: []
            };
    
            statistics.forEach(row => {
                stats[row.status] = row.count;
                stats.total += row.count;
            });
    
            // Format data harian untuk chart
            const formattedDailyStats = dailyStats.map(row => ({
                date: row.date,
                sent: row.sent,
                pending: row.pending,
                failed: row.failed
            }));
    
            stats.daily = formattedDailyStats;
    
            return stats;
        } catch (error) {
            console.error('Error retrieving message statistics:', error);
            throw error.isBoom ? error : new Boom('Database error', { statusCode: 500 });
        } finally {
            connection.release();
        }
    }
    

}

module.exports = MessageManager;