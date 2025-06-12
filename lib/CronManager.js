const cron = require("node-cron");
const axios = require("axios");
const moment = require("moment-timezone");

class CronManager {
  constructor(pool, messageManager, sessionManager) {
    this.pool = pool;
    this.messageManager = messageManager;
    this.sessionManager = sessionManager;

    // Cron flags untuk menghindari tumpang tindih proses
    this.cronProcessingFlags = {
      group: false,
      personal: false,
      bulk: false,
    };
  }

  

  async initCrons() {
    console.log("✅ Cron Manager initialized.");

    // Cron utama: setiap 15 detik
    cron.schedule(
      "*/15 * * * * *",
      async () => {
        for (const type of ["group", "personal", "bulk"]) {
          if (this.cronProcessingFlags[type]) {
            console.log(`⚠️ [${type}] already processing, skipping.`);
            continue;
          }

          this.cronProcessingFlags[type] = true;
          try {
            await this.processMessagesByType(type);
          } catch (err) {
            console.error(`❌ Error in [${type}]:`, err.message);
          } finally {
            this.cronProcessingFlags[type] = false;
          }
        }
      },
      { timezone: "Asia/Jakarta" }
    );

    // Cron untuk mengurangi life_time device: setiap jam
    cron.schedule(
      "0 * * * *",
      async () => {
        console.log("🔁 Decrementing device life_time...");
        await this.decrementDeviceLifeTime();
      },
      { timezone: "Asia/Jakarta" }
    );

    // Cron untuk mengirim notifikasi deadline: setiap menit
    cron.schedule(
      "*/1 * * * *",
      async () => {
        console.log("🔔 Generating deadline warnings...");
        await this.generateDeadlineWarnings();
      },
      { timezone: "Asia/Jakarta" }
    );

    // Cron untuk hapus pesan lama: setiap jam
    cron.schedule(
      "0 * * * *",
      async () => {
        console.log("🧹 Cleaning up old messages...");
        await this.deleteOldMessages();
      },
      { timezone: "Asia/Jakarta" }
    );


    // Cron untuk hapus sesi device removed
    cron.schedule(
      "*/1 * * * *",
      async () => {
        this.removeRemovedDeviceSessions();
      },
      { timezone: "Asia/Jakarta" }
    );
  }

  

  async deleteOldMessages() {
    const now = moment().tz("Asia/Jakarta");
    const oneMonthAgo = now
      .clone()
      .subtract(1, "months")
      .format("YYYY-MM-DD HH:mm:ss");
    const twoMonthsAgo = now
      .clone()
      .subtract(2, "months")
      .format("YYYY-MM-DD HH:mm:ss");

    try {
      const [sent] = await this.pool.query(
        `DELETE FROM messages WHERE status = 'sent' AND created_at < ?`,
        [oneMonthAgo]
      );
      console.log(
        `🗑 Deleted ${sent.affectedRows} sent messages older than 1 month.`
      );

      const [others] = await this.pool.query(
        `DELETE FROM messages WHERE status IN ('pending', 'failed', 'processing') AND created_at < ?`,
        [twoMonthsAgo]
      );
      console.log(
        `🗑 Deleted ${others.affectedRows} messages with other statuses older than 2 months.`
      );
    } catch (err) {
      console.error("❌ Failed to delete old messages:", err.message);
    }
  }

  async fetchActiveSessions(limit, offset) {
    const sql = `
      SELECT u.uid, u.api_key, d.device_key, d.id AS device_id, d.name AS device_name, 
             d.phone AS device_phone, d.life_time
      FROM users u
      JOIN devices d ON u.uid = d.uid
      WHERE u.active = 1 AND d.status = 'connected'
      LIMIT ? OFFSET ?`;

    const [rows] = await this.pool.query(sql, [limit, offset]);

    return rows.map((row) => ({
      uid: row.uid,
      apiKey: row.api_key,
      deviceKey: row.device_key,
      deviceId: row.device_id,
      deviceName: row.device_name,
      devicePhone: row.device_phone,
      deviceLifeTime: row.life_time,
    }));
  }

  async processMessagesByType(type) {
    const limit = 10;
    let offset = 0;

    while (true) {
      const sessions = await this.fetchActiveSessions(limit, offset);
      if (sessions.length === 0) break;

      for (const session of sessions) {
        await this.processMessages(session, type);
        await this.delay(5000); // Delay antar sesi
      }

      offset += limit;
    }
  }

  async processMessages(session, type) {
    if (!session || !type) return;

    const { uid, apiKey, deviceKey, deviceId } = session;
    const limit = 50;
    const now = moment().tz("Asia/Jakarta");
    const today = now.format("YYYY-MM-DD");
    const currentTime = now.format("YYYY-MM-DD HH:mm:ss");

    // Lock pesan
    await this.pool.query(
      `
      UPDATE messages 
      SET status = 'processing', updated_at = ? 
      WHERE status = 'pending' AND type = ? AND uid = ? 
        AND device_id = ? AND DATE(created_at) = ? 
      ORDER BY created_at ASC LIMIT ?`,
      [currentTime, type, uid, deviceId, today, limit]
    );

    // Ambil pesan yang dikunci
    const [messages] = await this.pool.query(
      `
      SELECT * FROM messages 
      WHERE status = 'processing' AND type = ? AND uid = ? 
        AND device_id = ? AND DATE(created_at) = ? 
      ORDER BY created_at ASC`,
      [type, uid, deviceId, today]
    );

    for (const msg of messages) {
      let { id, number, message, type: msgType } = msg;

      if (!number || !message) {
        console.warn(`⚠️ Skipping message ID ${id}: number or message missing`);
        continue;
      }

      // Validasi group
      if (msgType === "group" && !number.includes("@g.us")) {
        const [group] = await this.pool.query(
          "SELECT group_id FROM `groups` WHERE group_key = ? LIMIT 1",
          [number]
        );
        if (!group.length || !group[0].group_id) {
          console.warn(
            `⚠️ Group not found for message ID ${id}, key: ${number}`
          );
          await this.pool.query(
            "UPDATE messages SET status = ?, updated_at = ? WHERE id = ?",
            ["failed", currentTime, id]
          );
          continue;
        }
        number = group[0].group_id;
      }

      try {
        await this.delay(3000 + Math.floor(Math.random() * 5000)); // Delay random
        const response = await this.messageManager.sendMessage(
          apiKey,
          deviceKey,
          number,
          message,
          msgType === "group" ? 1 : 0
        );

        const status =
          response?.status && response?.data?.results?.every((r) => r.status)
            ? "sent"
            : "failed";
        await this.pool.query(
          `
          UPDATE messages SET status = ?, response = ?, updated_at = ? WHERE id = ?`,
          [status, JSON.stringify(response), currentTime, id]
        );
      } catch (err) {
        console.error(`❌ Failed to send message ID ${id}:`, err.message);
        await this.pool.query(
          "UPDATE messages SET status = ?, updated_at = ? WHERE id = ?",
          ["failed", currentTime, id]
        );
      }
    }
  }

