const axios = require('axios');
const crypto = require('crypto');
const { duitku } = require('duitku-nodejs');
const config = require('../config-duitku');


async function createDuitkuInvoice(userId, amount, paymentMethodCode) {
    const transaction = {
        paymentAmount: amount,
        paymentMethod: paymentMethodCode,
        merchantOrderId: `ORDER-${Date.now()}`,
        productDetails: 'Top-Up Saldo',
        email: 'user@example.com', // Ganti dengan email pengguna
        phoneNumber: '081234567890', // Ganti dengan nomor telepon pengguna
        additionalParam: userId, // Menyimpan ID pengguna untuk referensi
        merchantUserInfo: 'Informasi tambahan',
        customerVaName: 'Nama Pengguna',
        callbackUrl: config.callbackUrl,
        returnUrl: config.returnUrl,
        expiryPeriod: 1440
    };

    try {
        const response = await duitku.createInvoice(transaction, config);
        console.log('Response from Duitku:', response.data);
        const { merchantCode: respMerchantCode, reference, paymentUrl, statusCode, statusMessage } = response.data;

        if (statusCode === '00') {
            return {
                success: true,
                reference: reference,
                paymentUrl: paymentUrl,
            };
        } else {
            throw new Error(statusMessage || 'Failed to create invoice');
        }
    } catch (error) {
        console.error('Error creating Duitku invoice:', error.response ? error.response.data : error.message);
        throw error;
    }
}

module.exports = { createDuitkuInvoice };