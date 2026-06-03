const BoomModule = require("@hapi/boom");
const Boom = BoomModule.Boom;
Object.assign(Boom, BoomModule);

class AiManager {
  constructor(pool) {
    this.pool = pool;
  }

  async getOverview(uid) {
    const [[settings]] = await this.pool.query(
      "SELECT * FROM ai_settings WHERE uid = ? LIMIT 1",
      [uid],
    );
    const [knowledge] = await this.pool.query(
      "SELECT * FROM ai_knowledge_sources WHERE uid = ? ORDER BY updated_at DESC, id DESC",
      [uid],
    );
    const [logs] = await this.pool.query(
      "SELECT id, provider, model, prompt, response, status, error_message, source, tokens_used, created_at FROM ai_logs WHERE uid = ? ORDER BY created_at DESC LIMIT 20",
      [uid],
    );

    return {
      settings: settings || this.defaultSettings(uid),
      knowledge,
      logs,
    };
  }

  defaultSettings(uid) {
    return {
      uid,
      provider: "openai",
      base_url: "https://api.openai.com/v1",
      api_key: "",
      model: "gpt-4o-mini",
      temperature: 0.3,
      max_tokens: 600,
      system_prompt:
        "Anda adalah asisten layanan pelanggan. Jawab singkat, sopan, dan manfaatkan knowledge base sebaik mungkin. Jika pertanyaan cocok dengan judul atau link knowledge, jawab berdasarkan kecocokan itu dan sertakan link sumber bila tersedia.",
      auto_reply_enabled: 0,
      draft_only: 1,
      active: 0,
    };
  }

  async saveSettings(uid, data) {
    const provider = String(data.provider || "openai").trim();
    const baseUrl = String(data.base_url || "").trim() || this.defaultBaseUrl(provider);
    const apiKey = String(data.api_key || "").trim();
    const model = String(data.model || "").trim() || this.defaultModel(provider);
    const temperature = Math.min(1, Math.max(0, Number(data.temperature || 0.3)));
    const maxTokens = Math.min(4000, Math.max(100, parseInt(data.max_tokens || "600", 10)));
    const systemPrompt = String(data.system_prompt || "").trim();
    const autoReplyEnabled = data.auto_reply_enabled ? 1 : 0;
    const draftOnly = data.draft_only ? 1 : 0;
    const active = data.active ? 1 : 0;

    await this.pool.query(
      `INSERT INTO ai_settings
         (uid, provider, base_url, api_key, model, temperature, max_tokens, system_prompt, auto_reply_enabled, draft_only, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         provider = VALUES(provider),
         base_url = VALUES(base_url),
         api_key = CASE WHEN VALUES(api_key) = '' THEN api_key ELSE VALUES(api_key) END,
         model = VALUES(model),
         temperature = VALUES(temperature),
         max_tokens = VALUES(max_tokens),
         system_prompt = VALUES(system_prompt),
         auto_reply_enabled = VALUES(auto_reply_enabled),
         draft_only = VALUES(draft_only),
         active = VALUES(active),
         updated_at = NOW()`,
      [
        uid,
        provider,
        baseUrl,
        apiKey,
        model,
        temperature,
        maxTokens,
        systemPrompt,
        autoReplyEnabled,
        draftOnly,
        active,
      ],
    );
  }

  async saveKnowledge(uid, data) {
    const id = parseInt(data.id || "0", 10);
    const title = String(data.title || "").trim();
    const sourceType = String(data.source_type || "text") === "link" ? "link" : "text";
    let content = String(data.content || "").trim();
    const url = String(data.url || "").trim();
    const active = data.active ? 1 : 0;

    if (!title) throw Boom.badRequest("Judul knowledge wajib diisi.");
    if (sourceType === "link" && !url) throw Boom.badRequest("URL wajib diisi untuk tipe link.");
    if (sourceType === "text" && !content) throw Boom.badRequest("Konten wajib diisi untuk tipe text.");
    if (sourceType === "link" && !content) {
      content = await this.fetchKnowledgeLinkContent(url).catch(() => "");
    }

    if (id > 0) {
      const [result] = await this.pool.query(
        "UPDATE ai_knowledge_sources SET title = ?, source_type = ?, content = ?, url = ?, active = ?, updated_at = NOW() WHERE id = ? AND uid = ?",
        [title, sourceType, content || null, url || null, active, id, uid],
      );
      if (result.affectedRows === 0) throw Boom.notFound("Knowledge tidak ditemukan.");
      return;
    }

    await this.pool.query(
      "INSERT INTO ai_knowledge_sources (uid, title, source_type, content, url, active) VALUES (?, ?, ?, ?, ?, ?)",
      [uid, title, sourceType, content || null, url || null, active],
    );
  }

