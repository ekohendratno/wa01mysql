const express = require('express');
const router = express.Router();
const { isValidPhoneNumber, isValidGroupId } = require('../lib/Utils.js');

module.exports = ({sessionManager, messageManager}) => {
    router.post("/send", async (req, res) => {
        const { key, to, text, group } = req.body;
    
        if (!key || !to || !text) {
            return res.status(400).json({
                status: false,
                message: "Key, to, and text are required."
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
            const recipients = to.split(',').map((recipient) => recipient.trim());
            const invalidRecipients = [];
            const results = [];
    
            for (const recipient of recipients) {
                try {
                    if (group === true) {
                        if (!isValidGroupId(recipient)) {
                            invalidRecipients.push(recipient);
                            results.push({
                                recipient,
                                status: false,
                                message: "Invalid Group ID format."
                            });
                            continue;
                        }
                        await session.socket.sendMessage(recipient, { text });
                    } else {
                        if (!isValidPhoneNumber(recipient)) {
                            invalidRecipients.push(recipient);
                            results.push({
                                recipient,
                                status: false,
                                message: "Invalid phone number format."
                            });
                            continue;
                        }
                        const formattedNumber = recipient.includes("@s.whatsapp.net")
                            ? recipient
                            : `${recipient}@s.whatsapp.net`;
                        await session.socket.sendMessage(formattedNumber, { text });
                    }
                    results.push({
                        recipient,
                        status: true,
                        message: "Message sent successfully."
                    });
                } catch (error) {
                    results.push({
                        recipient,
                        status: false,
                        message: `Failed to send message: ${error.message}`
                    });
                }
            }
    
            return res.status(200).json({
                status: true,
                message: "Message processing completed.",
                data: {
                    results,
                    invalidRecipients
                }
            });
        } catch (error) {
            console.error("Failed to send messages:", error);
            return res.status(500).json({
                status: false,
                message: "Failed to send messages due to an internal server error.",
                error: error.message
            });
        }
    });
    

    return router;
};