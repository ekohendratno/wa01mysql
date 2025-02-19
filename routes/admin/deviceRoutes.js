const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../../lib/Utils.js');

module.exports = ({sessionManager, deviceManager}) => {

    router.get("/", authMiddleware, async (req, res) => {
        try {
            const apiKey = req.session.user.api_key;
    
            const devices = await deviceManager.getDevices(apiKey);  
            const packages = await sessionManager.getPackages();
            const devicesWithLastActive = await deviceManager.getDevicesWithLastActive(apiKey);
            const activeDeviceCount = await deviceManager.getActiveDeviceCount(apiKey);

            res.render("admin/device", {
                countDeviceLast: devicesWithLastActive,
                countDevice: activeDeviceCount,
                devices: devices || [],
                packages: packages || [],
                apiKey: apiKey,
                title: "Device - w@pi",
                layout: "layouts/admin"
            });
        } catch (error) {
            console.error('Error:', error);
            res.status(500).send("Internal Server Error");
        }
    });

    
    router.get("/status", authMiddleware, async (req, res) => {
        const {deviceKey} = req.query;
        try {
            const apiKey = req.session.user.api_key;
            const device = await deviceManager.getDevice(apiKey, deviceKey);

            res.render("admin/device-status", { device: device|| [], apiKey: apiKey, deviceKey: deviceKey, title: "Device Status", layout: "layouts/admin" });
        } catch (error) {
            console.error('Error:', error);
            res.status(500).send("Internal Server Error");
        }
    });


    router.post('/register', authMiddleware, async (req, res) => {
        const { apiKey, deviceName, phoneNumber, packageId } = req.body;
        try {
            const result = await deviceManager.registerDevice(apiKey, deviceName, phoneNumber, packageId);
            res.json({
                status: result.status,
                message: result.message,
                data: result.data
            });
        } catch (error) {
            if (error.message.includes('Saldo tidak mencukupi')) {
                return res.status(400).json({
                    status: false,
                    message: error.message,
                    redirect: '/admin/billing'
                });
            }
            res.status(500).json({
                status: false,
                message: error.message
            });
        }
    });

    router.delete('/remove', authMiddleware, async (req, res) => {
        try {
            const { apiKey, deviceKey } = req.query;
            const result = await deviceManager.removeDevice(apiKey, deviceKey);
            res.json({ status: true, message: 'Device deleted successfully' });
        } catch (error) {
            console.error('Delete device error:', error);
            const statusCode = error.output?.statusCode || 500;
            res.status(statusCode).json({
                status: false,
                message: error.message
            });
        }
    });

    return router;
};