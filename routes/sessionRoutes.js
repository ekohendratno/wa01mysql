const express = require('express');
const router = express.Router();

module.exports = (sessionManager) => {

    router.get("/", (req, res) => {
        try {
            const { key } = req.query;

            if (key) {
                const session = sessionManager.getSession(key);
                if (session) {
                    return res.status(200).json({
                        status: true,
                        message: "Session status retrieved successfully.",
                        data: {
                            key,
                            connected: session?.connected || false,
                        },
                    });
                } else {
                    return res.status(200).json({
                        status: false,
                        message: `Session with key "${key}" not found.`,
                    });
                }
            }

            const sessions = sessionManager.getAllSessions();
            const sessionsStatus = Object.keys(sessions).map((key) => ({
                key,
                connected: sessions[key]?.connected || false,
            }));

            return res.status(200).json({
                status: true,
                message: "All session statuses retrieved successfully.",
                data: sessionsStatus,
            });
        } catch (error) {
            console.error("Failed to retrieve session status:", error);
            res.status(500).json({
                status: false,
                message: "Failed to retrieve session status.",
                error: error.message,
            });
        }
    });

    router.get("/remove", async (req, res) => {
        const { key } = req.query;

        if (!key) {
            return res.status(400).json({ status: false, message: "Key is required." });
        }
        const session = sessionManager.getSession(key);
        if (!session) {
            return res.status(404).json({ status: false, message: `Session with key "${key}" not found.` });
        }

        try {

            sessionManager.removeSession(key, true);
        } catch (error) {
            console.error("Failed to delete session folder:", error);
            return res.status(500).json({
                status: false,
                message: "Failed to delete session folder.",
                error: error.message,
            });
        }

        res.status(200).json({
            status: true,
            message: `Session with key "${key}" removed successfully.`,
        });
    });

    router.get("/scan", async (req, res) => {
        const { key } = req.query;

        if (!key) {
            return res.status(400).json({ status: false, message: "Key is required." });
        }

        await sessionManager.createSession(key);

        const session = sessionManager.getSession(key);
        if (session.connected) {
            return res.status(200).json({ status: true, message: "Session already connected." });
        }

        if (!session.qr) {
            return res.status(202).json({ status: false, message: "QR Code not generated yet." });
        }

        res.status(200).json({
            status: true,
            qr: session.qr
        });
    });

    return router;
};