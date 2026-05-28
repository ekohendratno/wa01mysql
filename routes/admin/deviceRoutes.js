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
            d.life_time, d.webhook_url, d.created_at, d.updated_at,
            u.name AS user_name, u.email AS user_email,
            COALESCE(ms.total_messages, 0) AS total_messages,
            COALESCE(ms.sent_messages, 0) AS sent_messages,
            COALESCE(ms.failed_messages, 0) AS failed_messages,
            COALESCE(ms.pending_messages, 0) AS pending_messages
         FROM devices d
         LEFT JOIN users u ON d.uid = u.uid
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

      res.render("admin/devices", {
        title: "Devices - w@pi",
        layout: "layouts/admin",
        devices,
        summaryRows,
        filters: { status, user },
      });
    } catch (error) {
      console.error("Admin devices error:", error);
      res.status(500).send("Internal Server Error");
    }
  });

  return router;
};
