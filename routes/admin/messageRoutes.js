const express = require('express');
const router = express.Router();

module.exports = ({sessionManager, messageManager, deviceManager}) => {

    const authMiddleware = (req, res, next) => {
        if (!req.session.user) {
            return res.redirect('/auth/login');
        }
        next();
    };

    router.get("/", authMiddleware, async (req, res) => {
        try {
            const apiKey = req.session.user.api_key;
            const messages = await messageManager.getMessages(apiKey);
            const devices = await deviceManager.getDevices(apiKey, { status: 'connected' });
            res.render("admin/message", { apiKey, messages: messages || [], devices: devices || [], title: "Messages - w@pi", layout: "layouts/admin" });
        } catch (error) {
            console.error('Error:', error);
            res.status(500).send("Internal Server Error");
        }
    });
    
    router.delete('/remove', authMiddleware, async (req, res) => {
        try {
            const { apiKey, id } = req.query;
            const result = await messageManager.removeMessage(apiKey, id);
            res.json({ status: true, message: 'Message deleted successfully' });
        } catch (error) {
            console.error('Delete message error:', error);
            const statusCode = error.output?.statusCode || 500;
            res.status(statusCode).json({
                status: false,
                message: error.message
            });
        }
    });

    return router;
};