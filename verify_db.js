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
    console.log("--- VERIFYING CONTACTS ---");

    const [rows] = await pool.query("SELECT * FROM contacts");
    rows.forEach((r) => {
      console.log(
        `[ID ${r.id}] JID: ${r.jid} | Phone: ${r.phone} | Name: ${r.name}`,
      );
    });
  } catch (e) {
    console.error(e);
  } finally {
    await pool.end();
    process.exit(0);
  }
})();
