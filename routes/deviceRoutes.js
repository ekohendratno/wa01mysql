const express = require('express');
const router = express.Router();

module.exports = (sessionManager) => {

    const authMiddleware = (req, res, next) => {
        if (!req.session.user) {
            return res.redirect('/auth/login');
        }
        next();
    };

    router.get("/", authMiddleware, async (req, res) => {
        try {
            const devices = await sessionManager.getDevices('9b0a811f5d511d91b630a93ad882064b0ced925ffb46d188df920c339e824e82');
            res.render("device", { devices: devices || [] });
        } catch (error) {
            console.error('Error:', error);
            res.status(500).send("Internal Server Error");
        }
    });


    router.post('/register', authMiddleware, async (req, res) => {
        const { apiKey, name, phone } = req.body;
        try {
            const deviceData = await sessionManager.registerDevice(apiKey, name, phone);

            res.json({
                status: true,
                data: {
                    id: deviceData.id,
                    device_key: deviceData.device_key,
                    name: deviceData.name
                }
            });
        } catch (error) {
            res.status(500).json({
                status: false,
                message: error.message
            });
        }
    });


    router.delete('/remove', authMiddleware, async (req, res) => {
        try {
            const { api_key: apiKey, device_key: deviceKey } = req.query;
            const result = await sessionManager.removeDevice(apiKey, deviceKey);
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