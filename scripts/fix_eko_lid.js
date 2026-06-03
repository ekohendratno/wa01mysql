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
    const lid = "101915379667185";
    const pn = "6285769641780";

    console.log(`Fixing mapping for LID: ${lid} -> PN: ${pn}`);

    // Update contacts
    const [res1] = await pool.query(
      "UPDATE contacts SET phone = ? WHERE jid LIKE ?",
      [pn, `%${lid}%`],
    );
    console.log("Updated contacts:", res1.affectedRows);

    // Update opt_ins (only if it's the LID)
    const [res2] = await pool.query(
      "UPDATE opt_ins SET number = ? WHERE number = ?",
      [pn, lid],
    );
    console.log("Updated opt_ins:", res2.affectedRows);

    // Remove any duplicate opt-in for the same number
    const [res3] = await pool.query(
      "DELETE o1 FROM opt_ins o1 INNER JOIN opt_ins o2 WHERE o1.id > o2.id AND o1.uid = o2.uid AND o1.number = o2.number",
    );
    console.log("Removed duplicates:", res3.affectedRows);
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await pool.end();
  }
}

run();
