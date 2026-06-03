const { generateAPIKey } = require("../lib/Generate");
const { hashPassword } = require("../lib/Password");

class InitData {
  constructor(pool) {
    this.pool = pool;
  }

  async columnExists(connection, tableName, columnName) {
    const [rows] = await connection.query(
      `
        SELECT COUNT(*) AS total
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ?
          AND COLUMN_NAME = ?
      `,
      [tableName, columnName],
    );
    return Number(rows[0]?.total || 0) > 0;
  }

  async ensureColumn(connection, tableName, columnName, definition) {
    if (await this.columnExists(connection, tableName, columnName)) return;
    await connection.query(
      `ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` ${definition}`,
    );
  }

  async initDatabase() {
    const connection = await this.pool.getConnection();
    try {
      console.log("Initializing database...");

      await this.createTables(connection);
      await this.withLegacyDateMode(connection, async () => {
        await this.migrateExistingSchema(connection);
      });
      await this.seedDefaults(connection);

      console.log("Database initialized.");
    } catch (error) {
      console.error("Database initialization error:", error);
      throw error;
    } finally {
      connection.release();
    }
  }

  async withLegacyDateMode(connection, callback) {
    const [[row]] = await connection.query(
      "SELECT @@SESSION.sql_mode AS sql_mode",
    );
    const originalSqlMode = row?.sql_mode || "";
    const relaxedSqlMode = originalSqlMode
      .split(",")
      .filter((mode) => mode && mode !== "NO_ZERO_DATE" && mode !== "NO_ZERO_IN_DATE")
      .join(",");

    if (relaxedSqlMode !== originalSqlMode) {
      await connection.query("SET SESSION sql_mode = ?", [relaxedSqlMode]);
    }

    try {
      return await callback();
    } finally {
      if (relaxedSqlMode !== originalSqlMode) {
        await connection.query("SET SESSION sql_mode = ?", [originalSqlMode]);
      }
    }
  }

  async createTables(connection) {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        uid INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(60) NOT NULL,
        email VARCHAR(80) NOT NULL UNIQUE,
        phone VARCHAR(30) DEFAULT NULL,
        username VARCHAR(60) DEFAULT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        api_key VARCHAR(255) NOT NULL UNIQUE,
        template_invitation TEXT NULL,
        template_invitation_shared TEXT NULL,
        opt_in_required TINYINT(1) DEFAULT 0,
        active TINYINT(1) DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_active TIMESTAMP NULL DEFAULT NULL
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS admin (
        uid INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(60) NOT NULL,
        email VARCHAR(80) NOT NULL UNIQUE,
        phone VARCHAR(30) DEFAULT NULL,
        username VARCHAR(60) DEFAULT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        api_key VARCHAR(255) DEFAULT NULL UNIQUE,
        active TINYINT(1) DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS balances (
        uid INT NOT NULL PRIMARY KEY,
        balance DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        total_used DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (uid) REFERENCES users(uid) ON DELETE CASCADE
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS password_resets (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_type ENUM('client','admin') NOT NULL DEFAULT 'client',
        user_id INT NOT NULL,
        email VARCHAR(120) NOT NULL,
        token_hash VARCHAR(64) NOT NULL UNIQUE,
        expires_at DATETIME NOT NULL,
        used_at DATETIME DEFAULT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_password_resets_email (email),
        INDEX idx_password_resets_expires (expires_at)
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS packages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        limit_daily INT DEFAULT 50,
        life_time INT DEFAULT 30,
        description TEXT NULL,
        recomended TINYINT(1) DEFAULT 0,
        active TINYINT(1) DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS devices (
        id INT AUTO_INCREMENT PRIMARY KEY,
        uid INT NOT NULL,
        name VARCHAR(255) DEFAULT NULL,
        phone VARCHAR(255) DEFAULT NULL,
        status VARCHAR(30) DEFAULT 'connecting',
        life_time INT NOT NULL DEFAULT 30,
        last_life_decrement DATE DEFAULT NULL,
        \`limit\` INT NOT NULL DEFAULT 0,
        limit_daily INT NOT NULL DEFAULT 250,
        last_limit_decrement DATE DEFAULT NULL,
        device_key VARCHAR(255) NOT NULL UNIQUE,
        session_parent VARCHAR(255) DEFAULT NULL,
        packageId VARCHAR(30) DEFAULT NULL,
        webhook_url VARCHAR(255) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (uid) REFERENCES users(uid) ON DELETE CASCADE
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        uid INT NOT NULL,
        device_id INT NOT NULL,
        number TEXT NULL,
        message TEXT NULL,
        type ENUM('personal','bulk','group') NOT NULL,
        tags VARCHAR(100) DEFAULT NULL,
        role VARCHAR(30) DEFAULT NULL,
        campaign_id INT DEFAULT NULL,
        scheduled_at DATETIME DEFAULT NULL,
        status ENUM('pending','sent','failed','processing') DEFAULT 'pending',
        response TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NULL DEFAULT NULL,
        INDEX idx_messages_device_id (device_id),
        FOREIGN KEY (uid) REFERENCES users(uid) ON DELETE CASCADE
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS device_shares (
        id INT AUTO_INCREMENT PRIMARY KEY,
        device_id INT NOT NULL,
        owner_uid INT NOT NULL,
        shared_uid INT DEFAULT NULL,
        invite_code VARCHAR(40) NOT NULL UNIQUE,
        permission_send TINYINT(1) NOT NULL DEFAULT 1,
        ai_reply_mode ENUM('off','draft','auto') NOT NULL DEFAULT 'off',
        status ENUM('pending','active','revoked') NOT NULL DEFAULT 'pending',
        expires_at DATETIME DEFAULT NULL,
        accepted_at DATETIME DEFAULT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_device_shares_owner (owner_uid),
        INDEX idx_device_shares_shared (shared_uid),
        INDEX idx_device_shares_device (device_id),
        FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
        FOREIGN KEY (owner_uid) REFERENCES users(uid) ON DELETE CASCADE,
        FOREIGN KEY (shared_uid) REFERENCES users(uid) ON DELETE CASCADE
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS autoreply (
        id INT AUTO_INCREMENT PRIMARY KEY,
        uid INT NOT NULL,
        device_id INT NOT NULL,
        keyword VARCHAR(255) NOT NULL,
        response TEXT NOT NULL,
        status ENUM('active','inactive') NOT NULL DEFAULT 'active',
        used INT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        is_for_personal TINYINT(1) DEFAULT 1,
        is_for_group TINYINT(1) DEFAULT 0,
        FOREIGN KEY (uid) REFERENCES users(uid) ON DELETE CASCADE
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`groups\` (
        id INT AUTO_INCREMENT PRIMARY KEY,
        group_id VARCHAR(255) NOT NULL,
        group_key VARCHAR(30) NOT NULL,
        name VARCHAR(255) NOT NULL,
        device_key VARCHAR(30) NOT NULL,
        registered_at DATETIME NOT NULL,
        UNIQUE KEY unique_group_device (group_id, device_key)
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS contacts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        uid INT NOT NULL,
        device_id INT NOT NULL,
        jid VARCHAR(100) NOT NULL,
        phone VARCHAR(100) DEFAULT NULL,
        name VARCHAR(255) DEFAULT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_jid (uid, device_id, jid)
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS opt_ins (
        id INT AUTO_INCREMENT PRIMARY KEY,
        uid INT NOT NULL,
        device_id INT NOT NULL DEFAULT 0,
        number VARCHAR(50) NOT NULL,
        status ENUM('pending','approved','blocked') DEFAULT 'pending',
        source VARCHAR(50) DEFAULT 'chat',
        agreed_at TIMESTAMP NULL DEFAULT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_opt_in (uid, number)
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS opt_in_deleted (
        id INT AUTO_INCREMENT PRIMARY KEY,
        uid INT NOT NULL,
        device_id INT NOT NULL DEFAULT 0,
        number VARCHAR(50) NOT NULL,
        deleted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_opt_in_deleted (uid, number)
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        uid INT NOT NULL,
        merchantOrderId VARCHAR(255) DEFAULT NULL,
        paymentUrl VARCHAR(255) DEFAULT NULL,
        reference VARCHAR(255) DEFAULT NULL,
        description VARCHAR(255) NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        status ENUM('success','pending','failed','paid') NOT NULL,
        whatIs ENUM('+','-') DEFAULT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_transactions_merchant_order (merchantOrderId),
        FOREIGN KEY (uid) REFERENCES users(uid) ON DELETE CASCADE
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS message_templates (
        id INT AUTO_INCREMENT PRIMARY KEY,
        uid INT NOT NULL,
        name VARCHAR(100) NOT NULL,
        category VARCHAR(50) DEFAULT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (uid) REFERENCES users(uid) ON DELETE CASCADE
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS campaigns (
        id INT AUTO_INCREMENT PRIMARY KEY,
        uid INT NOT NULL,
        device_id INT DEFAULT NULL,
        device_key VARCHAR(255) DEFAULT NULL,
        name VARCHAR(120) NOT NULL,
        message TEXT NOT NULL,
        recipients_count INT NOT NULL DEFAULT 0,
        scheduled_at DATETIME DEFAULT NULL,
        status VARCHAR(30) DEFAULT 'queued',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (uid) REFERENCES users(uid) ON DELETE CASCADE
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS inbox_messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        uid INT NOT NULL,
        device_id INT NOT NULL,
        device_key VARCHAR(255) DEFAULT NULL,
        remote_jid VARCHAR(120) NOT NULL,
        push_name VARCHAR(255) DEFAULT NULL,
        message TEXT NOT NULL,
        message_id VARCHAR(120) DEFAULT NULL,
        is_group TINYINT(1) DEFAULT 0,
        from_me TINYINT(1) DEFAULT 0,
        received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_inbox_uid_received (uid, received_at),
        FOREIGN KEY (uid) REFERENCES users(uid) ON DELETE CASCADE
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS webhook_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        uid INT NOT NULL,
        device_id INT NOT NULL,
        device_key VARCHAR(255) DEFAULT NULL,
        webhook_url VARCHAR(255) NOT NULL,
        event VARCHAR(80) NOT NULL,
        status VARCHAR(30) NOT NULL,
        http_status INT DEFAULT NULL,
        error_message TEXT NULL,
        payload TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_webhook_logs_uid_created (uid, created_at),
        FOREIGN KEY (uid) REFERENCES users(uid) ON DELETE CASCADE
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        uid INT NOT NULL,
        action VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (uid) REFERENCES users(uid) ON DELETE CASCADE
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS ai_settings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        uid INT NOT NULL,
        provider VARCHAR(50) NOT NULL DEFAULT 'openai',
        base_url VARCHAR(255) DEFAULT NULL,
        api_key TEXT NULL,
        model VARCHAR(120) DEFAULT NULL,
        temperature DECIMAL(3,2) DEFAULT 0.30,
        max_tokens INT DEFAULT 600,
        system_prompt TEXT NULL,
        auto_reply_enabled TINYINT(1) DEFAULT 0,
        draft_only TINYINT(1) DEFAULT 1,
        active TINYINT(1) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_ai_settings_uid (uid),
        FOREIGN KEY (uid) REFERENCES users(uid) ON DELETE CASCADE
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS ai_knowledge_sources (
        id INT AUTO_INCREMENT PRIMARY KEY,
        uid INT NOT NULL,
        title VARCHAR(120) NOT NULL,
        source_type ENUM('text','link') NOT NULL DEFAULT 'text',
        content TEXT NULL,
        url VARCHAR(500) DEFAULT NULL,
        active TINYINT(1) DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_ai_knowledge_uid (uid),
        FOREIGN KEY (uid) REFERENCES users(uid) ON DELETE CASCADE
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS ai_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        uid INT NOT NULL,
        provider VARCHAR(50) DEFAULT NULL,
        model VARCHAR(120) DEFAULT NULL,
        prompt TEXT NOT NULL,
        response TEXT NULL,
        status VARCHAR(30) NOT NULL DEFAULT 'success',
        error_message TEXT NULL,
        source VARCHAR(50) DEFAULT 'test',
        tokens_used INT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_ai_logs_uid_created (uid, created_at),
        FOREIGN KEY (uid) REFERENCES users(uid) ON DELETE CASCADE
      )
    `);
  }

