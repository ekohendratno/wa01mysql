const moment = require("moment-timezone");
const { Boom } = require("@hapi/boom");
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

      // VALIDASI: Cek apakah nomor sudah digunakan
      if (phone) {
        const [existingDevice] = await connection.query(
          "SELECT id FROM devices WHERE phone = ? AND status != 'deleted' LIMIT 1",
          [phone],
        );
        if (existingDevice.length > 0) {
          throw new CustomError(
            "Nomor telepon ini sudah digunakan oleh perangkat lain.",
            400,
          );
        }
      }

      const [packages] = await connection.query(
        "SELECT id, name, price FROM packages WHERE id = ?",
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

      let lifeTime = 30; // Default masa aktif 30 hari
      let limitDaily = 250; // Default limit harian
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
      await connection.query(
        "INSERT INTO devices (uid, name, phone, device_key, session_parent, packageId, life_time, limit_daily, `limit`, last_life_decrement, last_limit_decrement) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          userId,
          deviceName,
          phone,
          deviceKey,
          sessionParent,
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

  async getDevices(apiKey) {
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

      // Ambil daftar devices milik user
      // Gunakan pagination default untuk menghindari placeholder yang tidak terisi
      const DEFAULT_LIMIT = 100;
      const DEFAULT_OFFSET = 0;
      const limit = DEFAULT_LIMIT;
      const offset = DEFAULT_OFFSET;

      const query = `
  SELECT id, name, phone, device_key, session_parent, life_time, \`limit\`, limit_daily, status, created_at, updated_at 
  FROM devices 
  WHERE uid = ? AND status != 'deleted'
  LIMIT ? OFFSET ?`;
      const [devices] = await connection.query(query, [uid, limit, offset]);

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
        `SELECT d.id, d.name, d.phone, d.device_key, d.session_parent, d.packageId, p.name as package_name, p.description as package_description, d.life_time, d.limit, d.limit_daily, d.status, d.created_at, d.updated_at
       FROM devices d
       LEFT JOIN packages p ON d.packageId = p.id
       WHERE d.uid = ? AND d.device_key = ? 
       LIMIT 1`,
        [uid, deviceKey],
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
