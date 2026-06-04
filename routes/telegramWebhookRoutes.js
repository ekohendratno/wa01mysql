const express = require("express");
const router = express.Router();

module.exports = ({ telegramManager }) => {
  router.post("/webhook/:secret", async (req, res) => {
    try {
      await telegramManager.handleWebhook(req.params.secret, req.body);
      res.json({ ok: true });
    } catch (error) {
      console.error("Telegram webhook error:", error);
      res.status(500).json({ ok: false });
    }
  });

  return router;
};
