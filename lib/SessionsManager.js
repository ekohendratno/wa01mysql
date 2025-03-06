const path = require('path');
const fs = require('fs');
const qrcode = require('qrcode');
const { Boom } = require('@hapi/boom');
const { Browsers, default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const pino = require("pino");

const crypto = require('crypto');
const axios = require('axios');

const moment = require('moment-timezone');
const { generateAPIKey, generateDeviceID } = require('../lib/Generate');
const { calculateLastActive } = require('../lib/Utils');
const { DeviceManager } = require('../lib/DeviceManager');

class SessionManager {
    constructor(pool, io, deviceManager, folderSession = '../.sessions') {
        this.pool = pool;
        this.io = io;
        this.folderSession = folderSession;
        this.sessions = {};

        if (!fs.existsSync(this.folderSession)) {
            fs.mkdirSync(this.folderSession, { recursive: true });
        }

        this.deviceManager = deviceManager;
    }



    async initSessions() {
        console.log("Initializing sessions...");
        const sessionKeys = fs.readdirSync(this.folderSession).filter(file => {
            return fs.statSync(path.join(this.folderSession, file)).isDirectory();
        });

        await Promise.all(sessionKeys.map(async (key) => {
            const sessionPath = path.join(this.folderSession, key);
            try {
                await fs.promises.access(path.join(sessionPath, 'creds.json'));
                await this.createSession(key);
            } catch (error) {
                if (error) {
                    console.log(`Removing corrupt session: ${key}`);
                    fs.rm(sessionPath, { recursive: true, force: true }, (rmError) => {
                        if (rmError) {
                            console.log(`Failed to remove corrupt session: ${key}`);
                        } else {
                            console.log(`Successfully removed corrupt session: ${key}`);
                        }
                    });
                } else {
                    console.log(`Unknown error session: ${key} => ${error}`);
                }

            }
        }));
        console.log("All sessions initialized!");
    }


    async createSession(key) {
        let session;
        try {
            const sessionPath = path.join(this.folderSession, key);
    
            // Pastikan folder utama ada sebelum membuat subfolder
            if (!fs.existsSync(this.folderSession)) {
                fs.mkdirSync(this.folderSession, { recursive: true });
            }
    
            // Pastikan subfolder session ada
            if (!fs.existsSync(sessionPath)) {
                fs.mkdirSync(sessionPath, { recursive: true });
            }
    
            if (!this.sessions[key]) {
                this.sessions[key] = {
                    socket: null,
                    qr: null,
                    connected: false,
                };
            }
    
            session = this.sessions[key];
            if (session.socket && typeof session.socket.close === 'function') {
                session.socket.close();
            }
    
            const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
            const socket = makeWASocket({
                auth: state,
                printQRInTerminal: false,
                logger: pino({ level: "silent" }),
                browser: Browsers.ubuntu("Chrome"),
                markOnlineOnConnect: true,
                syncFullHistory: false,
                fireInitQueries: true,
                keepAliveIntervalMs: 20000,
                connectTimeoutMs: 30000,
                defaultQueryTimeoutMs: 60000,
                getMessage: async () => ({}),
            });
    
            session.socket = socket;
    
            socket.ev.on("creds.update", saveCreds);
    
            socket.ev.on("connection.update", async (update) => {
                const { connection, qr, lastDisconnect } = update;
    
                const statusMap = {
                    open: "connected",
                    close: "disconnected",
                    connecting: "connecting",
                };
    
                if (statusMap[connection]) {
                    try {
                        const userJid = socket.user.id;
                        const pushName = socket.user.name || "Unknown";
                        const phoneText = userJid.split('@')[0];
                        const phoneNumber = phoneText.split(':')[0];


                        await this.deviceManager.updateDeviceStatus(key, statusMap[connection], phoneNumber, pushName);
                    } catch (error) {
                        console.error(`Failed to update device status for ${key}:`, error.message);
                    }
                }
    
                if (qr) {
                    console.log(`QR Code received for ${key}`);
                    const now = Date.now();
    
                    if (now - (session.lastQRUpdate || 0) < 30000) {
                        console.log(`Skipping QR update for ${key} (too frequent)`);
                        return;
                    }
    
                    session.lastQRUpdate = now;
    
                    qrcode.toFile(path.join(sessionPath, 'qr.png'), qr, (err) => {
                        if (err) {
                            console.error(`QR Generate Error for ${key}:`, err.message);
                            return;
                        }
    
                        const timestamp = Date.now();
                        const qrUrl = `/asset/sessions/${key}/qr.png?t=${timestamp}`;
                        session.qr = qrUrl;
                        this.io.emit("qr-update", { key, qr: qrUrl });
                    });
                }
    
                if (connection === "open") {
                    console.log(`Connected: ${key}`);
                    session.connected = true;
                    session.qr = null;
                    this.io.emit("connection-status", { key, connected: true });

                    // socket.ev.on('messages.upsert', async (m) => {
                    //     if (m.type === 'notify') {
                    //         for (const msg of m.messages) {
                    //             if (msg.body === '/register') {
                    //                 console.log(`Pesan /register ditemukan di grup: ${msg.key.remoteJid}`);
                    //                 // Proses grup sesuai kebutuhan
                    //             }
                    //         }
                    //     }
                    // });

                    // socket.ev.on("messages.upsert", async ({ messages }) => {
                    //     for (const msg of messages) {
                    //         if (msg.key.remoteJid.endsWith("@g.us")) {
                    //             const groupId = msg.key.remoteJid.replace("@g.us", "");
                    //             const sender = msg.pushName || "Unknown";
                    //             const content = msg.message?.conversation || "Non-text message";
                    
                    //             console.log(`🔔 [GROUP: ${groupId}] ${sender}: ${content}`);
                    //         }
                    //     }
                    // });

                    
                    // socket.ev.on("messaging-history.set", async ({ chats }) => {
                    //     try {
                    //         const groupChats = chats.filter(chat => chat.id.server === "g.us");
                    //         console.log("Group chats:", groupChats);
                    
                    //         for (const group of groupChats) {
                    //             try {
                    //                 const messages = await socket.fetchMessagesFromWA(group.id, { limit: 50 });
                    //                 const hasRegisterMessage = messages.some(msg => msg.body === "/register");
                    
                    //                 if (hasRegisterMessage) {
                    //                     const cleanGroupId = group.id._serialized.replace("@g.us", "");
                    //                     const groupName = group.name || "Unknown Group";
                    
                    //                     console.log("Group ID:", cleanGroupId);
                    //                     console.log("Group Name:", groupName);
                    
                    //                 }
                    //             } catch (error) {
                    //                 console.error(`Error processing group ${group.id._serialized}:`, error.message);
                    //             }
                    //         }
                    //     } catch (error) {
                    //         console.error("Error in messaging-history.set event:", error.message);
                    //     }
                    // });
                }
    
                if (connection === "close") {
                    session.connected = false;
                    this.io.emit("connection-status", { key, connected: false });
    
                    if (lastDisconnect?.error) {
                        const error = lastDisconnect.error;
                        const isLoggedOut = error.output?.statusCode === DisconnectReason.loggedOut;
    
                        if (isLoggedOut) {
                            console.log(`Session logged out: ${key}`);
                            this.removeSession(key, true);
                        } else {
                            console.log(`Reconnecting: ${key}`);
                            if (!session.reconnecting) {
                                session.reconnecting = true;
                                setTimeout(() => {
                                    this.createSession(key)
                                        .finally(() => session.reconnecting = false);
                                }, 5000);
                            }
                        }
                    }
                }
            });
    
            socket.ev.on("ws.connection", (update) => {
                if (update.error) {
                    console.error(`WS Error (${key}):`, update.error.message);
                }
            });
        } catch (error) {
            console.error(`Session Error (${key}):`, error.message);
    
            if (this.sessions[key]) {
                this.removeSession(key, true);
    
                try {
                    await this.deviceManager.updateDeviceStatus(key, 'removed');
                } catch (updateError) {
                    console.error(`Failed to update device status for ${key}:`, updateError.message);
                }
            } else {
                try {
                    await this.deviceManager.updateDeviceStatus(key, 'error');
                } catch (updateError) {
                    console.error(`Failed to update device status for ${key}:`, updateError.message);
                }
            }
        }
    }

    removeSession(key, deleteFolder = false) {
        const session = this.sessions[key];
        if (!session) return;
        if (session.socket && typeof session.socket.ws.close === 'function') {
            session.socket.ws.close();
        }
        delete this.sessions[key];
        if (deleteFolder) {
            const sessionPath = path.join(this.folderSession, key);
            if (fs.existsSync(sessionPath)) {
                console.log(`Attempting to remove session folder: ${sessionPath}`);
                try {
                    fs.rmSync(sessionPath, { recursive: true, force: true });
                    console.log(`Successfully removed session folder: ${sessionPath}`);
                } catch (rmError) {
                    console.log(`Failed to remove session folder: ${sessionPath}`);
                }
            }
        }
    }

    getSession(key) {
        return this.sessions[key];
    }

    getAllSessions() {
        return this.sessions;
    }




}

module.exports = SessionManager;