process.on("unhandledRejection", (reason, promise) => {
    console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (error) => {
    console.error("Uncaught Exception:", error);
});

process.on("uncaughtExceptionMonitor", (error) => {
    console.error("[Critical Error]", error);
});

const path = require('path')
const { Boom } = require('@hapi/boom');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const pino = require("pino");
const express = require("express");
const bodyParser = require("body-parser");
const qrcode = require("qrcode");
const http = require("http");
const socketIO = require("socket.io");
const fs = require("fs");
const cors = require('cors');


const SessionManager = require('./lib/SessionsManager.js');

// Setup server dan IO
const app = express();
const server = http.createServer(app);
const io = socketIO(server, { /* config IO */ });

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

const folderSession = './.sessions';
app.use("/asset/sessions", express.static(folderSession));

// Inisialisasi Session Manager
const sessionManager = new SessionManager(io, folderSession);


// Routes
const indexRoutes = require('./routes/indexRoutes')(sessionManager);
const authRoutes = require('./routes/authRoutes')(sessionManager);
const deviceRoutes = require('./routes/deviceRoutes')(sessionManager);
const sessionRoutes = require('./routes/sessionRoutes')(sessionManager);
const messageRoutes = require('./routes/messageRoutes')(sessionManager);
const groupRoutes = require('./routes/groupRoutes')(sessionManager);

app.use('/', indexRoutes);
app.use('/auth', authRoutes);
app.use('/device', deviceRoutes);
app.use('/session', sessionRoutes);
app.use('/message', messageRoutes);
app.use('/group', groupRoutes);


sessionManager.initSessions();
const PORT = 3000;
server.listen(PORT, () => {
    console.log(`WhatsApp Gateway running on http://localhost:${PORT}`);
});
