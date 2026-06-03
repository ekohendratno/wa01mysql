const mysql = require("mysql2/promise");
require("dotenv").config();

async function run() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  try {
    const [contacts] = await pool.query(
      "SELECT * FROM contacts WHERE phone LIKE '%6285769641780%' OR jid LIKE '%101915379667185%'",
    );
    console.log("CONTACTS:");
    contacts.forEach((c) =>
      console.log(
        `  ID: ${c.id} | JID: ${c.jid} | Phone: ${c.phone} | Name: ${c.name}`,
      ),
    );

    const [optins] = await pool.query(
      "SELECT * FROM opt_ins WHERE number LIKE '%6285769641780%' OR number LIKE '%101915379667185%'",
    );
    console.log("\nOPT-INS:");
    optins.forEach((o) =>
      console.log(
        `  ID: ${o.id} | Number: ${o.number} | Status: ${o.status} | Source: ${o.source}`,
      ),
    );
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await pool.end();
  }
}

run();
