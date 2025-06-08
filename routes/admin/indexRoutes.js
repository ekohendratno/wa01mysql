const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../../lib/Utils.js');

module.exports = () => {

    router.get("/", authMiddleware, async (req, res) => {

        res.render("admin/index", { title: "Home - w@pi", layout: "layouts/admin" });
    });


    return router;
};