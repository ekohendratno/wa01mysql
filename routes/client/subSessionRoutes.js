const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../../lib/Utils.js");

module.exports = ({ sessionManager, deviceManager, billingManager }) => {
  router.get("/list", authMiddleware, async (req, res) => {
    try {
      const { parentDeviceKey } = req.query;
      const apiKey = req.session.user.api_key;
      const subDevices = await deviceManager.getSubDevices(
        apiKey,
        parentDeviceKey
      );
      res.json({ status: true, data: subDevices });
    } catch (error) {
      console.error("Error fetching sub-devices:", error);
      res.status(500).json({ status: false, message: error.message });
    }
  });

  router.post("/register", authMiddleware, async (req, res) => {
    const { apiKey, deviceName, phoneNumber, packageId, sessionParent } =
      req.body;
    try {
      const result = await deviceManager.registerDevice(
        apiKey,
        deviceName,
        phoneNumber,
        packageId,
        sessionParent
      );
      res.json({
        status: result.status,
        message: result.message,
        data: result.data,
      });
    } catch (error) {
      console.error("Error registering sub-device:", error);
      const statusCode = error.statusCode || 500;
      res.status(statusCode).json({
        status: false,
        message: error.message,
        ...(error.data || {}),
      });
    }
  });

  return router;
};
