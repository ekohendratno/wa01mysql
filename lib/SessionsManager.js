const path = require('path');
const fs = require('fs');
const qrcode = require('qrcode');
const { Boom } = require('@hapi/boom');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const pino = require("pino");

class SessionManager {
    constructor(io, folderSession = '../.sessions') {
        this.io = io;
        this.folderSession = folderSession;
        this.sessions = {};
        
        if (!fs.existsSync(this.folderSession)) {
            fs.mkdirSync(this.folderSession, { recursive: true });
        }
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
                console.log(`Removing corrupt session: ${key}`);
                fs.rmSync(sessionPath, { recursive: true, force: true });
            }
        }));
        console.log("All sessions initialized!");
    }


    async createSession(key) {
        let session;
        try {
            const sessionPath = path.join(this.folderSession, key);
            
            // 1. Pastikan folder session
            if (!fs.existsSync(sessionPath)) {
                fs.mkdirSync(sessionPath, { recursive: true });
            }
    
            // 2. Inisialisasi session object JIKA BELUM ADA
            if (!this.sessions[key]) {
                this.sessions[key] = { 
                    socket: null, 
                    qr: null, 
                    connected: false 
                };
            }
            session = this.sessions[key]; // Ambil reference
    
            // 3. Hentikan socket lama jika ada
            if (session.socket && typeof session.socket.close === 'function') {
                session.socket.close();
            }
    
            // 4. Buat socket dan langsung assign ke session
            const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
            const socket = makeWASocket({
                auth: state,
                printQRInTerminal: false,
                logger: pino({ level: "silent" }),
                browser: ["Ubuntu", "Chrome", "119.0.0.1"],
                markOnlineOnConnect: true,
                syncFullHistory: false,
                fireInitQueries: true,
                keepAliveIntervalMs: 20000,
                connectTimeoutMs: 30000,
                defaultQueryTimeoutMs: 60000,
                getMessage: async () => ({}),
            });

            session.socket = socket; // 💡 Assign socket SEBELUM setup event listeners
    
            // 5. Setup event listeners
            socket.ev.on("creds.update", saveCreds);
    
            socket.ev.on("connection.update", async (update) => {
                if (!this.sessions[key]) return; // 🛡️ Cek session masih ada
                
                const { connection, qr, lastDisconnect } = update;
                const session = this.sessions[key];
    
                if (qr) {
                    console.log(`QR Code received for ${key}`);
                    
                    // 🔒 Throttle QR updates setiap 15 detik
                    const now = Date.now();
                    if (now - (session.lastQRUpdate || 0) < 30000) {
                        console.log(`Skipping QR update for ${key} (too frequent)`);
                        return;
                    }
                    session.lastQRUpdate = now; // Update timestamp
    
                    qrcode.toFile(path.join(sessionPath, 'qr.png'), qr, (err) => {
                        if (err) return console.error("QR Generate Error:", err);
                        
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
                } else if (connection === "close") {
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
                            // 🛡️ Cegah multiple reconnection
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
                    console.error(`WS Error (${key}):`, update.error);
                }
            });
    
        } catch (error) {
            console.error(`Session Error (${key}):`, error);
            // 🛡️ Hanya hapus jika session masih ada
            if (this.sessions[key]) {
                this.removeSession(key);
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
                fs.rmSync(sessionPath, { recursive: true, force: true });
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