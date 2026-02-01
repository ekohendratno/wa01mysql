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
    console.log("--- DB INSPECTION ---");

    const [contacts] = await pool.query("SELECT * FROM contacts");
    console.log("Contacts Count:", contacts.length);
    if (contacts.length > 0) {
      console.log("Latest Contacts:");
      contacts
        .slice(-5)
        .forEach((c) =>
          console.log(`  - ${c.jid} | Phone: ${c.phone} | Name: ${c.name}`),
        );
    }

    const [optins] = await pool.query("SELECT * FROM opt_ins");
    console.log("\nOpt-Ins Count:", optins.length);
    if (optins.length > 0) {
      console.log("Latest Opt-Ins:");
      optins
        .slice(-5)
        .forEach((o) =>
          console.log(
            `  - ${o.number} | status: ${o.status} | source: ${o.source}`,
          ),
        );
    }

    const [messages] = await pool.query(
      "SELECT id, number, type, msg_status, created_at FROM messages ORDER BY id DESC LIMIT 5",
    );
    console.log("\nLatest Messages:");
    messages.forEach((m) =>
      console.log(
        `  - ID: ${m.id} | To: ${m.number} | Status: ${m.msg_status} | Date: ${m.created_at}`,
      ),
    );
  } catch (e) {
    console.error(e);
  } finally {
    await pool.end();
  }
})();
