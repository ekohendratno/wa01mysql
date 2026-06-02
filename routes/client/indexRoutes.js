const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../../lib/Utils.js');

module.exports = ({sessionManager, deviceManager, messageManager, billingManager}) => {

    router.get("/", authMiddleware, async (req, res) => {
        try {
            const sessions = sessionManager.getAllSessions();
            const apiKey = req.session.user.api_key;
            const pool = messageManager.pool || deviceManager.pool || billingManager.pool;

            const devices = await deviceManager.getDevices(apiKey);
            const countDeviceLast = await deviceManager.getDevicesWithLastActive(apiKey);
            const countMessage = await messageManager.getMessageCounts(apiKey);
            const countDevice = await deviceManager.getActiveDeviceCount(apiKey);
            const countSummary = await billingManager.getBalanceSummary(apiKey);
            const messageStatistics = await messageManager.getMessageStatistics(apiKey);
            const messagesLast = await messageManager.getMessagesLast(apiKey, 8, 14);

            const dashboard = await buildDashboardStats(pool, apiKey, devices || [], sessions);

            res.render("client/index", {
                messagesLast,
                messageStatistics,
                countDeviceLast,
                countMessage,
                countDevice,
                countSummary,
                devices: devices || [],
                dashboard,
                apiKey: apiKey,
                sessions,
                title: "Home - w@pi",
                layout: "layouts/client"
            });
        } catch (error) {
            console.error("Client dashboard error:", error);
            res.status(500).send("Internal Server Error");
        }
    });


    router.get("/status", authMiddleware, async (req, res) => {
        const { key } = req.query;

        if (!key) {
            return res.status(400).json({ status: false, message: "Key is required." });
        }

        res.render("client/status", { key: key, title: "Home", layout: "layouts/client" });
    });
    return router;
};

