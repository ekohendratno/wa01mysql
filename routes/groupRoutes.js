const express = require('express');
const router = express.Router();
const { isValidPhoneNumber, isValidGroupId } = require('../lib/Utils.js');

module.exports = (sessionManager) => {

    const authMiddleware = (req, res, next) => {
        if (!req.session.user) {
            return res.redirect('/auth/login');
        }
        next();
    };

    router.get("/list", authMiddleware, async (req, res) => {
        const { key } = req.query;
    
        if (!key) {
            return res.status(400).json({
                status: false,
                message: "Key is required."
            });
        }
    
        const session = sessionManager.getSession(key);
        if (!session || !session.connected) {
            return res.status(404).json({
                status: false,
                message: "Session not found or not connected."
            });
        }
    
        try {
            const groupMetadata = await session.socket.groupFetchAllParticipating();
            const groups = Object.values(groupMetadata).map(group => ({
                id: group.id,
                name: group.subject
            }));
    
            return res.status(200).json({
                status: true,
                message: "Group list fetched successfully.",
                data: groups
            });
        } catch (error) {
            console.error("Failed to fetch group list:", error);
            return res.status(500).json({
                status: false,
                message: "Failed to fetch group list due to an internal server error.",
                error: error.message
            });
        }
    });

    return router;
};