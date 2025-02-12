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
        res.render("admin/dokumentasi", { title: "Dokumentasi - w@pi", layout: "layouts/admin" });
    });

    return router;
};