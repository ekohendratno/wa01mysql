const express = require('express');
const mysql = require('mysql2');
const cron = require('node-cron');
const axios = require('axios');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// const connection = mysql.createConnection({
//   host: 'jasaedukasi.com',
//   user: 'jasaeduk_www',
//   password: 'www@19881023',
//   database: 'jasaeduk_wa',
//   port: 3306
// });

const connection = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'jasaeduk_wa',
    port: 3306
});

connection.connect((err) => {
    if (err) {
        console.error('Error connecting: ' + err.stack);
        return;
    }
    console.log('Connected as id ' + connection.threadId);
});

const fetchActiveSessions = async (limit, offset) => {
    const sql = `
      SELECT session 
      FROM users 
      WHERE active = 1 
      LIMIT ? OFFSET ?`;
    const [rows] = await connection.promise().query(sql, [limit, offset]);
    return rows.map((row) => row.session);
};

const processMessages = async (session, role) => {
    if (!session || !role) return;

    const limit = 50;
    const group = role === 'group' ? 1 : 0;
    const todayDate = new Date().toISOString().split('T')[0];

    try {
        const lockSql = `
        UPDATE messages 
        SET status = 'processing' 
        WHERE status = 'pending' 
          AND isGroup = ? 
          AND role = ? 
          AND session = ? 
          AND DATE(created_at) = ? 
        ORDER BY created_at ASC 
        LIMIT ?`;

        const [lockResult] = await connection.promise().query(lockSql, [group, role, session, todayDate, limit]);
        if (lockResult.affectedRows === 0) return;

        const selectSql = `
        SELECT * 
        FROM messages 
        WHERE status = 'processing' 
          AND isGroup = ? 
          AND role = ? 
          AND session = ? 
          AND DATE(created_at) = ? 
        ORDER BY created_at ASC`;

        const [rows] = await connection.promise().query(selectSql, [group, role, session, todayDate]);
        if (rows.length === 0) return;

        let errorCount = 0;
        let successCount = 0;

        for (const row of rows) {
            const { id, isGroup, recipient: to, message: text } = row;

            try {
                const response = await sendMessage(session, isGroup, to, text);

                let status = 'pending';
                if (response.code === 200 && response.response.status) {
                    status = response.response.status ? 'sent' : 'failed';
                }

                const updateSql = `
                UPDATE messages 
                SET status = ?, response = ? 
                WHERE id = ? AND session = ?`;

                await connection.promise().query(updateSql, [status, JSON.stringify(response), id, session]);

                status === 'sent' ? successCount++ : errorCount++;
            } catch (err) {
                errorCount++;
            }

            await new Promise((resolve) => setTimeout(resolve, 1000)); // Delay to avoid flooding
        }

        console.log(`Session: ${session}, Role: ${role}, Success: ${successCount}, Errors: ${errorCount}`);
    } catch (err) {
        console.error(`Error processing session ${session}, role ${role}:`, err.message);
    }
};

const sendMessage = async (session, isGroup, to, text) => {
    const url = 'http://localhost:3000/message';

    const data = {
        to: to,
        text: text,
        key: session,
        group: isGroup > 0
    };

    try {
        const response = await axios.post(url, data, {
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        });

        return {
            code: response.status,
            response: response.data
        };
    } catch (error) {
        return {
            code: error.response?.status || 500,
            response: error.response?.data || error.message
        };
    }
};

// Cron for Group Messages
cron.schedule('*/1 * * * *', async () => {
    console.log('Running group message processing cron...');

    const limitSessions = 10; // Number of sessions to process per batch
    let offset = 0;

    while (true) {
        const sessions = await fetchActiveSessions(limitSessions, offset);
        if (sessions.length === 0) break;

        const sessionPromises = sessions.map((session) =>
            processMessages(session, 'group')
        );

        await Promise.all(sessionPromises);

        offset += limitSessions;
        await new Promise((resolve) => setTimeout(resolve, 5000)); // Small delay between batches
    }
});

// Cron for Guru Messages
cron.schedule('*/1 * * * *', async () => {
    console.log('Running guru message processing cron...');

    const limitSessions = 10; // Number of sessions to process per batch
    let offset = 0;

    while (true) {
        const sessions = await fetchActiveSessions(limitSessions, offset);
        if (sessions.length === 0) break;

        const sessionPromises = sessions.map((session) =>
            processMessages(session, 'guru')
        );

        await Promise.all(sessionPromises);

        offset += limitSessions;
        await new Promise((resolve) => setTimeout(resolve, 5000)); // Small delay between batches
    }
});

// Cron for Murid Messages
cron.schedule('*/1 * * * *', async () => {
    console.log('Running murid message processing cron...');

    const limitSessions = 10; // Number of sessions to process per batch
    let offset = 0;

    while (true) {
        const sessions = await fetchActiveSessions(limitSessions, offset);
        if (sessions.length === 0) break;

        const sessionPromises = sessions.map((session) =>
            processMessages(session, 'siswa')
        );

        await Promise.all(sessionPromises);

        offset += limitSessions;
        await new Promise((resolve) => setTimeout(resolve, 5000)); // Small delay between batches
    }
});

// Cron for Wali Messages
cron.schedule('*/1 * * * *', async () => {
    console.log('Running wali message processing cron...');

    const limitSessions = 10; // Number of sessions to process per batch
    let offset = 0;

    while (true) {
        const sessions = await fetchActiveSessions(limitSessions, offset);
        if (sessions.length === 0) break;

        const sessionPromises = sessions.map((session) =>
            processMessages(session, 'ortu')
        );

        await Promise.all(sessionPromises);

        offset += limitSessions;
        await new Promise((resolve) => setTimeout(resolve, 5000)); // Small delay between batches
    }
});

const port = 3001;
app.listen(port, () => {
    console.log('App running on http://localhost:' + port);
});