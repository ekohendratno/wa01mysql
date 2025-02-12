const express = require('express');
const router = express.Router();

module.exports = ({sessionManager, messageManager}) => {
    router.post("/message", async (req, res) => {
        try {
            const { apiKey, deviceKey } = req.body;
            const messageData = req.body;
            const result = await messageManager.registerMessage(apiKey, deviceKey, messageData);
    
            res.status(201).json({
                status: "success",
                message: "Message registered successfully",
                data: result
            });
        } catch (error) {
            console.error("Error registering message:", error);
            res.status(error.output.statusCode || 500).json({
                status: "error",
                message: error.message
            });
        }
    });
    

    return router;
};