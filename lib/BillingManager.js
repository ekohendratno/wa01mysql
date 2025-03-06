const mysql = require('mysql2/promise');

class BillingManager {
    constructor(pool) {
        this.pool = pool;
    }

    
    async addTransaction(apiKey, merchantOrderId, reference, description, amount, status) {
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
                'INSERT INTO transactions (uid, merchantOrderId, reference, description, amount, status, whatIs) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [userId, merchantOrderId, reference, description, parseFloat(amount), status, '+']
            );

            console.log(`Transaksi baru ditambahkan: ${merchantOrderId}, Status: ${status}`);

            // Commit transaksi
            await connection.commit();

            return { success: true, message: 'Transaksi berhasil ditambahkan.' };
        } catch (error) {
            await connection.rollback();
            console.error('Error adding transaction:', error.message);
            throw error;
        } finally {
            connection.release();
        }
    }

    
    async getTransactions(apiKey, status = 'all') {
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
    
            // Query dasar untuk mengambil transaksi
            let query = `
                SELECT merchantOrderId, reference, description, amount, status, whatIs, created_at 
                FROM transactions 
                WHERE uid = ?
            `;
    
            // Tambahkan filter status jika status bukan 'all'
            if (status && status !== 'all') {
                query += ` AND status = ?`;
            }
    
            // Urutkan berdasarkan waktu terbaru
            query += ` ORDER BY created_at DESC`;
    
            // Eksekusi query
            const queryParams = status && status !== 'all' ? [userId, status] : [userId];
            const [transactions] = await connection.query(query, queryParams);
    
            // Format tanggal dan jumlah uang
            const formattedTransactions = transactions.map(tx => ({
                ...tx,
                formattedDate: new Date(tx.created_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }),
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
            console.error('Error retrieving transactions:', error.message);
            throw error;
        } finally {
            connection.release();
        }
    }
    
    async updateTransactionStatus(merchantOrderId, status) {
        const connection = await this.pool.getConnection();
        try {
            await connection.beginTransaction();

            // Periksa apakah transaksi dengan merchantOrderId ada
            const [existingTransactions] = await connection.query(
                'SELECT uid, amount, status FROM transactions WHERE merchantOrderId = ? LIMIT 1',
                [merchantOrderId]
            );
            if (existingTransactions.length === 0) {
                throw new Error('Transaksi tidak ditemukan');
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
            console.error('Error updating transaction status:', error.message);
            throw error;
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

            // Cek transaksi pending yang dibuat dalam 1 jam terakhir
            const [transactions] = await connection.query(
                `SELECT merchantOrderId, reference 
                     FROM transactions 
                     WHERE uid = ? 
                     AND merchantOrderId = ? 
                     AND status = ? 
                     AND created_at >= NOW() - INTERVAL 24 HOUR 
                     LIMIT 1`,
                [userId, merchantOrderId, 'pending']
            );

            return transactions.length > 0 ? transactions[0] : null;
        } catch (error) {
            console.log('Error retrieving pending transaction:', error);
            throw error;
        } finally {
            if (connection) connection.release();
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

}

module.exports = BillingManager;