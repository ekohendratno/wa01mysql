module.exports = {
    host: '${{ MYSQLHOST }}',
    user: '${{ MYSQLUSER }}',
    password: '${{ MYSQLPASSWORD }}',
    database: '${{ MYSQL_DATABASE }}',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  };