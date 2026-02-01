const moment = require("moment-timezone");
const BoomModule = require("@hapi/boom");
const Boom = BoomModule.Boom;
Object.assign(Boom, BoomModule);
const { isValidGroupId, isValidPhoneNumber } = require("../lib/Utils");

class MessageManager {
  constructor(pool, sessionManager) {
    this.pool = pool;
    this.sessionManager = sessionManager;
  }

  async getMessages(apiKey, status = "", page = 1, limit = 30) {
    const connection = await this.pool.getConnection();
    try {
      const [users] = await connection.query(
        "SELECT uid FROM users WHERE api_key = ? LIMIT 1",
        [apiKey],
      );
      if (users.length === 0) {
        throw new Boom("Invalid API key", { statusCode: 401 });
      }

      const uid = users[0].uid;
      const todayStart = moment()
        .tz("Asia/Jakarta")
        .startOf("day")
        .format("YYYY-MM-DD HH:mm:ss");
      const todayEnd = moment()
        .tz("Asia/Jakarta")
        .endOf("day")
        .format("YYYY-MM-DD HH:mm:ss");

      // Hanya ambil pesan yang berasal dari device yang TIDAK bertatus 'deleted'
      let query =
        "SELECT m.*, d.device_key FROM messages m JOIN devices d ON d.id=m.device_id AND d.status != 'deleted' WHERE m.uid = ? AND m.created_at BETWEEN ? AND ?";
      const queryParams = [uid, todayStart, todayEnd];

      if (status !== "all") {
        query += " AND m.status = ?";
        queryParams.push(status);
      }

      query += " ORDER BY m.created_at DESC LIMIT ? OFFSET ?";
      queryParams.push(limit, (page - 1) * limit);

      const [messages] = await connection.query(query, queryParams);

      // Hitung total data sesuai filter
      // Hitung total hanya untuk pesan dari device yang belum dihapus (status != 'deleted')
      let countQuery =
        "SELECT COUNT(*) as total FROM messages m JOIN devices d ON d.id=m.device_id AND d.status != 'deleted' WHERE m.uid = ? AND m.created_at BETWEEN ? AND ?";
      const countParams = [uid, todayStart, todayEnd];
      if (status !== "all") {
        countQuery += " AND m.status = ?";
        countParams.push(status);
      }
      const [[{ total }]] = await connection.query(countQuery, countParams);

      // Hitung per status untuk statistik
      const [statusCounts] = await connection.query(
        "SELECT m.status AS status, COUNT(*) AS count FROM messages m JOIN devices d ON d.id=m.device_id AND d.status != 'deleted' WHERE m.uid = ? AND m.created_at BETWEEN ? AND ? GROUP BY m.status",
        [uid, todayStart, todayEnd],
      );

      const counts = {};
      statusCounts.forEach((row) => {
        counts[row.status] = row.count;
      });

      ["sent", "pending", "failed", "processing"].forEach((s) => {
        counts[s] = counts[s] || 0;
      });

      counts.totalCount = Object.values(counts).reduce(
        (total, c) => total + c,
        0,
      );

      return {
        messages,
        counts,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      console.error("Error retrieving messages:", error);
      throw error.isBoom
        ? error
        : new Boom("Database error", { statusCode: 500 });
    } finally {
      connection.release();
    }
  }

  /**
   * Checks if a number is allowed to receive messages based on Opt-In rules
   * @param {number} uid User ID
   * @param {string} number Phone number
   * @param {string} tags Optional tags (e.g. 'opt-in' to allow invitations)
   * @returns {Promise<{allowed: boolean, reason: string}>}
   */
  async checkOptInStatus(uid, number, tags = "") {
    if (String(process.env.FEATURE_OPT_IN) !== "1") {
      return { allowed: true, reason: "" };
    }

    const cleanNumber = number.replace(/\D/g, "");

    // 1. Ambil semua identitas yang terkait (LID <-> Phone) dari tabel contacts
    const associatedNumbers = [cleanNumber];
    const [linked] = await this.pool.query(
      "SELECT jid, phone FROM contacts WHERE uid = ? AND (phone = ? OR jid LIKE ?)",
      [uid, cleanNumber, `%${cleanNumber}%`],
    );

    linked.forEach((l) => {
      if (l.phone) associatedNumbers.push(l.phone.replace(/\D/g, ""));
      if (l.jid) associatedNumbers.push(l.jid.replace(/\D/g, ""));
    });

    // Unique list of numbers to check
    const uniqueNumbers = [...new Set(associatedNumbers)].filter(
      (n) => n.length > 0,
    );

    // 2. Cek status di tabel opt_ins untuk semua nomor yang terkait
    // Urutkan status agar 'approved' diprioritaskan
    const [optRows] = await this.pool.query(
      "SELECT status FROM opt_ins WHERE uid = ? AND number IN (?) ORDER BY FIELD(status, 'approved', 'blocked', 'pending') LIMIT 1",
      [uid, uniqueNumbers],
    );

    const status = optRows.length > 0 ? optRows[0].status : "pending";
    const effectiveTag = (tags || "").toString().trim().toLowerCase();

    if (status === "approved") {
      return { allowed: true, reason: "" };
    }

    // If the message is tagged as an opt-in invitation, allow it even if pending or blocked
    if (effectiveTag === "opt-in") {
      return { allowed: true, reason: "" };
    }

    if (status === "pending") {
      return {
        allowed: false,
        reason: "Penerima belum melakukan Opt-In (Persetujuan).",
      };
    }

    return {
      allowed: false,
      reason: "Penerima telah memblokir/unsubs notifikasi.",
    };
  }

  async registerMessage(apiKey, deviceKey, messageData) {
    const connection = await this.pool.getConnection();
    try {
      // Cek user
      const [users] = await connection.query(
        "SELECT uid FROM users WHERE api_key = ? LIMIT 1",
        [apiKey],
      );
      if (users.length === 0) {
        return {
          status: false,
          message: "Invalid API key",
        };
      }
      const uid = users[0].uid;

      // Cek device + ambil limit
      const [devices] = await connection.query(
        "SELECT id, limit_daily FROM devices WHERE uid = ? AND device_key = ? LIMIT 1",
        [uid, deviceKey],
      );
      if (devices.length === 0) {
        return {
          status: false,
          message: "Invalid Device Key",
        };
      }
      const deviceId = devices[0].id;
      const limitDaily = devices[0].limit_daily || 0;

      // Hitung pesan hari ini
      const today = moment().tz("Asia/Jakarta").format("YYYY-MM-DD");
      const [countMessages] = await connection.query(
        "SELECT COUNT(*) as total FROM messages WHERE device_id = ? AND DATE(created_at) = ? AND status != 'pending'",
        [deviceId, today],
      );

      let effectiveDeviceId = deviceId;
      let effectiveDeviceKey = deviceKey;

      // Check if primary is disconnected or limited
      const primarySession = this.sessionManager.getSession(deviceKey);
      const isPrimaryConnected = primarySession && primarySession.connected;
      const isPrimaryLimited =
        limitDaily > 0 && countMessages[0].total >= limitDaily;

      if (!isPrimaryConnected || isPrimaryLimited) {
        console.log(
          `ℹ️ [Fallback] Primary device ${deviceKey} is ${
            !isPrimaryConnected ? "disconnected" : "limited"
          }. Searching for sub-sessions...`,
        );

        // Find active sub-sessions
        const [subDevices] = await connection.query(
          "SELECT id, device_key, limit_daily FROM devices WHERE uid = ? AND session_parent = ? AND status = 'connected'",
          [uid, deviceKey],
        );

        for (const sub of subDevices) {
          const [subCount] = await connection.query(
            "SELECT COUNT(*) as total FROM messages WHERE device_id = ? AND DATE(created_at) = ? AND status != 'pending'",
            [sub.id, today],
          );

          if (sub.limit_daily === 0 || subCount[0].total < sub.limit_daily) {
            effectiveDeviceId = sub.id;
            effectiveDeviceKey = sub.device_key;
            console.log(
              `✅ [Fallback] Using sub-session ${effectiveDeviceKey} (ID: ${effectiveDeviceId})`,
            );
            break;
          }
        }

        if (effectiveDeviceId === deviceId) {
          if (isPrimaryLimited) {
            return {
              status: false,
              message: `Daily message limit reached (${limitDaily}) for device ${deviceKey} and no active sub-sessions available`,
              limit: limitDaily,
              used: countMessages[0].total,
            };
          }
        }
      }

      // --- MESSAGE DATA PREPARATION ---
      let { isGroup, to, text, tags, tag } = messageData;
      tags = tags || tag || "";

      let type = "personal";
      if (isGroup) {
        type = "group";
      } else {
        // Normalize numbers to 628 format if they start with 08 or 0
        to = to
          .split(",")
          .map((num) => {
            let n = num.trim().replace(/\D/g, "");
            if (n.startsWith("08")) n = "628" + n.slice(2);
            else if (n.startsWith("0")) n = "62" + n.slice(1);
            return n;
          })
          .join(",");

        const recipients = to.split(",");
        if (recipients.length > 1) {
          type = "bulk";
        }
      }
      // ---------------------------------

      // Waktu sekarang
      const createdAt = moment()
        .tz("Asia/Jakarta")
        .format("YYYY-MM-DD HH:mm:ss");

      // Insert pesan
      const [result] = await connection.query(
        "INSERT INTO messages (uid, device_id, type, number, message, tags, created_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?)",
        [uid, effectiveDeviceId, type, to, text, tags, createdAt],
      );

      return {
        status: true,
        message: "Message registered successfully",
        messageId: result.insertId,
      };
    } catch (error) {
      console.error("Error registering message:", error);
      return {
        status: false,
        message: "Database error",
      };
    } finally {
      connection.release();
    }
  }

  async removeMessage(apiKey, id) {
    const connection = await this.pool.getConnection();
    try {
      const [user] = await connection.query(
        "SELECT uid FROM users WHERE api_key = ?",
        [apiKey],
      );

      if (!user[0]) throw new Boom("Invalid API key", { statusCode: 401 });

      const [result] = await connection.query(
        "DELETE FROM messages WHERE uid = ? AND id = ?",
        [user[0].uid, id],
      );

      if (result.affectedRows === 0) {
        throw new Boom("Message not found", { statusCode: 404 });
      }

      return { status: true };
    } catch (error) {
      console.error("Error removing message:", error);
      throw error.isBoom
        ? error
        : new Boom("Database error", { statusCode: 500 });
    } finally {
      connection.release();
    }
  }

  async getOptIns(uid) {
    try {
      const [rows] = await this.pool.query(
        "SELECT o.*, d.name as device_name FROM opt_ins o LEFT JOIN devices d ON o.device_id = d.id WHERE o.uid = ? ORDER BY o.updated_at DESC",
        [uid],
      );
      return rows;
    } catch (error) {
      console.error("Error fetching opt-ins:", error);
      throw error;
    }
  }

  async removeOptIn(uid, id) {
    try {
      const [result] = await this.pool.query(
        "DELETE FROM opt_ins WHERE uid = ? AND id = ?",
        [uid, id],
      );
      return result.affectedRows > 0;
    } catch (error) {
      console.error("Error removing opt-in:", error);
      throw error;
    }
  }

  async registerOptIn(apiKey, number, status = "approved", source = "form") {
    const connection = await this.pool.getConnection();
    try {
      const [users] = await connection.query(
        "SELECT uid FROM users WHERE api_key = ? LIMIT 1",
        [apiKey],
      );
      if (users.length === 0) {
        return { status: false, message: "Invalid API key" };
      }
      const uid = users[0].uid;
      const cleanNumber = number.replace(/\D/g, "");
      const agreedAt = status === "approved" ? "NOW()" : "NULL";

      await connection.query(
        "INSERT INTO opt_ins (uid, device_id, number, status, source, agreed_at) VALUES (?, 0, ?, ?, ?, " +
          agreedAt +
          ") ON DUPLICATE KEY UPDATE status=VALUES(status), source=VALUES(source), agreed_at=VALUES(agreed_at), updated_at=NOW()",
        [uid, cleanNumber, status, source],
      );

      return { status: true, message: "Opt-In recorded successfully" };
    } catch (error) {
      console.error("Error registering opt-in:", error);
      return { status: false, message: "Database error" };
    } finally {
      connection.release();
    }
  }

  async retryMessage(apiKey, id) {
    const connection = await this.pool.getConnection();
    try {
      // Validasi API key
      const [users] = await connection.query(
        "SELECT uid FROM users WHERE api_key = ? LIMIT 1",
        [apiKey],
      );
      if (users.length === 0) {
        throw Boom.unauthorized("Invalid API key");
      }
      const uid = users[0].uid;

      // Cek apakah pesan ditemukan dan milik user
      const [messages] = await connection.query(
        "SELECT id, status FROM messages WHERE uid = ? AND id = ? LIMIT 1",
        [uid, id],
      );
      if (messages.length === 0) {
        throw Boom.notFound("Message not found");
      }

      const message = messages[0];

      if (message.status !== "failed") {
        throw Boom.badRequest(
          `Message cannot be retried because its status is '${message.status}'`,
        );
      }

      const updatedAt = moment()
        .tz("Asia/Jakarta")
        .format("YYYY-MM-DD HH:mm:ss");

      // Update status menjadi pending untuk retry
      await connection.query(
        "UPDATE messages SET status = ?, updated_at = ? WHERE id = ?",
        ["pending", updatedAt, id],
      );

      return {
        status: true,
        message: "Message status updated to pending for retry",
      };
    } catch (error) {
      console.error("Error confirming retry:", error);
      throw error.isBoom ? error : Boom.internal("Unexpected database error");
    } finally {
      connection.release();
    }
  }

  async getMessageCounts(apiKey) {
    const connection = await this.pool.getConnection();
    try {
      const [users] = await connection.query(
        "SELECT uid FROM users WHERE api_key = ? LIMIT 1",
        [apiKey],
      );
      if (users.length === 0) {
        throw new Boom("Invalid API key", { statusCode: 401 });
      }
      const userId = users[0].uid;

      const [messageCounts] = await connection.query(
        "SELECT status, COUNT(*) AS count FROM messages WHERE uid = ? GROUP BY status",
        [userId],
      );

      const counts = {};
      messageCounts.forEach((row) => {
        counts[row.status] = row.count;
      });

      const defaultStatuses = ["sent", "pending", "failed", "processing"];
      defaultStatuses.forEach((status) => {
        counts[status] = counts[status] || 0;
      });

      return counts;
    } catch (error) {
      console.log("Error retrieving message counts:");
      throw error.isBoom
        ? error
        : new Boom("Database error", { statusCode: 500 });
    } finally {
      connection.release();
    }
  }

  async getMessageCountTodayByDevice(apiKey, deviceKey) {
    const connection = await this.pool.getConnection();
    try {
      // Validasi API key
      const [users] = await connection.query(
        "SELECT uid FROM users WHERE api_key = ? LIMIT 1",
        [apiKey],
      );

      if (users.length === 0) {
        throw new Boom("Invalid API key", { statusCode: 401 });
      }

      const userId = users[0].uid;

      // Ambil ID device
      const [devices] = await connection.query(
        "SELECT id FROM devices WHERE uid = ? AND device_key = ? LIMIT 1",
        [userId, deviceKey],
      );

      if (devices.length === 0) {
        throw new Boom("Invalid device key", { statusCode: 404 });
      }

      const deviceId = devices[0].id;

      // Hitung pesan hari ini per status
      const [messageCounts] = await connection.query(
        `SELECT status, COUNT(*) AS count 
       FROM messages 
       WHERE uid = ? 
         AND device_id = ? 
         AND DATE(created_at) = CURDATE() 
       GROUP BY status`,
        [userId, deviceId],
      );

      const counts = {};
      messageCounts.forEach((row) => {
        counts[row.status] = row.count;
      });

      // Pastikan semua status ada
      const defaultStatuses = ["sent", "pending", "failed", "processing"];
      defaultStatuses.forEach((status) => {
        counts[status] = counts[status] || 0;
      });

      return counts;
    } catch (error) {
      console.error(
        "Error retrieving today's message counts by device:",
        error,
      );
      throw error.isBoom
        ? error
        : new Boom("Database error", { statusCode: 500 });
    } finally {
      connection.release();
    }
  }

  async sendMessage(apiKey, deviceKey, to, text, group = false, tags = "") {
    const session = this.sessionManager.getSession(deviceKey);
    if (!session || !session.connected) {
      throw new Error("Session not found or not connected.");
    }

    const [users] = await this.pool.query(
      "SELECT uid FROM users WHERE api_key = ? LIMIT 1",
      [apiKey],
    );
    if (!users.length) {
      throw new Error("Invalid API key.");
    }
    const uid = users[0].uid;

    const [devices] = await this.pool.query(
      "SELECT id FROM devices WHERE uid = ? AND device_key = ? LIMIT 1",
      [uid, deviceKey],
    );
    if (!devices.length) {
      throw new Error("Device not found.");
    }
    const deviceId = devices[0].id;

    const recipients = to.split(",").map((recipient) => recipient.trim());
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
              message: "Invalid Group ID format.",
            });
            continue;
          }
          await session.socket.sendMessage(recipient, { text });
        } else {
          // --- OPT-IN CHECK ---
          const optCheck = await this.checkOptInStatus(uid, recipient, tags);
          if (!optCheck.allowed) {
            results.push({
              recipient,
              status: false,
              message: optCheck.reason,
            });
            continue;
          }
          // --------------------

          if (!isValidPhoneNumber(recipient)) {
            invalidRecipients.push(recipient);
            results.push({
              recipient,
              status: false,
              message: "Invalid phone number format.",
            });
            continue;
          }

          const formattedNumber = recipient.includes("@s.whatsapp.net")
            ? recipient
            : `${recipient}@s.whatsapp.net`;
          const sentMsg = await session.socket.sendMessage(formattedNumber, {
            text,
          });
          const resultJid = sentMsg.key.remoteJid;

          // Record mapping if it's a new JID or LID
          if (resultJid) {
            try {
              let cleanPhone = recipient.replace(/\D/g, "");
              if (cleanPhone.startsWith("08")) {
                cleanPhone = "628" + cleanPhone.slice(2);
              } else if (cleanPhone.startsWith("0")) {
                cleanPhone = "62" + cleanPhone.slice(1);
              }
              await this.pool.query(
                "INSERT INTO contacts (uid, device_id, jid, phone) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE phone = VALUES(phone), updated_at = NOW()",
                [uid, deviceId, resultJid, cleanPhone],
              );
            } catch (e) {
              // Ignore mapping errors
            }
          }

          results.push({
            recipient,
            status: true,
            message: "Message sent successfully.",
            messageId: sentMsg.key.id,
          });
        }
      } catch (error) {
        results.push({
          recipient,
          status: false,
          message: `Failed to send message: ${error.message}`,
        });
      }
    }

    return {
      status: true,
      message: "Message processing completed.",
      data: {
        results,
        invalidRecipients,
      },
    };
  }

  async getMessageStatistics(apiKey) {
    const connection = await this.pool.getConnection();
    try {
      const [users] = await connection.query(
        "SELECT uid FROM users WHERE api_key = ? LIMIT 1",
        [apiKey],
      );
      if (users.length === 0) {
        throw new Boom("Invalid API key", { statusCode: 401 });
      }
      const uid = users[0].uid;

      // Ambil data statistik berdasarkan status pesan
      const [statistics] = await connection.query(
        `SELECT status, COUNT(*) AS count 
                 FROM messages 
                 WHERE uid = ? AND created_at >= NOW() - INTERVAL 7 DAY 
                 GROUP BY status`,
        [uid],
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
        [uid],
      );

      // Format statistik berdasarkan status
      const stats = {
        sent: 0,
        pending: 0,
        failed: 0,
        total: 0,
        daily: [],
      };

      statistics.forEach((row) => {
        stats[row.status] = row.count;
        stats.total += row.count;
      });

      // Format data harian untuk chart
      const formattedDailyStats = dailyStats.map((row) => ({
        date: row.date,
        sent: row.sent,
        pending: row.pending,
        failed: row.failed,
      }));

      stats.daily = formattedDailyStats;

      return stats;
    } catch (error) {
      console.error("Error retrieving message statistics:", error);
      throw error.isBoom
        ? error
        : new Boom("Database error", { statusCode: 500 });
    } finally {
      connection.release();
    }
  }

  async getMessagesLast(apiKey, limit = 3, days = 7) {
    const connection = await this.pool.getConnection();
    const now = moment().tz("Asia/Jakarta");
    const startTime = now.subtract(days, "days").format("YYYY-MM-DD HH:mm:ss"); // Ambil data 7 hari terakhir

    try {
      const [users] = await connection.query(
        "SELECT uid FROM users WHERE api_key = ? LIMIT 1",
        [apiKey],
      );

      if (users.length === 0) {
        throw new Boom("Invalid API key", { statusCode: 401 });
      }

      const uid = users[0].uid;

      const query = `
                SELECT m.id, m.uid, m.number, m.status, m.message, m.created_at, d.device_key
                FROM messages m 
                LEFT JOIN devices d ON d.id=m.device_id
                WHERE m.uid = ? AND m.created_at >= ? 
                ORDER BY m.created_at DESC 
                LIMIT ?
            `;

      const [messages] = await connection.query(query, [uid, startTime, limit]);

      return messages;
    } catch (error) {
      console.error("Error retrieving last messages:", error.message);
      throw new Error("Database error");
    } finally {
      connection.release(); // Pastikan koneksi selalu dilepas
    }
  }
}

module.exports = MessageManager;
