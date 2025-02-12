const cron = require('node-cron');
const axios = require('axios');
const moment = require('moment-timezone');

class CronManager {
    constructor(pool) {
        this.pool = pool;
    }

    async initCrons() {
        console.log("Initializing cron jobs...");

        // Cron for Group Messages
        cron.schedule('*/1 * * * *', async () => {
            // console.log('Running group message processing cron...');
            await this.processMessagesByRole('group');
        });

        // Cron for Guru Messages
        cron.schedule('*/1 * * * *', async () => {
            // console.log('Running guru message processing cron...');
            await this.processMessagesByRole('guru');
        });

        // Cron for Murid Messages
        cron.schedule('*/1 * * * *', async () => {
            // console.log('Running murid message processing cron...');
            await this.processMessagesByRole('siswa');
        });

        // Cron for Wali Messages
        cron.schedule('*/1 * * * *', async () => {
            // console.log('Running wali message processing cron...');
            await this.processMessagesByRole('ortu');
        });


        // Cron untuk menghapus pesan lama
        cron.schedule('*/30 * * * *', async () => {
            console.log('Running message cleanup cron...');
            await this.deleteOldMessages();
        });
    }

    async deleteOldMessages() {
        const now = moment().tz('Asia/Jakarta');
        const deleteSentTime = now.subtract(12, 'hours').format('YYYY-MM-DD HH:mm:ss');
        const deleteOtherTime = now.subtract(24, 'hours').format('YYYY-MM-DD HH:mm:ss');

        try {
            // Hapus pesan yang berstatus 'sent' lebih dari 12 jam
            const deleteSentSql = `DELETE FROM messages WHERE status = 'sent' AND created_at < ?`;
            const [sentResult] = await this.pool.query(deleteSentSql, [deleteSentTime]);
            console.log(`Deleted ${sentResult.affectedRows} messages with status 'sent' older than 12 hours.`);

            // Hapus pesan yang berstatus 'pending', 'failed', 'processing' lebih dari 24 jam
            const deleteOtherSql = `DELETE FROM messages WHERE status IN ('pending', 'failed', 'processing') AND created_at < ?`;
            const [otherResult] = await this.pool.query(deleteOtherSql, [deleteOtherTime]);
            console.log(`Deleted ${otherResult.affectedRows} messages with status 'pending', 'failed', or 'processing' older than 24 hours.`);

        } catch (error) {
            console.error('Error deleting old messages:', error.message);
        }
    }

    async fetchActiveSessions(limit, offset) {
        const sql = `
            SELECT u.uid, u.api_key, d.device_key, d.id AS device_id 
            FROM users u
            JOIN devices d ON u.uid = d.uid
            WHERE u.active = 1
            LIMIT ? OFFSET ?`;
        const [rows] = await this.pool.query(sql, [limit, offset]);
        return rows.map((row) => ({
            uid: row.uid,
            apiKey: row.api_key,
            deviceKey: row.device_key,
            deviceId: row.device_id
        }));
    }

    async processMessagesByRole(role) {
        const limitSessions = 10;
        let offset = 0;

        while (true) {
            const sessions = await this.fetchActiveSessions(limitSessions, offset);
            if (sessions.length === 0) break;

            const sessionPromises = sessions.map((session) =>
                this.processMessages(session, role)
            );
            await Promise.all(sessionPromises);

            offset += limitSessions;
            await new Promise((resolve) => setTimeout(resolve, 5000)); // Jeda 5 detik antar batch
        }
    }

    async processMessages(session, role) {
        if (!session || !role) return;
        const { uid, apiKey, deviceKey, deviceId } = session;
        const limit = 100;
        const todayDate = moment().tz('Asia/Jakarta').format('YYYY-MM-DD');
        try {
            // Lock messages and update status to 'processing'
            const lockSql = `
                UPDATE messages 
                SET status = 'processing', updated_at = ? 
                WHERE status = 'pending' 
                  AND role = ? 
                  AND uid = ? 
                  AND device_id = ? 
                  AND DATE(created_at) = ? 
                ORDER BY created_at ASC 
                LIMIT ?`;
            const currentTime = moment().tz('Asia/Jakarta').format('YYYY-MM-DD HH:mm:ss');
            const [lockResult] = await this.pool.query(lockSql, [currentTime, role, uid, deviceId, todayDate, limit]);

            // if (lockResult.affectedRows === 0) return;

            // Fetch the locked messages
            const selectSql = `
                SELECT * 
                FROM messages 
                WHERE status = 'processing' 
                  AND role = ? 
                  AND uid = ? 
                  AND device_id = ? 
                  AND DATE(created_at) = ? 
                ORDER BY created_at ASC`;
            const [rows] = await this.pool.query(selectSql, [role, uid, deviceId, todayDate]);

            if (rows.length === 0) return;

            let errorCount = 0;
            let successCount = 0;

            // Process each message
            for (const row of rows) {
                const { id, number, message, type } = row;

                try {
                    // Send the message
                    const response = await this.sendMessage(apiKey, deviceKey, role, number, message, type === 'group' ? true : false);

                    // Determine the new status based on the response
                    let status = 'pending';
                    if (response.code === 200 && response.response.status) {
                        status = response.response.status ? 'sent' : 'failed';
                    }

                    // Update the message status and response in the database
                    const updateSql = `
                        UPDATE messages 
                        SET status = ?, response = ?, updated_at = ? 
                        WHERE id = ?`;
                    const currentTime = moment().tz('Asia/Jakarta').format('YYYY-MM-DD HH:mm:ss');
                    await this.pool.query(updateSql, [status, JSON.stringify(response), currentTime, id]);

                    // Increment success or error count
                    status === 'sent' ? successCount++ : errorCount++;
                } catch (err) {
                    errorCount++;
                }

                // Optional: Wait 1 second before processing the next message
                // await new Promise((resolve) => setTimeout(resolve, 1000));
            }

            console.log(`Session: ${uid}, Role: ${role}, Success: ${successCount}, Errors: ${errorCount}`);
        } catch (err) {
            console.error(`Error processing session ${uid}, role ${role}:`, err.message);
        }
    }
    async sendMessage(apiKey, deviceKey, role, to, text, isGroup) {
        const url = 'http://localhost:3000/message/send';
        const data = {
            key: deviceKey,
            group: isGroup,
            to: to,
            text: text
        };

        try {
            const response = await axios.post(url, data, {
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                }
            });

            return {
                code: response.status,
                response: response.data
            };
        } catch (error) {
            return {
                code: error.response?.status || 500,
                response: error.response?.data || error.message
            };
        }
    }
}

module.exports = CronManager;