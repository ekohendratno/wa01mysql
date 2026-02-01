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
    console.log("--- DB INSPECTION V2 ---");

    const [tables] = await pool.query("SHOW TABLES");
    console.log("Tables:", tables.map((t) => Object.values(t)[0]).join(", "));

    const [contacts] = await pool.query(
      "SELECT COUNT(*) as count FROM contacts",
    );
    console.log("Contacts Count:", contacts[0].count);

    const [optins] = await pool.query("SELECT COUNT(*) as count FROM opt_ins");
    console.log("Opt-Ins Count:", optins[0].count);

    const [devices] = await pool.query(
      "SELECT id, uid, device_key, status FROM devices",
    );
    console.log("\nDevices:");
    console.table(devices);

    const [users] = await pool.query("SELECT uid, name, username FROM users");
    console.log("\nUsers:");
    console.table(users);
  } catch (e) {
    console.error("Inspection error:", e);
  } finally {
    await pool.end();
    process.exit(0);
  }
})();
