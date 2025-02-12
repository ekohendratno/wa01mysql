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
            const apiKey = req.session.user.api_key;
            const billingData = await sessionManager.getTransactions(apiKey);
            res.render("admin/billing", {
                apiKey,
                title: "Billing - w@pi",
                layout: "layouts/admin",
                ...billingData
            });
        } catch (error) {
            console.error('Error fetching billing data:', error);
            res.status(500).send("Internal Server Error");
        }
    });


    return router;
};