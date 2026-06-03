const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../../lib/Utils.js");

module.exports = ({ pool } = {}) => {
  router.get("/", authMiddleware, async (req, res) => {
    try {
      const status = req.query.status || "";
      const keyword = req.query.keyword || "";
      const params = [];
      const where = ["1=1"];

      if (status) {
        if (status === "failed") {
          where.push("wl.status != 'success'");
        } else {
          where.push("wl.status = ?");
          params.push(status);
        }
      }

      if (keyword) {
        where.push("(wl.webhook_url LIKE ? OR wl.event LIKE ? OR wl.error_message LIKE ? OR u.name LIKE ? OR d.name LIKE ?)");
        const term = `%${keyword}%`;
        params.push(term, term, term, term, term);
      }

      const [logs] = await pool.query(
        `SELECT
            wl.id, wl.uid, wl.webhook_url, wl.event, wl.status, wl.http_status,
            wl.error_message, wl.created_at,
            u.name AS user_name, u.email AS user_email,
            d.name AS device_name
         FROM webhook_logs wl
         LEFT JOIN users u ON wl.uid = u.uid
         LEFT JOIN devices d ON wl.device_id = d.id
         WHERE ${where.join(" AND ")}
         ORDER BY wl.created_at DESC
         LIMIT 300`,
        params
      );

      const [summaryRows] = await pool.query(
        "SELECT status, COUNT(*) AS cnt FROM webhook_logs GROUP BY status ORDER BY status"
      );

      res.render("admin/webhook-logs", {
        title: "Webhook Logs - w@pi",
        layout: "layouts/admin",
        logs,
        summaryRows,
        filters: { status, keyword },
      });
    } catch (error) {
      console.error("Admin webhook logs error:", error);
      res.status(500).send("Internal Server Error");
    }
  });

  return router;
};
