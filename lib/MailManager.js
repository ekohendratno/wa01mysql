const nodemailer = require("nodemailer");

class MailManager {
  constructor() {
    this.from = process.env.SMTP_FROM || process.env.MAIL_FROM || "w@pi <no-reply@wapi.jasaedukasi.com>";
  }

  isConfigured() {
    return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
  }

  getTransporter() {
    if (!this.isConfigured()) {
      throw new Error("SMTP belum dikonfigurasi. Isi SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, dan SMTP_FROM.");
    }

    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE || "").toLowerCase() === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }

  async sendPasswordResetEmail({ to, name, resetUrl }) {
    const transporter = this.getTransporter();
    const safeName = name || "Pengguna w@pi";

    await transporter.sendMail({
      from: this.from,
      to,
      subject: "Reset Password Akun w@pi",
      text: [
        `Halo ${safeName},`,
        "",
        "Kami menerima permintaan reset password untuk akun w@pi Anda.",
        `Buka link berikut untuk membuat password baru: ${resetUrl}`,
        "",
        "Link ini berlaku selama 60 menit. Jika Anda tidak meminta reset password, abaikan email ini.",
        "",
        "Salam,",
        "w@pi",
      ].join("\n"),
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#0b221e">
          <h2 style="color:#075e54;margin-bottom:8px">Reset Password w@pi</h2>
          <p>Halo <strong>${this.escapeHtml(safeName)}</strong>,</p>
          <p>Kami menerima permintaan reset password untuk akun w@pi Anda.</p>
          <p>
            <a href="${this.escapeHtml(resetUrl)}" style="display:inline-block;background:#25d366;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:bold">
              Buat Password Baru
            </a>
          </p>
          <p style="color:#667">Link ini berlaku selama 60 menit. Jika tombol tidak bisa dibuka, salin link berikut:</p>
          <p><a href="${this.escapeHtml(resetUrl)}">${this.escapeHtml(resetUrl)}</a></p>
          <p style="color:#667">Jika Anda tidak meminta reset password, abaikan email ini.</p>
        </div>
      `,
    });
  }

  escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
}

module.exports = MailManager;
