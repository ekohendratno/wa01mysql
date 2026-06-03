const express = require("express");
const router = express.Router();
const { redirectIfLoggedIn } = require("../lib/Utils.js");

module.exports = ({ sessionManager, userManager }) => {
  router.get("/login", redirectIfLoggedIn, (req, res) => {
    res.render("auth/login", {
      path: req.originalUrl,
      error: null,
      title: "Login - w@pi",
      layout: "layouts/main",
    });
  });

  router.post("/login", redirectIfLoggedIn, async (req, res) => {
    try {
      const { username, password } = req.body;
      const user = await userManager.loginUser(username, password);
      const role = user && (user.role === "admin" || user.role === "client")
        ? user.role
        : null;

      if (!role) {
        throw new Error("Role akun tidak valid. Silakan hubungi admin.");
      }

      // Simpan data pengguna ke dalam sesi
      req.session.user = {
        uid: user.uid,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role,
        api_key: user.api_key,
      };

      res.redirect(`/${role}`);
    } catch (error) {
      res.render("auth/login", {
        path: req.originalUrl,
        error: error.message || "Login gagal",
        title: "Login - w@pi",
        layout: "layouts/main",
      });
    }
  });

  router.get("/register", redirectIfLoggedIn, (req, res) => {
    res.render("auth/register", {
      path: req.originalUrl,
      error: null,
      title: "Registrasi - w@pi",
      layout: "layouts/main",
    });
  });

  router.post("/register", redirectIfLoggedIn, async (req, res) => {
    let name = "";
    let email = "";
    let phone = "";
    let ref = "";

    const renderRegisterError = (message) =>
      res.status(400).render("auth/register", {
        error: message || "Registrasi gagal",
        name,
        email,
        phone,
        ref,
        path: req.originalUrl,
        title: "Registrasi - w@pi",
        layout: "layouts/main",
      });

    try {
      ({ name = "", email = "", phone = "", ref = "" } = req.body);
      const { password, repassword } = req.body;

      name = String(name).trim();
      email = String(email).trim().toLowerCase();
      phone = String(phone).trim();
      ref = String(ref).trim();

      if (!name) {
        throw new Error("Nama lengkap harus diisi");
      }
      if (!email) {
        throw new Error("Email harus diisi");
      }
      if (!phone) {
        throw new Error("Nomor WhatsApp harus diisi");
      }

      if (!password || !repassword) {
        throw new Error("Password dan Konfirmasi Password harus diisi");
      }
      if (password.length < 6) {
        throw new Error("Password harus memiliki minimal 6 karakter");
      }
      if (password !== repassword) {
        throw new Error("Konfirmasi Password tidak cocok");
      }

      const user = await userManager.registerUser(
        name,
        email,
        phone,
        ref,
        password,
        repassword
      );

      req.session.user = user;
      res.redirect("/client");
    } catch (error) {
      return renderRegisterError(error.message || "Registrasi gagal");
    }
  });

  // Logout
  router.get("/logout", (req, res) => {
    req.session.destroy();
    res.redirect("/auth/login");
  });

  return router;
};
