const crypto = require("crypto");
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");

function getAllowedOrigins() {
  const configured = String(process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (configured.length > 0) return configured;
  if (process.env.SERVER_URL) return [process.env.SERVER_URL];
  return [];
}

function normalizeOrigin(value) {
  try {
    const url = new URL(String(value || ""));
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch (error) {
    return String(value || "").trim().replace(/\/+$/, "").toLowerCase();
  }
}

function isOriginAllowed(origin) {
  if (!origin) return true;

  let requestOrigin = null;
  try {
    requestOrigin = new URL(origin);
  } catch (error) {
    return process.env.NODE_ENV !== "production";
  }

  const hostname = requestOrigin.hostname.toLowerCase();
  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  if (process.env.NODE_ENV !== "production" && localHosts.has(hostname)) {
    return true;
  }

  const allowed = getAllowedOrigins().map(normalizeOrigin);
  if (allowed.length === 0) return process.env.NODE_ENV !== "production";

  const requestNormalized = normalizeOrigin(origin);
  if (allowed.includes(requestNormalized)) return true;

  const serverUrl = process.env.SERVER_URL ? normalizeOrigin(process.env.SERVER_URL) : "";
  if (serverUrl && requestNormalized === serverUrl) return true;

  return false;
}

function corsOrigin(origin, callback) {
  if (isOriginAllowed(origin)) return callback(null, true);
  return callback(null, false);
}

function createRateLimiter({ windowMs = 60000, max = 60, keyPrefix = "rl" } = {}) {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) =>
      `${keyPrefix}:${ipKeyGenerator(req.ip || req.connection?.remoteAddress || "unknown")}`,
    handler: (req, res) =>
      res.status(429).json({
        status: false,
        message: "Terlalu banyak request. Coba lagi beberapa saat.",
      }),
  });
}

function attachCsrfToken(req, res, next) {
  if (req.session && !req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString("hex");
  }
  res.locals.csrfToken = req.session?.csrfToken || "";
  next();
}

function csrfProtection(req, res, next) {
  const method = String(req.method || "GET").toUpperCase();
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) return next();

  const protectedPrefixes = [
    "/client",
    "/admin",
    "/message/send",
  ];
  const excludedPrefixes = [
    "/telegram/webhook",
    "/health",
    "/v1",
    "/api",
    "/bot",
    "/callback",
  ];

  if (excludedPrefixes.some((prefix) => req.path.startsWith(prefix))) {
    return next();
  }

  const isDashboardMutation = protectedPrefixes.some((prefix) =>
    req.path.startsWith(prefix)
  );

  if (!isDashboardMutation) return next();

  const sessionToken = req.session?.csrfToken;
  const requestToken =
    req.get("x-csrf-token") ||
    req.body?._csrf ||
    req.query?._csrf;

  if (sessionToken && requestToken) {
    const sessionBuffer = Buffer.from(sessionToken);
    const requestBuffer = Buffer.from(String(requestToken));
    if (
      sessionBuffer.length === requestBuffer.length &&
      crypto.timingSafeEqual(sessionBuffer, requestBuffer)
    ) {
      return next();
    }
  }

  return res.status(403).json({
    status: false,
    message: "CSRF token tidak valid. Refresh halaman lalu coba lagi.",
  });
}

module.exports = {
  attachCsrfToken,
  corsOrigin,
  createRateLimiter,
  csrfProtection,
  getAllowedOrigins,
  isOriginAllowed,
};
