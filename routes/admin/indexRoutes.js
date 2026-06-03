const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../../lib/Utils.js');

module.exports = ({ pool, billingManager, deviceManager, messageManager, sessionManager, userManager } = {}) => {

    router.get("/", authMiddleware, async (req, res) => {
        try {
            const stats = {
                totalBalance: 0,
                totalDevices: 0,
                activeDevices: 0,
                totalUsers: 0,
                activeUsers: 0,
                messagesThisMonth: 0,
                messagesToday: 0,
                pendingMessages: 0,
                failedMessages: 0,
                processingMessages: 0,
                pendingTransactions: 0,
                webhookFailed24h: 0,
                newUsersToday: 0,
                newUsers7d: 0,
                lastActiveDevice: null,
                recentMessages: [],
                recentDevices: [],
                recentUsers: [],
                recentCampaigns: [],
                statusBreakdown: [],
            };

            try {
                const [[balanceRow]] = await pool.query('SELECT SUM(balance) AS total FROM balances');
                stats.totalBalance = parseFloat(balanceRow.total) || 0;
            } catch (e) { console.warn('Dashboard: failed to read total balance', e && e.message); }

            try {
                const [[devCount]] = await pool.query("SELECT COUNT(*) AS cnt FROM devices WHERE status != 'deleted'");
                stats.totalDevices = devCount.cnt || 0;
                const [[activeCount]] = await pool.query("SELECT COUNT(*) AS cnt FROM devices WHERE status = 'connected'");
                stats.activeDevices = activeCount.cnt || 0;
            } catch (e) { console.warn('Dashboard: failed to read device counts', e && e.message); }

            try {
                const [[userCount]] = await pool.query("SELECT COUNT(*) AS cnt, SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) AS active_cnt FROM users");
                stats.totalUsers = userCount.cnt || 0;
                stats.activeUsers = userCount.active_cnt || 0;
                const [[newUsers]] = await pool.query(`
                    SELECT
                        SUM(CASE WHEN DATE(created_at) = CURDATE() THEN 1 ELSE 0 END) AS today_total,
                        SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) AS week_total
                    FROM users
                `);
                stats.newUsersToday = Number(newUsers.today_total || 0);
                stats.newUsers7d = Number(newUsers.week_total || 0);
            } catch (e) { console.warn('Dashboard: failed to read user counts', e && e.message); }

            try {
                const [[msgCount]] = await pool.query("SELECT COUNT(*) AS cnt FROM messages WHERE MONTH(created_at)=MONTH(CURRENT_DATE()) AND YEAR(created_at)=YEAR(CURRENT_DATE())");
                stats.messagesThisMonth = msgCount.cnt || 0;
            } catch (e) { console.warn('Dashboard: failed to read monthly messages', e && e.message); }

            try {
                const [[msgToday]] = await pool.query("SELECT COUNT(*) AS cnt FROM messages WHERE DATE(created_at)=CURRENT_DATE()");
                stats.messagesToday = msgToday.cnt || 0;
            } catch (e) { console.warn('Dashboard: failed to read today messages', e && e.message); }

            try {
                const [statusRows] = await pool.query("SELECT status, COUNT(*) AS cnt FROM messages GROUP BY status");
                stats.statusBreakdown = statusRows || [];
                statusRows.forEach((row) => {
                    if (row.status === "pending") stats.pendingMessages = row.cnt || 0;
                    if (row.status === "failed") stats.failedMessages = row.cnt || 0;
                    if (row.status === "processing") stats.processingMessages = row.cnt || 0;
                });
            } catch (e) { console.warn('Dashboard: failed to read message status breakdown', e && e.message); }

            try {
                const [[trxRow]] = await pool.query("SELECT COUNT(*) AS cnt FROM transactions WHERE status = 'pending'");
                stats.pendingTransactions = trxRow.cnt || 0;
            } catch (e) { console.warn('Dashboard: failed to read pending transactions', e && e.message); }

            try {
                const [[webhookRow]] = await pool.query("SELECT COUNT(*) AS cnt FROM webhook_logs WHERE status != 'success' AND created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)");
                stats.webhookFailed24h = webhookRow.cnt || 0;
            } catch (e) { console.warn('Dashboard: failed to read webhook failures', e && e.message); }

            try {
                const [rows] = await pool.query("SELECT id, name, updated_at FROM devices WHERE status != 'deleted' ORDER BY updated_at DESC LIMIT 1");
                if (rows && rows.length > 0) stats.lastActiveDevice = rows[0];
            } catch (e) { console.warn('Dashboard: failed to read last active device', e && e.message); }

            try {
                const [rmsgs] = await pool.query("SELECT m.id, m.number, m.message, m.status, m.created_at, d.name AS device_name, u.name AS user_name FROM messages m LEFT JOIN devices d ON m.device_id = d.id LEFT JOIN users u ON m.uid = u.uid ORDER BY m.created_at DESC LIMIT 8");
                stats.recentMessages = rmsgs || [];
            } catch (e) { console.warn('Dashboard: failed to read recent messages', e && e.message); }

            try {
                const [rows] = await pool.query("SELECT d.id, d.name, d.phone, d.status, d.updated_at, u.name AS user_name FROM devices d LEFT JOIN users u ON d.uid = u.uid WHERE d.status != 'deleted' ORDER BY d.updated_at DESC LIMIT 6");
                stats.recentDevices = rows || [];
            } catch (e) { console.warn('Dashboard: failed to read recent devices', e && e.message); }

            try {
                const [rows] = await pool.query("SELECT uid, name, email, phone, active, created_at, last_active FROM users ORDER BY created_at DESC LIMIT 8");
                stats.recentUsers = rows || [];
            } catch (e) { console.warn('Dashboard: failed to read recent users', e && e.message); }

            try {
                const [rows] = await pool.query("SELECT c.id, c.name, c.status, c.recipients_count, c.created_at, u.name AS user_name FROM campaigns c LEFT JOIN users u ON c.uid = u.uid ORDER BY c.created_at DESC LIMIT 6");
                stats.recentCampaigns = rows || [];
            } catch (e) { console.warn('Dashboard: failed to read recent campaigns', e && e.message); }

            res.render("admin/index", { title: "Home - w@pi", layout: "layouts/admin", stats });
        } catch (error) {
            console.error('Admin dashboard error:', error && error.message);
            res.status(500).send('Internal Server Error');
        }
    });

    // API: message stats per day for the last N days (default 14)
    router.get('/api/message-stats', authMiddleware, async (req, res) => {
        try {
            const days = Math.max(7, Math.min(60, parseInt(req.query.days || '14')));
            const [rows] = await pool.query(
                `SELECT DATE(created_at) AS day, COUNT(*) AS cnt
                 FROM messages
                 WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
                 GROUP BY day
                 ORDER BY day ASC`,
                [days - 1]
            );

            // Build a full labels array from oldest -> newest
            const labels = [];
            const data = [];
            const countsByDay = {};
            rows.forEach(r => { const k = (r.day instanceof Date) ? r.day.toISOString().slice(0,10) : String(r.day); countsByDay[k] = Number(r.cnt || 0); });

            const today = new Date();
            for (let i = days - 1; i >= 0; i--) {
                const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
                const key = d.toISOString().slice(0,10);
                labels.push(key);
                data.push(countsByDay[key] || 0);
            }

            res.json({ labels, data });
        } catch (err) {
            console.error('message-stats API error:', err && err.message);
            res.status(500).json({ error: 'Failed to fetch stats' });
        }
    });

    router.get('/api/status-breakdown', authMiddleware, async (req, res) => {
        try {
            const [rows] = await pool.query(
                "SELECT status, COUNT(*) AS cnt FROM messages GROUP BY status ORDER BY status ASC"
            );
            res.json({
                labels: rows.map((row) => row.status || "unknown"),
                data: rows.map((row) => Number(row.cnt || 0)),
            });
        } catch (err) {
            console.error('status-breakdown API error:', err && err.message);
            res.status(500).json({ error: 'Failed to fetch status breakdown' });
        }
    });

    return router;
};
