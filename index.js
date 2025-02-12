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
const mysql = require('mysql2/promise');

const dbConfig = require('./config');
const pool = mysql.createPool(dbConfig);

const SessionManager = require('./lib/SessionsManager.js');
const CronManager = require('./lib/CronManager.js');
const MessageManager = require('./lib/MessageManager.js');
const DeviceManager = require('./lib/DeviceManager.js');
const AutoReplyManager = require('./lib/AutoReplyManager.js');
const UserManager = require('./lib/UserManager.js');


const expressLayouts = require("express-ejs-layouts");

// Setup server dan IO
const app = express();
const server = http.createServer(app);
const io = socketIO(server, { /* config IO */ });

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(expressLayouts);
app.use(express.static(path.join(__dirname, "public")));
app.set("view engine", "ejs");
app.set("views", __dirname + "/views");
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type'],
    credentials: true,
}));

const session = require('express-session');

// Tambahkan setelah middleware bodyParser
app.use(session({
    secret: 'your-secret-key',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // Set `secure: true` jika menggunakan HTTPS
}));

const moment = require('moment');
const momentTimezone = require('moment-timezone');
app.use((req, res, next) => {
    res.locals.moment = moment;
    res.locals.momentTimezone = momentTimezone;
    next();
});

const folderSession = './.sessions';
app.use("/asset/sessions", express.static(folderSession));

// Inisialisasi manager
const deviceManager = new DeviceManager(pool);
const sessionManager = new SessionManager(pool, io, deviceManager, folderSession);
const messageManager = new MessageManager(pool);
const userManager = new UserManager(pool);
const autoreplyManager = new AutoReplyManager(pool);
const cronManager = new CronManager(pool);

// Routes
const indexAdminRoutes = require('./routes/admin/indexRoutes')({sessionManager, deviceManager});
const billingAdminRoutes= require('./routes/admin/billingRoutes')(sessionManager);
const deviceAdminRoutes = require('./routes/admin/deviceRoutes')({sessionManager, deviceManager});
const messageAdminRoutes= require('./routes/admin/messageRoutes')({sessionManager, messageManager, deviceManager});
const autoreplyAdminRoutes= require('./routes/admin/autoreplyRoutes')({sessionManager, autoreplyManager});
const dokumentasiAdminRoutes= require('./routes/admin/dokumentasiRoutes')(sessionManager);


const indexRoutes = require('./routes/indexRoutes')(sessionManager);
const botRoutes = require('./routes/botRoutes')({sessionManager, messageManager});
const authRoutes = require('./routes/authRoutes')({sessionManager, userManager});
const sessionRoutes = require('./routes/sessionRoutes')(sessionManager);
const messageRoutes = require('./routes/messageRoutes')({sessionManager, messageManager});
const groupRoutes = require('./routes/groupRoutes')(sessionManager);


app.use('/admin', indexAdminRoutes);
app.use('/admin/billing', billingAdminRoutes);
app.use('/admin/device', deviceAdminRoutes);
app.use('/admin/message', messageAdminRoutes);
app.use('/admin/autoreply', autoreplyAdminRoutes);
app.use('/admin/dokumentasi', dokumentasiAdminRoutes);

app.use('/', indexRoutes);
app.use('/bot', botRoutes);
app.use('/auth', authRoutes);
app.use('/session', sessionRoutes);
app.use('/message', messageRoutes);
app.use('/group', groupRoutes);


sessionManager.initSessions();
cronManager.initCrons();
const PORT = 3000;
server.listen(PORT, () => {
    console.log(`WhatsApp Gateway running on http://localhost:${PORT}`);
});
