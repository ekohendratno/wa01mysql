const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../../lib/Utils.js");

module.exports = (sessionManager, deviceManager) => {
  router.get("/", authMiddleware, async (req, res) => {
    try {
      const apiKey = req.session.user.api_key;
      const devices = deviceManager ? await deviceManager.getDevices(apiKey) : [];
      const baseUrl = "https://wapi.jasaedukasi.com";

      res.render("client/dokumentasi", {
        title: "Dokumentasi - w@pi",
        layout: "layouts/client",
        apiKey,
        devices: devices || [],
        baseUrl,
      });
    } catch (error) {
      console.error("Documentation view error:", error);
      res.status(500).send("Internal Server Error");
    }
  });

  return router;
};
