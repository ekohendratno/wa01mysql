const { Boom } = require("@hapi/boom");
const crypto = require("crypto");
const { generateAPIKey } = require("../lib/Generate");
const {
  hashPasswordAsync,
  isPasswordHash,
  verifyPasswordAsync,
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
      const hashedPassword = await hashPasswordAsync(password);

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

      if (users.length > 0 && await verifyPasswordAsync(password, users[0].password)) {
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
            await hashPasswordAsync(password),
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

      if (admins.length > 0 && await verifyPasswordAsync(password, admins[0].password)) {
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
            await hashPasswordAsync(password),
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

  hashResetToken(token) {
    return crypto.createHash("sha256").update(String(token)).digest("hex");
  }

  toMysqlDateTime(date) {
    const d = date instanceof Date ? date : new Date(date);
    const pad = (value) => String(value).padStart(2, "0");
    return [
      d.getFullYear(),
      pad(d.getMonth() + 1),
      pad(d.getDate()),
    ].join("-") + " " + [
      pad(d.getHours()),
      pad(d.getMinutes()),
      pad(d.getSeconds()),
    ].join(":");
  }

  async createPasswordReset(email) {
    const cleanEmail = String(email || "").trim().toLowerCase();
    if (!cleanEmail) throw new Error("Email wajib diisi");

    const connection = await this.pool.getConnection();
    try {
      let userType = "client";
      let rows = [];
      [rows] = await connection.query(
        "SELECT uid, name, email FROM users WHERE email = ? AND active = 1 LIMIT 1",
        [cleanEmail],
      );

      if (rows.length === 0) {
        userType = "admin";
        [rows] = await connection.query(
          "SELECT uid, name, email FROM admin WHERE email = ? AND (active = 1 OR active IS NULL) LIMIT 1",
          [cleanEmail],
        );
      }

      if (rows.length === 0) {
        return { found: false };
      }

      const user = rows[0];
      const token = crypto.randomBytes(32).toString("hex");
      const tokenHash = this.hashResetToken(token);
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

      await connection.query(
        "UPDATE password_resets SET used_at = NOW() WHERE user_type = ? AND user_id = ? AND used_at IS NULL",
        [userType, user.uid],
      );
      await connection.query(
        `INSERT INTO password_resets
          (user_type, user_id, email, token_hash, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
        [
          userType,
          user.uid,
          user.email,
          tokenHash,
          this.toMysqlDateTime(expiresAt),
        ],
      );

      return {
        found: true,
        userType,
        user,
        token,
        expiresAt,
      };
    } finally {
      connection.release();
    }
  }

  async getPasswordReset(token) {
    const tokenHash = this.hashResetToken(token);
    const [rows] = await this.pool.query(
      `SELECT pr.id, pr.user_type, pr.user_id, pr.email, pr.expires_at, pr.used_at,
              COALESCE(u.name, a.name) AS name
       FROM password_resets pr
       LEFT JOIN users u ON pr.user_type = 'client' AND pr.user_id = u.uid
       LEFT JOIN admin a ON pr.user_type = 'admin' AND pr.user_id = a.uid
       WHERE pr.token_hash = ?
       LIMIT 1`,
      [tokenHash],
    );
    if (rows.length === 0) return null;

    const reset = rows[0];
    if (reset.used_at || new Date(reset.expires_at) <= new Date()) {
      return null;
    }
    return reset;
  }

  async resetPassword(token, password, confirmation) {
    if (!password || !confirmation) throw new Error("Password dan konfirmasi wajib diisi");
    if (String(password).length < 6) throw new Error("Password minimal 6 karakter");
    if (password !== confirmation) throw new Error("Konfirmasi password tidak cocok");

    const reset = await this.getPasswordReset(token);
    if (!reset) throw new Error("Link reset password tidak valid atau sudah kedaluwarsa");

    const table = reset.user_type === "admin" ? "admin" : "users";
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query(
        `UPDATE ${table} SET password = ? WHERE uid = ?`,
        [await hashPasswordAsync(password), reset.user_id],
      );
      await connection.query(
        "UPDATE password_resets SET used_at = NOW() WHERE id = ?",
        [reset.id],
      );
      await connection.commit();
      return { status: true, userType: reset.user_type };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
}

module.exports = UserManager;
