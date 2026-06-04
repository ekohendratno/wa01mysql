const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../../lib/Utils.js");
const os = require("os");

const PURGEABLE_TABLES = new Set([
  "messages",
  "inbox_messages",
  "webhook_logs",
  "logs",
  "ai_logs",
  "telegram_messages",
  "sessions",
  "opt_in_deleted",
  "groups",
  "campaigns",
]);

const PROTECTED_TABLES = new Set([
  "admin",
  "users",
  "devices",
  "device_shares",
  "contacts",
  "opt_ins",
  "balances",
  "packages",
  "transactions",
  "ai_settings",
  "ai_knowledge_sources",
  "telegram_bots",
  "telegram_shares",
  "autoreply",
  "webhook",
]);

const DATE_COLUMN_CANDIDATES = [
  "created_at",
  "updated_at",
  "received_at",
  "deleted_at",
  "expires",
];

const PURGE_SCOPES = {
  all: {
    label: "Semua data",
    whereSql: "",
    params: [],
  },
  today: {
    label: "Hari ini",
    whereSql: "DATE({column}) = CURDATE()",
    params: [],
  },
  yesterday: {
    label: "Kemarin",
    whereSql: "DATE({column}) = DATE_SUB(CURDATE(), INTERVAL 1 DAY)",
    params: [],
  },
  last7: {
    label: "7 hari terakhir",
    whereSql: "{column} >= DATE_SUB(NOW(), INTERVAL 7 DAY)",
    params: [],
  },
  older7: {
    label: "Lebih lama dari 7 hari",
    whereSql: "{column} < DATE_SUB(NOW(), INTERVAL 7 DAY)",
    params: [],
  },
  older30: {
    label: "Lebih lama dari 30 hari",
    whereSql: "{column} < DATE_SUB(NOW(), INTERVAL 30 DAY)",
    params: [],
  },
  older90: {
    label: "Lebih lama dari 90 hari",
    whereSql: "{column} < DATE_SUB(NOW(), INTERVAL 90 DAY)",
    params: [],
  },
};

function isSafeTableName(tableName) {
  return /^[A-Za-z0-9_]+$/.test(String(tableName || ""));
}

function quoteId(identifier) {
  if (!isSafeTableName(identifier)) {
    throw new Error("Nama tabel/kolom tidak valid.");
  }
  return `\`${identifier}\``;
}

async function getTableColumns(pool, tableName) {
  const [columns] = await pool.query(
    `SELECT column_name, data_type
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = ?`,
    [tableName],
  );
  return columns || [];
}

function pickDateColumn(columns) {
  const byName = new Map(
    columns.map((column) => [
      String(column.COLUMN_NAME || column.column_name || "").toLowerCase(),
      column,
    ]),
  );

  for (const name of DATE_COLUMN_CANDIDATES) {
    if (byName.has(name)) return name;
  }

  return null;
}

async function buildPurgeTarget(pool, tableName, scope) {
  if (!isSafeTableName(tableName)) {
    throw new Error("Nama tabel tidak valid.");
  }
  if (!PURGEABLE_TABLES.has(tableName) || PROTECTED_TABLES.has(tableName)) {
    throw new Error("Tabel ini dikunci dan tidak boleh dibersihkan manual dari halaman system.");
  }

  const columns = await getTableColumns(pool, tableName);
  if (!columns.length) {
    throw new Error("Tabel tidak ditemukan.");
  }

  const selectedScope = PURGE_SCOPES[scope] ? scope : "older30";
  const scopeConfig = PURGE_SCOPES[selectedScope];
  const dateColumn = pickDateColumn(columns);

  if (selectedScope !== "all" && !dateColumn) {
    throw new Error("Tabel ini tidak punya kolom tanggal yang bisa dipakai untuk filter waktu.");
  }

  const tableSql = quoteId(tableName);
  const dateExpression =
    tableName === "sessions" && dateColumn === "expires"
      ? "FROM_UNIXTIME(CASE WHEN `expires` > 9999999999 THEN `expires` / 1000 ELSE `expires` END)"
      : dateColumn
        ? quoteId(dateColumn)
        : null;
  const whereSql =
    selectedScope === "all"
      ? ""
      : `WHERE ${scopeConfig.whereSql.replace("{column}", dateExpression)}`;

  return {
    tableName,
    tableSql,
    scope: selectedScope,
    scopeLabel: scopeConfig.label,
    dateColumn,
    whereSql,
  };
}

