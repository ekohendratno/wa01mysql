const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../../lib/Utils.js");
const { generateAPIKey } = require("../../lib/Generate.js");
const { hashPasswordAsync } = require("../../lib/Password.js");
const { logAudit } = require("../../lib/AuditLogger.js");

module.exports = ({ pool } = {}) => {
  // List Users
  router.get("/", authMiddleware, async (req, res) => {
    try {
      const [users] = await pool.query(
        "SELECT u.*, CASE WHEN u.active = 1 THEN 'active' ELSE 'suspended' END AS status FROM users u ORDER BY created_at DESC"
      );
      const [[summary]] = await pool.query(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) AS active_total,
          SUM(CASE WHEN DATE(created_at) = CURDATE() THEN 1 ELSE 0 END) AS today_total,
          SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) AS week_total,
          SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 ELSE 0 END) AS month_total
        FROM users
      `);
      res.render("admin/users", {
        title: "Users Management - w@pi",
        layout: "layouts/admin",
        users,
        summary: summary || {},
      });
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).send("Internal Server Error");
    }
  });

  // Get User for Edit
  router.get("/edit/:uid", authMiddleware, async (req, res) => {
    try {
      const [rows] = await pool.query("SELECT * FROM users WHERE uid = ?", [
        req.params.uid,
      ]);
      if (rows.length === 0)
        return res
          .status(404)
          .json({ status: false, message: "User not found" });
      // hide password
      const user = rows[0];
      delete user.password;
      user.status = Number(user.active) === 1 ? "active" : "suspended";
      res.json({ status: true, data: user });
    } catch (e) {
      console.error(e);
      res.json({ status: false, message: e.message });
    }
  });

  router.get("/duplicate/:uid", authMiddleware, async (req, res) => {
    try {
      const [rows] = await pool.query(
        "SELECT uid, name, email, phone, active FROM users WHERE uid = ?",
        [req.params.uid]
      );
      if (rows.length === 0) {
        return res
          .status(404)
          .json({ status: false, message: "User not found" });
      }

      const source = rows[0];
      const emailParts = String(source.email || "").split("@");
      const emailPrefix = emailParts[0] || "user";
      const emailDomain = emailParts[1] || "example.com";

      res.json({
        status: true,
        data: {
          uid: 0,
          name: `${source.name || "User"} Copy`,
          email: `${emailPrefix}+copy${Date.now()}@${emailDomain}`,
          phone: source.phone || "",
          status: Number(source.active) === 1 ? "active" : "suspended",
        },
      });
    } catch (e) {
      console.error(e);
      res.json({ status: false, message: e.message });
    }
  });

  router.post("/impersonate/:uid", authMiddleware, async (req, res) => {
    try {
      const adminUser = req.session.user;
      if (!adminUser || adminUser.role !== "admin") {
        return res.status(403).json({
          status: false,
          message: "Hanya admin yang bisa masuk sebagai client.",
        });
      }

      const [rows] = await pool.query(
        "SELECT uid, name, email, phone, api_key, active FROM users WHERE uid = ? LIMIT 1",
        [req.params.uid],
      );
      if (rows.length === 0) {
        return res.status(404).json({ status: false, message: "Client tidak ditemukan." });
      }

      const target = rows[0];
      if (Number(target.active) !== 1) {
        return res.status(403).json({
          status: false,
          message: "Client sedang nonaktif/suspended.",
        });
      }

      req.session.adminImpersonator = {
        uid: adminUser.uid,
        name: adminUser.name,
        email: adminUser.email,
        phone: adminUser.phone,
        role: "admin",
        api_key: adminUser.api_key || null,
      };
      req.session.user = {
        uid: target.uid,
        name: target.name,
        email: target.email,
        phone: target.phone,
        role: "client",
        api_key: target.api_key,
        impersonated_by_admin: adminUser.uid,
      };

      req.session.save(() => {
        logAudit(pool, req, "admin.impersonate_user", {
          targetType: "user",
          targetId: target.uid,
          metadata: { targetName: target.name, targetEmail: target.email },
        }).catch((error) => console.error("Audit log error:", error));
        res.json({
          status: true,
          message: `Masuk sebagai ${target.name || target.email}.`,
          redirect: "/client",
        });
      });
    } catch (e) {
      console.error("Impersonate user error:", e);
      res.status(500).json({ status: false, message: e.message });
    }
  });

  // Save User (Add/Edit)
  router.post("/save", authMiddleware, async (req, res) => {
    const { uid, name, email, phone, password, status } = req.body;
    const active = status === "suspended" ? 0 : 1;
    // Basic validation
    if (!name || !email)
      return res.json({
        status: false,
        message: "Name and Email are required",
      });

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      if (uid && uid != 0) {
        // Update
        let query =
          "UPDATE users SET name=?, email=?, phone=?, active=? WHERE uid=?";
        let params = [name, email, phone, active, uid];

        if (password && password.trim() !== "") {
          query =
            "UPDATE users SET name=?, email=?, phone=?, active=?, password=? WHERE uid=?";
          params = [name, email, phone, active, await hashPasswordAsync(password), uid];
        }
        await connection.query(query, params);
        await logAudit(pool, req, "admin.update_user", {
          targetType: "user",
          targetId: uid,
          metadata: { email, active, passwordChanged: Boolean(password && password.trim() !== "") },
        });
      } else {
        if (!password || password.trim() === "") {
          throw new Error("Password wajib diisi untuk user baru");
        }

        // Insert
        // check email exist
        const [exist] = await connection.query(
          "SELECT uid FROM users WHERE email=? LIMIT 1",
          [email]
        );
        if (exist.length > 0) throw new Error("Email already registered");

        const apiKey = generateAPIKey();
        // Include template_invitation column with empty default to avoid missing column errors
        await connection.query(
          "INSERT INTO users (name, email, phone, password, api_key, template_invitation, active) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [name, email, phone, await hashPasswordAsync(password), apiKey, "", active]
        );
        await logAudit(pool, req, "admin.create_user", {
          targetType: "user",
          targetId: email,
          metadata: { email, active },
        });
      }

      await connection.commit();
      res.json({ status: true });
    } catch (e) {
      await connection.rollback();
      console.error(e);
      res.json({ status: false, message: e.message });
    } finally {
      connection.release();
    }
  });

  router.post("/reset-password/:uid", authMiddleware, async (req, res) => {
    const uid = parseInt(req.params.uid || "0", 10);
    const { password, repassword } = req.body;

    if (!uid) {
      return res.status(400).json({ status: false, message: "UID tidak valid." });
    }
    if (!password || !repassword) {
      return res.status(400).json({
        status: false,
        message: "Password dan konfirmasi password wajib diisi.",
      });
    }
    if (String(password).length < 6) {
      return res.status(400).json({
        status: false,
        message: "Password minimal 6 karakter.",
      });
    }
    if (password !== repassword) {
      return res.status(400).json({
        status: false,
        message: "Konfirmasi password tidak cocok.",
      });
    }

    try {
      const [result] = await pool.query(
        "UPDATE users SET password = ? WHERE uid = ?",
        [await hashPasswordAsync(password), uid],
      );
      if (result.affectedRows === 0) {
        return res.status(404).json({
          status: false,
          message: "User tidak ditemukan.",
        });
      }
      await logAudit(pool, req, "admin.reset_user_password", {
        targetType: "user",
        targetId: uid,
      });
      res.json({ status: true, message: "Password user berhasil direset." });
    } catch (e) {
      console.error("Reset user password error:", e);
      res.status(500).json({ status: false, message: e.message });
    }
  });

  // Delete User
  router.delete("/delete/:uid", authMiddleware, async (req, res) => {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      // delete related data (cascade usually handles this, but let's be safe or minimal)
      // For now, just delete user.
      await connection.query("DELETE FROM users WHERE uid = ?", [
        req.params.uid,
      ]);
      await logAudit(pool, req, "admin.delete_user", {
        targetType: "user",
        targetId: req.params.uid,
      });
      await connection.commit();
      res.json({ status: true });
    } catch (e) {
      await connection.rollback();
      console.error(e);
      res.json({ status: false, message: e.message });
    } finally {
      connection.release();
    }
  });

  return router;
};
