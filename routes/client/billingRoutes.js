const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../../lib/Utils.js');

module.exports = (billingManager) => {

    router.get("/", authMiddleware, async (req, res) => {
        try {
            const apiKey = req.session.user.api_key;
            const billingData = await billingManager.getTransactions(apiKey, 'all');
            res.render("client/billing", {
                apiKey,
                title: "Billing - w@pi",
                layout: "layouts/client",
                ...billingData
            });
        } catch (error) {
            console.error('Error fetching billing data:', error);
            res.status(500).send("Internal Server Error");
        }
    });

    router.get("/data", async (req, res) => {
        const { status } = req.query;   
        try {
            const apiKey = req.session.user.api_key;
            const billingData = await billingManager.getTransactions(apiKey, status);

            res.json({
                success: true,
                data: billingData
            });
        } catch (error) {
            console.error('Error fetching billing data:', error.message);
            res.status(500).json({
                success: false,
                message: 'Internal Server Error'
            });
        }
    });

    return router;
};