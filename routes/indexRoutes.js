const express = require('express');
const router = express.Router();

module.exports = (sessionManager) => {
    const authMiddleware = (req, res, next) => {
        if (!req.session.user) {
            return res.redirect('/auth/login');
        }
        next();
    };

    router.get("/", authMiddleware, (req, res) => {
        const sessions = sessionManager.getAllSessions();
        res.render("index", { sessions });
    });


    router.get("/status", authMiddleware, (req, res) => {
        const { key } = req.query;

        if (!key) {
            return res.status(400).json({ status: false, message: "Key is required." });
        }

        res.render("status", { key: key });
    });
    return router;
};