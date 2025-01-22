process.on("unhandledRejection", (reason, promise) => {
    console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (error) => {
    console.error("Uncaught Exception:", error);
});

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const pino = require("pino");
const express = require("express");
const bodyParser = require("body-parser");
const qrcode = require("qrcode");
const http = require("http");
const socketIO = require("socket.io");
const fs = require("fs");
const { isValidPhoneNumber, isValidGroupId } = require('./utils');
const cors = require('cors');


const app = express();
const server = http.createServer(app);
// const io = socketIO(server);
const io = require('socket.io')(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    allowEIO3: true, // Allow Engine.IO v3
});

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.set("view engine", "ejs");
app.set("views", __dirname + "/views");
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type'],
    credentials: true,
}));

const folderSession = "./sessions";
const sessions = {};

app.use("/sessions", express.static(folderSession));
async function initSessions() {
    console.log("Initializing sessions...");

    if (!fs.existsSync(folderSession)) {
        console.log("No sessions folder found, creating one...");
        fs.mkdirSync(folderSession, { recursive: true });
    }

    const sessionKeys = fs.readdirSync(folderSession).filter(file => {
        return fs.statSync(folderSession + `/${file}`).isDirectory();
    });

    for (const key of sessionKeys) {
        console.log(`Loading session: ${key}`);
        await createSession(key);
    }

    console.log("All sessions initialized!");
}

async function createSession(key) {
    try {
        const sessionPath = folderSession + `/${key}`;
        if (!fs.existsSync(sessionPath)) {
            console.log(`Session folder ${sessionPath} does not exist. Creating...`);
            fs.mkdirSync(sessionPath, { recursive: true });
        }

        if (!sessions[key]) {
            sessions[key] = { socket: null, qr: null, connected: false };
        }

        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
        const socket = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            logger: pino({ level: "silent" }),
        });

        socket.ev.on("creds.update", saveCreds);

        socket.ev.on("connection.update", ({ connection, qr, lastDisconnect }) => {
            if (connection === "open") {
                console.log(`Connected: ${key}`);
                sessions[key].connected = true;
                io.emit("connection-status", { key, connected: true });
            } else if (connection === "close") {
                console.log(`Disconnected: ${key}`);
                sessions[key].connected = false;
                io.emit("connection-status", { key, connected: false });

                const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
                console.log('connection closed due to ', lastDisconnect.error, ', reconnecting ', shouldReconnect);

                if (lastDisconnect.error.output.statusCode === 440) {
                    console.log('Disconnected due to conflict, reconnecting...');
                    socket.connect();
                }

                if (shouldReconnect) {
                    // Restart session creation after a disconnect
                    createSession(key).catch(err => console.error("Reconnection error:", err));
                } else {
                    delete sessions[key];
                }
            }

            if (qr) {
                // qrcode.toDataURL(qr, (err, qrCodeImage) => {
                //     if (!err) {
                //         if (!sessions[key]) {
                //             sessions[key] = { socket, qr: null, connected: false };
                //         }
                //         sessions[key].qr = qrCodeImage;
                //         io.emit("qr-update", { key, qr: qrCodeImage });
                //     } else {
                //         console.error("Error generating QR code:", err);
                //     }
                // });


                qrcode.toFile(`./sessions/${key}/qr.png`, qr, (err) => {
                    if (err) {
                        console.error("Error generating QR code:", err);
                    } else {
                        console.log(`QR code saved for session ${key}`);

                        if (!sessions[key]) {
                            sessions[key] = { socket, qr: null, connected: false };
                        }

                        // Tambahkan timestamp ke URL
                        const timestamp = Date.now();
                        const qrUrl = `/sessions/${key}/qr.png?t=${timestamp}`;

                        sessions[key].qr = qrUrl;
                        io.emit("qr-update", { key, qr: qrUrl });
                    }
                });


            }
        });

        sessions[key].socket = socket;
    } catch (error) {
        console.error(`Error in createSession for key "${key}":`, error);
    }
}


app.get("/", (req, res) => {
    res.render("index", { sessions });
});

app.get("/status", (req, res) => {
    const { key } = req.query;

    if (!key) {
        return res.status(400).json({ status: false, message: "Key is required." });
    }

    res.render("status", { key: key });
});

