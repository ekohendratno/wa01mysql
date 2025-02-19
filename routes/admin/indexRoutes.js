const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../../lib/Utils.js');

module.exports = ({sessionManager, deviceManager}) => {

    router.get("/", authMiddleware, async (req, res) => {
        const sessions = sessionManager.getAllSessions();
        const apiKey = req.session.user.api_key;
        const devices = await deviceManager.getDevices(apiKey);

        
        const countDeviceLast = await deviceManager.getDevicesWithLastActive(apiKey);
        const countMessage = await sessionManager.getMessageCounts(apiKey);
        const countDevice = await deviceManager.getActiveDeviceCount(apiKey);
        const countSummary = await sessionManager.getBalanceSummary(apiKey);

        res.render("admin/index", { countDeviceLast, countMessage, countDevice, countSummary, devices: devices || [], apiKey: apiKey, sessions, title: "Home - w@pi", layout: "layouts/admin" });
    });


    router.get("/status", authMiddleware, async (req, res) => {
        const { key } = req.query;

        if (!key) {
            return res.status(400).json({ status: false, message: "Key is required." });
        }

        res.render("admin/status", { key: key, title: "Home", layout: "layouts/admin" });
    });
    return router;
};