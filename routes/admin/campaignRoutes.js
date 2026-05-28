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
        where.push("c.status = ?");
        params.push(status);
      }

      if (keyword) {
        where.push("(c.name LIKE ? OR u.name LIKE ? OR d.name LIKE ?)");
        const term = `%${keyword}%`;
        params.push(term, term, term);
      }

      const [campaigns] = await pool.query(
        `SELECT
            c.id, c.uid, c.name, c.message, c.recipients_count, c.scheduled_at,
            c.status, c.created_at, c.updated_at,
            u.name AS user_name, u.email AS user_email,
            d.name AS device_name,
            COALESCE(ms.queued_messages, 0) AS queued_messages,
            COALESCE(ms.sent_messages, 0) AS sent_messages,
            COALESCE(ms.failed_messages, 0) AS failed_messages,
            COALESCE(ms.pending_messages, 0) AS pending_messages
         FROM campaigns c
         LEFT JOIN users u ON c.uid = u.uid
         LEFT JOIN devices d ON c.device_id = d.id
         LEFT JOIN (
            SELECT
              campaign_id,
              COUNT(*) AS queued_messages,
              SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent_messages,
              SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_messages,
              SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_messages
            FROM messages
            WHERE campaign_id IS NOT NULL
            GROUP BY campaign_id
         ) ms ON ms.campaign_id = c.id
         WHERE ${where.join(" AND ")}
         ORDER BY c.created_at DESC
         LIMIT 300`,
        params
      );

      const [summaryRows] = await pool.query(
        "SELECT status, COUNT(*) AS cnt FROM campaigns GROUP BY status ORDER BY status"
      );

      res.render("admin/campaigns", {
        title: "Campaigns - w@pi",
        layout: "layouts/admin",
        campaigns,
        summaryRows,
        filters: { status, keyword },
      });
    } catch (error) {
      console.error("Admin campaigns error:", error);
      res.status(500).send("Internal Server Error");
    }
  });

  return router;
};
