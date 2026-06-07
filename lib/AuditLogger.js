function getActor(req) {
  const user = req?.session?.adminImpersonator || req?.session?.user || {};
  return {
    role: user.role || null,
    uid: user.uid || null,
    name: user.name || user.email || null,
  };
}

async function logAudit(pool, req, action, options = {}) {
  if (!pool || !action) return;

  const actor = getActor(req);
  const metadata = options.metadata ? JSON.stringify(options.metadata).slice(0, 10000) : null;

  try {
    await pool.query(
      `INSERT INTO audit_logs
        (actor_role, actor_uid, actor_name, action, target_type, target_id, ip, user_agent, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        actor.role,
        actor.uid,
        actor.name,
        String(action).slice(0, 120),
        options.targetType ? String(options.targetType).slice(0, 80) : null,
        options.targetId ? String(options.targetId).slice(0, 120) : null,
        String(req?.ip || req?.connection?.remoteAddress || "").slice(0, 64),
        String(req?.get?.("user-agent") || "").slice(0, 255),
        metadata,
      ],
    );
  } catch (error) {
    console.error("Audit log error:", error.message || error);
  }
}

module.exports = {
  logAudit,
};
