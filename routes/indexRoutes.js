const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const router = express.Router();
const duitkuConfig = require('../config-duitku'); // Konfigurasi Duitku

module.exports = ({sessionManager,billingManager}) => {
    /**
     * Route untuk halaman utama.
     */
    router.get("/", async (req, res) => {  // Tambahkan async di sini
        const sessions = sessionManager.getAllSessions();
        let packages = [];  // Gunakan let karena akan diubah dalam try
    
        try {
            packages = await billingManager.getPackages();  // Tambahkan await
        } catch (error) {
            console.error("Error fetching packages:", error);
        }
    
        res.render("index", {
            sessions,
            packages,
            title: "Selamat Datang di w@pi",
            layout: "layouts/main"
        });
    });
    

    router.get('/check-pending-transaction', async (req, res) => {
        try {
            const { merchantOrderId } = req.query;
    
            if (!merchantOrderId) {
                return res.status(400).json({ success: false, message: 'merchantOrderId diperlukan.' });
            }
    
            const apiKey = req.session?.user?.api_key;
            if (!apiKey) {
                return res.status(401).json({ success: false, message: 'API key tidak ditemukan.' });
            }
    
            const pendingTransaction = await billingManager.getPendingTransactions(apiKey, merchantOrderId);
    
            return res.json({
                success: true,
                hasPending: !!pendingTransaction,
                reference: pendingTransaction?.reference || null,
                message: pendingTransaction ? 'Transaksi pending ditemukan.' : 'Tidak ada transaksi pending.',
            });
        } catch (error) {
            console.error('Error checking pending transaction:', error);
            res.status(500).json({ success: false, message: 'Terjadi kesalahan pada server.' });
        }
    });

    
    
    /**
     * Route untuk membuat invoice.
     */
    router.post('/create-invoice', async (req, res) => {
        try {
            // Ambil data pengguna dari sesi
            const uid = req.session.user.uid;
            const name = req.session.user.name;
            const email = req.session.user.email;
            const phone = req.session.user.phone;

            // Ambil konfigurasi Duitku
            const environment = duitkuConfig.environment;
            const merchantCode = duitkuConfig.merchantCode;
            const merchantKey = duitkuConfig.merchantKey;

            // Ambil data dari request body
            const { paymentAmount, paymentMethod, productDetail } = req.body;

            // Generate unique order ID dan timestamp
            const merchantOrderId = Date.now().toString();
            const timestamp = Date.now();

            // Hitung signature
            const signature = crypto.createHash('sha256')
                .update(`${merchantCode}${timestamp}${merchantKey}`)
                .digest('hex');

            // Request body untuk API Duitku
            const requestBody = {
                paymentAmount: parseInt(paymentAmount),
                merchantOrderId: merchantOrderId,
                productDetails: productDetail,
                paymentMethod: paymentMethod,
                email: email,
                phoneNumber: phone,
                customerVaName: name,
                callbackUrl: duitkuConfig.callbackUrl,
                returnUrl: duitkuConfig.returnUrl,
                expiryPeriod: 10,
            };

            // Headers untuk API Duitku
            const headers = {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'x-duitku-signature': signature,
                'x-duitku-timestamp': timestamp,
                'x-duitku-merchantcode': merchantCode,
            };

            // Kirim request ke API Duitku
            const response = await axios.post(
                `https://api-${environment}.duitku.com/api/merchant/createInvoice`,
                requestBody,
                { headers }
            );

            const { reference, paymentUrl, statusCode, statusMessage } = response.data;

            if (statusCode === '00') {
                // Simpan transaksi ke database
                const description = productDetail;
                const amount = parseFloat(paymentAmount);
                const status = 'pending';

                await billingManager.addTransaction(
                    req.session.user.api_key,
                    merchantOrderId,
                    reference,
                    description,
                    amount,
                    status
                );

                // Response ke frontend
                res.json({
                    success: true,
                    reference: reference
                });
            } else {
                throw new Error(statusMessage || 'Failed to create invoice');
            }
        } catch (error) {
            console.error('Error creating invoice:', error.response ? error.response.data : error.message);
            res.status(500).json({ success: false, message: error.message });
        }
    });

    router.get('/success', async (req, res) => {
        try {
            const { resultCode, merchantOrderId, reference } = req.query;
    
            if (!resultCode || !merchantOrderId || !reference) {
                return res.status(400).json({ success: false, message: 'Parameter tidak lengkap.' });
            }
    
            const status = resultCode === '00' ? 'success' : resultCode === '01' ? 'pending' : 'failed';
            await billingManager.updateTransactionStatus(
                merchantOrderId,
                status
            );
    
            return res.redirect(`/admin/billing`);
        } catch (error) {
            console.error('Error processing callback:', error.message);
            res.status(500).json({ success: false, message: error.message });
        }
    });
    
    router.post('/callback', async (req, res) => {
        console.log("Callback received:", req.body);
        try {
            const { merchantCode, amount, merchantOrderId, resultCode, reference, signature } = req.body;
            
            if (!resultCode || !merchantOrderId || !reference) {
                return res.status(400).json({ success: false, message: 'Parameter tidak lengkap.' });
            }
    
            const status = resultCode === '00' ? 'success' : resultCode === '01' ? 'pending' : 'failed';
    
            await billingManager.updateTransaction(
                merchantOrderId,
                `Top-Up via Duitku (${merchantOrderId})`,
                parseFloat(amount),
                status
            );
    
            res.status(200).json({ success: true, message: 'Callback processed successfully' });
        } catch (error) {
            console.error('Error processing callback:', error.message);
            res.status(500).json({ success: false, message: error.message });
        }
    });

    return router;
};