async function buildDashboardStats(pool, apiKey, devices, sessions) {
    const result = {
        uid: null,
        today: { sent: 0, pending: 0, failed: 0, processing: 0, total: 0 },
        week: { sent: 0, pending: 0, failed: 0, processing: 0, total: 0 },
        queue: { pending: 0, processing: 0, scheduled: 0, oldestPending: null },
        inbox: { today: 0, week: 0 },
        contacts: 0,
        optIns: { approved: 0, pending: 0, blocked: 0 },
        campaigns: { total: 0, queued: 0, scheduled: 0, completed: 0, failed: 0, recent: [] },
        webhooks: { success24h: 0, failed24h: 0 },
        transactions: { pending: 0, successThisMonth: 0, spentThisMonth: 0 },
        deviceStatus: { connected: 0, disconnected: 0, connecting: 0, other: 0 },
        deviceCards: [],
        packageAlerts: { critical: [], warning: [], healthy: [], nearest: null },
        shareAlerts: { critical: [], warning: [], healthy: [], nearest: null },
        receivedShareAlerts: { critical: [], warning: [], healthy: [], nearest: null },
        daily: [],
        peakHour: "-",
        successRate: 0,
        recommendations: [],
    };

    if (!pool || !apiKey) return result;

    const [users] = await pool.query("SELECT uid FROM users WHERE api_key = ? LIMIT 1", [apiKey]);
    if (!users.length) return result;
    const uid = users[0].uid;
    result.uid = uid;

    devices.forEach((device) => {
        if (device.status === "connected") result.deviceStatus.connected += 1;
        else if (device.status === "disconnected") result.deviceStatus.disconnected += 1;
        else if (device.status === "connecting") result.deviceStatus.connecting += 1;
        else result.deviceStatus.other += 1;
    });

    const [messageRows] = await pool.query(
        `SELECT
            SUM(CASE WHEN created_at >= CURDATE() AND status = 'sent' THEN 1 ELSE 0 END) AS today_sent,
            SUM(CASE WHEN created_at >= CURDATE() AND status = 'pending' THEN 1 ELSE 0 END) AS today_pending,
            SUM(CASE WHEN created_at >= CURDATE() AND status = 'failed' THEN 1 ELSE 0 END) AS today_failed,
            SUM(CASE WHEN created_at >= CURDATE() AND status = 'processing' THEN 1 ELSE 0 END) AS today_processing,
            SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND status = 'sent' THEN 1 ELSE 0 END) AS week_sent,
            SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND status = 'pending' THEN 1 ELSE 0 END) AS week_pending,
            SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND status = 'failed' THEN 1 ELSE 0 END) AS week_failed,
            SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND status = 'processing' THEN 1 ELSE 0 END) AS week_processing,
            SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS queue_pending,
            SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) AS queue_processing,
            SUM(CASE WHEN status = 'pending' AND scheduled_at > NOW() THEN 1 ELSE 0 END) AS queue_scheduled,
            MIN(CASE WHEN status = 'pending' THEN COALESCE(scheduled_at, created_at) END) AS oldest_pending
         FROM messages
         WHERE uid = ?`,
        [uid]
    );
    const msg = messageRows[0] || {};
    result.today.sent = Number(msg.today_sent || 0);
    result.today.pending = Number(msg.today_pending || 0);
    result.today.failed = Number(msg.today_failed || 0);
    result.today.processing = Number(msg.today_processing || 0);
    result.today.total = result.today.sent + result.today.pending + result.today.failed + result.today.processing;
    result.week.sent = Number(msg.week_sent || 0);
    result.week.pending = Number(msg.week_pending || 0);
    result.week.failed = Number(msg.week_failed || 0);
    result.week.processing = Number(msg.week_processing || 0);
    result.week.total = result.week.sent + result.week.pending + result.week.failed + result.week.processing;
    result.queue.pending = Number(msg.queue_pending || 0);
    result.queue.processing = Number(msg.queue_processing || 0);
    result.queue.scheduled = Number(msg.queue_scheduled || 0);
    result.queue.oldestPending = msg.oldest_pending || null;
    result.successRate = result.week.total > 0 ? Math.round((result.week.sent / result.week.total) * 100) : 0;

    const [dailyRows] = await pool.query(
        `SELECT DATE(created_at) AS day,
            SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent,
            SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
            COUNT(*) AS total
         FROM messages
         WHERE uid = ? AND created_at >= DATE_SUB(CURDATE(), INTERVAL 13 DAY)
         GROUP BY DATE(created_at)
         ORDER BY DATE(created_at) ASC`,
        [uid]
    );
    result.daily = fillDailyStats(dailyRows, 14);

    const [deviceRows] = await pool.query(
        `SELECT
            d.id, d.name, d.phone, d.device_key, d.status, d.limit_daily, d.life_time, d.updated_at,
            SUM(CASE WHEN m.created_at >= CURDATE() THEN 1 ELSE 0 END) AS today_total,
            SUM(CASE WHEN m.created_at >= CURDATE() AND m.status = 'sent' THEN 1 ELSE 0 END) AS today_sent,
            SUM(CASE WHEN m.created_at >= CURDATE() AND m.status = 'failed' THEN 1 ELSE 0 END) AS today_failed
         FROM devices d
         LEFT JOIN messages m ON m.device_id = d.id
         WHERE d.uid = ? AND d.status != 'deleted'
         GROUP BY d.id, d.name, d.phone, d.device_key, d.status, d.limit_daily, d.life_time, d.updated_at
         ORDER BY d.updated_at DESC
         LIMIT 8`,
        [uid]
    );
    result.deviceCards = deviceRows || [];
    result.packageAlerts = buildPackageAlerts(result.deviceCards);

    const [shareRows] = await pool.query(
        `SELECT
            ds.id, ds.invite_code, ds.status, ds.expires_at, ds.created_at,
            d.name AS device_name, d.device_key,
            u.name AS shared_name, u.email AS shared_email
         FROM device_shares ds
         JOIN devices d ON ds.device_id = d.id
         LEFT JOIN users u ON ds.shared_uid = u.uid
         WHERE ds.owner_uid = ?
           AND ds.status = 'active'
           AND ds.expires_at IS NOT NULL
           AND ds.expires_at > NOW()
         ORDER BY ds.expires_at ASC
         LIMIT 8`,
        [uid]
    );
    result.shareAlerts = buildShareAlerts(shareRows || []);

    const [receivedShareRows] = await pool.query(
        `SELECT
            ds.id, ds.invite_code, ds.status, ds.expires_at, ds.created_at,
            d.name AS device_name, d.device_key, d.phone, d.status AS device_status,
            u.name AS owner_name, u.email AS owner_email
         FROM device_shares ds
         JOIN devices d ON ds.device_id = d.id
         JOIN users u ON ds.owner_uid = u.uid
         WHERE ds.shared_uid = ?
           AND ds.status = 'active'
           AND ds.permission_send = 1
           AND ds.expires_at IS NOT NULL
           AND ds.expires_at > NOW()
           AND d.status != 'deleted'
         ORDER BY ds.expires_at ASC
         LIMIT 8`,
        [uid]
    );
    result.receivedShareAlerts = buildShareAlerts(receivedShareRows || []);

    const [campaignRows] = await pool.query(
        `SELECT
            COUNT(*) AS total,
            SUM(status = 'queued') AS queued,
            SUM(status = 'scheduled') AS scheduled,
            SUM(status = 'completed') AS completed,
            SUM(status = 'failed') AS failed
         FROM campaigns
         WHERE uid = ?`,
        [uid]
    );
    Object.assign(result.campaigns, {
        total: Number(campaignRows[0]?.total || 0),
        queued: Number(campaignRows[0]?.queued || 0),
        scheduled: Number(campaignRows[0]?.scheduled || 0),
        completed: Number(campaignRows[0]?.completed || 0),
        failed: Number(campaignRows[0]?.failed || 0),
    });

    const [recentCampaigns] = await pool.query(
        `SELECT c.id, c.name, c.status, c.recipients_count, c.scheduled_at, c.created_at, d.name AS device_name
         FROM campaigns c
         LEFT JOIN devices d ON c.device_id = d.id
         WHERE c.uid = ?
         ORDER BY c.created_at DESC
         LIMIT 5`,
        [uid]
    );
    result.campaigns.recent = recentCampaigns || [];

    const [inboxRows] = await pool.query(
        `SELECT
            SUM(received_at >= CURDATE()) AS today,
            SUM(received_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)) AS week
         FROM inbox_messages
         WHERE uid = ?`,
        [uid]
    );
    result.inbox.today = Number(inboxRows[0]?.today || 0);
    result.inbox.week = Number(inboxRows[0]?.week || 0);

    const [[contactRow]] = await pool.query("SELECT COUNT(*) AS total FROM contacts WHERE uid = ?", [uid]);
    result.contacts = Number(contactRow?.total || 0);

    const [optRows] = await pool.query("SELECT status, COUNT(*) AS total FROM opt_ins WHERE uid = ? GROUP BY status", [uid]);
    optRows.forEach((row) => {
        if (Object.prototype.hasOwnProperty.call(result.optIns, row.status)) {
            result.optIns[row.status] = Number(row.total || 0);
        }
    });

    const [webhookRows] = await pool.query(
        `SELECT
            SUM(status = 'success') AS success24h,
            SUM(status != 'success') AS failed24h
         FROM webhook_logs
         WHERE uid = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)`,
        [uid]
    );
    result.webhooks.success24h = Number(webhookRows[0]?.success24h || 0);
    result.webhooks.failed24h = Number(webhookRows[0]?.failed24h || 0);

    const [transactionRows] = await pool.query(
        `SELECT
            SUM(status = 'pending') AS pending,
            SUM(status IN ('success','paid') AND created_at >= DATE_FORMAT(CURRENT_DATE(), '%Y-%m-01')) AS success_this_month,
            SUM(CASE WHEN whatIs = '-' AND created_at >= DATE_FORMAT(CURRENT_DATE(), '%Y-%m-01') THEN ABS(amount) ELSE 0 END) AS spent_this_month
         FROM transactions
         WHERE uid = ?`,
        [uid]
    );
    result.transactions.pending = Number(transactionRows[0]?.pending || 0);
    result.transactions.successThisMonth = Number(transactionRows[0]?.success_this_month || 0);
    result.transactions.spentThisMonth = Number(transactionRows[0]?.spent_this_month || 0);

    const [peakRows] = await pool.query(
        `SELECT HOUR(created_at) AS hour, COUNT(*) AS total
         FROM messages
         WHERE uid = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
         GROUP BY HOUR(created_at)
         ORDER BY total DESC
         LIMIT 1`,
        [uid]
    );
    if (peakRows.length) {
        const hour = String(peakRows[0].hour).padStart(2, "0");
        result.peakHour = `${hour}:00`;
    }

    result.recommendations = buildRecommendations(result, devices, sessions);
    return result;
}

