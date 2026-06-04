const crypto = require("crypto");
const BoomModule = require("@hapi/boom");
const Boom = BoomModule.Boom;
Object.assign(Boom, BoomModule);

class TelegramManager {
  constructor(pool, aiManager = null) {
    this.pool = pool;
    this.aiManager = aiManager;
  }

  makeSecret() {
    return crypto.randomBytes(24).toString("hex");
  }

  publicBaseUrl() {
    return String(process.env.APP_URL || process.env.SERVER_URL || "http://localhost:3001").replace(/\/+$/, "");
  }

  normalizePhone(value) {
    let phone = String(value || "").replace(/\D/g, "");
    if (phone.startsWith("08")) phone = `628${phone.slice(2)}`;
    else if (phone.startsWith("0")) phone = `62${phone.slice(1)}`;
    return phone;
  }

  async getOverview(uid) {
    const [bots] = await this.pool.query(
      `SELECT
          tb.id, tb.uid, tb.name, tb.bot_username, tb.status, tb.mode,
          tb.bridge_wa_enabled, tb.operator_chat_id, tb.last_error,
          tb.webhook_secret, tb.created_at, tb.updated_at,
          CASE WHEN tb.uid = ? THEN 'owner' ELSE 'shared' END AS access_type,
          ts.ai_reply_mode AS share_ai_reply_mode
       FROM telegram_bots tb
       LEFT JOIN telegram_shares ts
         ON ts.bot_id = tb.id
        AND ts.shared_uid = ?
        AND ts.status = 'active'
        AND ts.permission_reply = 1
        AND (ts.expires_at IS NULL OR ts.expires_at > NOW())
       WHERE tb.uid = ? OR ts.id IS NOT NULL
       ORDER BY tb.updated_at DESC, tb.id DESC`,
      [uid, uid, uid],
    );
    const botIds = bots.map((bot) => bot.id);
    const [messages] = await this.pool.query(
      `SELECT tm.*, tb.name AS bot_name, tb.bot_username
       FROM telegram_messages tm
       JOIN telegram_bots tb ON tb.id = tm.bot_id
       WHERE ${botIds.length ? `tm.bot_id IN (${botIds.map(() => "?").join(",")})` : "1=0"}
       ORDER BY tm.created_at DESC
       LIMIT 30`,
      botIds,
    );
    const [shares] = await this.pool.query(
      `SELECT ts.*, tb.name AS bot_name, tb.bot_username, u.name AS shared_name, u.email AS shared_email
       FROM telegram_shares ts
       JOIN telegram_bots tb ON tb.id = ts.bot_id
       LEFT JOIN users u ON u.uid = ts.shared_uid
       WHERE ts.owner_uid = ?
       ORDER BY ts.updated_at DESC, ts.id DESC`,
      [uid],
    );

    return { bots, messages, shares, webhookBaseUrl: `${this.publicBaseUrl()}/telegram/webhook` };
  }

