
const { Boom } = require('@hapi/boom');

class AutoReplyManager {
    constructor(pool) {
        this.pool = pool;
    }

    

    async getAutoReply(apiKey, id = null) {
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

            // Query untuk mengambil data autoreply
            let query = `
                SELECT id, keyword, response, status, used, is_for_personal, is_for_group, created_at, updated_at 
                FROM autoreply 
                WHERE uid = ?
            `;
            const queryParams = [uid];

            if (id) {
                query += ' AND id = ?';
                queryParams.push(id);
            }

            const [autoreplies] = await connection.query(query, queryParams);

            if (id && autoreplies.length === 0) {
                throw new Boom('Auto-Reply not found', { statusCode: 404 });
            }

            // Hitung jumlah berdasarkan status dan total used
            const counts = {
                active: 0,
                inactive: 0,
                totalUsed: 0
            };

            if (!id) {
                autoreplies.forEach(reply => {
                    if (reply.status === 'active') {
                        counts.active++;
                    } else if (reply.status === 'inactive') {
                        counts.inactive++;
                    }
                    counts.totalUsed += reply.used || 0; // Tambahkan nilai used jika ada
                });
            }

            // Return hasil
            return id
                ? autoreplies[0] // Return single object jika ID
                : {
                    autoreplies: autoreplies,
                    counts: counts // Include counts hanya jika tidak ada ID
                };
        } catch (error) {
            console.error('Error retrieving autoreply:', error);
            throw error.isBoom ? error : new Boom('Database error', { statusCode: 500 });
        } finally {
            connection.release();
        }
    }


    



    async registerAutoReply(apiKey, id, keyword, response, status, is_for_personal, is_for_group) {
        const connection = await this.pool.getConnection();
        try {
            // Validasi API key
            const [user] = await connection.query(
                'SELECT uid FROM users WHERE api_key = ?',
                [apiKey]
            );
            if (!user[0]) throw new Error('Invalid API key');

            // Logika untuk update atau insert
            let result;
            if (id > 0) {
                // Update data jika id > 0
                [result] = await connection.query(
                    'UPDATE autoreply SET keyword = ?, response = ?, status = ?, is_for_personal = ?, is_for_group = ? WHERE id = ? AND uid = ?',
                    [keyword, response, status, is_for_personal, is_for_group, id, user[0].uid]
                );
                if (result.affectedRows === 0) {
                    throw new Error('No rows updated. Check if the ID exists and belongs to the user.');
                }
                return {
                    id: id,
                    keyword: keyword,
                    response: response,
                    status: status,
                    is_for_personal: is_for_personal,
                    is_for_group: is_for_group,
                };
            } else {
                // Insert data jika id <= 0
                [result] = await connection.query(
                    'INSERT INTO autoreply (uid, keyword, response, status, is_for_personal, is_for_group) VALUES (?, ?, ?, ?, ?, ?)',
                    [user[0].uid, keyword, response, status, is_for_personal, is_for_group]
                );
                return {
                    id: result.insertId,
                    keyword: keyword,
                    response: response,
                    status: status,
                    is_for_personal: is_for_personal,
                    is_for_group: is_for_group,
                };
            }
        } catch (error) {
            console.error('Registration error:', error);
            throw error;
        } finally {
            connection.release();
        }
    }

    async removeAutoReply(apiKey, autoreplyId) {
        const connection = await this.pool.getConnection();
        try {
            const [row] = await connection.query(
                'SELECT uid FROM users WHERE api_key = ?',
                [apiKey]
            );

            if (!row[0]) throw new Boom('Invalid API key', { statusCode: 401 });

            const [result] = await connection.query(
                'DELETE FROM autoreply WHERE uid = ? AND id = ?',
                [row[0].uid, autoreplyId]
            );

            if (result.affectedRows === 0) {
                throw new Boom('AutoReply not found', { statusCode: 404 });
            }

            return { status: true };
        } catch (error) {
            console.error('Error removing autoreply:', error);
            throw error.isBoom ? error : new Boom('Database error', { statusCode: 500 });
        } finally {
            connection.release();
        }
    }

    
}

module.exports = AutoReplyManager;