  async migrateExistingSchema(connection) {
    await this.ensureColumn(connection, "users", "username", "VARCHAR(60) DEFAULT NULL");
    await this.ensureColumn(connection, "users", "template_invitation", "TEXT NULL");
    await this.ensureColumn(connection, "users", "template_invitation_shared", "TEXT NULL");
    await this.ensureColumn(connection, "users", "opt_in_required", "TINYINT(1) DEFAULT 0");
    await this.ensureColumn(connection, "users", "active", "TINYINT(1) DEFAULT 1");
    await this.ensureColumn(connection, "users", "last_active", "TIMESTAMP NULL DEFAULT NULL");
    await connection.query("ALTER TABLE users MODIFY username VARCHAR(60) DEFAULT NULL");
    await connection.query("ALTER TABLE users MODIFY active TINYINT(1) DEFAULT 1");

    await this.ensureColumn(connection, "admin", "username", "VARCHAR(60) DEFAULT NULL");
    await this.ensureColumn(connection, "admin", "api_key", "VARCHAR(255) DEFAULT NULL");
    await this.ensureColumn(connection, "admin", "active", "TINYINT(1) DEFAULT 1");
    await connection.query("ALTER TABLE admin MODIFY active TINYINT(1) DEFAULT 1");
    await connection.query("ALTER TABLE admin MODIFY username VARCHAR(60) DEFAULT NULL");

    await this.ensureColumn(connection, "packages", "limit_daily", "INT DEFAULT NULL");
    await this.ensureColumn(connection, "packages", "life_time", "INT DEFAULT NULL");
    await this.ensureColumn(connection, "packages", "recomended", "TINYINT(1) DEFAULT 0");
    await this.ensureColumn(connection, "packages", "updated_at", "TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP");

    if (await this.columnExists(connection, "packages", "duration")) {
      await connection.query(`
        UPDATE packages
        SET life_time = duration
        WHERE duration IS NOT NULL
          AND (life_time IS NULL OR life_time = 0)
      `);
    }
    if (await this.columnExists(connection, "packages", "message_limit")) {
      await connection.query(`
        UPDATE packages
        SET limit_daily = message_limit
        WHERE message_limit IS NOT NULL
          AND (limit_daily IS NULL OR limit_daily = 0)
      `);
    }
    await connection.query("UPDATE packages SET life_time = COALESCE(NULLIF(life_time, 0), 30)");
    await connection.query("UPDATE packages SET limit_daily = COALESCE(NULLIF(limit_daily, 0), 50)");

    await this.ensureColumn(connection, "devices", "life_time", "INT NOT NULL DEFAULT 30");
    await this.ensureColumn(connection, "devices", "last_life_decrement", "DATE DEFAULT NULL");
    await this.ensureColumn(connection, "devices", "limit", "INT NOT NULL DEFAULT 0");
    await this.ensureColumn(connection, "devices", "limit_daily", "INT NOT NULL DEFAULT 250");
    await this.ensureColumn(connection, "devices", "last_limit_decrement", "DATE DEFAULT NULL");
    await this.ensureColumn(connection, "devices", "session_parent", "VARCHAR(255) DEFAULT NULL");
    await this.ensureColumn(connection, "devices", "webhook_url", "VARCHAR(255) DEFAULT NULL");
    await connection.query("ALTER TABLE devices MODIFY session_parent VARCHAR(255) DEFAULT NULL");
    await connection.query(
      "UPDATE devices SET last_life_decrement = '1970-01-01' WHERE CAST(last_life_decrement AS CHAR) = '0000-00-00'",
    );
    await connection.query(
      "UPDATE devices SET last_limit_decrement = '1970-01-01' WHERE CAST(last_limit_decrement AS CHAR) = '0000-00-00'",
    );
    await connection.query("ALTER TABLE devices MODIFY status VARCHAR(30) DEFAULT 'connecting'");

    await this.ensureColumn(connection, "messages", "tags", "VARCHAR(100) DEFAULT NULL");
    await this.ensureColumn(connection, "messages", "role", "VARCHAR(30) DEFAULT NULL");
    await this.ensureColumn(connection, "messages", "campaign_id", "INT DEFAULT NULL");
    await this.ensureColumn(connection, "messages", "scheduled_at", "DATETIME DEFAULT NULL");
    await this.ensureColumn(connection, "messages", "response", "TEXT NULL");
    await this.ensureColumn(connection, "messages", "updated_at", "TIMESTAMP NULL DEFAULT NULL");
    await connection.query("ALTER TABLE messages MODIFY number TEXT NULL");
    await connection.query("ALTER TABLE messages MODIFY message TEXT NULL");

    await this.ensureColumn(connection, "device_shares", "permission_send", "TINYINT(1) NOT NULL DEFAULT 1");
    await this.ensureColumn(connection, "device_shares", "limit_daily_override", "INT DEFAULT NULL");
    await this.ensureColumn(connection, "device_shares", "ai_reply_mode", "ENUM('off','draft','auto') NOT NULL DEFAULT 'off'");
    await this.ensureColumn(connection, "device_shares", "expires_at", "DATETIME DEFAULT NULL");
    await this.ensureColumn(connection, "device_shares", "accepted_at", "DATETIME DEFAULT NULL");
    await this.ensureColumn(connection, "device_shares", "updated_at", "TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP");

    await this.ensureColumn(connection, "ai_settings", "base_url", "VARCHAR(255) DEFAULT NULL");
    await this.ensureColumn(connection, "ai_settings", "api_key", "TEXT NULL");
    await this.ensureColumn(connection, "ai_settings", "model", "VARCHAR(120) DEFAULT NULL");
    await this.ensureColumn(connection, "ai_settings", "temperature", "DECIMAL(3,2) DEFAULT 0.30");
    await this.ensureColumn(connection, "ai_settings", "max_tokens", "INT DEFAULT 600");
    await this.ensureColumn(connection, "ai_settings", "system_prompt", "TEXT NULL");
    await this.ensureColumn(connection, "ai_settings", "auto_reply_enabled", "TINYINT(1) DEFAULT 0");
    await this.ensureColumn(connection, "ai_settings", "draft_only", "TINYINT(1) DEFAULT 1");
    await this.ensureColumn(connection, "ai_settings", "active", "TINYINT(1) DEFAULT 0");

    await this.ensureColumn(connection, "autoreply", "device_id", "INT NOT NULL DEFAULT 0");
    await this.ensureColumn(connection, "autoreply", "is_for_personal", "TINYINT(1) DEFAULT 1");
    await this.ensureColumn(connection, "autoreply", "is_for_group", "TINYINT(1) DEFAULT 0");

    await this.ensureColumn(connection, "transactions", "merchantOrderId", "VARCHAR(255) DEFAULT NULL");
    await this.ensureColumn(connection, "transactions", "paymentUrl", "VARCHAR(255) DEFAULT NULL");
    await this.ensureColumn(connection, "transactions", "reference", "VARCHAR(255) DEFAULT NULL");
    await this.ensureColumn(connection, "transactions", "whatIs", "ENUM('+','-') DEFAULT NULL");
    await this.ensureColumn(connection, "transactions", "updated_at", "TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP");

    await this.backfillOptInsFromInbox(connection);
  }

