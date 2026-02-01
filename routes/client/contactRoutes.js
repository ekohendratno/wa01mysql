const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../../lib/Utils.js");

module.exports = ({ deviceManager }) => {
  router.get("/", authMiddleware, async (req, res) => {
    try {
      res.render("client/contacts", {
        title: "Kontak - w@pi",
        layout: "layouts/client",
        apiKey: req.session.user.api_key,
      });
    } catch (error) {
      console.error("Contacts View Error:", error);
      res.status(500).send("Internal Server Error");
    }
  });

  router.get("/data", authMiddleware, async (req, res) => {
    try {
      const { page = 1, limit = 50 } = req.query;
      const apiKey = req.session.user.api_key;

      const p = parseInt(page) || 1;
      const l = parseInt(limit) || 50;

      const result = await deviceManager.getContacts(apiKey, p, l);
      res.json(result);
    } catch (error) {
      console.error("Contacts Data Error:", error);
      res.status(500).json({ status: false, message: "Internal Server Error" });
    }
  });

  return router;
};
