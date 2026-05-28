const { Boom } = require("@hapi/boom");
const { generateAPIKey } = require("../lib/Generate");
const {
  hashPassword,
  isPasswordHash,
  verifyPassword,
} = require("../lib/Password");

class UserManager {
  constructor(pool) {
    this.pool = pool;
  }

  async registerUser(name, email, phone, ref, password) {
    const connection = await this.pool.getConnection();
    try {
      const apiKey = generateAPIKey();
      const hashedPassword = hashPassword(password);

      const [result] = await connection.query(
        "INSERT INTO users (name, email, phone, password, api_key, active) VALUES (?,?,?,?,?,?)",
        [name, email, phone, hashedPassword, apiKey, 1]
      );

      return {
        uid: result.insertId,
        name,
        email,
        phone,
        api_key: apiKey,
        active: 1,
        role: "client",
      };

    } catch (error) {
      console.error("Registration error:", error);
      throw error;
    } finally {
      connection.release();
    }
  }

  async loginUser(username, password) {
    const connection = await this.pool.getConnection();

    try {
      // Cek ke tabel users terlebih dahulu
      const [users] = await connection.query(
        "SELECT uid, name, email, phone, password, api_key, active FROM users WHERE email = ? OR username = ? LIMIT 1",
        [username, username]
      );

      if (users.length > 0 && verifyPassword(password, users[0].password)) {
        if (Number(users[0].active) !== 1) {
          throw new Boom("Akun belum aktif atau sedang dinonaktifkan", {
            statusCode: 403,
          });
        }

        // Update last_active
        await connection.query(
          "UPDATE users SET last_active = NOW() WHERE uid = ?",
          [users[0].uid]
        );

        if (!isPasswordHash(users[0].password)) {
          await connection.query("UPDATE users SET password = ? WHERE uid = ?", [
            hashPassword(password),
            users[0].uid,
          ]);
        }

        const { password: _password, active: _active, ...user } = users[0];
        return {
          ...user,
          role: "client",
        };
      }

      // Jika tidak ditemukan di users, cek ke tabel admin
      const [admins] = await connection.query(
        "SELECT uid, name, email, phone, password, active FROM admin WHERE email = ? OR username = ? LIMIT 1",
        [username, username]
      );

      if (admins.length > 0 && verifyPassword(password, admins[0].password)) {
        if (
          admins[0].active !== null &&
          admins[0].active !== undefined &&
          Number(admins[0].active) !== 1
        ) {
          throw new Boom("Akun admin sedang dinonaktifkan", {
            statusCode: 403,
          });
        }

        if (!isPasswordHash(admins[0].password)) {
          await connection.query("UPDATE admin SET password = ? WHERE uid = ?", [
            hashPassword(password),
            admins[0].uid,
          ]);
        }

        const { password: _password, active: _active, ...admin } = admins[0];
        // Tambahkan api_key = null agar konsisten
        return {
          ...admin,
          api_key: null,
          role: "admin",
        };
      }

      // Jika tidak ditemukan di kedua tabel
      throw new Boom("Username atau password salah", { statusCode: 401 });
    } catch (error) {
      console.error("Login error:", error);
      throw error.isBoom ? error : new Boom("Login gagal", { statusCode: 500 });
    } finally {
      connection.release();
    }
  }
}

module.exports = UserManager;