  async callTelegram(token, method, payload = {}) {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      throw new Error(data.description || `Telegram API error HTTP ${response.status}`);
    }
    return data.result;
  }

  async validateBot(token) {
    return this.callTelegram(token, "getMe");
  }

  async saveBot(uid, data) {
    const id = parseInt(data.id || "0", 10);
    const name = String(data.name || "Telegram Bot").trim();
    const token = String(data.bot_token || "").trim();
    const mode = ["manual", "ai_draft", "ai_auto"].includes(data.mode) ? data.mode : "manual";
    const bridgeWaEnabled = data.bridge_wa_enabled ? 1 : 0;
    const operatorChatId = String(data.operator_chat_id || "").trim() || null;

    let botInfo = null;
    if (token) {
      botInfo = await this.validateBot(token);
    }

    if (id > 0) {
      const [existingRows] = await this.pool.query(
        "SELECT * FROM telegram_bots WHERE id = ? AND uid = ? LIMIT 1",
        [id, uid],
      );
      if (!existingRows.length) throw Boom.notFound("Telegram bot tidak ditemukan.");
      const existing = existingRows[0];
      const nextToken = token || existing.bot_token;
      const nextUsername = botInfo?.username || existing.bot_username || null;
      await this.pool.query(
        `UPDATE telegram_bots
         SET name = ?, bot_token = ?, bot_username = ?, mode = ?, bridge_wa_enabled = ?, operator_chat_id = ?, status = 'active', last_error = NULL, updated_at = NOW()
         WHERE id = ? AND uid = ?`,
        [name, nextToken, nextUsername, mode, bridgeWaEnabled, operatorChatId, id, uid],
      );
      return { id, bot_username: nextUsername };
    }

    if (!token) throw Boom.badRequest("Bot token wajib diisi.");
    const webhookSecret = this.makeSecret();
    const [result] = await this.pool.query(
      `INSERT INTO telegram_bots
        (uid, name, bot_token, bot_username, status, mode, bridge_wa_enabled, operator_chat_id, webhook_secret)
       VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
      [uid, name, token, botInfo?.username || null, mode, bridgeWaEnabled, operatorChatId, webhookSecret],
    );
    return { id: result.insertId, bot_username: botInfo?.username || null };
  }

  async setWebhook(uid, botId) {
    const [[bot]] = await this.pool.query(
      "SELECT * FROM telegram_bots WHERE id = ? AND uid = ? LIMIT 1",
      [botId, uid],
    );
    if (!bot) throw Boom.notFound("Telegram bot tidak ditemukan.");
    const url = `${this.publicBaseUrl()}/telegram/webhook/${bot.webhook_secret}`;
    await this.callTelegram(bot.bot_token, "setWebhook", {
      url,
      allowed_updates: ["message"],
    });
    await this.pool.query(
      "UPDATE telegram_bots SET status = 'active', last_error = NULL, updated_at = NOW() WHERE id = ?",
      [bot.id],
    );
    return { url };
  }

  async getWebhookInfo(uid, botId) {
    const [[bot]] = await this.pool.query(
      "SELECT * FROM telegram_bots WHERE id = ? AND uid = ? LIMIT 1",
      [botId, uid],
    );
    if (!bot) throw Boom.notFound("Telegram bot tidak ditemukan.");
    const info = await this.callTelegram(bot.bot_token, "getWebhookInfo", {});
    return {
      expectedUrl: `${this.publicBaseUrl()}/telegram/webhook/${bot.webhook_secret}`,
      info,
    };
  }

  async disableBot(uid, botId) {
    const [[bot]] = await this.pool.query(
      "SELECT * FROM telegram_bots WHERE id = ? AND uid = ? LIMIT 1",
      [botId, uid],
    );
    if (!bot) throw Boom.notFound("Telegram bot tidak ditemukan.");
    try {
      await this.callTelegram(bot.bot_token, "deleteWebhook", { drop_pending_updates: false });
    } catch (error) {
      await this.pool.query(
        "UPDATE telegram_bots SET last_error = ?, updated_at = NOW() WHERE id = ?",
        [`deleteWebhook gagal: ${error.message}`, bot.id],
      );
    }
    await this.pool.query(
      "UPDATE telegram_bots SET status = 'inactive', updated_at = NOW() WHERE id = ? AND uid = ?",
      [botId, uid],
    );
  }

  async deleteBot(uid, botId, confirmText) {
    const [[bot]] = await this.pool.query(
      "SELECT * FROM telegram_bots WHERE id = ? AND uid = ? LIMIT 1",
      [botId, uid],
    );
    if (!bot) throw Boom.notFound("Telegram bot tidak ditemukan.");
    const required = `HAPUS ${bot.name}`;
    if (String(confirmText || "").trim() !== required) {
      throw Boom.badRequest(`Konfirmasi tidak sesuai. Ketik persis: ${required}`);
    }
    try {
      await this.callTelegram(bot.bot_token, "deleteWebhook", { drop_pending_updates: true });
    } catch (error) {
      console.warn(`Telegram deleteWebhook before delete failed for bot ${bot.id}: ${error.message}`);
    }
    await this.pool.query("DELETE FROM telegram_bots WHERE id = ? AND uid = ?", [botId, uid]);
  }

  async sendMessage({ uid, botId, chatId, text }) {
    const [[bot]] = await this.pool.query(
      `SELECT tb.*
       FROM telegram_bots tb
       LEFT JOIN telegram_shares ts
         ON ts.bot_id = tb.id
        AND ts.shared_uid = ?
        AND ts.status = 'active'
        AND ts.permission_send = 1
        AND (ts.expires_at IS NULL OR ts.expires_at > NOW())
       WHERE tb.id = ?
         AND (tb.uid = ? OR ts.id IS NOT NULL)
       LIMIT 1`,
      [uid, botId, uid],
    );
    if (!bot) throw Boom.notFound("Telegram bot tidak ditemukan.");
    const message = String(text || "").trim();
    if (!message) throw Boom.badRequest("Isi pesan wajib diisi.");
    let targetChatId = String(chatId || "").trim();
    const normalizedPhone = this.normalizePhone(targetChatId);
    if (/^62\d{8,15}$/.test(normalizedPhone)) {
      const [[mapped]] = await this.pool.query(
        "SELECT chat_id FROM telegram_contacts WHERE uid = ? AND bot_id = ? AND phone = ? LIMIT 1",
        [uid, bot.id, normalizedPhone],
      );
      if (!mapped) {
        throw Boom.badRequest(
          `Nomor ${normalizedPhone} belum terhubung ke Telegram. Kirim link undangan bot dulu: https://t.me/${bot.bot_username}?start=${normalizedPhone}`,
        );
      }
      targetChatId = mapped.chat_id;
    }
    const result = await this.callTelegram(bot.bot_token, "sendMessage", {
      chat_id: targetChatId,
      text: message,
      disable_web_page_preview: false,
    });
    await this.pool.query(
      `INSERT INTO telegram_messages
        (uid, bot_id, chat_id, direction, message, status, response, created_at, updated_at)
       VALUES (?, ?, ?, 'out', ?, 'sent', ?, NOW(), NOW())`,
      [uid, bot.id, String(targetChatId), message, result?.message_id ? `telegram:${result.message_id}` : null],
    );
    return result;
  }

  async createShare(uid, botId, expiresInDays = 7, aiReplyMode = "off") {
    const [[bot]] = await this.pool.query(
      "SELECT id, name, bot_username FROM telegram_bots WHERE id = ? AND uid = ? LIMIT 1",
      [botId, uid],
    );
    if (!bot) throw Boom.notFound("Telegram bot tidak ditemukan.");
    const code = crypto.randomBytes(5).toString("hex").toUpperCase();
    const days = Math.max(1, Math.min(90, parseInt(expiresInDays || "7", 10) || 7));
    const mode = ["off", "draft", "auto"].includes(aiReplyMode) ? aiReplyMode : "off";
    await this.pool.query(
      `INSERT INTO telegram_shares
        (bot_id, owner_uid, invite_code, permission_send, permission_reply, ai_reply_mode, status, expires_at)
       VALUES (?, ?, ?, 1, 1, ?, 'pending', DATE_ADD(NOW(), INTERVAL ? DAY))`,
      [bot.id, uid, code, mode, days],
    );
    return { invite_code: code, expires_in_days: days, bot };
  }

  async acceptShare(uid, inviteCode) {
    const code = String(inviteCode || "").trim().toUpperCase();
    const [shares] = await this.pool.query(
      `SELECT ts.*, tb.name AS bot_name, tb.bot_username
       FROM telegram_shares ts
       JOIN telegram_bots tb ON tb.id = ts.bot_id
       WHERE ts.invite_code = ?
         AND ts.status = 'pending'
         AND (ts.expires_at IS NULL OR ts.expires_at > NOW())
       LIMIT 1`,
      [code],
    );
    if (!shares.length) throw Boom.notFound("Kode undangan Telegram tidak valid atau kedaluwarsa.");
    const share = shares[0];
    if (Number(share.owner_uid) === Number(uid)) {
      throw Boom.badRequest("Pemilik bot tidak perlu menerima undangan sendiri.");
    }
    const [existing] = await this.pool.query(
      "SELECT id FROM telegram_shares WHERE bot_id = ? AND shared_uid = ? AND status = 'active' LIMIT 1",
      [share.bot_id, uid],
    );
    if (existing.length) throw Boom.badRequest("Telegram bot ini sudah dibagikan ke akun Anda.");
    await this.pool.query(
      "UPDATE telegram_shares SET shared_uid = ?, status = 'active', accepted_at = NOW(), updated_at = NOW() WHERE id = ?",
      [uid, share.id],
    );
    return { bot_name: share.bot_name, bot_username: share.bot_username };
  }

  async revokeShare(uid, shareId) {
    const [result] = await this.pool.query(
      "UPDATE telegram_shares SET status = 'revoked', updated_at = NOW() WHERE id = ? AND owner_uid = ?",
      [shareId, uid],
    );
    if (!result.affectedRows) throw Boom.notFound("Share Telegram tidak ditemukan.");
  }

  async handleWebhook(secret, update) {
    const [[bot]] = await this.pool.query(
      "SELECT * FROM telegram_bots WHERE webhook_secret = ? AND status != 'inactive' LIMIT 1",
      [secret],
    );
    if (!bot) return { status: false, message: "Bot tidak ditemukan." };

    const msg = update?.message || update?.edited_message;
    if (!msg || !msg.chat) {
      await this.pool.query(
        "UPDATE telegram_bots SET last_error = ?, updated_at = NOW() WHERE id = ?",
        [`Webhook diterima tapi bukan message chat. update_id=${update?.update_id || "-"}`, bot.id],
      );
      return { status: true, skipped: true };
    }

    const text = String(msg.text || msg.caption || "").trim();
    if (!text) {
      await this.pool.query(
        "UPDATE telegram_bots SET last_error = ?, updated_at = NOW() WHERE id = ?",
        [`Webhook diterima tapi pesan kosong/non-text. chat=${msg.chat.id}`, bot.id],
      );
      return { status: true, skipped: true };
    }

    const chatId = String(msg.chat.id);
    const fromId = msg.from?.id ? String(msg.from.id) : null;
    const fromName = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ") || msg.from?.username || null;
    const username = msg.from?.username || null;
    const startMatch = text.match(/^\/start(?:@\w+)?\s+([0-9+\-\s().]{8,25})/i);
    let handledStartLink = false;
    if (startMatch) {
      const phone = this.normalizePhone(startMatch[1]);
      if (/^62\d{8,15}$/.test(phone)) {
        await this.pool.query(
          `INSERT INTO telegram_contacts
            (uid, bot_id, phone, chat_id, from_id, from_name, username, linked_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
           ON DUPLICATE KEY UPDATE
             chat_id = VALUES(chat_id),
             from_id = VALUES(from_id),
             from_name = VALUES(from_name),
             username = VALUES(username),
             updated_at = NOW()`,
          [bot.uid, bot.id, phone, chatId, fromId, fromName, username],
        );
        await this.callTelegram(bot.bot_token, "sendMessage", {
          chat_id: chatId,
          text: `Telegram Anda sudah terhubung dengan nomor WhatsApp ${phone}. Silakan kirim pertanyaan atau pesan Anda di sini.`,
          disable_web_page_preview: true,
        }).catch((error) => {
          console.warn(`Telegram start confirmation failed: ${error.message}`);
        });
        handledStartLink = true;
      }
    }

    const [insert] = await this.pool.query(
      `INSERT INTO telegram_messages
        (uid, bot_id, telegram_update_id, chat_id, from_id, from_name, direction, message, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'in', ?, 'received', NOW())`,
      [bot.uid, bot.id, update.update_id || null, chatId, fromId, fromName, text],
    );
    await this.pool.query(
      "UPDATE telegram_bots SET last_error = NULL, updated_at = NOW() WHERE id = ?",
      [bot.id],
    );

    if (!handledStartLink && (bot.mode === "ai_draft" || bot.mode === "ai_auto")) {
      try {
        const aiResult = this.aiManager
          ? await this.aiManager.generateChannelReply(bot.uid, `telegram:${chatId}\nmessage:${text}`, "telegram")
          : { handled: false, reason: "no_ai_manager" };
        if (aiResult.handled) {
          if (bot.mode === "ai_auto") {
            await this.callTelegram(bot.bot_token, "sendMessage", {
              chat_id: chatId,
              text: aiResult.text,
              disable_web_page_preview: false,
            });
            await this.pool.query(
              `INSERT INTO telegram_messages
                (uid, bot_id, chat_id, direction, message, status, response, ai_handled, created_at, updated_at)
               VALUES (?, ?, ?, 'out', ?, 'sent', 'AI auto reply', 1, NOW(), NOW())`,
              [bot.uid, bot.id, chatId, aiResult.text],
            );
          } else {
            await this.pool.query(
              "UPDATE telegram_messages SET status = 'draft', response = ?, ai_handled = 1, updated_at = NOW() WHERE id = ?",
              [aiResult.text, insert.insertId],
            );
          }
        }
      } catch (error) {
        await this.pool.query(
          "UPDATE telegram_messages SET response = ?, updated_at = NOW() WHERE id = ?",
          [`AI error: ${error.message}`, insert.insertId],
        );
      }
    }

    return { status: true };
  }
}

module.exports = TelegramManager;
