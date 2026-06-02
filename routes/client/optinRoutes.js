const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../../lib/Utils.js");

module.exports = ({ messageManager, deviceManager }) => {
  router.get("/", authMiddleware, async (req, res) => {
    try {
      const uid = req.session.user.uid;
      const apiKey = req.session.user.api_key;
      await messageManager.syncOptInsFromInbox(uid);
      const optins = await messageManager.getOptIns(uid);
      const devices = await deviceManager.getDevices(apiKey);

      res.render("client/optin", {
        optins: optins || [],
        devices: devices || [],
        apiKey: apiKey,
        title: "Opt-In Management - w@pi",
        layout: "layouts/client",
      });
    } catch (error) {
      console.error("Error fetching opt-ins:", error);
      res.status(500).send("Internal Server Error");
    }
  });

  router.post("/add", authMiddleware, async (req, res) => {
    try {
      const { apiKey, number, status, deviceId } = req.body;
      const uid = req.session.user.uid;

      if (!number) {
        return res
          .status(400)
          .json({ status: false, message: "Nomor harus diisi" });
      }

      const result = await messageManager.registerOptIn(
        apiKey,
        number,
        status || "approved",
        "manual_dashboard",
      );

      // If deviceId is provided, we might want to update it since registerOptIn sets it to 0
      if (result.status && deviceId) {
        const cleanNumber = number.replace(/\D/g, "");
        await messageManager.pool.query(
          "UPDATE opt_ins SET device_id = ? WHERE uid = ? AND number = ?",
          [deviceId, uid, cleanNumber],
        );
      }

      res.json(result);
    } catch (error) {
      console.error("Error adding opt-in:", error);
      res.status(500).json({ status: false, message: error.message });
    }
  });

  router.post("/import", authMiddleware, async (req, res) => {
    try {
      const { apiKey, numbers, status, deviceId } = req.body;
      const uid = req.session.user.uid;

      if (!numbers) {
        return res
          .status(400)
          .json({ status: false, message: "Nomor-nomor harus diisi" });
      }

      const numberList = numbers
        .split(/[\n,]+/)
        .map((n) => n.trim())
        .filter((n) => n.length > 0);
      let successCount = 0;

      for (const number of numberList) {
        const result = await messageManager.registerOptIn(
          apiKey,
          number,
          status || "approved",
          "bulk_import",
        );
        if (result.status && deviceId) {
          const cleanNumber = number.replace(/\D/g, "");
          await messageManager.pool.query(
            "UPDATE opt_ins SET device_id = ? WHERE uid = ? AND number = ?",
            [deviceId, uid, cleanNumber],
          );
        }
        if (result.status) successCount++;
      }

      res.json({
        status: true,
        message: `${successCount} nomor berhasil diimport.`,
      });
    } catch (error) {
      console.error("Error importing opt-ins:", error);
      res.status(500).json({ status: false, message: error.message });
    }
  });

  router.delete("/remove/:id", authMiddleware, async (req, res) => {
    try {
      const uid = req.session.user.uid;
      const id = req.params.id;
      const result = await messageManager.removeOptIn(uid, id);
      res.json({
        status: result,
        message: result ? "Berhasil dihapus" : "Gagal menghapus",
      });
    } catch (error) {
      console.error("Error removing opt-in:", error);
      res.status(500).json({ status: false, message: error.message });
    }
  });

  router.post("/remove/:id", authMiddleware, async (req, res) => {
    try {
      const uid = req.session.user.uid;
      const id = req.params.id;
      const result = await messageManager.removeOptIn(uid, id);
      res.json({
        status: result,
        message: result ? "Berhasil dihapus" : "Data tidak ditemukan",
      });
    } catch (error) {
      console.error("Error removing opt-in:", error);
      res.status(500).json({ status: false, message: error.message });
    }
  });

  router.post("/update", authMiddleware, async (req, res) => {
    try {
      const { id, status, deviceId } = req.body;
      const uid = req.session.user.uid;

      if (!id) {
        return res
          .status(400)
          .json({ status: false, message: "ID tidak valid" });
      }

      const agreedAt = status === "approved" ? "NOW()" : "NULL";
      await messageManager.pool.query(
        `UPDATE opt_ins SET status = ?, device_id = ?, agreed_at = ${agreedAt}, updated_at = NOW() WHERE id = ? AND uid = ?`,
        [status, deviceId, id, uid],
      );

      res.json({ status: true, message: "Berhasil diperbarui" });
    } catch (error) {
      console.error("Error updating opt-in:", error);
      res.status(500).json({ status: false, message: error.message });
    }
  });

  return router;
};