  async backfillOptInsFromInbox(connection) {
    try {
      const [approvedResult] = await connection.query(`
        INSERT INTO opt_ins (uid, device_id, number, status, source, agreed_at)
        SELECT
          im.uid,
          im.device_id,
          COALESCE(
            NULLIF(REPLACE(REPLACE(REPLACE(c.phone, '+', ''), ' ', ''), '-', ''), ''),
            SUBSTRING_INDEX(SUBSTRING_INDEX(im.remote_jid, ':', 1), '@', 1)
          ) AS number,
          'approved',
          'chat_explicit',
          COALESCE(im.received_at, NOW())
        FROM inbox_messages im
        LEFT JOIN contacts c
          ON c.uid = im.uid
         AND c.jid = CASE
           WHEN im.remote_jid LIKE '%:%'
             THEN CONCAT(SUBSTRING_INDEX(im.remote_jid, ':', 1), '@', SUBSTRING_INDEX(im.remote_jid, '@', -1))
           ELSE im.remote_jid
         END
        WHERE im.from_me = 0
          AND im.is_group = 0
          AND LOWER(TRIM(im.message)) IN ('setuju', 'srtuju', 'stuju', 'saya setuju', 'aktifkan notifikasi', 'daftar notifikasi')
          AND im.remote_jid IS NOT NULL
          AND im.remote_jid != ''
        ON DUPLICATE KEY UPDATE
          status = VALUES(status),
          source = VALUES(source),
          device_id = VALUES(device_id),
          agreed_at = COALESCE(opt_ins.agreed_at, VALUES(agreed_at)),
          updated_at = NOW()
      `);

      const [blockedResult] = await connection.query(`
        INSERT INTO opt_ins (uid, device_id, number, status, source, agreed_at)
        SELECT
          im.uid,
          im.device_id,
          COALESCE(
            NULLIF(REPLACE(REPLACE(REPLACE(c.phone, '+', ''), ' ', ''), '-', ''), ''),
            SUBSTRING_INDEX(SUBSTRING_INDEX(im.remote_jid, ':', 1), '@', 1)
          ) AS number,
          'blocked',
          'chat_explicit',
          NULL
        FROM inbox_messages im
        LEFT JOIN contacts c
          ON c.uid = im.uid
         AND c.jid = CASE
           WHEN im.remote_jid LIKE '%:%'
             THEN CONCAT(SUBSTRING_INDEX(im.remote_jid, ':', 1), '@', SUBSTRING_INDEX(im.remote_jid, '@', -1))
           ELSE im.remote_jid
         END
        WHERE im.from_me = 0
          AND im.is_group = 0
          AND (
            LOWER(TRIM(im.message)) IN ('stop', 'berhenti', 'tidak setuju', 'unsubs', 'blokir')
            OR LOWER(im.message) LIKE '%tidak setuju%'
          )
          AND im.remote_jid IS NOT NULL
          AND im.remote_jid != ''
        ON DUPLICATE KEY UPDATE
          status = VALUES(status),
          source = VALUES(source),
          device_id = VALUES(device_id),
          agreed_at = NULL,
          updated_at = NOW()
      `);

      const changed =
        Number(approvedResult.affectedRows || 0) +
        Number(blockedResult.affectedRows || 0);
      if (changed > 0) {
        console.log(`Backfilled/updated ${changed} opt-in records from inbox replies.`);
      }
    } catch (error) {
      console.warn("Opt-in inbox backfill skipped:", error.message);
    }
  }

