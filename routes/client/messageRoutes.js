const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../../lib/Utils.js");

module.exports = ({ sessionManager, messageManager, deviceManager }) => {
  router.get("/", authMiddleware, async (req, res) => {
    try {
      const apiKey = req.session.user.api_key;
      const uid = req.session.user.uid;
      const devices = await deviceManager.getDevices(apiKey, {
        status: "connected",
      });
      const [[userOptIn]] = await messageManager.pool.query(
        "SELECT opt_in_required FROM users WHERE uid = ? LIMIT 1",
        [uid],
      );

      res.render("client/message", {
        apiKey,
        devices: devices || [],
        showOptInColumn: Number(userOptIn?.opt_in_required || 0) === 1,
        title: "Messages - w@pi",
        layout: "layouts/client",
      });
    } catch (error) {
      console.error("Error:", error);
      res.status(500).send("Internal Server Error");
    }
  });

  router.get("/data", authMiddleware, async (req, res) => {
    const { status = "all", page, limit } = req.query;
    const p = parseInt(page) || 1;
    const l = parseInt(limit) || 30;

    try {
      const apiKey = req.session.user.api_key;
      const messages = await messageManager.getMessages(apiKey, status, p, l);

      res.json({
        success: true,
        messages: messages.messages || [],
        counts: messages.counts || [],
        pagination: messages.pagination,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: "Terjadi kesalahan" });
    }
  });

  router.get("/insights", authMiddleware, async (req, res) => {
    try {
      const apiKey = req.session.user.api_key;
      const insights = await messageManager.getMessageInsights(apiKey);
      res.json({ success: true, insights });
    } catch (error) {
      console.error("Message insights error:", error);
      res.status(500).json({ success: false, message: "Terjadi kesalahan" });
    }
  });

  router.delete("/remove", authMiddleware, async (req, res) => {
    try {
      const { apiKey, id } = req.query;
      const result = await messageManager.removeMessage(apiKey, id);
      res.json({ status: true, message: "Message deleted successfully" });
    } catch (error) {
      console.error("Delete message error:", error);
      const statusCode = error.output?.statusCode || 500;
      res.status(statusCode).json({
        status: false,
        message: error.message,
      });
    }
  });

  router.post("/retry", authMiddleware, async (req, res) => {
    try {
      const apiKey = req.session.user.api_key;
      const id = req.body.id || req.query.id;
      const deviceKey = req.body.deviceKey || req.query.deviceKey || null;
      const result = await messageManager.retryMessage(apiKey, id, deviceKey);
      res.json({ status: true, message: "Message retry successfully" });
    } catch (error) {
      console.error("Retry message error:", error);
      const statusCode = error.output?.statusCode || 500;
      res.status(statusCode).json({
        status: false,
        message: error.message,
      });
    }
  });

  return router;
};
