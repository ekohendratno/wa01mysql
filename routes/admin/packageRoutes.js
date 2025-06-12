const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../../lib/Utils.js');

module.exports = (billingManager) => {

    router.get("/", authMiddleware, async (req, res) => {
        try {
            let packages = [];

            try {
                packages = await billingManager.getPackages();
            } catch (error) {
                console.error("Error fetching packages:", error);
            }

            res.render("admin/package", {
                packages,
                title: "Package - w@pi",
                layout: "layouts/admin"
            });
        } catch (error) {
            console.error('Error fetching billing data:', error);
            res.status(500).send("Internal Server Error");
        }
    });


    return router;
};