  async deleteKnowledge(uid, id) {
    await this.pool.query("DELETE FROM ai_knowledge_sources WHERE id = ? AND uid = ?", [
      id,
      uid,
    ]);
  }

  async syncKnowledgeLinks(uid) {
    const [rows] = await this.pool.query(
      `SELECT id, url
       FROM ai_knowledge_sources
       WHERE uid = ? AND source_type = 'link' AND active = 1 AND url IS NOT NULL AND url != ''`,
      [uid],
    );

    let updated = 0;
    const failed = [];
    for (const row of rows) {
      try {
        const content = await this.fetchKnowledgeLinkContent(row.url);
        if (!content) {
          failed.push(row.id);
          continue;
        }
        await this.pool.query(
          "UPDATE ai_knowledge_sources SET content = ?, updated_at = NOW() WHERE id = ? AND uid = ?",
          [content, row.id, uid],
        );
        updated += 1;
      } catch (error) {
        failed.push(row.id);
      }
    }

    return { updated, failed: failed.length, total: rows.length };
  }

  async fetchKnowledgeLinkContent(url) {
    const cleanUrl = String(url || "").trim();
    if (!/^https?:\/\//i.test(cleanUrl)) return "";

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(cleanUrl, {
        method: "GET",
        headers: {
          "User-Agent": "wapi-ai-knowledge/1.0",
          Accept: "text/html,text/plain,application/xhtml+xml",
        },
        signal: controller.signal,
      });
      if (!response.ok) return "";
      const html = await response.text();
      return this.extractReadableText(html);
    } finally {
      clearTimeout(timeout);
    }
  }

  extractReadableText(html) {
    const raw = String(html || "");
    if (!raw.trim()) return "";

    const title = (raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").trim();
    const description =
      raw.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i)?.[1] ||
      raw.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["'][^>]*>/i)?.[1] ||
      "";
    const body = raw
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
      .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/\s+/g, " ")
      .trim();

    return [
      title ? `Judul halaman: ${title}` : "",
      description ? `Deskripsi: ${description}` : "",
      body,
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, 6000);
  }

  async testPrompt(uid, prompt) {
    const question = String(prompt || "").trim();
    if (!question) throw Boom.badRequest("Prompt wajib diisi.");

    const [[settings]] = await this.pool.query(
      "SELECT * FROM ai_settings WHERE uid = ? LIMIT 1",
      [uid],
    );
    if (!settings || !settings.active) {
      throw Boom.badRequest("AI belum aktif. Simpan dan aktifkan konfigurasi AI terlebih dahulu.");
    }

    try {
      const knowledgeContext = await this.buildKnowledgeContext(uid, question);
      const response = await this.callProvider(settings, question, knowledgeContext);
      await this.log(uid, {
        provider: settings.provider,
        model: settings.model,
        prompt: question,
        response: response.text,
        status: "success",
        source: "test",
        tokens_used: response.tokensUsed || null,
      });
      return response;
    } catch (error) {
      await this.log(uid, {
        provider: settings.provider,
        model: settings.model,
        prompt: question,
        response: null,
        status: "error",
        error_message: error.message,
        source: "test",
      });
      throw error;
    }
  }

