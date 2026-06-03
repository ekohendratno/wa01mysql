const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../../lib/Utils.js");

module.exports = ({ pool } = {}) => {
  router.get("/", authMiddleware, async (req, res) => {
    try {
      const status = req.query.status || "";
      const user = req.query.user || "";
      const params = [];
      const where = ["d.status != 'deleted'"];

      if (status) {
        where.push("d.status = ?");
        params.push(status);
      }

      if (user) {
        where.push("(u.name LIKE ? OR u.email LIKE ? OR d.name LIKE ? OR d.phone LIKE ?)");
        const keyword = `%${user}%`;
        params.push(keyword, keyword, keyword, keyword);
      }

      const [devices] = await pool.query(
        `SELECT
            d.id, d.uid, d.name, d.phone, d.status, d.device_key, d.limit_daily,
            d.life_time, d.\`limit\`, d.packageId, d.session_parent, d.webhook_url, d.created_at, d.updated_at,
            u.name AS user_name, u.email AS user_email,
            p.name AS package_name, p.price AS package_price,
            COALESCE(ms.total_messages, 0) AS total_messages,
            COALESCE(ms.sent_messages, 0) AS sent_messages,
            COALESCE(ms.failed_messages, 0) AS failed_messages,
            COALESCE(ms.pending_messages, 0) AS pending_messages
         FROM devices d
         LEFT JOIN users u ON d.uid = u.uid
         LEFT JOIN packages p ON p.id = d.packageId
         LEFT JOIN (
            SELECT
              device_id,
              COUNT(*) AS total_messages,
              SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent_messages,
              SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_messages,
              SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_messages
            FROM messages
            GROUP BY device_id
         ) ms ON ms.device_id = d.id
         WHERE ${where.join(" AND ")}
         ORDER BY d.updated_at DESC
         LIMIT 300`,
        params
      );

      const [summaryRows] = await pool.query(
        `SELECT status, COUNT(*) AS cnt
         FROM devices
         WHERE status != 'deleted'
         GROUP BY status`
      );

      const [packages] = await pool.query(
        `SELECT id, name, price, life_time, limit_daily, active
         FROM packages
         ORDER BY active DESC, price ASC, name ASC`
      );

      res.render("admin/devices", {
        title: "Devices - w@pi",
        layout: "layouts/admin",
        devices,
        summaryRows,
        packages,
        filters: { status, user },
      });
    } catch (error) {
      console.error("Admin devices error:", error);
      res.status(500).send("Internal Server Error");
    }
  });

  router.post("/update", authMiddleware, async (req, res) => {
    try {
      const {
        id,
        name,
        phone,
        status,
        life_time,
        limit_daily,
        packageId,
        webhook_url,
        applyPackageDefaults,
      } = req.body;

      if (!id) {
        return res.status(400).json({ status: false, message: "Device ID wajib diisi." });
      }

      const [devices] = await pool.query(
        "SELECT id FROM devices WHERE id = ? AND status != 'deleted' LIMIT 1",
        [id]
      );
      if (!devices.length) {
        return res.status(404).json({ status: false, message: "Device tidak ditemukan." });
      }

      const allowedStatuses = ["connected", "disconnected", "connecting", "error", "removed"];
      const cleanStatus = allowedStatuses.includes(status) ? status : "connecting";
      let nextLifeTime = Math.max(0, parseInt(life_time || "0", 10) || 0);
      let nextLimitDaily = Math.max(0, parseInt(limit_daily || "0", 10) || 0);
      let nextPackageId = packageId || null;

      if (nextPackageId) {
        const [pkgRows] = await pool.query(
          "SELECT id, life_time, limit_daily FROM packages WHERE id = ? LIMIT 1",
          [nextPackageId]
        );
        if (!pkgRows.length) {
          return res.status(400).json({ status: false, message: "Paket tidak ditemukan." });
        }
        if (applyPackageDefaults) {
          nextLifeTime = Number(pkgRows[0].life_time || nextLifeTime);
          nextLimitDaily = Number(pkgRows[0].limit_daily || nextLimitDaily);
        }
      }

      await pool.query(
        `UPDATE devices
         SET name = ?,
             phone = ?,
             status = ?,
             life_time = ?,
             limit_daily = ?,
             packageId = ?,
             webhook_url = ?,
             updated_at = NOW()
         WHERE id = ?`,
        [
          String(name || "").trim() || null,
          String(phone || "").trim() || null,
          cleanStatus,
          nextLifeTime,
          nextLimitDaily,
          nextPackageId,
          String(webhook_url || "").trim() || null,
          id,
        ]
      );

      res.json({
        status: true,
        message: "Device berhasil diperbarui tanpa memotong billing.",
      });
    } catch (error) {
      console.error("Admin update device error:", error);
      res.status(500).json({ status: false, message: error.message || "Gagal update device." });
    }
  });

  return router;
};
