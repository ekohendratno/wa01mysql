const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../../lib/Utils.js");

module.exports = (billingManager) => {
  router.get("/", authMiddleware, async (req, res) => {
    try {
      res.render("admin/billing", {
        title: "Billing - w@pi",
        layout: "layouts/admin",
      });
    } catch (error) {
      console.error("Error fetching billing data:", error);
      res.status(500).send("Internal Server Error");
    }
  });

  router.get("/data", async (req, res) => {
    const { status } = req.query;
    try {
      const billingData = await billingManager.getTransactionsAll(status);
      res.json({ success: true, data: billingData });
    } catch (error) {
      console.error("Error fetching billing data:", error.message);
      res
        .status(500)
        .json({ success: false, message: "Internal Server Error" });
    }
  });

  router.get("/users", authMiddleware, async (req, res) => {
    try {
      const users = await billingManager.getAdminBalanceUsers();
      res.json({ success: true, users });
    } catch (error) {
      console.error("Error fetching billing users:", error.message);
      res.status(500).json({
        success: false,
        message: "Gagal mengambil daftar pengguna.",
      });
    }
  });

  router.post("/send-balance", authMiddleware, async (req, res) => {
    try {
      const { uid, amount, note } = req.body;
      const result = await billingManager.sendBalanceToUser(uid, amount, note);
      res.json(result);
    } catch (error) {
      console.error("Error sending balance:", error.message);
      res.status(400).json({
        success: false,
        message: error.message || "Gagal mengirim saldo.",
      });
    }
  });

  return router;
};
