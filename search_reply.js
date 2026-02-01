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
    console.log("Searching for the duplicate message in DB...");
    const [rows] = await pool.query(
      "SELECT * FROM autoreply WHERE response LIKE ?",
      ["%Terima kasih! Nomor Anda telah terdaftar%"],
    );
    console.log("Found:", rows.length);
    rows.forEach((r) =>
      console.log(
        `ID: ${r.id} | Keyword: ${r.keyword} | Response: ${r.response}`,
      ),
    );

    console.log("\nChecking all keywords for UID 3:");
    const [u3] = await pool.query(
      "SELECT keyword FROM autoreply WHERE uid = 3",
    );
    console.log(u3.map((r) => r.keyword).join(", "));
  } catch (e) {
    console.error(e);
  } finally {
    await pool.end();
  }
})();
