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
    console.log("🔄 Menyamakan format JID (Cleaning device index)...");

    // Ambil semua kontak yang mungkin punya : (multi-device index)
    const [contacts] = await pool.query(
      "SELECT id, jid FROM contacts WHERE jid LIKE '%:%'",
    );

    for (const c of contacts) {
      const cleanJid = c.jid.replace(/:[0-9]+/, "");
      console.log(`Fixing JID: ${c.jid} -> ${cleanJid}`);
      await pool.query("UPDATE contacts SET jid = ? WHERE id = ?", [
        cleanJid,
        c.id,
      ]);
    }

    console.log("✅ Selesai.");
  } catch (e) {
    console.error(e);
  } finally {
    await pool.end();
    process.exit(0);
  }
})();
