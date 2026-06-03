const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../../lib/Utils.js");

module.exports = ({ pool } = {}) => {
  router.get("/", authMiddleware, async (req, res) => {
    try {
      const status = req.query.status || "";
      const type = req.query.type || "";
      const keyword = req.query.keyword || "";
      const params = [];
      const where = ["1=1"];

      if (status) {
        where.push("m.status = ?");
        params.push(status);
      }

      if (type) {
        where.push("m.type = ?");
        params.push(type);
      }

      if (keyword) {
        where.push("(m.number LIKE ? OR m.message LIKE ? OR u.name LIKE ? OR d.name LIKE ?)");
        const term = `%${keyword}%`;
        params.push(term, term, term, term);
      }

      const [messages] = await pool.query(
        `SELECT
            m.id, m.uid, m.number, m.message, m.type, m.status, m.response,
            m.scheduled_at, m.created_at, m.updated_at, m.campaign_id,
            u.name AS user_name, u.email AS user_email,
            d.name AS device_name, d.device_key,
            c.name AS campaign_name
         FROM messages m
         LEFT JOIN users u ON m.uid = u.uid
         LEFT JOIN devices d ON m.device_id = d.id
         LEFT JOIN campaigns c ON m.campaign_id = c.id
         WHERE ${where.join(" AND ")}
         ORDER BY COALESCE(m.scheduled_at, m.created_at) DESC
         LIMIT 300`,
        params
      );

      const [summaryRows] = await pool.query(
        "SELECT status, COUNT(*) AS cnt FROM messages GROUP BY status ORDER BY status"
      );

      res.render("admin/messages", {
        title: "Messages - w@pi",
        layout: "layouts/admin",
        messages,
        summaryRows,
        filters: { status, type, keyword },
      });
    } catch (error) {
      console.error("Admin messages error:", error);
      res.status(500).send("Internal Server Error");
    }
  });

  router.post("/retry/:id", authMiddleware, async (req, res) => {
    try {
      await pool.query(
        "UPDATE messages SET status = 'pending', response = NULL, updated_at = NULL WHERE id = ? AND status = 'failed'",
        [req.params.id]
      );
      res.json({ status: true });
    } catch (error) {
      console.error("Retry message error:", error);
      res.status(500).json({ status: false, message: error.message });
    }
  });

  return router;
};
