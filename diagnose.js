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
    console.log("--- DIAGNOSTIC REPORT ---");
    console.log("Time:", new Date().toLocaleString());

    // 1. Check opt_ins table for invalid formats (LIDs)
    const [optIns] = await pool.query("SELECT * FROM opt_ins");
    console.log("\n[opt_ins Table Status]");
    console.log("Total Records:", optIns.length);
    const lidsInOptIn = optIns.filter(
      (r) => !r.number.startsWith("62") && !r.number.startsWith("0"),
    );
    if (lidsInOptIn.length > 0) {
      console.log("⚠️ WARNING: Found LIDs in opt_ins table:");
      lidsInOptIn.forEach((r) =>
        console.log(`  - ${r.number} (Status: ${r.status})`),
      );
    } else {
      console.log("✅ No LIDs found in opt_ins table. Filter is working.");
    }

    // 2. Check contacts table for cross-linking
    const [contacts] = await pool.query(
      "SELECT * FROM contacts ORDER BY updated_at DESC LIMIT 10",
    );
    console.log("\n[Latest 10 Contacts]");
    console.table(
      contacts.map((c) => ({
        id: c.id,
        jid: c.jid,
        phone: c.phone || "NULL",
        name: c.name || "NULL",
        updated: c.updated_at,
      })),
    );

    // 3. Check for potential duplicates/orphans
    const [orphans] = await pool.query(
      "SELECT name, COUNT(*) as count FROM contacts WHERE name IS NOT NULL AND name != 'Tanpa Nama' GROUP BY name HAVING count > 1",
    );
    if (orphans.length > 0) {
      console.log("\n[Potential Identity Splits (Same name, different JIDs)]");
      orphans.forEach((o) =>
        console.log(`  - Name: ${o.name} (${o.count} records)`),
      );
    }

    // 4. Check App Env
    console.log("\n[Environment Config]");
    console.log("FEATURE_OPT_IN:", process.env.FEATURE_OPT_IN);
    console.log("AUTO_OPT_IN_INVITATION:", process.env.AUTO_OPT_IN_INVITATION);
  } catch (e) {
    console.error("Diagnostic error:", e);
  } finally {
    await pool.end();
    process.exit(0);
  }
})();
