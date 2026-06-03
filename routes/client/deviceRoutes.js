const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../../lib/Utils.js");
const moment = require("moment-timezone");

module.exports = ({ sessionManager, deviceManager, billingManager }) => {
  router.get("/", authMiddleware, async (req, res) => {
    try {
      const apiKey = req.session.user.api_key;

      const devices = await deviceManager.getDevices(apiKey);
      const packages = await billingManager.getPackages();
      const devicesWithLastActive =
        await deviceManager.getDevicesWithLastActive(apiKey);
      const activeDeviceCount =
        await deviceManager.getActiveDeviceCount(apiKey);
      const deviceShares = await deviceManager.getDeviceShares(apiKey);

      // Build a simple device history from devices (latest updated first)
      const deviceHistory = (devices || [])
        .slice()
        .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
        .slice(0, 10)
        .map((d) => ({
          device_key: d.device_key,
          status: d.status,
          when: d.updated_at
            ? moment(d.updated_at).tz("Asia/Jakarta").fromNow()
            : "-",
          note: d.name || "",
        }));

      res.render("client/device", {
        countDeviceLast: devicesWithLastActive,
        countDevice: activeDeviceCount,
        devices: devices || [],
        packages: packages || [],
        apiKey: apiKey,
        deviceHistory: deviceHistory,
        deviceShares: deviceShares || [],
        title: "Device - w@pi",
        layout: "layouts/client",
      });
    } catch (error) {
      console.error("Error:", error);
      res.status(500).send("Internal Server Error");
    }
  });

  router.get("/status", authMiddleware, async (req, res) => {
    const { deviceKey } = req.query;
    try {
      const apiKey = req.session.user.api_key;
      const device = await deviceManager.getDevice(apiKey, deviceKey);
      if (device.access_type !== "owner") {
        return res.status(403).send("Device shared hanya bisa dipakai untuk kirim pesan.");
      }
      const packages = await billingManager.getPackages();
      const subDevices = await deviceManager.getSubDevices(apiKey, deviceKey);

      res.render("client/device-status", {
        device: device || {},
        subDevices: subDevices || [],
        packages: packages || [],
        apiKey: apiKey,
        deviceKey: deviceKey,
        title: "Device Status",
        layout: "layouts/client",
      });
    } catch (error) {
      console.error("Error fetching device status:", error);
      const statusCode = error.isBoom ? error.output.statusCode : 500;
      res.status(statusCode).send(error.message || "Internal Server Error");
    }
  });

  router.post("/register", authMiddleware, async (req, res) => {
    const { apiKey, deviceName, phoneNumber, packageId } = req.body;
    try {
      const result = await deviceManager.registerDevice(
        apiKey,
        deviceName,
        phoneNumber,
        packageId,
      );
      res.json({
        status: result.status,
        message: result.message,
        data: result.data,
      });
    } catch (error) {
      console.error("Error registering device:", error);
      const statusCode = error.statusCode || 500;
      res.status(statusCode).json({
        status: false,
        message: error.message,
        ...(error.data || {}),
      });
    }
  });

  router.post("/upgrade-package", authMiddleware, async (req, res) => {
    try {
      const apiKey = req.session.user.api_key;
      const { deviceKey, packageId } = req.body;

      if (!deviceKey || !packageId) {
        return res.status(400).json({
          status: false,
          message: "Device dan paket wajib dipilih.",
        });
      }

      const result = await deviceManager.upgradeDevicePackage(
        apiKey,
        deviceKey,
        packageId,
      );
      res.json(result);
    } catch (error) {
      console.error("Upgrade package error:", error);
      const statusCode = error.statusCode || error.output?.statusCode || 500;
      res.status(statusCode).json({
        status: false,
        message: error.message || "Gagal upgrade paket.",
        ...(error.data || {}),
      });
    }
  });

  router.post("/share/create", authMiddleware, async (req, res) => {
    try {
      const apiKey = req.session.user.api_key;
      const { deviceKey, expiresInDays } = req.body;
      if (!deviceKey) {
        return res.status(400).json({
          status: false,
          message: "Device key wajib diisi.",
        });
      }

      const result = await deviceManager.createDeviceShare(
        apiKey,
        deviceKey,
        expiresInDays,
      );
      res.json(result);
    } catch (error) {
      console.error("Create device share error:", error);
      const statusCode = error.output?.statusCode || error.statusCode || 500;
      res.status(statusCode).json({
        status: false,
        message: error.message,
      });
    }
  });

  router.post("/share/accept", authMiddleware, async (req, res) => {
    try {
      const apiKey = req.session.user.api_key;
      const { inviteCode } = req.body;
      if (!inviteCode) {
        return res.status(400).json({
          status: false,
          message: "Kode undangan wajib diisi.",
        });
      }

      const result = await deviceManager.acceptDeviceShare(apiKey, inviteCode);
      res.json(result);
    } catch (error) {
      console.error("Accept device share error:", error);
      const statusCode = error.output?.statusCode || error.statusCode || 500;
      res.status(statusCode).json({
        status: false,
        message: error.message,
      });
    }
  });

  router.post("/share/revoke", authMiddleware, async (req, res) => {
    try {
      const apiKey = req.session.user.api_key;
      const { shareId } = req.body;
      const ok = await deviceManager.revokeDeviceShare(apiKey, shareId);
      res.json({
        status: ok,
        message: ok ? "Akses share dicabut." : "Share tidak ditemukan.",
      });
    } catch (error) {
      console.error("Revoke device share error:", error);
      res.status(500).json({ status: false, message: error.message });
    }
  });

  router.post("/share/update-expiry", authMiddleware, async (req, res) => {
    try {
      const apiKey = req.session.user.api_key;
      const { shareId, additionalDays, expiresAt, limitDailyOverride, aiReplyMode } = req.body;
      if (!shareId) {
        return res.status(400).json({
          status: false,
          message: "Share ID wajib diisi.",
        });
      }

      const result = await deviceManager.updateDeviceShareExpiry(apiKey, shareId, {
        additionalDays,
        expiresAt,
        limitDailyOverride,
        aiReplyMode,
      });
      res.json(result);
    } catch (error) {
      console.error("Update device share expiry error:", error);
      const statusCode = error.output?.statusCode || error.statusCode || 500;
      res.status(statusCode).json({
        status: false,
        message: error.message,
      });
    }
  });

  router.delete("/remove", authMiddleware, async (req, res) => {
    try {
      const { apiKey, deviceKey } = req.query;
      const result = await deviceManager.removeDevice(apiKey, deviceKey);
      res.json({ status: true, message: "Device deleted successfully" });
    } catch (error) {
      console.error("Delete device error:", error);
      const statusCode = error.output?.statusCode || 500;
      res.status(statusCode).json({
        status: false,
        message: error.message,
      });
    }
  });

  router.get("/disconnect", authMiddleware, async (req, res) => {
    try {
      const { deviceKey } = req.query;
      const apiKey = req.session.user.api_key;

      // Verify device belongs to user
      const device = await deviceManager.getDevice(apiKey, deviceKey);
      if (!device) {
        return res
          .status(404)
          .json({ status: false, message: "Device not found" });
      }
      if (device.access_type !== "owner") {
        return res.status(403).json({
          status: false,
          message: "Device shared hanya bisa dipakai untuk kirim pesan, bukan disconnect.",
        });
      }

      await sessionManager.removeSession(deviceKey, true, "disconnected");
      res.json({ status: true, message: "Device disconnected successfully" });
    } catch (error) {
      console.error("Disconnect device error:", error);
      res.status(500).json({ status: false, message: error.message });
    }
  });

  router.get("/group", authMiddleware, async (req, res) => {
    const { deviceKey } = req.query;
    try {
      const apiKey = req.session.user.api_key;
      const device = await deviceManager.getDevice(apiKey, deviceKey);
      if (device.access_type !== "owner") {
        return res.status(403).send("Device shared tidak bisa membuka manajemen group.");
      }
      const groups = await deviceManager.getGroups(apiKey, deviceKey);

      res.render("client/device-group", {
        groups: groups || [],
        device: device || [],
        apiKey: apiKey,
        deviceKey: deviceKey,
        title: "Device Group",
        layout: "layouts/client",
      });
    } catch (error) {
      console.error("Error:", error);
      res.status(500).send("Internal Server Error");
    }
  });

  return router;
};
