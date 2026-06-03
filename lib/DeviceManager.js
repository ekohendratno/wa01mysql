const moment = require("moment-timezone");
const { Boom } = require("@hapi/boom");
const crypto = require("crypto");
const { generateAPIKey, generateDeviceID } = require("./Generate");
const { calculateLastActive } = require("./Utils");
const CustomError = require("./CustomError");

class DeviceManager {
  constructor(pool) {
    this.pool = pool;
  }

  async registerDevice(
    apiKey,
    deviceName,
    phone,
    packageId,
    sessionParent = null,
  ) {
    const connection = await this.pool.getConnection();
    try {
      const [user] = await connection.query(
        "SELECT uid FROM users WHERE api_key = ?",
        [apiKey],
      );
      if (!user[0]) throw new CustomError("API key tidak valid", 401);

      const userId = user[0].uid;
      console.log(
        `[DEBUG] DeviceManager.registerDevice called for UID: ${userId}, phone: ${phone}, packageId: ${packageId}`,
      );

      // VALIDASI: Skip pengecekan nomor unik agar bisa didaftarkan berkali-kali (Multi-device/Multi-account)
      /*
      if (phone) {
        const [existingDevice] = await connection.query(
          "SELECT id FROM devices WHERE phone = ? AND uid != ? AND status != 'deleted' LIMIT 1",
          [phone, userId],
        );
        if (existingDevice.length > 0) {
          throw new CustomError(
            "Nomor telepon ini sudah digunakan oleh akun lain.",
            400,
          );
        }
      }
      */

      const [packages] = await connection.query(
        "SELECT id, name, price, limit_daily, life_time FROM packages WHERE id = ?",
        [packageId],
      );
      if (packages.length === 0)
        throw new CustomError("Paket tidak ditemukan", 404);

      const packageDetails = packages[0];
      const packagePrice = parseFloat(packageDetails.price);

      if (packagePrice > 0) {
        const [balances] = await connection.query(
          "SELECT balance FROM balances WHERE uid = ?",
          [userId],
        );
        const balance = balances[0]?.balance || 0;

        if (balance < packagePrice) {
          throw new CustomError(
            "Saldo tidak mencukupi. Silakan top-up terlebih dahulu.",
            402,
            {
              redirect: "/client/billing",
            },
          );
        }

        await connection.beginTransaction();
        await connection.query(
          "UPDATE balances SET balance = balance - ? WHERE uid = ?",
          [packagePrice, userId],
        );

        const description = `Pembelian Paket Device (${packageDetails.name})`;
        await connection.query(
          "INSERT INTO transactions (uid, description, amount, status, whatIs) VALUES (?, ?, ?, ?, ?)",
          [userId, description, -packagePrice, "success", "-"],
        );
      } else {
        await connection.beginTransaction();
      }

      let lifeTime = packageDetails.life_time || 30; // Default masa aktif
      let limitDaily = packageDetails.limit_daily || 250; // Default limit harian
      let limitTotal = 0; // Default limit total (unlimited)

      if (sessionParent) {
        const [parentDevices] = await connection.query(
          "SELECT life_time, limit_daily, `limit` FROM devices WHERE device_key = ? LIMIT 1",
          [sessionParent],
        );
        if (parentDevices.length > 0) {
          lifeTime = parentDevices[0].life_time;
          limitDaily = parentDevices[0].limit_daily;
          limitTotal = parentDevices[0].limit;
        }
      }

      const todayStr = moment().tz("Asia/Jakarta").format("YYYY-MM-DD");
      const deviceKey = generateDeviceID();
      const safeSessionParent = sessionParent || "";
      await connection.query(
        "INSERT INTO devices (uid, name, phone, device_key, session_parent, packageId, life_time, limit_daily, `limit`, last_life_decrement, last_limit_decrement) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          userId,
          deviceName,
          phone,
          deviceKey,
          safeSessionParent,
          packageId,
          lifeTime,
          limitDaily,
          limitTotal,
          todayStr,
          todayStr,
        ],
      );

      await connection.commit();

      return {
        status: true,
        message: "Device berhasil ditambahkan.",
        data: {
          device_key: deviceKey,
          name: deviceName,
        },
      };
    } catch (error) {
      await connection.rollback();
      console.error("Error registering device:", error);
      if (
        error &&
        error.code === "ER_BAD_NULL_ERROR" &&
        String(error.sqlMessage || error.message || "").includes("session_parent")
      ) {
        throw new CustomError(
          "Gagal menambah device karena struktur database belum diperbarui. Silakan restart aplikasi lalu coba lagi.",
          500,
        );
      }
      throw error;
    } finally {
      connection.release();
    }
  }

  async removeDevice(apiKey, deviceKey) {
    const connection = await this.pool.getConnection();
    try {
      const [user] = await connection.query(
        "SELECT uid FROM users WHERE api_key = ?",
        [apiKey],
      );

      if (!user[0]) throw new Boom("Invalid API key", { statusCode: 401 });

      // Soft-delete: mark device as 'deleted' so it will be removed by cron.
      const [result] = await connection.query(
        "UPDATE devices SET status = ?, updated_at = NOW() WHERE uid = ? AND device_key = ?",
        ["deleted", user[0].uid, deviceKey],
      );

      if (result.affectedRows === 0) {
        throw new Boom("Device not found", { statusCode: 404 });
      }

      console.log(
        `[DeviceManager] Device ${deviceKey} marked as deleted by API user ${user[0].uid}`,
      );
      return { status: true };
    } catch (error) {
      console.error("Error removing device:", error);
      throw error.isBoom
        ? error
        : new Boom("Database error", { statusCode: 500 });
    } finally {
      connection.release();
    }
  }

  async upgradeDevicePackage(apiKey, deviceKey, packageId) {
    const connection = await this.pool.getConnection();
    try {
      const [users] = await connection.query(
        "SELECT uid FROM users WHERE api_key = ? LIMIT 1",
        [apiKey],
      );
      if (users.length === 0) throw new CustomError("API key tidak valid", 401);
      const uid = users[0].uid;

      const [devices] = await connection.query(
        "SELECT id, name, packageId FROM devices WHERE uid = ? AND device_key = ? AND status != 'deleted' LIMIT 1",
        [uid, deviceKey],
      );
      if (devices.length === 0) {
        throw new CustomError("Device tidak ditemukan atau bukan milik akun ini.", 404);
      }

      const [packages] = await connection.query(
        "SELECT id, name, price, limit_daily, life_time FROM packages WHERE id = ? AND active = 1 LIMIT 1",
        [packageId],
      );
      if (packages.length === 0) {
        throw new CustomError("Paket tidak ditemukan atau sedang tidak aktif.", 404);
      }

      const pkg = packages[0];
      const price = parseFloat(pkg.price || 0);

      await connection.beginTransaction();

      if (price > 0) {
        const [balances] = await connection.query(
          "SELECT balance FROM balances WHERE uid = ? FOR UPDATE",
          [uid],
        );
        const balance = parseFloat(balances[0]?.balance || 0);
        if (balance < price) {
          throw new CustomError(
            "Saldo tidak mencukupi untuk upgrade paket. Silakan top-up terlebih dahulu.",
            402,
            { redirect: "/client/billing" },
          );
        }

        await connection.query(
          "UPDATE balances SET balance = balance - ? WHERE uid = ?",
          [price, uid],
        );

        await connection.query(
          "INSERT INTO transactions (uid, description, amount, status, whatIs) VALUES (?, ?, ?, ?, ?)",
          [
            uid,
            `Upgrade Paket Device ${deviceKey} ke ${pkg.name}. Paket lama hangus.`,
            -price,
            "success",
            "-",
          ],
        );
      }

      const lifeTime = pkg.life_time || 30;
      const limitDaily = pkg.limit_daily || 250;
      const todayStr = moment().tz("Asia/Jakarta").format("YYYY-MM-DD");

      await connection.query(
        `UPDATE devices
         SET packageId = ?,
             life_time = ?,
             limit_daily = ?,
             last_life_decrement = ?,
             last_limit_decrement = ?,
             updated_at = NOW()
         WHERE id = ? AND uid = ?`,
        [pkg.id, lifeTime, limitDaily, todayStr, todayStr, devices[0].id, uid],
      );

      await connection.commit();

      return {
        status: true,
        message: `Paket device berhasil diubah ke ${pkg.name}. Paket lama telah hangus.`,
        data: {
          device_key: deviceKey,
          package_id: pkg.id,
          package_name: pkg.name,
          life_time: lifeTime,
          limit_daily: limitDaily,
        },
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async updateDeviceStatus(deviceKey, status, phoneNumber = null, name = null) {
    const connection = await this.pool.getConnection();
    try {
      let safeStatus = String(status || "unknown").substring(0, 20);

      let query = `
      UPDATE devices 
      SET status = ?, updated_at = NOW()
    `;
      const params = [safeStatus];

      if (phoneNumber !== null && phoneNumber !== undefined) {
        query += `, phone = ?`;
        params.push(String(phoneNumber).substring(0, 50));
      }

      if (name !== null && name !== undefined) {
        query += `, name = ?`;
        params.push(String(name).substring(0, 100));
      }

      query += ` WHERE device_key = ?`;
      params.push(deviceKey);

      const [result] = await connection.query(query, params);

      console.log(
        `[DeviceManager] Status updated → Key: ${deviceKey} | Status: "${safeStatus}" | Affected rows: ${result.affectedRows}`,
      );

      if (result.affectedRows === 0) {
        console.warn(
          `[DeviceManager] ⚠️ No device found with device_key: ${deviceKey}`,
        );
      }
    } catch (error) {
      console.error(
        `[DeviceManager] ❌ Error updating device status:`,
        error.message,
      );
      throw error;
    } finally {
      connection.release();
    }
  }

  async updateWebhookUrl(apiKey, deviceKey, webhookUrl) {
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

      const [result] = await connection.query(
        "UPDATE devices SET webhook_url = ?, updated_at = NOW() WHERE uid = ? AND device_key = ?",
        [webhookUrl, uid, deviceKey],
      );

      if (result.affectedRows === 0) {
        throw new Boom("Device not found", { statusCode: 404 });
      }

      return { status: true, message: "Webhook URL updated successfully" };
    } catch (error) {
      console.error("Error updating webhook URL:", error);
      throw error.isBoom
        ? error
        : new Boom("Database error", { statusCode: 500 });
    } finally {
      connection.release();
    }
  }

  async getWebhookUrl(apiKey, deviceKey) {
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

      const [rows] = await connection.query(
        "SELECT webhook_url FROM devices WHERE uid = ? AND device_key = ? LIMIT 1",
        [uid, deviceKey],
      );

      if (rows.length === 0) {
        throw new Boom("Device not found", { statusCode: 404 });
      }

      return rows[0].webhook_url;
    } catch (error) {
      console.error("Error getting webhook URL:", error);
      throw error.isBoom
        ? error
        : new Boom("Database error", { statusCode: 500 });
    } finally {
      connection.release();
    }
  }

  async getDevices(apiKey, options = {}) {
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

      const uid = users[0].uid;
      const includeShared = options.includeShared !== false;
      const status = options.status || "";
      const statusClause = status ? " AND d.status = ?" : "";

      // Ambil daftar devices milik user
      // Gunakan pagination default untuk menghindari placeholder yang tidak terisi
      const DEFAULT_LIMIT = 100;
      const DEFAULT_OFFSET = 0;
      const limit = DEFAULT_LIMIT;
      const offset = DEFAULT_OFFSET;

      const ownedParams = [uid];
      if (status) ownedParams.push(status);

      const selects = [
        `
        SELECT
          d.id, d.uid, d.name, d.phone, d.device_key, d.session_parent,
          d.life_time, d.\`limit\`, d.limit_daily, d.status, d.webhook_url,
          d.created_at, d.updated_at,
          'owner' AS access_type,
          NULL AS share_id,
          NULL AS owner_name,
          NULL AS share_expires_at,
          NULL AS share_created_at,
          NULL AS share_status,
          NULL AS share_limit_daily_override
        FROM devices d
        WHERE d.uid = ? AND d.status != 'deleted'${statusClause}
        `,
      ];
      const queryParams = [...ownedParams];

      if (includeShared) {
        const sharedParams = [uid];
        if (status) sharedParams.push(status);
        selects.push(`
        SELECT
          d.id, d.uid, d.name, d.phone, d.device_key, d.session_parent,
          d.life_time, d.\`limit\`, d.limit_daily, d.status, d.webhook_url,
          d.created_at, d.updated_at,
          'shared' AS access_type,
          ds.id AS share_id,
          u.name AS owner_name,
          ds.expires_at AS share_expires_at,
          ds.created_at AS share_created_at,
          ds.status AS share_status,
          ds.limit_daily_override AS share_limit_daily_override
        FROM device_shares ds
        JOIN devices d ON ds.device_id = d.id
        JOIN users u ON ds.owner_uid = u.uid
        WHERE ds.shared_uid = ?
          AND ds.status = 'active'
          AND ds.permission_send = 1
          AND d.status != 'deleted'
          ${statusClause}
          AND (ds.expires_at IS NULL OR ds.expires_at > NOW())
        `);
        queryParams.push(...sharedParams);
      }

      const query = `
        SELECT *
        FROM (
          ${selects.join(" UNION ALL ")}
        ) accessible_devices
        ORDER BY updated_at DESC
        LIMIT ? OFFSET ?`;
      queryParams.push(limit, offset);
      const [devices] = await connection.query(query, queryParams);

      const result = [];
      for (const device of devices) {
        const lastActive = calculateLastActive(device.updated_at);

        // Hitung pesan hari ini per status
        const [messageCounts] = await connection.query(
          `SELECT status, COUNT(*) AS count 
         FROM messages 
         WHERE uid = ? 
           AND device_id = ? 
           AND DATE(created_at) = CURDATE() 
         GROUP BY status`,
          [uid, device.id],
        );

        const counts = {};
        messageCounts.forEach((row) => {
          counts[row.status] = row.count;
        });

        // Default status supaya selalu ada
        const defaultStatuses = ["sent", "pending", "failed", "processing"];
        defaultStatuses.forEach((status) => {
          counts[status] = counts[status] || 0;
        });

        if (device.access_type === "shared" && device.share_limit_daily_override !== null) {
          device.limit_daily = device.share_limit_daily_override;
        }

        // Tambahin total semua status
        const totalToday =
          counts.sent + counts.pending + counts.failed + counts.processing;

        result.push({
          ...device,
          last_active: lastActive,
          message_count_today: {
            ...counts,
            total: totalToday,
          },
        });
      }

      return result;
    } catch (error) {
      console.error("Error retrieving devices:", error);
      throw error.isBoom
        ? error
        : new Boom("Database error", { statusCode: 500 });
    } finally {
      connection.release();
    }
  }

  async getDevice(apiKey, deviceKey) {
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

      const uid = users[0].uid;

      // Ambil device
      const [devices] = await connection.query(
        `SELECT d.id, d.uid, d.name, d.phone, d.device_key, d.session_parent, d.packageId, p.name as package_name, p.description as package_description, d.life_time, d.limit, d.limit_daily, d.status, d.created_at, d.updated_at,
          CASE WHEN d.uid = ? THEN 'owner' ELSE 'shared' END AS access_type
       FROM devices d
       LEFT JOIN packages p ON d.packageId = p.id
       LEFT JOIN device_shares ds
         ON ds.device_id = d.id
        AND ds.shared_uid = ?
        AND ds.status = 'active'
        AND ds.permission_send = 1
        AND (ds.expires_at IS NULL OR ds.expires_at > NOW())
       WHERE (d.uid = ? OR ds.id IS NOT NULL)
         AND d.device_key = ?
         AND d.status != 'deleted'
       LIMIT 1`,
        [uid, uid, uid, deviceKey],
      );

      if (devices.length === 0) {
        throw new Boom("Invalid device key", { statusCode: 404 });
      }

      const device = devices[0];

      // Hitung pesan hari ini per status
      const [messageCounts] = await connection.query(
        `SELECT status, COUNT(*) AS count 
       FROM messages 
       WHERE uid = ? 
         AND device_id = ? 
         AND DATE(created_at) = CURDATE() 
       GROUP BY status`,
        [uid, device.id],
      );

      const counts = {};
      messageCounts.forEach((row) => {
        counts[row.status] = row.count;
      });

      // Default status supaya selalu ada
      const defaultStatuses = ["sent", "pending", "failed", "processing"];
      defaultStatuses.forEach((status) => {
        counts[status] = counts[status] || 0;
      });

      // Tambahin total
      const totalToday =
        counts.sent + counts.pending + counts.failed + counts.processing;

      const lastActive = calculateLastActive(device.updated_at);

      return {
        ...device,
        last_active: lastActive,
        message_count_today: {
          ...counts,
          total: totalToday,
        },
      };
    } catch (error) {
      console.error("Error retrieving device:", error);
      throw error.isBoom
        ? error
        : new Boom("Database error", { statusCode: 500 });
    } finally {
      connection.release();
    }
  }

  async resolveAccessibleDevice(apiKey, deviceKey) {
    const [users] = await this.pool.query(
      "SELECT uid FROM users WHERE api_key = ? LIMIT 1",
      [apiKey],
    );
    if (users.length === 0) {
      throw new Boom("Invalid API key", { statusCode: 401 });
    }

    const uid = users[0].uid;
    const [devices] = await this.pool.query(
      `SELECT
          d.id, d.uid AS owner_uid, d.device_key, d.status, d.limit_daily,
          CASE WHEN d.uid = ? THEN 'owner' ELSE 'shared' END AS access_type
       FROM devices d
       LEFT JOIN device_shares ds
         ON ds.device_id = d.id
        AND ds.shared_uid = ?
        AND ds.status = 'active'
        AND ds.permission_send = 1
        AND (ds.expires_at IS NULL OR ds.expires_at > NOW())
       WHERE (d.uid = ? OR ds.id IS NOT NULL)
         AND d.device_key = ?
         AND d.status != 'deleted'
       LIMIT 1`,
      [uid, uid, uid, deviceKey],
    );

    if (devices.length === 0) {
      throw new Boom("Device not found or not shared to this account", {
        statusCode: 404,
      });
    }

    return {
      requester_uid: uid,
      ...devices[0],
    };
  }

  async createDeviceShare(apiKey, deviceKey, expiresInDays = 7) {
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
      const [devices] = await connection.query(
        "SELECT id, name, device_key FROM devices WHERE uid = ? AND device_key = ? AND status != 'deleted' LIMIT 1",
        [uid, deviceKey],
      );
      if (devices.length === 0) {
        throw new Boom("Device tidak ditemukan atau bukan milik akun ini", {
          statusCode: 404,
        });
      }

      const code = crypto.randomBytes(5).toString("hex").toUpperCase();
      const days = Math.max(1, Math.min(30, parseInt(expiresInDays, 10) || 7));
      await connection.query(
        `INSERT INTO device_shares
          (device_id, owner_uid, invite_code, permission_send, status, expires_at)
         VALUES (?, ?, ?, 1, 'pending', DATE_ADD(NOW(), INTERVAL ? DAY))`,
        [devices[0].id, uid, code, days],
      );

      return {
        status: true,
        inviteCode: code,
        data: {
          invite_code: code,
          expires_in_days: days,
          device: devices[0],
        },
        expiresInDays: days,
        device: devices[0],
      };
    } finally {
      connection.release();
    }
  }

  async acceptDeviceShare(apiKey, inviteCode) {
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
      const code = String(inviteCode || "").trim().toUpperCase();
      const [shares] = await connection.query(
        `SELECT ds.*, d.name, d.device_key
         FROM device_shares ds
         JOIN devices d ON ds.device_id = d.id
         WHERE ds.invite_code = ?
           AND ds.status = 'pending'
           AND (ds.expires_at IS NULL OR ds.expires_at > NOW())
         LIMIT 1`,
        [code],
      );

      if (shares.length === 0) {
        throw new Boom("Kode undangan tidak valid atau sudah kedaluwarsa", {
          statusCode: 404,
        });
      }

      const share = shares[0];
      if (Number(share.owner_uid) === Number(uid)) {
        throw new Boom("Pemilik device tidak perlu menerima undangan sendiri", {
          statusCode: 400,
        });
      }

      const [existing] = await connection.query(
        `SELECT id FROM device_shares
         WHERE device_id = ? AND shared_uid = ? AND status = 'active'
         LIMIT 1`,
        [share.device_id, uid],
      );
      if (existing.length > 0) {
        throw new Boom("Device ini sudah dibagikan ke akun Anda", {
          statusCode: 400,
        });
      }

      await connection.query(
        `UPDATE device_shares
         SET shared_uid = ?, status = 'active', accepted_at = NOW(), updated_at = NOW()
         WHERE id = ?`,
        [uid, share.id],
      );

      return {
        status: true,
        device: {
          name: share.name,
          device_key: share.device_key,
        },
      };
    } finally {
      connection.release();
    }
  }

  async getDeviceShares(apiKey) {
    const [users] = await this.pool.query(
      "SELECT uid FROM users WHERE api_key = ? LIMIT 1",
      [apiKey],
    );
    if (users.length === 0) {
      throw new Boom("Invalid API key", { statusCode: 401 });
    }

    const uid = users[0].uid;
    const [rows] = await this.pool.query(
      `SELECT
          ds.id, ds.invite_code, ds.status, ds.permission_send,
          ds.limit_daily_override, ds.ai_reply_mode, ds.expires_at,
          ds.accepted_at, ds.created_at,
          d.name AS device_name, d.device_key, d.limit_daily AS device_limit_daily,
          u.name AS shared_name, u.email AS shared_email,
          COALESCE(ms.today_total, 0) AS today_total,
          COALESCE(ms.today_sent, 0) AS today_sent,
          COALESCE(ms.today_pending, 0) AS today_pending,
          COALESCE(ms.today_processing, 0) AS today_processing,
          COALESCE(ms.today_failed, 0) AS today_failed,
          COALESCE(ms.week_total, 0) AS week_total,
          COALESCE(ms.week_sent, 0) AS week_sent,
          COALESCE(ms.week_pending, 0) AS week_pending,
          COALESCE(ms.week_processing, 0) AS week_processing,
          COALESCE(ms.week_failed, 0) AS week_failed
       FROM device_shares ds
       JOIN devices d ON ds.device_id = d.id
       LEFT JOIN users u ON ds.shared_uid = u.uid
       LEFT JOIN (
          SELECT
            uid,
            device_id,
            COUNT(CASE WHEN created_at >= CURDATE() THEN 1 END) AS today_total,
            SUM(CASE WHEN created_at >= CURDATE() AND status = 'sent' THEN 1 ELSE 0 END) AS today_sent,
            SUM(CASE WHEN created_at >= CURDATE() AND status = 'pending' THEN 1 ELSE 0 END) AS today_pending,
            SUM(CASE WHEN created_at >= CURDATE() AND status = 'processing' THEN 1 ELSE 0 END) AS today_processing,
            SUM(CASE WHEN created_at >= CURDATE() AND status = 'failed' THEN 1 ELSE 0 END) AS today_failed,
            COUNT(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 END) AS week_total,
            SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND status = 'sent' THEN 1 ELSE 0 END) AS week_sent,
            SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND status = 'pending' THEN 1 ELSE 0 END) AS week_pending,
            SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND status = 'processing' THEN 1 ELSE 0 END) AS week_processing,
            SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND status = 'failed' THEN 1 ELSE 0 END) AS week_failed
          FROM messages
          GROUP BY uid, device_id
       ) ms ON ms.uid = ds.shared_uid AND ms.device_id = ds.device_id
       WHERE ds.owner_uid = ?
       ORDER BY ds.created_at DESC
       LIMIT 50`,
      [uid],
    );
    return rows;
  }

  async revokeDeviceShare(apiKey, shareId) {
    const [users] = await this.pool.query(
      "SELECT uid FROM users WHERE api_key = ? LIMIT 1",
      [apiKey],
    );
    if (users.length === 0) {
      throw new Boom("Invalid API key", { statusCode: 401 });
    }

    const [result] = await this.pool.query(
      "UPDATE device_shares SET status = 'revoked', updated_at = NOW() WHERE id = ? AND owner_uid = ?",
      [shareId, users[0].uid],
    );

    return result.affectedRows > 0;
  }

  async updateDeviceShareExpiry(apiKey, shareId, options = {}) {
    const [users] = await this.pool.query(
      "SELECT uid FROM users WHERE api_key = ? LIMIT 1",
      [apiKey],
    );
    if (users.length === 0) {
      throw new Boom("Invalid API key", { statusCode: 401 });
    }

    const uid = users[0].uid;
    const [shares] = await this.pool.query(
      `SELECT ds.id, ds.expires_at, ds.limit_daily_override, ds.ai_reply_mode, d.limit_daily AS device_limit_daily
       FROM device_shares ds
       JOIN devices d ON d.id = ds.device_id
       WHERE ds.id = ? AND ds.owner_uid = ? AND ds.status != 'revoked'
       LIMIT 1`,
      [shareId, uid],
    );
    if (shares.length === 0) {
      throw new Boom("Share tidak ditemukan atau sudah dicabut", {
        statusCode: 404,
      });
    }

    let expiresAt = null;
    if (options.expiresAt) {
      const parsed = new Date(options.expiresAt);
      if (Number.isNaN(parsed.getTime()) || parsed <= new Date()) {
        throw new Boom("Tanggal kedaluwarsa harus lebih besar dari sekarang", {
          statusCode: 400,
        });
      }
      expiresAt = parsed;
    } else {
      const additionalDays = parseInt(options.additionalDays || "0", 10);
      if (!Number.isFinite(additionalDays) || additionalDays === 0) {
        throw new Boom("Jumlah hari wajib diisi", { statusCode: 400 });
      }
      if (additionalDays < -365 || additionalDays > 365) {
        throw new Boom("Jumlah hari harus antara -365 sampai 365", {
          statusCode: 400,
        });
      }

      const currentExpiry = shares[0].expires_at
        ? new Date(shares[0].expires_at)
        : new Date();
      const base = currentExpiry > new Date() ? currentExpiry : new Date();
      expiresAt = new Date(base.getTime() + additionalDays * 24 * 60 * 60 * 1000);
      if (expiresAt <= new Date()) {
        throw new Boom("Perubahan hari membuat share langsung kedaluwarsa", {
          statusCode: 400,
        });
      }
    }

    const mysqlDate = expiresAt.toISOString().slice(0, 19).replace("T", " ");
    let limitDailyOverride = shares[0].limit_daily_override;
    if (Object.prototype.hasOwnProperty.call(options, "limitDailyOverride")) {
      const rawLimit = String(options.limitDailyOverride ?? "").trim();
      if (rawLimit !== "") {
        const parsedLimit = parseInt(rawLimit, 10);
        const maxLimit = Number(shares[0].device_limit_daily || 0);
        if (!Number.isFinite(parsedLimit) || parsedLimit < 1) {
          throw new Boom("Limit harian share harus minimal 1 pesan", {
            statusCode: 400,
          });
        }
        if (maxLimit > 0 && parsedLimit > maxLimit) {
          throw new Boom(
            `Limit harian share tidak boleh melebihi limit device (${maxLimit} pesan/hari)`,
            { statusCode: 400 },
          );
        }
        limitDailyOverride = parsedLimit;
      }
    }

    const allowedAiModes = ["off", "draft", "auto"];
    let aiReplyMode = shares[0].ai_reply_mode || "off";
    if (Object.prototype.hasOwnProperty.call(options, "aiReplyMode")) {
      const requestedMode = String(options.aiReplyMode || "off").trim().toLowerCase();
      if (!allowedAiModes.includes(requestedMode)) {
        throw new Boom("Mode AI share tidak valid", { statusCode: 400 });
      }
      aiReplyMode = requestedMode;
    }

    await this.pool.query(
      "UPDATE device_shares SET expires_at = ?, limit_daily_override = ?, ai_reply_mode = ?, updated_at = NOW() WHERE id = ? AND owner_uid = ?",
      [mysqlDate, limitDailyOverride, aiReplyMode, shareId, uid],
    );

    return {
      status: true,
      message: "Masa aktif share berhasil diperbarui.",
      expires_at: mysqlDate,
      limit_daily_override: limitDailyOverride,
      ai_reply_mode: aiReplyMode,
    };
  }

  // Fungsi untuk mendapatkan jumlah perangkat aktif
  async getActiveDeviceCount(apiKey) {
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

      // Hitung jumlah perangkat aktif
      const [activeDevices] = await connection.query(
        "SELECT COUNT(*) AS activeCount FROM devices WHERE uid = ? AND status = ?",
        [userId, "connected"],
      );

      return activeDevices[0].activeCount || 0;
    } catch (error) {
      console.error("Error retrieving active device count:", error);
      throw error.isBoom
        ? error
        : new Boom("Database error", { statusCode: 500 });
    } finally {
      connection.release();
    }
  }

  // Fungsi untuk mendapatkan daftar perangkat dengan last_active
  async getDevicesWithLastActive(apiKey) {
    if (!apiKey) {
      throw new Boom("API key is required", { statusCode: 400 });
    }

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

      // Ambil satu perangkat terakhir yang aktif berdasarkan updated_at terbaru
      const [devices] = await connection.query(
        "SELECT id, name, phone, device_key, status, created_at, updated_at FROM devices WHERE uid = ? ORDER BY updated_at DESC LIMIT 1",
        [userId],
      );

      // Jika tidak ada perangkat, kembalikan null
      if (devices.length === 0) {
        return null;
      }

      const device = devices[0];

      return {
        ...device,
        last_active: device.updated_at
          ? moment(device.updated_at).fromNow()
          : "Tidak tersedia",
      };
    } catch (error) {
      console.error("Error retrieving latest active device:", error);
      throw error.isBoom
        ? error
        : new Boom("Database error", { statusCode: 500 });
    } finally {
      connection.release();
    }
  }

  async getGroups(apiKey, deviceKey) {
    const connection = await this.pool.getConnection();
    try {
      // ✅ Validasi API key dan ambil UID
      const [users] = await connection.query(
        "SELECT uid FROM users WHERE api_key = ? LIMIT 1",
        [apiKey],
      );
      if (users.length === 0) {
        throw new Boom("Invalid API key", { statusCode: 401 });
      }
      const uid = users[0].uid;
      const [devices] = await connection.query(
        "SELECT id, name, phone, device_key, status, created_at, updated_at " +
          "FROM devices WHERE uid = ? AND device_key = ?",
        [uid, deviceKey],
      );

      const device = devices[0];

      // ✅ Query grup berdasarkan UID
      let query = `
        SELECT id, group_id, group_key, name, device_key, registered_at
        FROM \`groups\` 
        WHERE device_key = ?
      `;

      const queryParams = [deviceKey];
      const [groups] = await connection.query(query, queryParams);

      return groups;
    } catch (error) {
      console.error("Error retrieving groups:", error);
      throw error.isBoom
        ? error
        : new Boom("Database error", { statusCode: 500 });
    } finally {
      connection.release();
    }
  }
  async getSubDevices(apiKey, parentDeviceKey) {
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

      const [subDevices] = await connection.query(
        "SELECT id, name, phone, device_key, status, updated_at FROM devices WHERE uid = ? AND session_parent = ? AND status != 'deleted'",
        [uid, parentDeviceKey],
      );

      return subDevices.map((d) => ({
        ...d,
        last_active: calculateLastActive(d.updated_at),
      }));
    } catch (error) {
      console.error("Error retrieving sub-devices:", error);
      throw error.isBoom
        ? error
        : new Boom("Database error", { statusCode: 500 });
    } finally {
      connection.release();
    }
  }

  async getContacts(apiKey, page = 1, limit = 50) {
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
      const offset = (page - 1) * limit;

      const [contacts] = await connection.query(
        "SELECT c.*, d.name as device_name FROM contacts c LEFT JOIN devices d ON c.device_id = d.id WHERE c.uid = ? ORDER BY c.name ASC LIMIT ? OFFSET ?",
        [uid, limit, offset],
      );

      const [countRows] = await connection.query(
        "SELECT COUNT(*) as total FROM contacts WHERE uid = ?",
        [uid],
      );
      const total = countRows[0] ? countRows[0].total : 0;

      return {
        contacts,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      console.error("Error fetching contacts:", error);
      throw error.isBoom
        ? error
        : new Boom("Database error", { statusCode: 500 });
    } finally {
      connection.release();
    }
  }
}

module.exports = DeviceManager;
