const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../../lib/Utils.js");

module.exports = ({ pool }) => {
  router.get("/", authMiddleware, async (req, res) => {
    try {
      const uid = req.session.user.uid;
      const [counts] = await pool.query(
        `
          SELECT status, COUNT(*) AS total
          FROM messages
          WHERE uid = ? AND status IN ('pending', 'processing', 'failed')
          GROUP BY status
        `,
        [uid],
      );

      const stats = { pending: 0, processing: 0, failed: 0 };
      counts.forEach((row) => {
        stats[row.status] = row.total;
      });

      res.render("client/queue", {
        title: "Queue Pesan - w@pi",
        layout: "layouts/client",
        stats,
      });
    } catch (error) {
      console.error("Queue view error:", error);
      res.status(500).send("Internal Server Error");
    }
  });

  router.get("/data", authMiddleware, async (req, res) => {
    try {
      const uid = req.session.user.uid;
      const status = String(req.query.status || "failed");
      const allowedStatuses = ["pending", "processing", "failed", "all"];
      if (!allowedStatuses.includes(status)) {
        return res
          .status(400)
          .json({ status: false, message: "Filter status tidak valid." });
      }

      const params = [uid];
      let where = "m.uid = ? AND m.status IN ('pending','processing','failed')";
      if (status !== "all") {
        where += " AND m.status = ?";
        params.push(status);
      }

      const [messages] = await pool.query(
        `
          SELECT
            m.id, m.number, m.message, m.type, m.tags, m.status, m.response,
            m.scheduled_at, m.created_at, m.updated_at,
            d.device_key, d.name AS device_name,
            c.name AS campaign_name
          FROM messages m
          LEFT JOIN devices d ON d.id = m.device_id
          LEFT JOIN campaigns c ON c.id = m.campaign_id
          WHERE ${where}
          ORDER BY COALESCE(m.scheduled_at, m.created_at) ASC
          LIMIT 200
        `,
        params,
      );

      res.json({ status: true, messages });
    } catch (error) {
      console.error("Queue data error:", error);
      res.status(500).json({ status: false, message: "Internal Server Error" });
    }
  });

  router.post("/retry-failed", authMiddleware, async (req, res) => {
    try {
      const uid = req.session.user.uid;
      const [result] = await pool.query(
        "UPDATE messages SET status = 'pending', updated_at = NOW() WHERE uid = ? AND status = 'failed'",
        [uid],
      );
      res.json({
        status: true,
        message: `${result.affectedRows} pesan gagal dikembalikan ke antrean.`,
      });
    } catch (error) {
      console.error("Queue retry error:", error);
      res.status(500).json({ status: false, message: "Internal Server Error" });
    }
  });

  return router;
};
