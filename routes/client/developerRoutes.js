const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../../lib/Utils.js");
const { generateAPIKey } = require("../../lib/Generate.js");

module.exports = ({ pool, deviceManager }) => {
  router.get("/", authMiddleware, async (req, res) => {
    try {
      const apiKey = req.session.user.api_key;
      const devices = await deviceManager.getDevices(apiKey);
      const baseUrl = "https://wapi.jasaedukasi.com";

      res.render("client/developer", {
        title: "Developer API - w@pi",
        layout: "layouts/client",
        apiKey,
        devices: devices || [],
        baseUrl,
      });
    } catch (error) {
      console.error("Developer view error:", error);
      res.status(500).send("Internal Server Error");
    }
  });

  router.post("/regenerate-key", authMiddleware, async (req, res) => {
    try {
      const uid = req.session.user.uid;
      const apiKey = generateAPIKey();
      await pool.query("UPDATE users SET api_key = ? WHERE uid = ?", [
        apiKey,
        uid,
      ]);
      req.session.user.api_key = apiKey;
      res.json({ status: true, apiKey });
    } catch (error) {
      console.error("API key regenerate error:", error);
      res.status(500).json({ status: false, message: "Internal Server Error" });
    }
  });

  return router;
};
