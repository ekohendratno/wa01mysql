const path = require('path');
const fs = require('fs');
const qrcode = require('qrcode');
const { Boom } = require('@hapi/boom');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const pino = require("pino");
const mysql = require('mysql2/promise');
const dbConfig = require('../config');
const { generateAPIKey, generateDeviceID } = require('../lib/Generate');

class SessionManager {
    constructor(io, folderSession = '../.sessions') {
        this.io = io;
        this.folderSession = folderSession;
        this.sessions = {};

        if (!fs.existsSync(this.folderSession)) {
            fs.mkdirSync(this.folderSession, { recursive: true });
        }


        this.pool = mysql.createPool(dbConfig);
        this.initDatabase();
    }


    async initDatabase() {
        try {
            const connection = await this.pool.getConnection();
            connection.release();
        } catch (error) {
            console.error('Gagal inisialisasi database:', error);
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


                const statusMap = {
                    'open': 'connected',
                    'close': 'disconnected',
                    'connecting': 'connecting'
                };

                if (statusMap[connection]) {
                    try {
                        await this.updateDeviceStatus(key, statusMap[connection]);
                    } catch (error) {
                        console.error('Failed to update device status:', error);
                    }
                }

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

    async registerUser(name, username, password) {
        const connection = await this.pool.getConnection();
        try {
            const apiKey = generateAPIKey();
            const [result] = await connection.query(
                'INSERT INTO users (name, username, password, api_key) VALUES (?,?,?,?)',
                [name, username, password, apiKey]
            );

            return {
                uid: result.insertId,
                api_key: apiKey
            };
        } catch (error) {
            console.error('Registration error:', error);
            throw error;
        } finally {
            connection.release();
        }
    }


    async registerDevice(apiKey, deviceName, phone) {
        const connection = await this.pool.getConnection();
        try {
            const [user] = await connection.query(
                'SELECT uid FROM users WHERE api_key = ?',
                [apiKey]
            );

            if (!user[0]) throw new Error('Invalid API key');

            const device_key = generateDeviceID();
            const [result] = await connection.query(
                'INSERT INTO devices (uid, name, phone, device_key) VALUES (?, ?, ?, ?)',
                [user[0].uid, deviceName, phone, device_key]
            );

            return {
                id: result.insertId,
                device_key: device_key,
                name: result.name
            };
        } catch (error) {
            console.error('Registration error:', error);
            throw error;
        } finally {
            connection.release();
        }
    }

    async removeDevice(apiKey, deviceKey) {
        const connection = await this.pool.getConnection();
        try {
            const [user] = await connection.query(
                'SELECT uid FROM users WHERE api_key = ?',
                [apiKey]
            );

            if (!user[0]) throw new Boom('Invalid API key', { statusCode: 401 });

            const [result] = await connection.query(
                'DELETE FROM devices WHERE uid = ? AND device_key = ?',
                [user[0].uid, deviceKey]
            );

            if (result.affectedRows === 0) {
                throw new Boom('Device not found', { statusCode: 404 });
            }

            return { status: true };
        } catch (error) {
            console.error('Error removing device:', error);
            throw error.isBoom ? error : new Boom('Database error', { statusCode: 500 });
        } finally {
            connection.release();
        }
    }

    async updateDeviceStatus(deviceKey, status) {
        const connection = await this.pool.getConnection();
        try {
            await connection.query(
                'UPDATE devices SET status = ?, updated_at = NOW() WHERE device_key = ?',
                [status, deviceKey]
            );
        } catch (error) {
            console.error('Error updating device status:', error);
        } finally {
            connection.release();
        }
    }

    async getDevices(apiKey) {
        const connection = await this.pool.getConnection();
        try {
            const [users] = await connection.query(
                'SELECT uid FROM users WHERE api_key = ? LIMIT 1',
                [apiKey]
            );

            if (users.length === 0) {
                throw new Boom('Invalid API key', { statusCode: 401 });
            }

            const uid = users[0].uid;
            const [devices] = await connection.query(
                'SELECT id, name, phone, device_key, status, created_at ' +
                'FROM devices WHERE uid = ?',
                [uid]
            );

            return devices;
        } catch (error) {
            console.error('Error retrieving devices:', error);
            throw error.isBoom ? error : new Boom('Database error', { statusCode: 500 });
        } finally {
            connection.release();
        }
    }



    async loginUser(username, password) {
        const connection = await this.pool.getConnection();
        try {
            const [users] = await connection.query(
                'SELECT uid, name, api_key FROM users WHERE username = ? AND password = ? LIMIT 1',
                [username, password]
            );
    
            if (users.length === 0) {
                throw new Boom('Username atau password salah', { statusCode: 401 });
            }
    
            return users[0];
        } catch (error) {
            console.error('Login error:', error);
            throw error.isBoom ? error : new Boom('Login gagal', { statusCode: 500 });
        } finally {
            connection.release();
        }
    }

}

module.exports = SessionManager;