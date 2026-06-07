class AuthLockout {
  constructor(pool, options = {}) {
    this.pool = pool;
    this.maxFailures = Number(options.maxFailures || process.env.AUTH_LOCKOUT_MAX || 5);
    this.lockMinutes = Number(options.lockMinutes || process.env.AUTH_LOCKOUT_MINUTES || 15);
  }

  normalizeIdentifier(identifier) {
    return String(identifier || "").trim().toLowerCase().slice(0, 120);
  }

  getIp(req) {
    return String(req.ip || req.connection?.remoteAddress || "unknown").slice(0, 64);
  }

  async assertAllowed(identifier, req) {
    const cleanIdentifier = this.normalizeIdentifier(identifier);
    if (!cleanIdentifier) return;

    const [rows] = await this.pool.query(
      `SELECT failures, locked_until
       FROM auth_attempts
       WHERE ip = ? AND identifier = ?
       LIMIT 1`,
      [this.getIp(req), cleanIdentifier],
    );

    const attempt = rows[0];
    if (!attempt?.locked_until) return;

    const lockedUntil = new Date(attempt.locked_until);
    if (lockedUntil > new Date()) {
      const minutes = Math.max(1, Math.ceil((lockedUntil.getTime() - Date.now()) / 60000));
      throw new Error(`Terlalu banyak percobaan login gagal. Coba lagi sekitar ${minutes} menit.`);
    }
  }

  async recordFailure(identifier, req) {
    const cleanIdentifier = this.normalizeIdentifier(identifier);
    if (!cleanIdentifier) return;

    const ip = this.getIp(req);
    await this.pool.query(
      `INSERT INTO auth_attempts (ip, identifier, failures, last_attempt)
       VALUES (?, ?, 1, NOW())
       ON DUPLICATE KEY UPDATE
         failures = IF(locked_until IS NULL OR locked_until <= NOW(), failures + 1, failures),
         last_attempt = NOW(),
         locked_until = IF(
           (locked_until IS NULL OR locked_until <= NOW()) AND failures + 1 >= ?,
           DATE_ADD(NOW(), INTERVAL ? MINUTE),
           locked_until
         )`,
      [ip, cleanIdentifier, this.maxFailures, this.lockMinutes],
    );
  }

  async recordSuccess(identifier, req) {
    const cleanIdentifier = this.normalizeIdentifier(identifier);
    if (!cleanIdentifier) return;

    await this.pool.query(
      "DELETE FROM auth_attempts WHERE ip = ? AND identifier = ?",
      [this.getIp(req), cleanIdentifier],
    );
  }
}

module.exports = AuthLockout;