  async handleIncomingMessage({ uid, deviceId, remoteJid, messageText, isGroup, overrideDraftOnly = null }) {
    const text = String(messageText || "").trim();
    if (!text) return { handled: false, reason: "empty" };

    const lower = text.toLowerCase();
    const blockedKeywords = ["setuju", "stop", "berhenti", "tidak setuju", "/register", "/unregister"];
    if (blockedKeywords.some((keyword) => lower === keyword || lower.includes(keyword))) {
      return { handled: false, reason: "guardrail_keyword" };
    }

    const [[settings]] = await this.pool.query(
      "SELECT * FROM ai_settings WHERE uid = ? LIMIT 1",
      [uid],
    );
    if (!settings || !settings.active || !settings.auto_reply_enabled) {
      return { handled: false, reason: "disabled" };
    }
    if (isGroup) return { handled: false, reason: "group_disabled" };

    const dailyLimit = parseInt(process.env.AI_REPLY_DAILY_LIMIT_PER_CONTACT || "10", 10);
    const [recentRows] = await this.pool.query(
      `SELECT COUNT(*) AS total
       FROM ai_logs
       WHERE uid = ?
         AND source = 'whatsapp'
         AND prompt LIKE ?
         AND created_at >= CURDATE()`,
      [uid, `%remote:${remoteJid}%`],
    );
    if (dailyLimit > 0 && Number(recentRows[0]?.total || 0) >= dailyLimit) {
      return { handled: false, reason: "daily_limit" };
    }

    const aiPrompt = `remote:${remoteJid}\nmessage:${text}`;
    try {
      const knowledgeContext = await this.buildKnowledgeContext(uid, text);
      const response = await this.callProvider(settings, text, knowledgeContext);
      const answer = String(response.text || "").trim();
      if (!answer) return { handled: false, reason: "empty_answer" };

      const draftOnly =
        overrideDraftOnly === null || overrideDraftOnly === undefined
          ? Number(settings.draft_only || 0) === 1
          : Boolean(overrideDraftOnly);

      await this.log(uid, {
        provider: settings.provider,
        model: settings.model,
        prompt: aiPrompt,
        response: answer,
        status: draftOnly ? "draft" : "success",
        source: "whatsapp",
        tokens_used: response.tokensUsed || null,
      });

      return {
        handled: true,
        draftOnly,
        text: answer,
      };
    } catch (error) {
      await this.log(uid, {
        provider: settings.provider,
        model: settings.model,
        prompt: aiPrompt,
        response: null,
        status: "error",
        error_message: error.message,
        source: "whatsapp",
      });
      throw error;
    }
  }


  async buildKnowledgeContext(uid, prompt = "") {
    const [rows] = await this.pool.query(
      "SELECT title, source_type, content, url, updated_at FROM ai_knowledge_sources WHERE uid = ? AND active = 1 ORDER BY updated_at DESC LIMIT 40",
      [uid],
    );

    if (!rows.length) return "Belum ada knowledge base aktif.";

    const queryTokens = this.expandKnowledgeTokens(this.tokenizeKnowledgeText(prompt));
    const scoredRows = rows
      .map((row) => ({
        row,
        score: this.scoreKnowledgeRow(row, queryTokens),
      }))
      .sort((a, b) => b.score - a.score);

    const topScore = scoredRows[0]?.score || 0;
    const relevant = scoredRows
      .filter((item) => {
        if (item.score <= 0) return false;
        if (topScore >= 4) return item.score >= topScore;
        return true;
      })
      .slice(0, 4);
    const fallback = scoredRows.filter((item) => item.score <= 0).slice(0, 8);
    const selected = relevant.length ? relevant : fallback;

    const sections = selected.map((item, index) => {
      const row = item.row;
      const title = String(row.title || "-").trim();
      const url = String(row.url || "").trim();
      const content = String(row.content || "").trim();
      const urlHints = this.extractUrlHints(url);
      const kind = row.source_type === "link" ? "link referensi" : "catatan teks";
      const confidence =
        item.score >= 5 ? "sangat relevan" : item.score > 0 ? "relevan" : "cadangan";

      return [
        `${index + 1}. Judul: ${title}`,
        `Tipe: ${kind}`,
        `Relevansi: ${confidence}`,
        url ? `URL: ${url}` : null,
        urlHints ? `Petunjuk dari URL: ${urlHints}` : null,
        content
          ? `Isi/Catatan: ${content}`
          : "Isi/Catatan: Belum ada ringkasan. Jika pertanyaan cocok dengan judul atau petunjuk URL, jawab secara umum dari judul tersebut dan arahkan pengguna membuka URL untuk detail lengkap.",
      ]
        .filter(Boolean)
        .join("\n");
    });

    return [
      "Knowledge base aktif yang paling relevan dengan pertanyaan pengguna:",
      sections.join("\n\n"),
      "",
      "Aturan pemakaian knowledge:",
      "- Cocokkan pertanyaan dengan judul, kata kunci, singkatan, dan petunjuk URL.",
      "- Untuk link tanpa isi/catatan, jangan langsung menjawab tidak tahu jika judulnya jelas relevan.",
      "- Jika data detail tidak tersedia, jawab ringkas bahwa informasi terkait tersedia dan sertakan URL sumber.",
      "- Jangan mengarang data spesifik seperti biaya, tanggal, nama, atau syarat jika tidak ada di knowledge.",
    ].join("\n");
  }

