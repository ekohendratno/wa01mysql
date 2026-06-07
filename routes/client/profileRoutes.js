const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../../lib/Utils.js");
const { hashPasswordAsync } = require("../../lib/Password.js");

module.exports = ({ pool }) => {
  // Helper to get fresh user data
  async function getUser(uid) {
    const [rows] = await pool.query(
      "SELECT * FROM users WHERE uid = ? LIMIT 1",
      [uid],
    );
    return rows.length ? rows[0] : null;
  }

  router.get("/", authMiddleware, async (req, res) => {
    try {
      const user = await getUser(req.session.user.uid);
      if (!user) return res.redirect("/auth/logout");
      delete user.password;
      user.status = Number(user.active) === 1 ? "active" : "suspended";

      res.render("client/profile", {
        title: "Profile Saya - w@pi",
        layout: "layouts/client",
        user,
      });
    } catch (error) {
      console.error("Profile View Error:", error);
      res.status(500).send("Internal Server Error");
    }
  });

  router.post("/update", authMiddleware, async (req, res) => {
    const {
      name,
      phone,
      password,
      template_invitation,
      template_invitation_shared,
      opt_in_required,
    } = req.body;
    const uid = req.session.user.uid;
    const optInRequired = opt_in_required === true || opt_in_required === "1" ? 1 : 0;

    if (!name) return res.json({ status: false, message: "Nama wajib diisi" });

    try {
      const connection = await pool.getConnection();
      try {
        let query, params;

        if (password && password.trim().length > 0) {
          query =
            "UPDATE users SET name = ?, phone = ?, password = ?, template_invitation = ?, template_invitation_shared = ?, opt_in_required = ? WHERE uid = ?";
          params = [name, phone, await hashPasswordAsync(password), template_invitation, template_invitation_shared, optInRequired, uid];
        } else {
          query =
            "UPDATE users SET name = ?, phone = ?, template_invitation = ?, template_invitation_shared = ?, opt_in_required = ? WHERE uid = ?";
          params = [name, phone, template_invitation, template_invitation_shared, optInRequired, uid];
        }

        await connection.query(query, params);

        // Update session info slightly
        req.session.user.name = name;
        req.session.user.phone = phone;

        res.json({ status: true, message: "Profile updated successfully" });
      } finally {
        connection.release();
      }
    } catch (error) {
      console.error("Profile Update Error:", error);
      res.status(500).json({ status: false, message: "Internal Server Error" });
    }
  });

  return router;
};