  async delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async decrementDeviceLifeTime() {
    try {
      const today = moment().tz("Asia/Jakarta").format("YYYY-MM-DD");
      const now = moment().tz("Asia/Jakarta").format("YYYY-MM-DD HH:mm:ss");

      const sql = `
      UPDATE devices 
      SET 
        life_time = life_time - 1,
        status = CASE 
          WHEN life_time - 1 <= 0 THEN 'removed'
          ELSE status 
        END,
        last_life_decrement = ?, 
        updated_at = ?
      WHERE 
        status = 'connected'
        AND life_time > 0
        AND (
          last_life_decrement IS NULL 
          OR last_life_decrement < ?
        )
    `;

      const [result] = await this.pool.query(sql, [today, now, today]);

      console.log(
        `[${now}] Updated life_time for ${result.affectedRows} connected device(s).`
      );
    } catch (error) {
      console.error("Error updating device life_time:", error.message);
    }
  }

  async generateDeadlineWarnings() {
    const limitSessions = 10;
    let offset = 0;

    const sessions = await this.fetchActiveSessions(limitSessions, offset);

    for (const session of sessions) {
      const {
        deviceLifeTime: diffInDays,
        apiKey,
        deviceKey,
        devicePhone,
        deviceId,
      } = session;
      let message = "";

      switch (diffInDays) {
        case 3:
          message = `📢 Pemberitahuan: Masa aktif perangkat *${deviceKey}* pada layanan WhatsApp Gateway W@Pi akan berakhir dalam 3 hari.\n\nSegera lakukan top-up untuk memastikan layanan tetap berjalan tanpa gangguan.`;
          break;
        case 2:
          message = `⚠️ Peringatan: Masa aktif perangkat *${deviceKey}* akan berakhir dalam 2 hari.\n\nSilakan perpanjang masa layanan Anda sesegera mungkin untuk menghindari penghentian akses.`;
          break;
        case 1:
          message = `⏰ Peringatan Penting: Besok adalah hari terakhir masa aktif perangkat *${deviceKey}* pada layanan WhatsApp Gateway W@Pi.\n\nLakukan top-up sekarang untuk mencegah terputusnya layanan.`;
          break;
        case 0:
          message = `🚨 Hari Terakhir: Masa aktif perangkat *${deviceKey}* berakhir hari ini.\n\nSegera lakukan perpanjangan agar layanan Anda tidak terhenti.`;
          break;
      }

      if (message) {
        try {
          const hasSentToday = await this.hasSentWarningToday(deviceId);
          if (!hasSentToday) {
            message += `\n\n🔗 Perpanjang layanan Anda: https://wapi.jasaedukasi.com/#pricing`;

            const messageData = {
              isGroup: 0,
              to: devicePhone,
              text: message,
              tags: "Life Time",
            };

            await this.messageManager.registerMessage(
              apiKey,
              deviceKey,
              messageData
            );
            console.log(
              `Peringatan berhasil dikirim untuk perangkat "${deviceKey}".`
            );
          }
        } catch (error) {
          console.error(
            `Gagal mengirim peringatan untuk perangkat "${deviceKey}":`,
            error
          );
        }
      }
    }
  }

  async hasSentWarningToday(deviceId) {
    const sql = `SELECT COUNT(*) AS count FROM messages WHERE device_id = ? AND tags = 'Life Time' AND DATE(created_at) = CURDATE()`;
    const [rows] = await this.pool.query(sql, [deviceId]);
    return rows[0].count > 0;
  }

  async removeRemovedDeviceSessions() {
    try {
      const now = moment().tz("Asia/Jakarta").format("YYYY-MM-DD HH:mm:ss");

      // Ambil semua device_key dengan status 'removed'
      const sql = `
      SELECT device_key 
      FROM devices 
      WHERE status = 'removed'
    `;
      const [rows] = await this.pool.query(sql);

      let removedCount = 0;

      for (const row of rows) {
        const deviceKey = row.device_key;

        // Hapus session-nya dari session manager
        const removed = await this.sessionManager.removeSession(
          deviceKey,
          true
        );
        if (removed) {
          console.log(`[${now}] Session removed for device: ${deviceKey}`);
          removedCount++;
        }
      }

      console.log(
        `[${now}] Total removed sessions for devices with status 'removed': ${removedCount}`
      );
    } catch (error) {
      console.error(
        "Error removing sessions for removed devices:",
        error.message
      );
    }
  }


}

module.exports = CronManager;
