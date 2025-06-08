process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
});

process.on("uncaughtExceptionMonitor", (error) => {
  console.error("[Critical Error]", error);
});

const path = require("path");
const { Boom } = require("@hapi/boom");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const express = require("express");
const bodyParser = require("body-parser");
const qrcode = require("qrcode");
const http = require("http");
const socketIO = require("socket.io");
const fs = require("fs");
const cors = require("cors");
const mysql = require("mysql2/promise");

require("dotenv").config();

const dbConfig = require("./config");
const pool = mysql.createPool(dbConfig);

const InitData = require("./lib/InitData.js");
const SessionManager = require("./lib/SessionsManager.js");
const BillingManager = require("./lib/BillingManager");
const CronManager = require("./lib/CronManager.js");
const CronGroupManager = require("./lib/CronGroupManager.js");
const MessageManager = require("./lib/MessageManager.js");
const DeviceManager = require("./lib/DeviceManager.js");
const AutoReplyManager = require("./lib/AutoReplyManager.js");
const UserManager = require("./lib/UserManager.js");
const { requireRole, redirectIfLoggedIn } = require("./lib/Utils.js");

const expressLayouts = require("express-ejs-layouts");

// Setup server dan IO
const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  /* config IO */
});

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(expressLayouts);
app.use(express.static(path.join(__dirname, "public")));
app.set("view engine", "ejs");
app.set("views", __dirname + "/views");
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type"],
    credentials: true,
  })
);

const session = require("express-session");

// Tambahkan setelah middleware bodyParser
app.use(
  session({
    secret: "your-secret-key",
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }, // Set `secure: true` jika menggunakan HTTPS
  })
);

const moment = require("moment");
const momentTimezone = require("moment-timezone");
app.use((req, res, next) => {
  res.locals.moment = moment;
  res.locals.momentTimezone = momentTimezone;
  next();
});

const folderSession = "./.sessions";
app.use("/asset/sessions", express.static(folderSession));

// Inisialisasi manager
const initData = new InitData(pool);

const deviceManager = new DeviceManager(pool);
const sessionManager = new SessionManager(
  pool,
  io,
  deviceManager,
  folderSession
);
const billingManager = new BillingManager(pool);
const messageManager = new MessageManager(pool, sessionManager);
const userManager = new UserManager(pool);
const autoreplyManager = new AutoReplyManager(pool);
const cronManager = new CronManager(pool, messageManager);
const cronGroupManager = new CronGroupManager(pool, sessionManager);

// Routes Admin
const indexAdminRoutes = require("./routes/admin/indexRoutes.js")();
app.use("/admin", requireRole("admin"), indexAdminRoutes);

// Routes Client
const indexClientRoutes = require("./routes/client/indexRoutes")({
  sessionManager,
  deviceManager,
  messageManager,
  billingManager,
});
const packageClientRoutes = require("./routes/client/packageRoutes")(
  billingManager
);
const billingClientRoutes = require("./routes/client/billingRoutes")(
  billingManager
);
const deviceClientRoutes = require("./routes/client/deviceRoutes")({
  sessionManager,
  deviceManager,
  billingManager,
});
const groupClientRoutes = require("./routes/client/groupRoutes")({
  sessionManager,
  deviceManager,
  billingManager,
});
const messageClientRoutes = require("./routes/client/messageRoutes")({
  sessionManager,
  messageManager,
  deviceManager,
});
const autoreplyClientRoutes = require("./routes/client/autoreplyRoutes")({
  sessionManager,
  autoreplyManager,
  deviceManager,
});
const bantuinClientRoutes = require("./routes/client/bantuinRoutes")(
  sessionManager
);
const dokumentasiClientRoutes = require("./routes/client/dokumentasiRoutes")(
  sessionManager
);

app.use("/client", requireRole("client"), indexClientRoutes);
app.use("/client/package", requireRole("client"), packageClientRoutes);
app.use("/client/billing", requireRole("client"), billingClientRoutes);
app.use("/client/device", requireRole("client"), deviceClientRoutes);
app.use("/client/group", requireRole("client"), groupClientRoutes);
app.use("/client/message", requireRole("client"), messageClientRoutes);
app.use("/client/autoreply", requireRole("client"), autoreplyClientRoutes);
app.use("/client/bantuin", requireRole("client"), bantuinClientRoutes);
app.use("/client/dokumentasi", requireRole("client"), dokumentasiClientRoutes);

// Routes Main
const indexRoutes = require("./routes/indexRoutes")({
  sessionManager,
  billingManager,
});
const v1Routes = require("./routes/v1Routes")({
  sessionManager,
  messageManager,
});
const authRoutes = require("./routes/authRoutes")({
  sessionManager,
  userManager,
});
const sessionRoutes = require("./routes/sessionRoutes")(sessionManager);
const messageRoutes = require("./routes/messageRoutes")({
  sessionManager,
  messageManager,
});
const groupRoutes = require("./routes/groupRoutes")(sessionManager);

app.use("/", indexRoutes);
app.use("/v1", v1Routes);
app.use("/bot", v1Routes); //backup lama
app.use("/auth", authRoutes);
app.use("/session", sessionRoutes);
app.use("/message", messageRoutes);
app.use("/group", groupRoutes);

initData.initDatabase();
sessionManager.initSessions();
cronManager.initCrons();
// cronGroupManager.initCrons();
const PORT = process.env.SERVERPORT;
server.listen(PORT, () => {
  console.log(`WhatsApp Gateway running on http://localhost:${PORT}`);
});
