console.log("Connecting to MySQL with:");
console.log("Host:", process.env.MYSQLHOST);
console.log("User:", process.env.MYSQLUSER);
console.log("Port:", process.env.MYSQLPORT);
console.log("Database:", process.env.MYSQLDATABASE);

module.exports = {
  host: process.env.MYSQLHOST,
  user: process.env.MYSQLUSER,
  password: process.env.MYSQLPASSWORD,
  database: process.env.MYSQLDATABASE,
  port: process.env.MYSQLPORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};
