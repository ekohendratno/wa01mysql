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
                await this.processMessagesByRole('group');
                await this.processMessagesByRole('guru');
                await this.processMessagesByRole('siswa');
                await this.processMessagesByRole('ortu');
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

    async processMessagesByRole(role) {
        const limitSessions = 10;
        let offset = 0;

        while (true) {
            const sessions = await this.fetchActiveSessions(limitSessions, offset);
            if (sessions.length === 0) break;

            for (const session of sessions) {
                await this.processMessages(session, role);
                await new Promise((resolve) => setTimeout(resolve, 5000)); // Jeda antar sesi
            }

            offset += limitSessions;
        }
    }

    async processMessages(session, role) {
        if (!session || !role) return;
        const { uid, apiKey, deviceKey, deviceId } = session;
        const limit = 50;
        const todayDate = moment().tz('Asia/Jakarta').format('YYYY-MM-DD');

        try {
            // Kunci pesan agar tidak diproses oleh job lain
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
            await this.pool.query(lockSql, [currentTime, role, uid, deviceId, todayDate, limit]);

            // Ambil pesan yang dikunci
            const selectSql = `
                SELECT * FROM messages 
                WHERE status = 'processing' 
                  AND role = ? 
                  AND uid = ? 
                  AND device_id = ? 
                  AND DATE(created_at) = ? 
                ORDER BY created_at ASC`;
            const [rows] = await this.pool.query(selectSql, [role, uid, deviceId, todayDate]);

            if (rows.length === 0) return;

            for (const row of rows) {
                const { id, number, message, type } = row;

                try {
                    // Kirim pesan dengan jeda untuk menghindari blokir
                    await new Promise((resolve) => setTimeout(resolve, 3000));

                    const response = await this.sendMessage(apiKey, deviceKey, role, number, message, type === 'group' ? 1 : 0);

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
            console.error(`Error processing session ${uid}, role ${role}:`, err.message);
        }
    }

    

    async sendMessage(apiKey, deviceKey, role, to, text, isGroup) {
        const url = `http://localhost:${process.env.SERVERPORT}/message/send`;
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