function nextIntervalRun(seconds) {
  const now = new Date();
  const current = now.getTime();
  const intervalMs = seconds * 1000;
  const next = Math.ceil(current / intervalMs) * intervalMs;
  return {
    nextRunAt: new Date(next).toISOString(),
    intervalSeconds: seconds,
  };
}

function nextMinuteIntervalRun(minutes) {
  return nextIntervalRun(minutes * 60);
}

function nextDailyRun(times) {
  const now = new Date();
  const candidates = [];

  for (let dayOffset = 0; dayOffset <= 1; dayOffset++) {
    for (const time of times) {
      const [hour, minute] = time.split(":").map((part) => parseInt(part, 10));
      const candidate = new Date(now);
      candidate.setDate(now.getDate() + dayOffset);
      candidate.setHours(hour, minute || 0, 0, 0);
      if (candidate > now) candidates.push(candidate);
    }
  }

  candidates.sort((a, b) => a - b);
  return {
    nextRunAt: (candidates[0] || now).toISOString(),
    intervalSeconds: 24 * 60 * 60,
  };
}

function nextOperationalRun(operational24h) {
  if (operational24h) return nextIntervalRun(20);

  const now = new Date();
  const hour = now.getHours();
  if (hour >= 6 && hour <= 23) return nextIntervalRun(20);

  const next = new Date(now);
  if (hour >= 24) next.setDate(now.getDate() + 1);
  next.setHours(6, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);

  return {
    nextRunAt: next.toISOString(),
    intervalSeconds: 18 * 60 * 60,
  };
}

function buildCronJobs(cronManager, cronGroupManager) {
  const operational24h =
    process.env.CRON_OPERATIONAL_24H === "1" ||
    process.env.CRON_OPERATIONAL_24H === "true";
  const sendRun = nextOperationalRun(operational24h);

  return [
    {
      name: "Pengiriman Pesan",
      schedule: operational24h ? "*/20 * * * * *" : "*/20 * 6-23 * * *",
      frequency: operational24h ? "Setiap 20 detik, 24 jam" : "Setiap 20 detik, jam 06:00-23:59",
      task: "Memproses antrean group, personal, dan bulk.",
      status: cronManager ? "registered" : "unknown",
      ...sendRun,
    },
    {
      name: "Decrement Life Time",
      schedule: "0 0 * * *",
      frequency: "Harian, 00:00",
      task: "Mengurangi masa aktif device dan menandai device habis masa aktif.",
      status: cronManager ? "registered" : "unknown",
      ...nextDailyRun(["00:00"]),
    },
    {
      name: "Deadline Warning",
      schedule: "0 9,15 * * *",
      frequency: "Harian, 09:00 dan 15:00",
      task: "Mengirim pengingat masa aktif paket/device.",
      status: cronManager ? "registered" : "unknown",
      ...nextDailyRun(["09:00", "15:00"]),
    },
    {
      name: "Cleanup Messages",
      schedule: "0 * * * *",
      frequency: "Setiap jam",
      task: "Menghapus pesan sent > 24 jam dan stale pending/failed/processing > 48 jam.",
      status: cronManager ? "registered" : "unknown",
      ...nextMinuteIntervalRun(60),
    },
    {
      name: "Remove Deleted Sessions",
      schedule: "*/1 * * * *",
      frequency: "Setiap menit",
      task: "Membersihkan device berstatus deleted, session file, messages, autoreply, dan groups terkait.",
      status: cronManager ? "registered" : "unknown",
      ...nextMinuteIntervalRun(1),
    },
    {
      name: "Pending Transactions Check",
      schedule: "*/5 * * * *",
      frequency: "Setiap 5 menit",
      task: "Menandai transaksi pending yang melewati expiry sebagai failed.",
      status: cronManager ? "registered" : "unknown",
      ...nextMinuteIntervalRun(5),
    },
    {
      name: "Cleanup Database Data",
      schedule: "30 3 * * *",
      frequency: "Harian, 03:30",
      task: "Membersihkan inbox, webhook logs, logs, web sessions expired, device shares lama, opt_in_deleted lama, orphan groups, dan campaign lama.",
      status: cronManager ? "registered" : "unknown",
      ...nextDailyRun(["03:30"]),
    },
    {
      name: "Group Register Sync",
      schedule: "*/1 * * * *",
      frequency: "Setiap menit",
      task: "Membaca group WhatsApp dan menyimpan group yang mengirim /register.",
      status: cronGroupManager ? "registered" : "unknown",
      ...nextMinuteIntervalRun(1),
    },
  ];
}

