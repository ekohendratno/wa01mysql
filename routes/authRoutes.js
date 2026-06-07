const express = require("express");
const router = express.Router();
const { redirectIfLoggedIn } = require("../lib/Utils.js");
const MailManager = require("../lib/MailManager.js");
const AuthLockout = require("../lib/AuthLockout.js");

module.exports = ({ sessionManager, userManager }) => {
  const mailManager = new MailManager();
  const authLockout = new AuthLockout(userManager.pool);

  router.get("/login", redirectIfLoggedIn, (req, res) => {
    res.render("auth/login", {
      path: req.originalUrl,
      error: null,
      title: "Login - w@pi",
      layout: "layouts/main",
    });
  });

  router.post("/login", redirectIfLoggedIn, async (req, res) => {
    const username = String(req.body.username || "").trim();
    try {
      const { password } = req.body;
      await authLockout.assertAllowed(username, req);
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

      await authLockout.recordSuccess(username, req);
      res.redirect(`/${role}`);
    } catch (error) {
      if (username) {
        await authLockout.recordFailure(username, req).catch((lockError) =>
          console.error("Auth lockout record error:", lockError)
        );
      }
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

  router.get("/forgot-password", redirectIfLoggedIn, (req, res) => {
    res.render("auth/forgot-password", {
      path: req.originalUrl,
      title: "Lupa Password - w@pi",
      layout: "layouts/main",
      message: null,
      error: null,
      email: "",
    });
  });

  router.post("/forgot-password", redirectIfLoggedIn, async (req, res) => {
    const email = String(req.body.email || "").trim().toLowerCase();
    const renderPage = (locals) =>
      res.render("auth/forgot-password", {
        path: req.originalUrl,
        title: "Lupa Password - w@pi",
        layout: "layouts/main",
        email,
        message: null,
        error: null,
        ...locals,
      });

    try {
      const reset = await userManager.createPasswordReset(email);
      const genericMessage =
        "Jika email terdaftar, link reset password akan dikirim ke email tersebut.";

      if (reset.found) {
        const baseUrl =
          process.env.APP_URL ||
          process.env.SERVER_URL ||
          `${req.protocol}://${req.get("host")}`;
        const resetUrl = `${baseUrl.replace(/\/+$/, "")}/auth/reset-password?token=${encodeURIComponent(reset.token)}`;

        try {
          await mailManager.sendPasswordResetEmail({
            to: reset.user.email,
            name: reset.user.name,
            resetUrl,
          });
        } catch (mailError) {
          console.error("Password reset email error:", mailError);
          if (process.env.NODE_ENV !== "production") {
            return renderPage({
              message: `Link reset dibuat, tetapi email belum terkirim karena SMTP belum siap. Link lokal: ${resetUrl}`,
            });
          }
        }
      }

      return renderPage({ message: genericMessage });
    } catch (error) {
      console.error("Forgot password error:", error);
      return renderPage({ error: error.message || "Gagal memproses reset password." });
    }
  });

  router.get("/reset-password", redirectIfLoggedIn, async (req, res) => {
    const token = String(req.query.token || "").trim();
    const reset = token ? await userManager.getPasswordReset(token) : null;
    res.render("auth/reset-password", {
      path: req.originalUrl,
      title: "Reset Password - w@pi",
      layout: "layouts/main",
      token,
      reset,
      error: reset ? null : "Link reset password tidak valid atau sudah kedaluwarsa.",
      message: null,
    });
  });

  router.post("/reset-password", redirectIfLoggedIn, async (req, res) => {
    const token = String(req.body.token || "").trim();
    const renderPage = async (locals) => {
      const reset = token ? await userManager.getPasswordReset(token) : null;
      return res.render("auth/reset-password", {
        path: req.originalUrl,
        title: "Reset Password - w@pi",
        layout: "layouts/main",
        token,
        reset,
        error: null,
        message: null,
        ...locals,
      });
    };

    try {
      await userManager.resetPassword(token, req.body.password, req.body.repassword);
      return res.render("auth/reset-password", {
        path: req.originalUrl,
        title: "Reset Password - w@pi",
        layout: "layouts/main",
        token: "",
        reset: null,
        error: null,
        message: "Password berhasil diubah. Silakan login dengan password baru.",
      });
    } catch (error) {
      console.error("Reset password error:", error);
      return renderPage({ error: error.message || "Gagal mengubah password." });
    }
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

  router.post("/stop-impersonation", (req, res) => {
    if (!req.session?.adminImpersonator) {
      return res.status(400).json({
        status: false,
        message: "Session impersonasi tidak ditemukan.",
      });
    }

    req.session.user = req.session.adminImpersonator;
    delete req.session.adminImpersonator;
    req.session.save(() => {
      res.json({
        status: true,
        message: "Kembali ke akun admin.",
        redirect: "/admin/users",
      });
    });
  });

  return router;
};