  async seedDefaults(connection) {
    const [adminRows] = await connection.query("SELECT COUNT(*) AS count FROM admin");
    if (Number(adminRows[0]?.count || 0) === 0) {
      const defaultPassword =
        process.env.ADMIN_DEFAULT_PASSWORD ||
        (process.env.NODE_ENV === "production" ? generateAPIKey().slice(0, 16) : "admin123");
      await connection.query(
        `
          INSERT INTO admin (name, email, phone, username, password, api_key, active)
          VALUES (?, ?, ?, ?, ?, ?, 1)
        `,
        [
          "Admin",
          "admin@example.com",
          "123456789",
          "admin",
          hashPassword(defaultPassword),
          generateAPIKey(),
        ],
      );
      console.log(
        process.env.ADMIN_DEFAULT_PASSWORD
          ? "Default admin created from ADMIN_DEFAULT_PASSWORD."
          : `Default admin created with password: ${defaultPassword}. Change it after first login.`,
      );
    }

    const [packageRows] = await connection.query("SELECT COUNT(*) AS count FROM packages");
    if (Number(packageRows[0]?.count || 0) === 0) {
      await connection.query(`
        INSERT INTO packages (name, price, limit_daily, life_time, description, recomended, active)
        VALUES
          ('Gratis', 0.00, 50, 3650, '1 Perangkat, 50 pesan/hari, Fitur dasar.', 0, 1),
          ('Pro Developer', 50000.00, 2000, 30, 'Tanpa batas pesan, media, webhook, dan fitur premium lainnya.', 1, 1)
      `);
    }
  }
}

module.exports = InitData;
