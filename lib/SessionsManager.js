const path = require('path');
const fs = require('fs');
const qrcode = require('qrcode');
const { Boom } = require('@hapi/boom');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
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
                    connected: false
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
                browser: ["Ubuntu", "Chrome", "119.0.0.1"],
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
                if (!this.sessions[key]) return;
                const { connection, qr, lastDisconnect } = update;
                const session = this.sessions[key];
                const statusMap = {
                    'open': 'connected',
                    'close': 'disconnected',
                    'connecting': 'connecting'
                };
                if (statusMap[connection]) {
                    try {
                        await this.deviceManager.updateDeviceStatus(key, statusMap[connection]);
                    } catch (error) {
                        console.log('Failed to update device status:');
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
                        if (err) return console.log("QR Generate Error:");
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
                    console.log(`WS Error (${key}):`);

                }
            });
        } catch (error) {
            console.log(`Session Error (${key}):`);
            if (this.sessions[key]) {
                this.removeSession(key, true);
                
                try {
                    await this.deviceManager.updateDeviceStatus(key, 'removed');
                } catch (error) {
                    console.log('Failed to update device status:');
                }
            }else{               
                    
                try {
                    await this.deviceManager.updateDeviceStatus(key, 'error');
                } catch (error) {
                    console.log('Failed to update device status:');
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


    async addTransaction(apiKey, merchantOrderId, paymentUrl, description, amount, status) {
        const connection = await this.pool.getConnection();
        try {
            // Validasi API key
            const [users] = await connection.query(
                'SELECT uid FROM users WHERE api_key = ? LIMIT 1',
                [apiKey]
            );
            if (users.length === 0) {
                throw new Error('Invalid API key');
            }
            const userId = users[0].uid;

            // Mulai transaksi database
            await connection.beginTransaction();

            // Cek apakah transaksi dengan merchantOrderId sudah ada
            const [existingTransactions] = await connection.query(
                'SELECT id FROM transactions WHERE merchantOrderId = ? LIMIT 1',
                [merchantOrderId]
            );
            if (existingTransactions.length > 0) {
                throw new Error('Transaksi dengan Merchant Order ID ini sudah ada.');
            }

            // Cek apakah saldo pengguna sudah ada
            const [existingBalance] = await connection.query(
                'SELECT uid FROM balances WHERE uid = ? LIMIT 1',
                [userId]
            );

            // Jika saldo belum ada, insert dengan nilai default balance = 0, total_used = 0
            if (existingBalance.length === 0) {
                await connection.query(
                    'INSERT INTO balances (uid, balance, total_used) VALUES (?, 0, 0)',
                    [userId]
                );
                console.log(`Saldo baru ditambahkan untuk UID: ${userId}`);
            }

            // Tambahkan transaksi baru tanpa mengupdate saldo
            await connection.query(
                'INSERT INTO transactions (uid, merchantOrderId, paymentUrl, description, amount, status, whatIs) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [userId, merchantOrderId, paymentUrl, description, parseFloat(amount), status, '+']
            );

            console.log(`Transaksi baru ditambahkan: ${merchantOrderId}, Status: ${status}`);

            // Commit transaksi
            await connection.commit();

            return { success: true, message: 'Transaksi berhasil ditambahkan.' };
        } catch (error) {
            await connection.rollback();
            console.log('Error adding transaction:');
            throw error;
        } finally {
            connection.release();
        }
    }



    async updateTransaction(merchantOrderId, description, amount, status) {
        const connection = await this.pool.getConnection();
        try {
            // Mulai transaksi database
            await connection.beginTransaction();

            // Periksa apakah transaksi dengan merchantOrderId ada
            const [existingTransactions] = await connection.query(
                'SELECT uid, amount, status FROM transactions WHERE merchantOrderId = ? LIMIT 1',
                [merchantOrderId]
            );
            if (existingTransactions.length === 0) {
                throw new Error('Transaksi tidak ditemukan');
            }

            const userId = existingTransactions[0].uid;
            const previousAmount = parseFloat(existingTransactions[0].amount);
            const previousStatus = existingTransactions[0].status;

            // Update transaksi
            await connection.query(
                'UPDATE transactions SET description = ?, amount = ?, status = ?, whatIs = ? WHERE merchantOrderId = ?',
                [description, amount, status, '+', merchantOrderId]
            );

            // Jika status transaksi sebelumnya bukan 'success' tetapi sekarang menjadi 'success'
            if (status === 'success' && previousStatus !== 'success') {
                await connection.query(
                    'UPDATE balances SET balance = balance + ? WHERE uid = ?',
                    [amount, userId]
                );
                console.log(`Saldo berhasil diperbarui untuk UID: ${userId}, +${amount}`);
            }

            // Commit transaksi
            await connection.commit();
            return { success: true, message: 'Transaksi berhasil diperbarui.' };
        } catch (error) {
            await connection.rollback();
            console.log('Error updating transaction:');
            throw error;
        } finally {
            connection.release();
        }
    }


    async updateTransactionStatus(merchantOrderId, status) {
        const connection = await this.pool.getConnection();
        if (!connection) {
            throw new Error('Gagal mendapatkan koneksi ke database.');
        }

        try {
            await connection.beginTransaction();

            const [existingTransactions] = await connection.query(
                'SELECT uid, amount, status FROM transactions WHERE merchantOrderId = ? LIMIT 1',
                [merchantOrderId]
            );

            if (existingTransactions.length === 0) {
                throw new Error(`Transaksi dengan ID ${merchantOrderId} tidak ditemukan.`);
            }

            const { uid: userId, amount, status: previousStatus } = existingTransactions[0];
            const previousAmount = parseFloat(amount);

            // Update status transaksi
            await connection.query(
                'UPDATE transactions SET status = ? WHERE merchantOrderId = ?',
                [status, merchantOrderId]
            );

            // Jika transaksi sukses dan sebelumnya belum sukses, tambahkan saldo
            if (status === 'success' && previousStatus !== 'success') {
                await connection.query(
                    'UPDATE balances SET balance = balance + ? WHERE uid = ?',
                    [previousAmount, userId]
                );

                console.log(`Saldo diperbarui: UID ${userId}, +${previousAmount}`);
            }

            await connection.commit();
            return { success: true, message: 'Transaksi berhasil diperbarui.' };

        } catch (error) {
            await connection.rollback();
            console.log('Error updating transaction:');
            return { success: false, message: 'Gagal memperbarui transaksi.', error: error.message };
        } finally {
            connection.release();
        }
    }



    async getTransactions(apiKey) {
        const connection = await this.pool.getConnection();
        try {
            // Validasi API key
            const [users] = await connection.query(
                'SELECT uid FROM users WHERE api_key = ? LIMIT 1',
                [apiKey]
            );
            if (users.length === 0) {
                throw new Boom('Invalid API key', { statusCode: 401 });
            }
            const userId = users[0].uid;

            // Ambil riwayat transaksi
            const [transactions] = await connection.query(
                'SELECT merchantOrderId, paymentUrl, description, amount, status, whatIs, created_at FROM transactions WHERE uid = ? ORDER BY created_at DESC',
                [userId]
            );

            // Format tanggal menggunakan moment
            const formattedTransactions = transactions.map(tx => ({
                ...tx,
                formattedDate: moment(tx.created_at).tz('Asia/Jakarta').format('DD MMM YYYY'),
                amountFormatted: parseFloat(tx.amount) >= 0
                    ? `+ Rp ${parseFloat(tx.amount).toFixed(2)}`
                    : `- Rp ${Math.abs(parseFloat(tx.amount)).toFixed(2)}`
            }));
            // Ambil saldo pengguna
            const [balances] = await connection.query(
                'SELECT balance, total_used FROM balances WHERE uid = ?',
                [userId]
            );

            const balanceInfo = balances[0] || { balance: 0, total_used: 0 };
            return {
                transactions: formattedTransactions,
                balance: parseFloat(balanceInfo.balance) || 0,
                totalUsed: parseFloat(balanceInfo.total_used) || 0
            };

        } catch (error) {
            console.log('Error retrieving transactions:');
            throw error.isBoom ? error : new Boom('Database error', { statusCode: 500 });
        } finally {
            connection.release();
        }
    }

    async getPendingTransactions(apiKey, merchantOrderId) {
        let connection;
        try {
            connection = await this.pool.getConnection();

            // Ambil UID berdasarkan API key
            const [user] = await connection.query(
                'SELECT uid FROM users WHERE api_key = ? LIMIT 1',
                [apiKey]
            );

            if (user.length === 0) {
                throw new Error('Invalid API key');
            }

            const userId = user[0].uid;

            // Cek transaksi pending
            const [transactions] = await connection.query(
                'SELECT merchantOrderId, paymentUrl FROM transactions WHERE uid = ? AND merchantOrderId = ? AND status = ? LIMIT 1',
                [userId, merchantOrderId, 'pending']
            );

            return transactions.length > 0 ? transactions[0] : null;
        } catch (error) {
            console.log('Error retrieving pending transaction:');
            throw error;
        } finally {
            if (connection) connection.release();
        }
    }


    async getPackages() {
        const connection = await this.pool.getConnection();
        try {
            const [packages] = await connection.query(
                'SELECT * FROM packages'
            );
            return packages || [];
        } catch (error) {
            console.log('Error retrieving packages:');
            throw new Error('Gagal mengambil daftar paket');
        } finally {
            connection.release();
        }
    }



    // Fungsi untuk mendapatkan ringkasan saldo
    async getBalanceSummary(apiKey) {
        const connection = await this.pool.getConnection();
        try {
            // Validasi API key
            const [users] = await connection.query(
                'SELECT uid FROM users WHERE api_key = ? LIMIT 1',
                [apiKey]
            );
            if (users.length === 0) {
                throw new Boom('Invalid API key', { statusCode: 401 });
            }
            const userId = users[0].uid;

            // Ambil saldo pengguna
            const [balances] = await connection.query(
                'SELECT balance, total_used FROM balances WHERE uid = ?',
                [userId]
            );
            const balanceInfo = balances[0] || { balance: 0, total_used: 0 };

            return {
                balance: parseFloat(balanceInfo.balance),
                totalUsed: parseFloat(balanceInfo.total_used),
            };
        } catch (error) {
            console.log('Error retrieving balance summary:');
            throw error.isBoom ? error : new Boom('Database error', { statusCode: 500 });
        } finally {
            connection.release();
        }
    }

    // Fungsi untuk mendapatkan jumlah pesan berdasarkan status
    async getMessageCounts(apiKey) {
        const connection = await this.pool.getConnection();
        try {
            // Validasi API key
            const [users] = await connection.query(
                'SELECT uid FROM users WHERE api_key = ? LIMIT 1',
                [apiKey]
            );
            if (users.length === 0) {
                throw new Boom('Invalid API key', { statusCode: 401 });
            }
            const userId = users[0].uid;

            // Hitung jumlah pesan berdasarkan status
            const [messageCounts] = await connection.query(
                'SELECT status, COUNT(*) AS count FROM messages WHERE uid = ? GROUP BY status',
                [userId]
            );

            // Format hasil menjadi objek dengan kunci status
            const counts = {};
            messageCounts.forEach(row => {
                counts[row.status] = row.count;
            });

            // Tambahkan default value untuk status yang mungkin tidak ada
            const defaultStatuses = ['sent', 'pending', 'failed', 'processing'];
            defaultStatuses.forEach(status => {
                counts[status] = counts[status] || 0;
            });

            return counts;
        } catch (error) {
            console.log('Error retrieving message counts:');
            throw error.isBoom ? error : new Boom('Database error', { statusCode: 500 });
        } finally {
            connection.release();
        }
    }


}

module.exports = SessionManager;