const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../../lib/Utils.js");

module.exports = ({ telegramManager }) => {
  router.get("/", authMiddleware, async (req, res) => {
    try {
      const overview = await telegramManager.getOverview(req.session.user.uid);
      res.render("client/telegram", {
        title: "Telegram Integration - w@pi",
        layout: "layouts/client",
        ...overview,
      });
    } catch (error) {
      console.error("Telegram page error:", error);
      res.status(500).send("Internal Server Error");
    }
  });

  router.post("/bot", authMiddleware, async (req, res) => {
    try {
      const result = await telegramManager.saveBot(req.session.user.uid, req.body);
      let webhook = null;
      try {
        webhook = await telegramManager.setWebhook(req.session.user.uid, result.id);
      } catch (webhookError) {
        return res.json({
          status: true,
          message: `Telegram bot tersimpan, tetapi webhook belum aktif: ${webhookError.message}`,
          data: result,
        });
      }
      res.json({
        status: true,
        message: "Telegram bot berhasil disimpan dan webhook aktif.",
        data: { ...result, webhook },
      });
    } catch (error) {
      console.error("Telegram bot save error:", error);
      res.status(error.output?.statusCode || 500).json({ status: false, message: error.message });
    }
  });

  router.post("/bot/:id/webhook", authMiddleware, async (req, res) => {
    try {
      const result = await telegramManager.setWebhook(req.session.user.uid, parseInt(req.params.id, 10));
      res.json({ status: true, message: "Webhook Telegram berhasil dipasang.", data: result });
    } catch (error) {
      console.error("Telegram webhook set error:", error);
      res.status(error.output?.statusCode || 500).json({ status: false, message: error.message });
    }
  });

  router.get("/bot/:id/webhook-info", authMiddleware, async (req, res) => {
    try {
      const result = await telegramManager.getWebhookInfo(req.session.user.uid, parseInt(req.params.id, 10));
      res.json({ status: true, data: result });
    } catch (error) {
      console.error("Telegram webhook info error:", error);
      res.status(error.output?.statusCode || 500).json({ status: false, message: error.message });
    }
  });

  router.post("/bot/:id/disable", authMiddleware, async (req, res) => {
    try {
      await telegramManager.disableBot(req.session.user.uid, parseInt(req.params.id, 10));
      res.json({ status: true, message: "Telegram bot dinonaktifkan." });
    } catch (error) {
      console.error("Telegram bot disable error:", error);
      res.status(error.output?.statusCode || 500).json({ status: false, message: error.message });
    }
  });

  router.delete("/bot/:id", authMiddleware, async (req, res) => {
    try {
      await telegramManager.deleteBot(
        req.session.user.uid,
        parseInt(req.params.id, 10),
        req.body.confirmText,
      );
      res.json({ status: true, message: "Telegram bot berhasil dihapus." });
    } catch (error) {
      console.error("Telegram bot delete error:", error);
      res.status(error.output?.statusCode || 500).json({ status: false, message: error.message });
    }
  });

  router.post("/send", authMiddleware, async (req, res) => {
    try {
      const result = await telegramManager.sendMessage({
        uid: req.session.user.uid,
        botId: parseInt(req.body.bot_id || "0", 10),
        chatId: req.body.chat_id,
        text: req.body.message,
      });
      res.json({ status: true, message: "Pesan Telegram terkirim.", data: result });
    } catch (error) {
      console.error("Telegram send error:", error);
      res.status(error.output?.statusCode || 500).json({ status: false, message: error.message });
    }
  });

  router.post("/share", authMiddleware, async (req, res) => {
    try {
      const result = await telegramManager.createShare(
        req.session.user.uid,
        parseInt(req.body.bot_id || "0", 10),
        req.body.expires_in_days,
        req.body.ai_reply_mode,
      );
      res.json({ status: true, message: "Kode share Telegram dibuat.", data: result });
    } catch (error) {
      console.error("Telegram share create error:", error);
      res.status(error.output?.statusCode || 500).json({ status: false, message: error.message });
    }
  });

  router.post("/share/accept", authMiddleware, async (req, res) => {
    try {
      const result = await telegramManager.acceptShare(req.session.user.uid, req.body.invite_code);
      res.json({ status: true, message: "Share Telegram diterima.", data: result });
    } catch (error) {
      console.error("Telegram share accept error:", error);
      res.status(error.output?.statusCode || 500).json({ status: false, message: error.message });
    }
  });

  router.post("/share/:id/revoke", authMiddleware, async (req, res) => {
    try {
      await telegramManager.revokeShare(req.session.user.uid, parseInt(req.params.id, 10));
      res.json({ status: true, message: "Share Telegram dicabut." });
    } catch (error) {
      console.error("Telegram share revoke error:", error);
      res.status(error.output?.statusCode || 500).json({ status: false, message: error.message });
    }
  });

  return router;
};
