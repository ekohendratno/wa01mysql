const express = require('express');
const router = express.Router();

module.exports = (sessionManager) => {

    router.get("/register", (req, res) => {
        const { key } = req.query;

        if (!key) {
            return res.status(400).json({ status: false, message: "Key is required." });
        }
        
        console.log(key);
    });
    return router;
};