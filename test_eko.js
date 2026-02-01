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
    console.log("=== TEST ANALYSIS: EKO HENDRATNO ===");

    // 1. Check Contacts for Eko
    const [contacts] = await pool.query(
      "SELECT * FROM contacts WHERE name LIKE '%EKO%' OR phone LIKE '%6285769641780%' OR jid LIKE '%101915379667185%'",
    );
    console.log("\n[Contacts Table]");
    if (contacts.length === 0) {
      console.log("❌ No contact records found for Eko.");
    } else {
      console.table(
        contacts.map((c) => ({
          id: c.id,
          jid: c.jid,
          phone: c.phone || "NULL",
          name: c.name || "NULL",
        })),
      );
    }

    // 2. Check Opt-In for Eko
    const [optins] = await pool.query(
      "SELECT * FROM opt_ins WHERE number LIKE '%6285769641780%' OR number LIKE '%101915379667185%'",
    );
    console.log("\n[Opt-Ins Table]");
    if (optins.length === 0) {
      console.log("❌ No opt-in records found for Eko.");
    } else {
      console.table(
        optins.map((o) => ({
          number: o.number,
          status: o.status,
          source: o.source,
          agreed: o.agreed_at,
        })),
      );
    }

    // 3. System Status
    const [devices] = await pool.query(
      "SELECT id, name, status FROM devices WHERE uid = 3",
    );
    console.log("\n[Device Status for UID 3]");
    console.table(devices);
  } catch (e) {
    console.error(e);
  } finally {
    await pool.end();
    process.exit(0);
  }
})();