function buildPackageAlerts(devices) {
    const buckets = { critical: [], warning: [], healthy: [], nearest: null };
    const sorted = (devices || [])
        .map((device) => ({
            ...device,
            life_time: Number(device.life_time || 0),
            limit_daily: Number(device.limit_daily || 0),
        }))
        .sort((a, b) => a.life_time - b.life_time);

    sorted.forEach((device) => {
        if (device.life_time <= 3) buckets.critical.push(device);
        else if (device.life_time <= 7) buckets.warning.push(device);
        else buckets.healthy.push(device);
    });

    buckets.nearest = sorted[0] || null;
    return buckets;
}

function fillDailyStats(rows, days) {
    const map = {};
    rows.forEach((row) => {
        const key = row.day instanceof Date ? row.day.toISOString().slice(0, 10) : String(row.day).slice(0, 10);
        map[key] = {
            sent: Number(row.sent || 0),
            pending: Number(row.pending || 0),
            failed: Number(row.failed || 0),
            total: Number(row.total || 0),
        };
    });

    const data = [];
    const now = new Date();
    for (let i = days - 1; i >= 0; i -= 1) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        data.push({ date: key, ...(map[key] || { sent: 0, pending: 0, failed: 0, total: 0 }) });
    }
    return data;
}

function buildRecommendations(stats, devices, sessions) {
    const tips = [];
    const hasDevice = devices && devices.length > 0;
    const connected = stats.deviceStatus.connected;

    if (!hasDevice) tips.push({ type: "warning", text: "Tambahkan device pertama agar API bisa mulai mengirim pesan.", href: "/client/device" });
    else if (!connected) tips.push({ type: "danger", text: "Tidak ada device connected. Scan ulang WhatsApp sebelum kirim campaign.", href: "/client/device" });
    if (stats.queue.pending > 50) tips.push({ type: "warning", text: "Queue pending cukup tinggi. Cek koneksi device atau pecah campaign menjadi batch kecil.", href: "/client/queue" });
    if (stats.week.total > 0 && stats.successRate < 85) tips.push({ type: "danger", text: "Success rate 7 hari di bawah 85%. Review nomor tujuan, opt-in, dan status device.", href: "/client/reports" });
    if (stats.webhooks.failed24h > 0) tips.push({ type: "warning", text: "Ada webhook gagal dalam 24 jam. Cek URL webhook dan response server tujuan.", href: "/client/webhook/logs" });
    if (stats.packageAlerts?.critical?.length) tips.push({ type: "danger", text: `${stats.packageAlerts.critical.length} device masa aktifnya tinggal 3 hari atau kurang. Upgrade paket sebelum nonaktif.`, href: "/client/device" });
    else if (stats.packageAlerts?.warning?.length) tips.push({ type: "warning", text: `${stats.packageAlerts.warning.length} device masa aktifnya tinggal 7 hari atau kurang. Siapkan perpanjangan paket.`, href: "/client/device" });
    if (stats.shareAlerts?.critical?.length) tips.push({ type: "danger", text: `${stats.shareAlerts.critical.length} akses device share tinggal 3 hari atau kurang. Buat kode share baru atau koordinasikan perpanjangan akses.`, href: "/client/device" });
    else if (stats.shareAlerts?.warning?.length) tips.push({ type: "warning", text: `${stats.shareAlerts.warning.length} akses device share tinggal 7 hari atau kurang. Siapkan perpanjangan akses penerima.`, href: "/client/device" });
    if (stats.receivedShareAlerts?.critical?.length) tips.push({ type: "danger", text: `${stats.receivedShareAlerts.critical.length} shared device yang Anda terima tinggal 3 hari atau kurang. Hubungi owner untuk memperpanjang akses.`, href: "/client/device" });
    else if (stats.receivedShareAlerts?.warning?.length) tips.push({ type: "warning", text: `${stats.receivedShareAlerts.warning.length} shared device yang Anda terima tinggal 7 hari atau kurang. Siapkan koordinasi dengan owner.`, href: "/client/device" });
    if (stats.optIns.pending > stats.optIns.approved && stats.optIns.pending > 0) tips.push({ type: "info", text: "Opt-in pending lebih banyak dari approved. Kirim reminder persetujuan ke kontak yang belum approve.", href: "/client/optin" });
    if (!stats.campaigns.total && hasDevice) tips.push({ type: "info", text: "Buat campaign pertama untuk broadcast terjadwal dari kontak atau template.", href: "/client/campaign" });
    if (!stats.contacts && hasDevice) tips.push({ type: "info", text: "Sinkronkan atau tambah kontak agar campaign lebih mudah dikelola.", href: "/client/contact" });
    if (!tips.length) tips.push({ type: "success", text: "Operasional terlihat sehat. Pantau queue dan failed message secara berkala.", href: "/client/reports" });

    return tips.slice(0, 5);
}

function buildShareAlerts(shares) {
    const buckets = { critical: [], warning: [], healthy: [], nearest: null };
    const now = Date.now();
    const sorted = (shares || [])
        .map((share) => {
            const expiresAt = share.expires_at ? new Date(share.expires_at).getTime() : null;
            const daysLeft = expiresAt ? Math.max(0, Math.ceil((expiresAt - now) / (24 * 60 * 60 * 1000))) : null;
            return { ...share, days_left: daysLeft };
        })
        .filter((share) => share.days_left !== null)
        .sort((a, b) => a.days_left - b.days_left);

    sorted.forEach((share) => {
        if (share.days_left <= 3) buckets.critical.push(share);
        else if (share.days_left <= 7) buckets.warning.push(share);
        else buckets.healthy.push(share);
    });

    buckets.nearest = sorted[0] || null;
    return buckets;
}
