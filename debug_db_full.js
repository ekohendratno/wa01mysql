const mysql = require("mysql2/promise");
require("dotenv").config();

(async () => {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  try {
    console.log("=== DETAILED DB STATE ===");

    const [contacts] = await pool.query("SELECT * FROM contacts");
    console.log("\nContacts found:", contacts.length);
    contacts.forEach((c) => {
      console.log(
        `- ID: ${c.id} | JID: ${c.jid} | Phone: ${c.phone} | Name: ${c.name}`,
      );
    });

    const [optins] = await pool.query("SELECT * FROM opt_ins");
    console.log("\nOpt-Ins found:", optins.length);
    optins.forEach((o) => {
      console.log(
        `- Number: ${o.number} | Status: ${o.status} | Source: ${o.source}`,
      );
    });

    const [users] = await pool.query(
      "SELECT uid, name FROM users WHERE uid = 3",
    );
    console.log(
      "\nTarget User (UID 3):",
      users[0] ? users[0].name : "Not found",
    );
  } catch (e) {
    console.error(e);
  } finally {
    await pool.end();
    process.exit(0);
  }
})();
