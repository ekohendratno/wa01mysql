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
      const cleanName = String(name || "").trim();
      const cleanEmail = String(email || "").trim().toLowerCase();
      const cleanPhone = this.normalizePhone(phone);

      if (!cleanName) throw new Error("Nama lengkap harus diisi");
      if (!cleanEmail) throw new Error("Email harus diisi");
      if (!cleanPhone) throw new Error("Nomor WhatsApp tidak valid");

      const [existingUsers] = await connection.query(
        "SELECT uid FROM users WHERE email = ? LIMIT 1",
        [cleanEmail],
      );
      if (existingUsers.length > 0) {
        throw new Error("Email sudah terdaftar. Silakan login atau gunakan email lain.");
      }

      const [existingAdmins] = await connection.query(
        "SELECT uid FROM admin WHERE email = ? LIMIT 1",
        [cleanEmail],
      );
      if (existingAdmins.length > 0) {
        throw new Error("Email sudah terdaftar sebagai admin. Silakan login.");
      }

      const apiKey = generateAPIKey();
      const hashedPassword = hashPassword(password);

      const [result] = await connection.query(
        "INSERT INTO users (name, email, phone, password, api_key, active, last_active) VALUES (?,?,?,?,?,?,NOW())",
        [cleanName, cleanEmail, cleanPhone, hashedPassword, apiKey, 1]
      );

      return {
        uid: result.insertId,
        name: cleanName,
        email: cleanEmail,
        phone: cleanPhone,
        api_key: apiKey,
        active: 1,
        role: "client",
      };

    } catch (error) {
      console.error("Registration error:", error);
      if (error && error.code === "ER_DUP_ENTRY") {
        const detail = String(error.sqlMessage || "");
        if (detail.includes("email")) {
          throw new Error("Email sudah terdaftar. Silakan login atau gunakan email lain.");
        }
        if (detail.includes("api_key")) {
          throw new Error("Registrasi gagal membuat API key unik. Silakan coba lagi.");
        }
        throw new Error("Data akun sudah terdaftar. Silakan periksa kembali.");
      }
      if (error && error.code === "ER_NO_DEFAULT_FOR_FIELD") {
        throw new Error("Registrasi gagal karena konfigurasi database belum lengkap. Silakan hubungi admin.");
      }
      throw error;
    } finally {
      connection.release();
    }
  }

  normalizePhone(phone) {
    let cleanPhone = String(phone || "").replace(/\D/g, "");
    if (cleanPhone.startsWith("08")) {
      cleanPhone = "628" + cleanPhone.slice(2);
    } else if (cleanPhone.startsWith("8")) {
      cleanPhone = "62" + cleanPhone;
    } else if (cleanPhone.startsWith("0")) {
      cleanPhone = "62" + cleanPhone.slice(1);
    }

    if (!/^62\d{8,14}$/.test(cleanPhone)) {
      return null;
    }

    return cleanPhone;
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
