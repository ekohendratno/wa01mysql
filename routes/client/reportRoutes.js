const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../../lib/Utils.js");

module.exports = ({ pool }) => {
  router.get("/", authMiddleware, async (req, res) => {
    try {
      const uid = req.session.user.uid;
      const [daily] = await pool.query(
        `
          SELECT
            DATE(COALESCE(updated_at, created_at)) AS date,
            SUM(status = 'sent') AS sent,
            SUM(status = 'pending') AS pending,
            SUM(status = 'processing') AS processing,
            SUM(status = 'failed') AS failed
          FROM messages
          WHERE uid = ?
            AND COALESCE(updated_at, created_at) >= DATE_SUB(NOW(), INTERVAL 30 DAY)
          GROUP BY DATE(COALESCE(updated_at, created_at))
          ORDER BY date ASC
        `,
        [uid],
      );

      const [devices] = await pool.query(
        `
          SELECT
            d.name, d.device_key,
            COUNT(m.id) AS total,
            SUM(m.status = 'sent') AS sent,
            SUM(m.status = 'failed') AS failed
          FROM devices d
          LEFT JOIN messages m ON m.device_id = d.id AND m.uid = d.uid
          WHERE d.uid = ? AND d.status != 'deleted'
          GROUP BY d.id
          ORDER BY total DESC
        `,
        [uid],
      );

      const [campaigns] = await pool.query(
        `
          SELECT
            c.id, c.name, c.recipients_count, c.scheduled_at, c.created_at,
            COALESCE(SUM(m.status = 'sent'), 0) AS sent,
            COALESCE(SUM(m.status = 'failed'), 0) AS failed,
            COALESCE(SUM(m.status = 'pending'), 0) AS pending
          FROM campaigns c
          LEFT JOIN messages m ON m.campaign_id = c.id
          WHERE c.uid = ?
          GROUP BY c.id
          ORDER BY c.created_at DESC
          LIMIT 20
        `,
        [uid],
      );

      res.render("client/reports", {
        title: "Reports - w@pi",
        layout: "layouts/client",
        daily,
        devices,
        campaigns,
      });
    } catch (error) {
      console.error("Reports view error:", error);
      res.status(500).send("Internal Server Error");
    }
  });

  return router;
};
