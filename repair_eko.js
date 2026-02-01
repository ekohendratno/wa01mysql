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
    console.log("--- REPAIRING EKO IDENTITY ---");

    // 1. Find the LID and the Phone
    const [lids] = await pool.query(
      "SELECT * FROM contacts WHERE name LIKE '%EKO%' AND jid LIKE '%@lid'",
    );
    const [phones] = await pool.query(
      "SELECT * FROM contacts WHERE phone LIKE '%6285769641780%'",
    );

    if (lids.length > 0 && phones.length > 0) {
      const lid = lids[0].jid;
      const phone = phones[0].phone;
      const name = lids[0].name;

      console.log(`Matching LID ${lid} to Phone ${phone} (Name: ${name})`);

      // Update LID record with phone
      await pool.query("UPDATE contacts SET phone = ? WHERE jid = ?", [
        phone,
        lid,
      ]);
      // Update Phone record with name
      await pool.query("UPDATE contacts SET name = ? WHERE phone = ?", [
        name,
        phone,
      ]);

      console.log("✅ Identity linked successfully.");
    } else {
      console.log("❌ Could not find both LID and Phone records.");
    }
  } catch (e) {
    console.error(e);
  } finally {
    await pool.end();
    process.exit(0);
  }
})();
