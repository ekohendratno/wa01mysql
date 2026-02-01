const express = require("express");
const router = express.Router();

module.exports = ({ sessionManager, messageManager }) => {
  router.post("/send", async (req, res) => {
    const { key, to, text, group, tags } = req.body;

    if (!key || !to || !text) {
      return res.status(400).json({
        status: false,
        message: "Key, to, and text are required.",
      });
    }

    try {
      // Get API Key from session (Dashboard) or fallback to apiKey in body (API)
      const apiKey = req.session?.user?.api_key || req.body.apiKey;

      if (!apiKey) {
        return res.status(401).json({
          status: false,
          message: "Authentication required (API Key not found).",
        });
      }

      const result = await messageManager.sendMessage(
        apiKey,
        key,
        to,
        text,
        group,
        tags,
      );

      if (!result.status) {
        return res.status(400).json(result);
      }

      return res.status(200).json(result);
    } catch (error) {
      console.error("Failed to send messages:", error);
      return res.status(500).json({
        status: false,
        message: error.message || "Internal server error.",
      });
    }
  });

  return router;
};
