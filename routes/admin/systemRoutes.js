const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../../lib/Utils.js");
const os = require("os");

module.exports = ({ pool, sessionManager } = {}) => {
  router.get("/", authMiddleware, async (req, res) => {
    const memory = process.memoryUsage();
    const health = {
      database: "unknown",
      uptime: process.uptime(),
      nodeEnv: process.env.NODE_ENV || "development",
      nodeVersion: process.version,
      platform: `${process.platform} ${process.arch}`,
      host: os.hostname(),
      memory,
      memoryUsedMb: Math.round(memory.rss / 1024 / 1024),
      totalMemoryMb: Math.round(os.totalmem() / 1024 / 1024),
      freeMemoryMb: Math.round(os.freemem() / 1024 / 1024),
      serverPort: process.env.SERVER_PORT || 3000,
      serverUrl: process.env.SERVER_URL || "",
      databaseVersion: "-",
      databaseTime: "-",
      sqlMode: "-",
      activeSessions: 0,
      loadedSessions: 0,
      queuePending: 0,
      queueProcessing: 0,
      queueOldestPending: null,
      webhookFailed24h: 0,
      tables: [],
      deviceStatus: [],
      messageStatus: [],
      transactionStatus: [],
      topUsers: [],
      recentFailures: [],
      recentWebhookFailures: [],
      envChecks: [],
      recommendations: [],
    };

    try {
      await pool.query("SELECT 1");
      health.database = "connected";
      const [[dbInfo]] = await pool.query(
        "SELECT VERSION() AS version, NOW() AS db_time, @@SESSION.sql_mode AS sql_mode"
      );
      health.databaseVersion = dbInfo.version || "-";
      health.databaseTime = dbInfo.db_time || "-";
      health.sqlMode = dbInfo.sql_mode || "-";
    } catch (error) {
      health.database = "error";
      health.databaseError = error.message;
    }

    try {
      const sessions = sessionManager && typeof sessionManager.getAllSessions === "function"
        ? sessionManager.getAllSessions()
        : {};
      health.loadedSessions = Object.keys(sessions).length;
      health.activeSessions = Object.values(sessions).filter((session) => session && session.connected).length;
    } catch (error) {
      health.sessionError = error.message;
    }

    try {
      const [[queueRow]] = await pool.query(
        "SELECT SUM(status = 'pending') AS pending, SUM(status = 'processing') AS processing, MIN(CASE WHEN status = 'pending' THEN COALESCE(scheduled_at, created_at) END) AS oldest_pending FROM messages"
      );
      health.queuePending = queueRow.pending || 0;
      health.queueProcessing = queueRow.processing || 0;
      health.queueOldestPending = queueRow.oldest_pending || null;
    } catch (error) {
      health.queueError = error.message;
    }

    try {
      const [[webhookRow]] = await pool.query(
        "SELECT COUNT(*) AS cnt FROM webhook_logs WHERE status != 'success' AND created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)"
      );
      health.webhookFailed24h = webhookRow.cnt || 0;
    } catch (error) {
      health.webhookError = error.message;
    }

    try {
      const [tables] = await pool.query(
        `SELECT table_name, table_rows, data_length, index_length
         FROM information_schema.tables
         WHERE table_schema = DATABASE()
         ORDER BY table_name ASC`
      );
      health.tables = tables || [];
    } catch (error) {
      health.tableError = error.message;
    }

    try {
      const [rows] = await pool.query(
        "SELECT status, COUNT(*) AS cnt FROM devices WHERE status != 'deleted' GROUP BY status ORDER BY status"
      );
      health.deviceStatus = rows || [];
    } catch (error) {
      health.deviceStatusError = error.message;
    }

    try {
      const [rows] = await pool.query(
        "SELECT status, COUNT(*) AS cnt FROM messages GROUP BY status ORDER BY status"
      );
      health.messageStatus = rows || [];
    } catch (error) {
      health.messageStatusError = error.message;
    }

    try {
      const [rows] = await pool.query(
        "SELECT status, COUNT(*) AS cnt, COALESCE(SUM(amount), 0) AS amount FROM transactions GROUP BY status ORDER BY status"
      );
      health.transactionStatus = rows || [];
    } catch (error) {
      health.transactionStatusError = error.message;
    }

    try {
      const [rows] = await pool.query(
        `SELECT
            u.uid, u.name, u.email,
            COUNT(m.id) AS total_messages,
            SUM(CASE WHEN m.status = 'sent' THEN 1 ELSE 0 END) AS sent_messages,
            SUM(CASE WHEN m.status = 'failed' THEN 1 ELSE 0 END) AS failed_messages
         FROM users u
         LEFT JOIN messages m ON m.uid = u.uid AND m.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
         GROUP BY u.uid, u.name, u.email
         ORDER BY total_messages DESC
         LIMIT 10`
      );
      health.topUsers = rows || [];
    } catch (error) {
      health.topUsersError = error.message;
    }

    try {
      const [rows] = await pool.query(
        `SELECT m.id, m.number, m.response, m.created_at, u.name AS user_name, d.name AS device_name
         FROM messages m
         LEFT JOIN users u ON m.uid = u.uid
         LEFT JOIN devices d ON m.device_id = d.id
         WHERE m.status = 'failed'
         ORDER BY m.updated_at DESC, m.created_at DESC
         LIMIT 8`
      );
      health.recentFailures = rows || [];
    } catch (error) {
      health.recentFailuresError = error.message;
    }

    try {
      const [rows] = await pool.query(
        `SELECT wl.id, wl.event, wl.http_status, wl.error_message, wl.created_at, u.name AS user_name, d.name AS device_name
         FROM webhook_logs wl
         LEFT JOIN users u ON wl.uid = u.uid
         LEFT JOIN devices d ON wl.device_id = d.id
         WHERE wl.status != 'success'
         ORDER BY wl.created_at DESC
         LIMIT 8`
      );
      health.recentWebhookFailures = rows || [];
    } catch (error) {
      health.recentWebhookFailuresError = error.message;
    }

    health.envChecks = [
      { name: "SESSION_SECRET", ok: Boolean(process.env.SESSION_SECRET), detail: process.env.SESSION_SECRET ? "Configured" : "Masih memakai fallback dev" },
      { name: "SERVER_URL", ok: Boolean(process.env.SERVER_URL), detail: process.env.SERVER_URL || "Belum di-set" },
      { name: "DUITKU_MERCHANT_CODE", ok: Boolean(process.env.DUITKU_MERCHANT_CODE), detail: process.env.DUITKU_MERCHANT_CODE ? "Configured" : "Billing Duitku belum lengkap" },
      { name: "DUITKU_MERCHANT_KEY", ok: Boolean(process.env.DUITKU_MERCHANT_KEY), detail: process.env.DUITKU_MERCHANT_KEY ? "Configured" : "Billing Duitku belum lengkap" },
      { name: "NODE_ENV", ok: process.env.NODE_ENV === "production", detail: process.env.NODE_ENV || "development" },
    ];

    if (health.database !== "connected") {
      health.recommendations.push("Database belum connected. Cek host, user, password, dan service MySQL.");
    }
    if (!process.env.SESSION_SECRET) {
      health.recommendations.push("Set SESSION_SECRET di .env agar cookie session tidak memakai fallback development.");
    }
    if (process.env.NODE_ENV !== "production") {
      health.recommendations.push("Untuk server live, set NODE_ENV=production agar logging dan cookie mengikuti mode produksi.");
    }
    if (Number(health.queuePending) > 100) {
      health.recommendations.push("Queue pending tinggi. Pertimbangkan tambah worker/cron interval atau cek device yang disconnected.");
    }
    if (Number(health.queueProcessing) > 0) {
      health.recommendations.push("Ada pesan berstatus processing. Jika bertahan lama, perlu job recovery untuk mengembalikannya ke pending.");
    }
    if (Number(health.webhookFailed24h) > 0) {
      health.recommendations.push("Ada webhook gagal dalam 24 jam. Cek URL client, timeout, dan response endpoint.");
    }
    if (health.freeMemoryMb < Math.max(512, health.totalMemoryMb * 0.1)) {
      health.recommendations.push("Free memory rendah. Pantau penggunaan RAM dan pertimbangkan restart terjadwal di jam sepi.");
    }
    if (!health.recommendations.length) {
      health.recommendations.push("Tidak ada anomali besar dari indikator yang dipantau.");
    }

    res.render("admin/system", {
      title: "System Health - w@pi",
      layout: "layouts/admin",
      health,
    });
  });

  return router;
};