  tokenizeKnowledgeText(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 2);
  }

  expandKnowledgeTokens(tokens) {
    const aliases = {
      tkj: ["tjkt", "jaringan", "komputer", "telekomunikasi"],
      tjkt: ["tkj", "jaringan", "komputer", "telekomunikasi"],
      tkr: ["tkro", "otomotif", "kendaraan", "ringan"],
      tkro: ["tkr", "otomotif", "kendaraan", "ringan"],
      dkv: ["multimedia", "desain", "komunikasi", "visual"],
      multimedia: ["dkv", "desain", "komunikasi", "visual"],
      jurusan: ["program", "keahlian", "kompetensi"],
      logo: ["lambang", "ikon", "gambar"],
      kepala: ["kepsek", "sekolah"],
      kepsek: ["kepala", "sekolah"],
    };

    const expanded = new Set(tokens);
    for (const token of tokens) {
      (aliases[token] || []).forEach((alias) => expanded.add(alias));
    }
    return expanded;
  }

  scoreKnowledgeRow(row, queryTokens) {
    if (!queryTokens || queryTokens.size === 0) return 0;

    const weakTokens = new Set([
      "info",
      "informasi",
      "seputar",
      "tentang",
      "tanya",
      "dong",
      "jurusan",
      "program",
      "keahlian",
      "kompetensi",
      "sekolah",
      "smk",
      "smkn",
      "negeri",
      "marga",
      "sekampung",
      "post",
      "page",
      "id",
      "topik",
    ]);
    const titleTokens = this.expandKnowledgeTokens(this.tokenizeKnowledgeText(row.title));
    const contentTokens = this.expandKnowledgeTokens(this.tokenizeKnowledgeText(row.content));
    const urlTokens = this.expandKnowledgeTokens(this.tokenizeKnowledgeText(this.extractUrlHints(row.url)));

    let score = 0;
    for (const token of queryTokens) {
      if (weakTokens.has(token)) continue;
      if (titleTokens.has(token)) score += 4;
      if (urlTokens.has(token)) score += 3;
      if (contentTokens.has(token)) score += 2;
    }
    return score;
  }

  extractUrlHints(url) {
    const rawUrl = String(url || "").trim();
    if (!rawUrl) return "";

    try {
      const parsed = new URL(rawUrl);
      const parts = [];
      parsed.pathname
        .split("/")
        .filter(Boolean)
        .forEach((part) => parts.push(part));
      parsed.searchParams.forEach((value, key) => {
        parts.push(key, value);
      });
      return parts.join(" ");
    } catch (error) {
      return rawUrl;
    }
  }

  async callProvider(settings, prompt, knowledgeContext) {
    const provider = String(settings.provider || "").toLowerCase();
    if (provider === "gemini") return this.callGemini(settings, prompt, knowledgeContext);
    if (provider === "ollama") return this.callOllama(settings, prompt, knowledgeContext);
    return this.callOpenAiCompatible(settings, prompt, knowledgeContext);
  }

  buildMessages(settings, prompt, knowledgeContext) {
    const systemPrompt =
      settings.system_prompt ||
      "Jawab singkat, sopan, dan hanya berdasarkan knowledge base.";
    const platformInstruction = [
      "Instruksi platform tambahan:",
      "- Anda boleh menyimpulkan dari judul knowledge, URL, dan catatan yang diberikan.",
      "- Jika pengguna bertanya topik yang cocok dengan judul/link, jawab dengan percaya diri secara ringkas dan sertakan link sumber.",
      "- Jika detail belum tersedia di catatan, jelaskan bahwa detail lengkap dapat dibuka pada link sumber, bukan langsung menolak.",
      "- Tetap jangan mengarang fakta spesifik yang tidak ada.",
      "- Gunakan Bahasa Indonesia yang ramah dan natural untuk chat WhatsApp.",
    ].join("\n");
    return [
      {
        role: "system",
        content: `${systemPrompt}\n\n${platformInstruction}\n\n${knowledgeContext}`,
      },
      { role: "user", content: prompt },
    ];
  }

  async callOpenAiCompatible(settings, prompt, knowledgeContext) {
    if (!settings.api_key) throw Boom.badRequest("API key provider wajib diisi.");
    const baseUrl = String(settings.base_url || this.defaultBaseUrl(settings.provider)).replace(/\/+$/, "");
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.api_key}`,
      },
      body: JSON.stringify({
        model: settings.model || this.defaultModel(settings.provider),
        messages: this.buildMessages(settings, prompt, knowledgeContext),
        temperature: Number(settings.temperature || 0.3),
        max_tokens: Number(settings.max_tokens || 600),
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error?.message || data.message || `AI provider error HTTP ${response.status}`);
    }

    return {
      text: data.choices?.[0]?.message?.content || "",
      tokensUsed: data.usage?.total_tokens || null,
    };
  }

  async callGemini(settings, prompt, knowledgeContext) {
    if (!settings.api_key) throw Boom.badRequest("API key Gemini wajib diisi.");
    const model = settings.model || "gemini-1.5-flash";
    const baseUrl = String(settings.base_url || "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, "");
    const messages = this.buildMessages(settings, prompt, knowledgeContext);
    const response = await fetch(`${baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(settings.api_key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: messages.map((m) => `${m.role}: ${m.content}`).join("\n\n") }],
          },
        ],
        generationConfig: {
          temperature: Number(settings.temperature || 0.3),
          maxOutputTokens: Number(settings.max_tokens || 600),
        },
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error?.message || `Gemini error HTTP ${response.status}`);
    }
    return {
      text: data.candidates?.[0]?.content?.parts?.map((part) => part.text).join("\n") || "",
      tokensUsed: data.usageMetadata?.totalTokenCount || null,
    };
  }

  async callOllama(settings, prompt, knowledgeContext) {
    const baseUrl = String(settings.base_url || "http://localhost:11434").replace(/\/+$/, "");
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: settings.model || "llama3.1",
        messages: this.buildMessages(settings, prompt, knowledgeContext),
        stream: false,
        options: {
          temperature: Number(settings.temperature || 0.3),
          num_predict: Number(settings.max_tokens || 600),
        },
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || `Ollama error HTTP ${response.status}`);
    }
    return { text: data.message?.content || "", tokensUsed: null };
  }

  async log(uid, data) {
    await this.pool.query(
      `INSERT INTO ai_logs
        (uid, provider, model, prompt, response, status, error_message, source, tokens_used)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uid,
        data.provider || null,
        data.model || null,
        data.prompt,
        data.response || null,
        data.status || "success",
        data.error_message || null,
        data.source || "test",
        data.tokens_used || null,
      ],
    );
  }

  defaultBaseUrl(provider) {
    const p = String(provider || "").toLowerCase();
    if (p === "gemini") return "https://generativelanguage.googleapis.com/v1beta";
    if (p === "groq") return "https://api.groq.com/openai/v1";
    if (p === "openrouter") return "https://openrouter.ai/api/v1";
    if (p === "ollama") return "http://localhost:11434";
    return "https://api.openai.com/v1";
  }

  defaultModel(provider) {
    const p = String(provider || "").toLowerCase();
    if (p === "gemini") return "gemini-1.5-flash";
    if (p === "groq") return "llama-3.1-8b-instant";
    if (p === "openrouter") return "openai/gpt-4o-mini";
    if (p === "ollama") return "llama3.1";
    return "gpt-4o-mini";
  }
}

module.exports = AiManager;