app.get("/session", (req, res) => {
    try {
        const { key } = req.query;

        if (key) {
            if (sessions[key]) {
                return res.status(200).json({
                    status: true,
                    message: "Session status retrieved successfully.",
                    data: {
                        key,
                        connected: sessions[key]?.connected || false,
                    },
                });
            } else {
                return res.status(200).json({
                    status: false,
                    message: `Session with key "${key}" not found.`,
                });
            }
        }

        const sessionsStatus = Object.keys(sessions).map((key) => ({
            key,
            connected: sessions[key]?.connected || false,
        }));

        return res.status(200).json({
            status: true,
            message: "All session statuses retrieved successfully.",
            data: sessionsStatus,
        });
    } catch (error) {
        console.error("Failed to retrieve session status:", error);
        res.status(500).json({
            status: false,
            message: "Failed to retrieve session status.",
            error: error.message,
        });
    }
});

app.get("/session-remove", async (req, res) => {
    const { key } = req.query;

    if (!key) {
        return res.status(400).json({ status: false, message: "Key is required." });
    }
    const session = sessions[key];
    if (!session) {
        return res.status(404).json({ status: false, message: `Session with key "${key}" not found.` });
    }
    if (session.socket) {
        session.socket.close();
    }

    delete sessions[key];
    try {
        const sessionFolderPath = folderSession + `/${key}`;
        if (fs.existsSync(sessionFolderPath)) {
            fs.rmSync(sessionFolderPath, { recursive: true, force: true }); // Mengganti fs.rmdirSync dengan fs.rmSync
            console.log(`Session folder ${sessionFolderPath} removed.`);
        }
    } catch (error) {
        console.error("Failed to delete session folder:", error);
        return res.status(500).json({
            status: false,
            message: "Failed to delete session folder.",
            error: error.message,
        });
    }

    res.status(200).json({
        status: true,
        message: `Session with key "${key}" removed successfully.`,
    });
});

app.get("/scan", async (req, res) => {
    const { key } = req.query;

    if (!key) {
        return res.status(400).json({ status: false, message: "Key is required." });
    }

    await createSession(key);

    const session = sessions[key];
    if (session.connected) {
        return res.status(200).json({ status: true, message: "Session already connected." });
    }

    if (!session.qr) {
        return res.status(202).json({ status: false, message: "QR Code not generated yet." });
    }

    res.status(200).json({ status: true, qr: session.qr });
});


app.post("/message", async (req, res) => {
    const { key, to, text, group } = req.body;


    if (!key || !to || !text) {
        return res.status(400).json({ status: false, message: "Key, to, and text are required." });
    }

    const session = sessions[key];
    if (!session || !session.connected) {
        return res.status(404).json({ status: false, message: "Session not found or not connected." });
    }

    try {
        if (group === true) {
            if (!isValidGroupId(to)) {
                return res.status(400).json({
                    status: false,
                    message: "Invalid Group ID format. Group ID must be 18 digits followed by '@g.us'.",
                });
            }

            const jid = to;
            await session.socket.sendMessage(jid, { text });

            console.log(`Success session ${key} send message group to ${to}`);
            return res.status(200).json({
                status: true,
                message: "Message sent to group successfully.",
                to,
            });
        } else {
            const phoneNumbers = to.split(",").map((number) => number.trim());
            const invalidNumbers = phoneNumbers.filter((number) => !isValidPhoneNumber(number));

            if (invalidNumbers.length > 0) {
                return res.status(400).json({
                    status: false,
                    message: "Some phone numbers are invalid.",
                    invalidNumbers,
                });
            }

            let numberCount = 0;
            const results = [];
            for (const recipient of phoneNumbers) {
                const jid = `${recipient}@s.whatsapp.net`;
                await session.socket.sendMessage(jid, { text });
                results.push({ to: recipient, status: "sent" });
                numberCount++;
            }


            console.log(`Success session ${key} send message to ${to}`);
            return res.status(200).json({
                status: true,
                message: numberCount > 1 ? "Bulk messages sent successfully." : "Messages sent successfully.",
                results,
            });
        }
    } catch (error) {
        console.error("Failed to send message:", error);
        return res.status(500).json({
            status: false,
            message: "Failed to send message.",
            error: error.message,
        });
    }
});


initSessions();
const PORT = 3000;
server.listen(PORT, () => {
    console.log(`WhatsApp Gateway running on http://localhost:${PORT}`);
});
