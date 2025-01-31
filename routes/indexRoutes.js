const express = require('express');
const router = express.Router();

module.exports = (sessionManager) => {
    router.get("/", (req, res) => {
        const sessions = sessionManager.getAllSessions();
        res.render("index", { sessions });
    });


    router.get("/status", (req, res) => {
        const { key } = req.query;

        if (!key) {
            return res.status(400).json({ status: false, message: "Key is required." });
        }

        res.render("status", { key: key });
    });
    return router;
};