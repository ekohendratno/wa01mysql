const cronschedule = require("node-cron");
const axios = require("axios");
const moment = require("moment-timezone");

class CronManager {
  constructor(pool, messageManager) {
    this.pool = pool;
    this.isProcessing = false;
    this.messageManager = messageManager;

    this.cronProcessingFlags = {
      group: false,
      personal: false,
      bulk: false,
    };
  }

  async initCrons() {
    console.log("Initializing cron jobs...");

    cronschedule.schedule(
      "*/15 * * * * *",
      async () => {
        const types = ["group", "personal", "bulk"];
        for (const type of types) {
          if (this.cronProcessingFlags[type]) {
            console.log(`[${type}] still processing, skipped.`);
            continue;
          }

          this.cronProcessingFlags[type] = true;

          try {
            await this.processMessagesByType(type);
          } catch (err) {
            console.error(`Error processing type "${type}":`, err.message);
          }

          this.cronProcessingFlags[type] = false;
        }
      },
      {
        timezone: "Asia/Jakarta",
      }
    );

    cronschedule.schedule(
      "0 * * * *",
      async () => {
        console.log("Running device life_time decrement cronschedule...");
        await this.decrementDeviceLifeTime();
      },
      {
        timezone: "Asia/Jakarta",
      }
    );

    cronschedule.schedule(
      "*/1 * * * *",
      async () => {
        console.log(
          "Running generate notif send life_time decrement cronschedule..."
        );
        await this.generateDeadlineWarnings();
      },
      {
        timezone: "Asia/Jakarta",
      }
    );

    cronschedule.schedule(
      "0 * * * *",
      async () => {
        console.log("Running message cleanup cronschedule...");
        await this.deleteOldMessages();
      },
      {
        timezone: "Asia/Jakarta",
      }
    );
  }

  async deleteOldMessages() {
    const now = moment().tz("Asia/Jakarta");
    const deleteSentTime = now
      .subtract(1, "months")
      .format("YYYY-MM-DD HH:mm:ss"); // 1 bulan
    const deleteOtherTime = now
      .subtract(2, "months")
      .format("YYYY-MM-DD HH:mm:ss"); // 2 bulan

    try {
      const deleteSentSql = `DELETE FROM messages WHERE status = 'sent' AND created_at < ?`;
      const [sentResult] = await this.pool.query(deleteSentSql, [
        deleteSentTime,
      ]);
      console.log(
        `Deleted ${sentResult.affectedRows} messages with status 'sent' older than 1 month.`
      );

      const deleteOtherSql = `DELETE FROM messages WHERE status IN ('pending', 'failed', 'processing') AND created_at < ?`;
      const [otherResult] = await this.pool.query(deleteOtherSql, [
        deleteOtherTime,
      ]);
      console.log(
        `Deleted ${otherResult.affectedRows} messages with status 'pending', 'failed', or 'processing' older than 2 months.`
      );
    } catch (error) {
      console.error("Error deleting old messages:", error.message);
    }
  }

  async fetchActiveSessions(limit, offset) {
    const sql = `
            SELECT u.uid, u.api_key, d.device_key, d.id AS device_id, d.name AS device_name, d.phone AS device_phone, d.life_time AS life_time 
            FROM users u
            JOIN devices d ON u.uid = d.uid
            WHERE u.active = 1 AND d.status='connected'
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
    const todayDate = moment().tz("Asia/Jakarta").format("YYYY-MM-DD");
    const currentTime = moment()
      .tz("Asia/Jakarta")
      .format("YYYY-MM-DD HH:mm:ss");

    try {
      // Lock messages untuk diproses
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

      await this.pool.query(lockSql, [
        currentTime,
        type,
        uid,
        deviceId,
        todayDate,
        limit,
      ]);

      // Ambil pesan yang sudah dikunci
      const selectSql = `
      SELECT * FROM messages 
      WHERE status = 'processing' 
        AND type = ? 
        AND uid = ? 
        AND device_id = ? 
        AND DATE(created_at) = ? 
      ORDER BY created_at ASC`;

      const [rows] = await this.pool.query(selectSql, [
        type,
        uid,
        deviceId,
        todayDate,
      ]);

      if (rows.length === 0) return;

      for (const row of rows) {
        let { id, number, message, type: msgType } = row;

        // Lewati jika tidak lengkap
        if (!number || !message) {
          console.warn(
            `Skipping message ID ${id} due to missing number or message`
          );
          continue;
        }

        try {
          // Jika type group, pastikan group_id valid
          if (msgType === "group") {
            // Lewati jika sudah merupakan format WhatsApp group ID
            const isGroupId = number.includes("@g.us");

            if (!isGroupId) {
              const [groupRows] = await this.pool.query(
                "SELECT group_id FROM groups WHERE group_key = ? LIMIT 1",
                [number]
              );

              if (groupRows.length === 0 || !groupRows[0].group_id) {
                console.warn(
                  `Group not found for message ID ${id} with key ${number}`
                );
                await this.pool.query(
                  "UPDATE messages SET status = ?, updated_at = ? WHERE id = ?",
                  ["failed", currentTime, id]
                );
                continue;
              }

              number = groupRows[0].group_id;
            }
          }

          // Random delay
          const jitter = Math.floor(Math.random() * 5000);
          await new Promise((resolve) => setTimeout(resolve, 3000 + jitter));

          // Kirim pesan
          const response = await this.messageManager.sendMessage(
            apiKey,
            deviceKey,
            number,
            message,
            msgType === "group" ? 1 : 0
          );

          // Evaluasi hasil pengiriman
          let status = "failed";
          if (response?.status) {
            const allSent = response.data?.results?.every(
              (r) => r.status === true
            );
            status = allSent ? "sent" : "failed";
          }

          // Update status pesan
          const updateSql = `
          UPDATE messages 
          SET status = ?, response = ?, updated_at = ? 
          WHERE id = ?`;

          await this.pool.query(updateSql, [
            status,
            JSON.stringify(response),
            currentTime,
            id,
          ]);
        } catch (err) {
          console.error(`Error sending message ID ${id}:`, err.message);
          await this.pool.query(
            "UPDATE messages SET status = ?, updated_at = ? WHERE id = ?",
            ["failed", currentTime, id]
          );
        }
      }
    } catch (err) {
      console.error(
        `Error processing messages for UID ${uid}, type ${type}:`,
        err.message
      );
    }
  }

  async decrementDeviceLifeTime() {
    try {
      const sql = `
            UPDATE devices 
            SET life_time = life_time - 1, 
                status = CASE 
                    WHEN life_time - 1 <= 0 THEN 'removed'
                    ELSE status 
                END,
                updated_at = ?
            WHERE status != 'removed' AND life_time > 0
        `;
      const now = moment().tz("Asia/Jakarta").format("YYYY-MM-DD HH:mm:ss");
      const [result] = await this.pool.query(sql, [now]);

      console.log(
        `[${now}] Updated life_time for ${result.affectedRows} device(s).`
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

            message+=`\n\n🔗 Perpanjang layanan Anda: https://wapi.jasaedukasi.com/#pricing`;


            const messageData = {
              isGroup: 0,
              to: devicePhone,
              text: message,
              role: "Life Time",
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
    const sql = `SELECT COUNT(*) AS count FROM messages WHERE device_id = ? AND role = 'Life Time' AND DATE(created_at) = CURDATE()`;
    const [rows] = await this.pool.query(sql, [deviceId]);
    return rows[0].count > 0;
  }
}

module.exports = CronManager;
