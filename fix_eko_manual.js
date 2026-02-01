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
    console.log("--- FORCING EKO REPAIR ---");

    const phone = "6285769641780";
    const lidJid = "101915379667185@lid";
    const name = "EKO HENDRATNO";

    // 1. Update LID to have Phone
    const [res1] = await pool.query(
      "UPDATE contacts SET phone = ? WHERE jid = ?",
      [phone, lidJid],
    );
    console.log(`Updated LID phone: ${res1.affectedRows} rows`);

    // 2. Update Phone JID to have Name
    const [res2] = await pool.query(
      "UPDATE contacts SET name = ? WHERE phone = ?",
      [name, phone],
    );
    console.log(`Updated Phone name: ${res2.affectedRows} rows`);
  } catch (e) {
    console.error(e);
  } finally {
    await pool.end();
    process.exit(0);
  }
})();
