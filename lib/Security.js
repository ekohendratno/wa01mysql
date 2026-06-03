const crypto = require("crypto");

function getAllowedOrigins() {
  const configured = String(process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (configured.length > 0) return configured;
  if (process.env.SERVER_URL) return [process.env.SERVER_URL];
  return [];
}

function isOriginAllowed(origin) {
  if (!origin) return true;
  const allowed = getAllowedOrigins();
  if (allowed.length === 0) return process.env.NODE_ENV !== "production";
  return allowed.includes(origin);
}

function corsOrigin(origin, callback) {
  if (isOriginAllowed(origin)) return callback(null, true);
  return callback(new Error("Origin not allowed by CORS"));
}

function createRateLimiter({ windowMs = 60000, max = 60, keyPrefix = "rl" } = {}) {
  const hits = new Map();

  return (req, res, next) => {
    const now = Date.now();
    const key = `${keyPrefix}:${req.ip || req.connection?.remoteAddress || "unknown"}`;
    const current = hits.get(key) || { count: 0, resetAt: now + windowMs };

    if (current.resetAt <= now) {
      current.count = 0;
      current.resetAt = now + windowMs;
    }

    current.count += 1;
    hits.set(key, current);

    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, max - current.count)));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(current.resetAt / 1000)));

    if (current.count > max) {
      return res.status(429).json({
        status: false,
        message: "Terlalu banyak request. Coba lagi beberapa saat.",
      });
    }

    return next();
  };
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

  const isDashboardMutation =
    req.path.startsWith("/client") ||
    req.path.startsWith("/admin") ||
    req.path.startsWith("/message/send");

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
};