module.exports = ({ pool, sessionManager, cronManager, cronGroupManager } = {}) => {
  router.get("/database/preview", authMiddleware, async (req, res) => {
    try {
      const tableName = String(req.query.table || "").trim();
      const scope = String(req.query.scope || "older30").trim();
      const action = String(req.query.action || "delete").trim();
      const target = await buildPurgeTarget(pool, tableName, scope);
      const [[row]] = await pool.query(
        `SELECT COUNT(*) AS total FROM ${target.tableSql} ${target.whereSql}`,
      );

      res.json({
        status: true,
        table: target.tableName,
        action,
        scope: target.scope,
        scopeLabel: target.scopeLabel,
        dateColumn: target.dateColumn,
        affectedRows: Number(row?.total || 0),
        confirmText:
          action === "truncate"
            ? `TRUNCATE ${target.tableName}`
            : `HAPUS ${target.tableName}`,
      });
    } catch (error) {
      res.status(400).json({
        status: false,
        message: error.message || "Gagal membaca preview database.",
      });
    }
  });

  router.post("/database/purge", authMiddleware, async (req, res) => {
    try {
      const tableName = String(req.body.table || "").trim();
      const scope = String(req.body.scope || "older30").trim();
      const action = String(req.body.action || "delete").trim();
      const confirmText = String(req.body.confirmText || "").trim();

      if (!["delete", "truncate"].includes(action)) {
        throw new Error("Aksi tidak valid.");
      }

      if (action === "truncate" && scope !== "all") {
        throw new Error("TRUNCATE hanya boleh untuk scope semua data.");
      }

      const target = await buildPurgeTarget(pool, tableName, scope);
      const requiredConfirm =
        action === "truncate"
          ? `TRUNCATE ${target.tableName}`
          : `HAPUS ${target.tableName}`;

      if (confirmText !== requiredConfirm) {
        throw new Error(`Konfirmasi tidak sesuai. Ketik persis: ${requiredConfirm}`);
      }

      const [[preview]] = await pool.query(
        `SELECT COUNT(*) AS total FROM ${target.tableSql} ${target.whereSql}`,
      );
      const affectedBefore = Number(preview?.total || 0);

      let affectedRows = 0;
      if (action === "truncate") {
        await pool.query(`TRUNCATE TABLE ${target.tableSql}`);
        affectedRows = affectedBefore;
      } else {
        const [result] = await pool.query(
          `DELETE FROM ${target.tableSql} ${target.whereSql}`,
        );
        affectedRows = Number(result?.affectedRows || 0);
      }

      res.json({
        status: true,
        message: `${action === "truncate" ? "Truncate" : "Hapus data"} berhasil.`,
        table: target.tableName,
        scope: target.scope,
        scopeLabel: target.scopeLabel,
        affectedRows,
      });
    } catch (error) {
      res.status(400).json({
        status: false,
        message: error.message || "Gagal membersihkan tabel.",
      });
    }
  });

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
      recentAppLogs: [],
      recentWebhookLogs: [],
      cronJobs: buildCronJobs(cronManager, cronGroupManager),
      cronTaskCount: cronManager && Array.isArray(cronManager.tasks) ? cronManager.tasks.length : 0,
      cleanupPreview: [],
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
      health.purgeableTables = Array.from(PURGEABLE_TABLES);
      health.protectedTables = Array.from(PROTECTED_TABLES);
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

    try {
      const [rows] = await pool.query(
        `SELECT l.id, l.action, l.created_at, u.name AS user_name
         FROM logs l
         LEFT JOIN users u ON l.uid = u.uid
         ORDER BY l.created_at DESC
         LIMIT 10`
      );
      health.recentAppLogs = rows || [];
    } catch (error) {
      health.recentAppLogsError = error.message;
    }

    try {
      const [rows] = await pool.query(
        `SELECT wl.id, wl.event, wl.status, wl.http_status, wl.created_at, u.name AS user_name, d.name AS device_name
         FROM webhook_logs wl
         LEFT JOIN users u ON wl.uid = u.uid
         LEFT JOIN devices d ON wl.device_id = d.id
         ORDER BY wl.created_at DESC
         LIMIT 10`
      );
      health.recentWebhookLogs = rows || [];
    } catch (error) {
      health.recentWebhookLogsError = error.message;
    }

    try {
      const [rows] = await pool.query(
        `SELECT 'inbox_messages > 30 hari' AS item, COUNT(*) AS cnt FROM inbox_messages WHERE received_at < DATE_SUB(NOW(), INTERVAL 30 DAY)
         UNION ALL SELECT 'webhook_logs > 14 hari', COUNT(*) FROM webhook_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL 14 DAY)
         UNION ALL SELECT 'logs > 30 hari', COUNT(*) FROM logs WHERE created_at < DATE_SUB(NOW(), INTERVAL 30 DAY)
         UNION ALL SELECT 'sessions expired', COUNT(*) FROM sessions WHERE expires < UNIX_TIMESTAMP()
         UNION ALL SELECT 'transactions pending > 90 hari', COUNT(*) FROM transactions WHERE status = 'pending' AND created_at < DATE_SUB(NOW(), INTERVAL 90 DAY)
         UNION ALL SELECT 'transactions failed > 180 hari', COUNT(*) FROM transactions WHERE status = 'failed' AND created_at < DATE_SUB(NOW(), INTERVAL 180 DAY)
         UNION ALL SELECT 'device_shares pending expired/>7 hari', COUNT(*) FROM device_shares WHERE status='pending' AND (created_at < DATE_SUB(NOW(), INTERVAL 7 DAY) OR (expires_at IS NOT NULL AND expires_at < NOW()))
         UNION ALL SELECT 'device_shares revoked > 30 hari', COUNT(*) FROM device_shares WHERE status='revoked' AND updated_at < DATE_SUB(NOW(), INTERVAL 30 DAY)
         UNION ALL SELECT 'opt_in_deleted > 90 hari', COUNT(*) FROM opt_in_deleted WHERE deleted_at < DATE_SUB(NOW(), INTERVAL 90 DAY)
         UNION ALL SELECT 'groups orphan', COUNT(*) FROM \`groups\` g LEFT JOIN devices d ON d.device_key=g.device_key WHERE d.id IS NULL
         UNION ALL SELECT 'campaign selesai/gagal > 90 hari', COUNT(*) FROM campaigns WHERE status IN ('completed','failed','cancelled','canceled') AND created_at < DATE_SUB(NOW(), INTERVAL 90 DAY)`
      );
      health.cleanupPreview = rows || [];
    } catch (error) {
      health.cleanupPreviewError = error.message;
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
    if (Number(health.cronTaskCount) < 6) {
      health.recommendations.push("Jumlah task cron terdaftar terlihat kurang. Cek proses startup dan log server setelah restart.");
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
