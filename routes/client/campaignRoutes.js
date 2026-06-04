const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../../lib/Utils.js");

function parseRecipients(input) {
  return [
    ...new Set(
      String(input || "")
        .split(/[\n,;]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function normalizePhone(value) {
  let phone = String(value || "").split("@")[0].replace(/\D/g, "");
  if (phone.startsWith("08")) phone = `628${phone.slice(2)}`;
  else if (phone.startsWith("0")) phone = `62${phone.slice(1)}`;
  return phone;
}

function isValidCampaignPhone(value) {
  return /^62\d{8,15}$/.test(String(value || ""));
}

module.exports = ({ pool, messageManager, deviceManager }) => {
  router.get("/", authMiddleware, async (req, res) => {
    try {
      const uid = req.session.user.uid;
      const apiKey = req.session.user.api_key;
      const devices = await deviceManager.getDevices(apiKey);
      const [templates] = await pool.query(
        "SELECT id, name, content FROM message_templates WHERE uid = ? ORDER BY name ASC",
        [uid],
      );
      const [campaigns] = await pool.query(
        `
          SELECT
            c.*,
            COALESCE(SUM(m.status = 'sent'), 0) AS sent_count,
            COALESCE(SUM(m.status = 'pending'), 0) AS pending_count,
            COALESCE(SUM(m.status = 'processing'), 0) AS processing_count,
            COALESCE(SUM(m.status = 'failed'), 0) AS failed_count
          FROM campaigns c
          LEFT JOIN messages m ON m.campaign_id = c.id
          WHERE c.uid = ?
          GROUP BY c.id
          ORDER BY c.created_at DESC
          LIMIT 50
        `,
        [uid],
      );

      res.render("client/campaign", {
        title: "Campaign - w@pi",
        layout: "layouts/client",
        apiKey,
        devices: devices || [],
        templates,
        campaigns,
      });
    } catch (error) {
      console.error("Campaign view error:", error);
      res.status(500).send("Internal Server Error");
    }
  });

  router.get("/optin-recipients", authMiddleware, async (req, res) => {
    try {
      const uid = req.session.user.uid;
      const statusMode = String(req.query.status || "approved_pending").trim();
      let statuses = ["approved", "pending"];
      if (statusMode === "approved") statuses = ["approved"];
      if (statusMode === "pending") statuses = ["pending"];

      const [rows] = await pool.query(
        `SELECT
            oi.number,
            oi.status,
            oi.updated_at,
            COALESCE(
              NULLIF(REPLACE(REPLACE(REPLACE(c_exact.phone, '+', ''), ' ', ''), '-', ''), ''),
              NULLIF(REPLACE(REPLACE(REPLACE(c_device.phone, '+', ''), ' ', ''), '-', ''), ''),
              NULLIF(REPLACE(REPLACE(REPLACE(c_uid.phone, '+', ''), ' ', ''), '-', ''), '')
            ) AS mapped_phone
         FROM opt_ins oi
         LEFT JOIN contacts c_exact
           ON c_exact.uid = oi.uid
          AND c_exact.device_id = oi.device_id
          AND c_exact.jid = oi.number
         LEFT JOIN contacts c_device
           ON c_device.uid = oi.uid
          AND c_device.device_id = oi.device_id
          AND SUBSTRING_INDEX(c_device.jid, '@', 1) = SUBSTRING_INDEX(oi.number, '@', 1)
         LEFT JOIN contacts c_uid
           ON c_uid.uid = oi.uid
          AND SUBSTRING_INDEX(c_uid.jid, '@', 1) = SUBSTRING_INDEX(oi.number, '@', 1)
         WHERE oi.uid = ?
           AND oi.status IN (${statuses.map(() => "?").join(",")})
           AND oi.number IS NOT NULL
           AND oi.number != ''
         ORDER BY FIELD(oi.status, 'approved', 'pending'), oi.updated_at DESC
         LIMIT 3000`,
        [uid, ...statuses],
      );

      const recipients = [];
      const seen = new Set();
      const counts = { approved: 0, pending: 0, skipped_lid: 0, skipped_invalid: 0, mapped_lid: 0 };
      for (const row of rows) {
        const directPhone = normalizePhone(row.number);
        const mappedPhone = normalizePhone(row.mapped_phone);
        const phone = isValidCampaignPhone(directPhone)
          ? directPhone
          : isValidCampaignPhone(mappedPhone)
            ? mappedPhone
            : "";

        if (!phone) {
          if (String(row.number || "").includes("@")) counts.skipped_lid += 1;
          else counts.skipped_invalid += 1;
          continue;
        }

        if (!isValidCampaignPhone(directPhone) && isValidCampaignPhone(mappedPhone)) {
          counts.mapped_lid += 1;
        }

        if (!seen.has(phone)) {
          seen.add(phone);
          recipients.push(phone);
          counts[row.status] = (counts[row.status] || 0) + 1;
        }
        if (recipients.length >= 1000) break;
      }

      res.json({
        status: true,
        recipients,
        counts,
      });
    } catch (error) {
      console.error("Campaign opt-in recipients error:", error);
      res.status(500).json({ status: false, message: "Gagal mengambil daftar opt-in." });
    }
  });

  router.post("/create", authMiddleware, async (req, res) => {
    const uid = req.session.user.uid;
    const apiKey = req.session.user.api_key;
    const name = String(req.body.name || "").trim();
    const deviceKey = String(req.body.deviceKey || "").trim();
    const message = String(req.body.message || "").trim();
    const scheduledAt = req.body.scheduledAt || null;
    const recipients = parseRecipients(req.body.recipients);

    if (!name || !deviceKey || !message || recipients.length === 0) {
      return res.status(400).json({
        status: false,
        message: "Nama, perangkat, penerima, dan pesan wajib diisi.",
      });
    }

    if (recipients.length > 1000) {
      return res.status(400).json({
        status: false,
        message: "Maksimal 1000 penerima per campaign.",
      });
    }

    try {
      const [devices] = await pool.query(
        `SELECT d.id
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
        [uid, uid, deviceKey],
      );
      if (devices.length === 0) {
        return res
          .status(404)
          .json({ status: false, message: "Device tidak ditemukan atau belum dibagikan ke akun ini." });
      }

      const [campaignResult] = await pool.query(
        `
          INSERT INTO campaigns
            (uid, device_id, device_key, name, message, recipients_count, scheduled_at, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          uid,
          devices[0].id,
          deviceKey,
          name,
          message,
          recipients.length,
          scheduledAt || null,
          scheduledAt ? "scheduled" : "queued",
        ],
      );

      const campaignId = campaignResult.insertId;
      let registered = 0;
      for (const recipient of recipients) {
        const result = await messageManager.registerMessage(apiKey, deviceKey, {
          isGroup: 0,
          to: recipient,
          text: message,
          tags: `campaign:${campaignId}`,
          campaignId,
          scheduledAt,
        });
        if (result.status) registered++;
      }

      res.json({
        status: true,
        message: `${registered} pesan berhasil masuk antrean campaign.`,
        campaignId,
      });
    } catch (error) {
      console.error("Campaign create error:", error);
      res.status(500).json({ status: false, message: "Internal Server Error" });
    }
  });

  return router;
};
