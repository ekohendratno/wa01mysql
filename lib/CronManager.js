const cron = require('node-cron');
const axios = require('axios');
const moment = require('moment-timezone');

class CronManager {
    constructor(pool) {
        this.pool = pool;
        this.isProcessing = false; // Mutex untuk mencegah overlapping cron job
    }

    async initCrons() {
        console.log("Initializing cron jobs...");

        cron.schedule('*/1 * * * *', async () => {
            if (this.isProcessing) {
                console.log("Cron is still running, skipping this cycle...");
                return;
            }
            this.isProcessing = true;
            try {
                await this.processMessagesByType('group');
                await this.processMessagesByType('personal');
                await this.processMessagesByType('bulk');
            } catch (error) {
                console.error("Error in cron job:", error);
            }
            this.isProcessing = false;
        });

        cron.schedule('*/30 * * * *', async () => {
            console.log('Running message cleanup cron...');
            await this.deleteOldMessages();
        });

        
    }

    async deleteOldMessages() {
        const now = moment().tz('Asia/Jakarta');
        const deleteSentTime = now.subtract(24, 'hours').format('YYYY-MM-DD HH:mm:ss');
        const deleteOtherTime = now.subtract(48, 'hours').format('YYYY-MM-DD HH:mm:ss');

        try {
            const deleteSentSql = `DELETE FROM messages WHERE status = 'sent' AND created_at < ?`;
            const [sentResult] = await this.pool.query(deleteSentSql, [deleteSentTime]);
            console.log(`Deleted ${sentResult.affectedRows} messages with status 'sent' older than 24 hours.`);

            const deleteOtherSql = `DELETE FROM messages WHERE status IN ('pending', 'failed', 'processing') AND created_at < ?`;
            const [otherResult] = await this.pool.query(deleteOtherSql, [deleteOtherTime]);
            console.log(`Deleted ${otherResult.affectedRows} messages with status 'pending', 'failed', or 'processing' older than 48 hours/2 day.`);

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

    async processMessagesByType(type) {
        const limitSessions = 10;
        let offset = 0;

        while (true) {
            const sessions = await this.fetchActiveSessions(limitSessions, offset);
            if (sessions.length === 0) break;

            for (const session of sessions) {
                await this.processMessages(session, type);
                await new Promise((resolve) => setTimeout(resolve, 5000)); // Jeda antar sesi
            }

            offset += limitSessions;
        }
    }

    async processMessages(session, type) {
        if (!session || !type) return;
        const { uid, apiKey, deviceKey, deviceId } = session;
        const limit = 50;
        const todayDate = moment().tz('Asia/Jakarta').format('YYYY-MM-DD');

        try {
            const lockSql = `
                UPDATE messages 
                SET status = 'processing', updated_at = ? 
                WHERE status = 'pending' 
                  AND type = ? 
                  AND uid = ? 
                  AND device_id = ? 
                  AND DATE(created_at) = ? 
                ORDER BY created_at ASC 
                LIMIT ?`;
            const currentTime = moment().tz('Asia/Jakarta').format('YYYY-MM-DD HH:mm:ss');
            await this.pool.query(lockSql, [currentTime, type, uid, deviceId, todayDate, limit]);

            const selectSql = `
                SELECT * FROM messages 
                WHERE status = 'processing' 
                  AND type = ? 
                  AND uid = ? 
                  AND device_id = ? 
                  AND DATE(created_at) = ? 
                ORDER BY created_at ASC`;
            const [rows] = await this.pool.query(selectSql, [type, uid, deviceId, todayDate]);

            if (rows.length === 0) return;

            for (const row of rows) {
                const { id, number, message, type } = row;

                try {
                    // Implement random delay (jitter) to avoid uniform timing
                    const jitter = Math.floor(Math.random() * 5000); // Random delay between 0 and 5 seconds
                    await new Promise((resolve) => setTimeout(resolve, 3000 + jitter));

                    const response = await this.sendMessage(apiKey, deviceKey, number, message, type === 'group' ? 1 : 0);

                    let status = 'failed';
                    if (response.code === 200 && response.response.status) {
                        status = response.response.status ? 'sent' : 'failed';
                    }

                    const updateSql = `
                        UPDATE messages 
                        SET status = ?, response = ?, updated_at = ? 
                        WHERE id = ?`;
                    await this.pool.query(updateSql, [status, JSON.stringify(response), currentTime, id]);
                } catch (err) {
                    console.error(`Error sending message ID ${id}:`, err.message);
                }
            }
        } catch (err) {
            console.error(`Error processing session ${uid}, type ${type}:`, err.message);
        }
    }

    async sendMessage(apiKey, deviceKey, to, text, isGroup) {
        const url = `${process.env.SERVERURL}:${process.env.SERVERPORT}/message/send`;
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
