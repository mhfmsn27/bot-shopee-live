/**
 * Enterprise SQLite Database Manager - Shopee Live View Bot Apps
 * Menggunakan engine native Node.js (node:sqlite - DatabaseSync) dengan:
 * - Write-Ahead Logging (WAL) Mode untuk konkurensi tinggi (read & write serentak tanpa lock)
 * - B-Tree Indexing pada kolom-kolom pencarian & filter kritis
 * - Transaksi ACID atomik untuk eksekusi batch aman
 * - Automated JSON Migrator & Dual-Sync Snapshot untuk menjamin 100% backward compatibility
 */

const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '../../data');
const DB_PATH = path.join(DATA_DIR, 'shopee_bot.db');

// At-Rest Encryption Configuration (AES-256-GCM)
const APP_SECRET = process.env.APP_SECRET_KEY || 'shopee-live-enterprise-secret-key-32b!';
const ENCRYPTION_KEY = crypto.createHash('sha256').update(APP_SECRET).digest();

/**
 * Enkripsi simetris AES-256-GCM untuk kolom sensitif (Cookies & Passwords)
 * @param {string} plaintext
 */
function encryptSensitiveData(plaintext) {
  if (!plaintext || typeof plaintext !== 'string' || plaintext.startsWith('enc:v1:')) {
    return plaintext;
  }
  try {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag().toString('hex');
    return `enc:v1:${iv.toString('hex')}:${tag}:${encrypted}`;
  } catch (e) {
    return plaintext;
  }
}

/**
 * Dekripsi simetris AES-256-GCM untuk data sensitif
 * Mendukung graceful fallback pada data plaintext yang belum terenkripsi (100% backward compatible)
 * @param {string} ciphertext
 */
function decryptSensitiveData(ciphertext) {
  if (!ciphertext || typeof ciphertext !== 'string' || !ciphertext.startsWith('enc:v1:')) {
    return ciphertext;
  }
  try {
    const parts = ciphertext.split(':');
    const iv = Buffer.from(parts[2], 'hex');
    const tag = Buffer.from(parts[3], 'hex');
    const data = parts[4];
    const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    return ciphertext;
  }
}

class SqliteManager {
  constructor(dbPath = DB_PATH) {
    this.dbPath = dbPath;
    this.initDatabase();
    this.autoMigrateFromJson();
  }

  /**
   * Inisialisasi koneksi SQLite, PRAGMA flags, tabel, dan indeks B-Tree
   */
  initDatabase() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    this.db = new DatabaseSync(this.dbPath);

    // Konfigurasi performa enterprise SQLite
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA busy_timeout = 5000;');

    // 1. Tabel Akun & Identitas
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        username TEXT,
        name TEXT,
        email TEXT,
        phone TEXT,
        city TEXT,
        avatar TEXT,
        bio TEXT,
        account_type TEXT,
        status TEXT,
        cookies TEXT,
        cookie_status TEXT,
        assigned_proxy_id TEXT,
        assigned_proxy_json TEXT,
        raw_json TEXT,
        created_at TEXT,
        updated_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_accounts_status ON accounts(status);
      CREATE INDEX IF NOT EXISTS idx_accounts_type ON accounts(account_type);
      CREATE INDEX IF NOT EXISTS idx_accounts_proxy ON accounts(assigned_proxy_id);
    `);

    // 2. Tabel Proxy Pool
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS proxies (
        id TEXT PRIMARY KEY,
        ip TEXT,
        port INTEGER,
        protocol TEXT,
        type TEXT,
        username TEXT,
        password TEXT,
        city TEXT,
        country TEXT,
        latency INTEGER,
        status TEXT,
        assigned_accounts_count INTEGER DEFAULT 0,
        raw_json TEXT,
        created_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_proxies_protocol ON proxies(protocol);
      CREATE INDEX IF NOT EXISTS idx_proxies_type ON proxies(type);
      CREATE INDEX IF NOT EXISTS idx_proxies_status ON proxies(status);
    `);

    // 3. Tabel Campaign History (Riwayat Siaran)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS campaign_history (
        id TEXT PRIMARY KEY,
        campaign_id TEXT,
        name TEXT,
        room_id TEXT,
        start_time TEXT,
        end_time TEXT,
        duration_minutes INTEGER,
        peak_viewers INTEGER,
        accumulated_views INTEGER,
        total_likes INTEGER,
        total_comments INTEGER,
        total_cart_clicks INTEGER,
        bandwidth_mb REAL,
        stop_reason TEXT,
        raw_json TEXT,
        created_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_history_start ON campaign_history(start_time);
    `);

    // 4. Tabel Schedules (Jadwal Siaran)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schedules (
        id TEXT PRIMARY KEY,
        title TEXT,
        target_url TEXT,
        target_viewers INTEGER,
        duration_minutes INTEGER,
        scheduled_at TEXT,
        status TEXT,
        raw_json TEXT,
        created_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_schedules_time ON schedules(scheduled_at);
    `);

    // 5. Tabel Comment Banks
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS comment_banks (
        category TEXT PRIMARY KEY,
        comments_json TEXT,
        updated_at TEXT
      );
    `);

    // 6. Tabel System Config
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS system_config (
        key TEXT PRIMARY KEY,
        value_json TEXT,
        updated_at TEXT
      );
    `);

    // 7. Tabel Active Campaigns State (Crash Recovery & Auto-Resume)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS active_campaigns_state (
        id TEXT PRIMARY KEY,
        room_id TEXT,
        target_viewers INTEGER,
        retention_mode TEXT,
        status TEXT,
        config_json TEXT,
        started_at TEXT,
        updated_at TEXT
      );
    `);

    // 8. Tabel Auth Sessions (Stateful Token Management & Revocation)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS auth_sessions (
        token TEXT PRIMARY KEY,
        username TEXT,
        ip TEXT,
        user_agent TEXT,
        created_at INTEGER,
        last_activity_at INTEGER,
        expires_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_expires ON auth_sessions(expires_at);
      CREATE INDEX IF NOT EXISTS idx_sessions_token ON auth_sessions(token);
    `);

    this.prepareStatements();
  }

  prepareStatements() {
    // Accounts Prepared Statements
    this.stmtInsertAccount = this.db.prepare(`
      INSERT OR REPLACE INTO accounts (
        id, username, name, email, phone, city, avatar, bio,
        account_type, status, cookies, cookie_status,
        assigned_proxy_id, assigned_proxy_json, raw_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.stmtSelectAllAccounts = this.db.prepare(`SELECT raw_json FROM accounts ORDER BY created_at DESC`);
    this.stmtSelectAccountById = this.db.prepare(`SELECT raw_json FROM accounts WHERE id = ?`);
    this.stmtDeleteAccount = this.db.prepare(`DELETE FROM accounts WHERE id = ?`);
    this.stmtCountAccounts = this.db.prepare(`SELECT COUNT(*) as count FROM accounts`);

    // Proxies Prepared Statements
    this.stmtInsertProxy = this.db.prepare(`
      INSERT OR REPLACE INTO proxies (
        id, ip, port, protocol, type, username, password,
        city, country, latency, status, assigned_accounts_count, raw_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.stmtSelectAllProxies = this.db.prepare(`SELECT raw_json FROM proxies`);
    this.stmtSelectProxyById = this.db.prepare(`SELECT raw_json FROM proxies WHERE id = ?`);
    this.stmtDeleteProxy = this.db.prepare(`DELETE FROM proxies WHERE id = ?`);
    this.stmtCountProxies = this.db.prepare(`SELECT COUNT(*) as count FROM proxies`);

    // Campaign History Prepared Statements
    this.stmtInsertHistory = this.db.prepare(`
      INSERT OR REPLACE INTO campaign_history (
        id, campaign_id, name, room_id, start_time, end_time,
        duration_minutes, peak_viewers, accumulated_views,
        total_likes, total_comments, total_cart_clicks,
        bandwidth_mb, stop_reason, raw_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.stmtSelectAllHistory = this.db.prepare(`SELECT raw_json FROM campaign_history ORDER BY start_time DESC`);
    this.stmtDeleteHistory = this.db.prepare(`DELETE FROM campaign_history WHERE id = ? OR campaign_id = ?`);
    this.stmtClearHistory = this.db.prepare(`DELETE FROM campaign_history`);

    // Schedules Prepared Statements
    this.stmtInsertSchedule = this.db.prepare(`
      INSERT OR REPLACE INTO schedules (
        id, title, target_url, target_viewers, duration_minutes,
        scheduled_at, status, raw_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.stmtSelectAllSchedules = this.db.prepare(`SELECT raw_json FROM schedules ORDER BY scheduled_at ASC`);
    this.stmtDeleteSchedule = this.db.prepare(`DELETE FROM schedules WHERE id = ?`);

    // Comment Banks Prepared Statements
    this.stmtInsertCommentBank = this.db.prepare(`
      INSERT OR REPLACE INTO comment_banks (category, comments_json, updated_at)
      VALUES (?, ?, ?)
    `);
    this.stmtSelectAllCommentBanks = this.db.prepare(`SELECT category, comments_json FROM comment_banks`);

    // System Config Prepared Statements
    this.stmtInsertConfig = this.db.prepare(`
      INSERT OR REPLACE INTO system_config (key, value_json, updated_at)
      VALUES (?, ?, ?)
    `);
    this.stmtSelectConfig = this.db.prepare(`SELECT value_json FROM system_config WHERE key = ?`);
    this.stmtSelectAllConfig = this.db.prepare(`SELECT key, value_json FROM system_config`);

    // Active Campaigns State Prepared Statements
    this.stmtInsertActiveCampaignState = this.db.prepare(`
      INSERT OR REPLACE INTO active_campaigns_state (
        id, room_id, target_viewers, retention_mode, status, config_json, started_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.stmtSelectAllActiveCampaignStates = this.db.prepare(`SELECT * FROM active_campaigns_state`);
    this.stmtDeleteActiveCampaignState = this.db.prepare(`DELETE FROM active_campaigns_state WHERE id = ?`);
    this.stmtClearActiveCampaignStates = this.db.prepare(`DELETE FROM active_campaigns_state`);

    // Auth Sessions Prepared Statements
    this.stmtInsertSession = this.db.prepare(`
      INSERT OR REPLACE INTO auth_sessions (
        token, username, ip, user_agent, created_at, last_activity_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    this.stmtSelectSession = this.db.prepare(`SELECT * FROM auth_sessions WHERE token = ?`);
    this.stmtUpdateSessionActivity = this.db.prepare(`UPDATE auth_sessions SET last_activity_at = ? WHERE token = ?`);
    this.stmtDeleteSession = this.db.prepare(`DELETE FROM auth_sessions WHERE token = ?`);
    this.stmtDeleteAllSessions = this.db.prepare(`DELETE FROM auth_sessions`);
    this.stmtCleanExpiredSessions = this.db.prepare(`DELETE FROM auth_sessions WHERE expires_at < ?`);
  }

  /**
   * Eksekusi transaksi atomik SQLite (ACID compliant)
   */
  transaction(fn) {
    this.db.exec('BEGIN TRANSACTION;');
    try {
      const result = fn();
      this.db.exec('COMMIT;');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK;');
      throw err;
    }
  }

  // =========================================================================
  // ACCOUNTS CRUD
  // =========================================================================
  getAllAccounts() {
    const rows = this.stmtSelectAllAccounts.all();
    return rows.map(r => {
      const acc = JSON.parse(r.raw_json);
      if (acc.cookies) acc.cookies = decryptSensitiveData(acc.cookies);
      return acc;
    });
  }

  getAccountById(id) {
    const row = this.stmtSelectAccountById.get(id);
    if (!row) return null;
    const acc = JSON.parse(row.raw_json);
    if (acc.cookies) acc.cookies = decryptSensitiveData(acc.cookies);
    return acc;
  }

  saveAccount(acc) {
    const now = new Date().toISOString();
    const encCookies = acc.cookies ? encryptSensitiveData(acc.cookies) : '';
    const storedAcc = {
      ...acc,
      cookies: encCookies
    };
    const rawJson = JSON.stringify(storedAcc);
    this.stmtInsertAccount.run(
      acc.id,
      acc.username || '',
      acc.name || '',
      acc.email || '',
      acc.phone || '',
      acc.city || '',
      acc.avatar || '',
      acc.bio || '',
      acc.accountType || 'persona',
      acc.status || 'ready',
      encCookies,
      acc.cookieStatus || 'none',
      acc.assignedProxy ? acc.assignedProxy.id : null,
      acc.assignedProxy ? JSON.stringify(acc.assignedProxy) : null,
      rawJson,
      acc.createdAt || now,
      acc.updatedAt || now
    );
    this.exportAccountsSnapshot();
    return acc;
  }

  saveAccountsBatch(accounts) {
    const now = new Date().toISOString();
    this.transaction(() => {
      for (const acc of accounts) {
        const encCookies = acc.cookies ? encryptSensitiveData(acc.cookies) : '';
        const storedAcc = {
          ...acc,
          cookies: encCookies
        };
        const rawJson = JSON.stringify(storedAcc);
        this.stmtInsertAccount.run(
          acc.id,
          acc.username || '',
          acc.name || '',
          acc.email || '',
          acc.phone || '',
          acc.city || '',
          acc.avatar || '',
          acc.bio || '',
          acc.accountType || 'persona',
          acc.status || 'ready',
          encCookies,
          acc.cookieStatus || 'none',
          acc.assignedProxy ? acc.assignedProxy.id : null,
          acc.assignedProxy ? JSON.stringify(acc.assignedProxy) : null,
          rawJson,
          acc.createdAt || now,
          acc.updatedAt || now
        );
      }
    });
    this.exportAccountsSnapshot();
  }

  replaceAccounts(accounts) {
    const now = new Date().toISOString();
    this.transaction(() => {
      this.db.exec('DELETE FROM accounts;');
      for (const acc of accounts) {
        const encCookies = acc.cookies ? encryptSensitiveData(acc.cookies) : '';
        const storedAcc = {
          ...acc,
          cookies: encCookies
        };
        const rawJson = JSON.stringify(storedAcc);
        this.stmtInsertAccount.run(
          acc.id,
          acc.username || '',
          acc.name || '',
          acc.email || '',
          acc.phone || '',
          acc.city || '',
          acc.avatar || '',
          acc.bio || '',
          acc.accountType || 'persona',
          acc.status || 'ready',
          encCookies,
          acc.cookieStatus || 'none',
          acc.assignedProxy ? acc.assignedProxy.id : null,
          acc.assignedProxy ? JSON.stringify(acc.assignedProxy) : null,
          rawJson,
          acc.createdAt || now,
          acc.updatedAt || now
        );
      }
    });
    this.exportAccountsSnapshot();
  }

  deleteAccount(id) {
    this.stmtDeleteAccount.run(id);
    this.exportAccountsSnapshot();
  }

  getAccountsCount() {
    const row = this.stmtCountAccounts.get();
    return row ? Number(row.count) : 0;
  }

  // =========================================================================
  // PROXIES CRUD
  // =========================================================================
  getAllProxies() {
    const rows = this.stmtSelectAllProxies.all();
    return rows.map(r => {
      const prx = JSON.parse(r.raw_json);
      if (prx.password) prx.password = decryptSensitiveData(prx.password);
      return prx;
    });
  }

  getProxyById(id) {
    const row = this.stmtSelectProxyById.get(id);
    if (!row) return null;
    const prx = JSON.parse(row.raw_json);
    if (prx.password) prx.password = decryptSensitiveData(prx.password);
    return prx;
  }

  saveProxy(proxy) {
    const now = new Date().toISOString();
    const encPassword = proxy.password ? encryptSensitiveData(proxy.password) : '';
    const storedProxy = {
      ...proxy,
      password: encPassword
    };
    const rawJson = JSON.stringify(storedProxy);
    this.stmtInsertProxy.run(
      proxy.id,
      proxy.ip,
      Number(proxy.port),
      (proxy.protocol || 'http').toLowerCase(),
      (proxy.type || 'datacenter').toLowerCase(),
      proxy.username || '',
      encPassword,
      proxy.city || '',
      proxy.country || '',
      Number(proxy.latency || 0),
      proxy.status || 'untested',
      Number(proxy.assignedAccountsCount || 0),
      rawJson,
      proxy.createdAt || now
    );
    this.exportProxiesSnapshot();
    return proxy;
  }

  saveProxiesBatch(proxies) {
    const now = new Date().toISOString();
    this.transaction(() => {
      for (const proxy of proxies) {
        const encPassword = proxy.password ? encryptSensitiveData(proxy.password) : '';
        const storedProxy = {
          ...proxy,
          password: encPassword
        };
        const rawJson = JSON.stringify(storedProxy);
        this.stmtInsertProxy.run(
          proxy.id,
          proxy.ip,
          Number(proxy.port),
          (proxy.protocol || 'http').toLowerCase(),
          (proxy.type || 'datacenter').toLowerCase(),
          proxy.username || '',
          encPassword,
          proxy.city || '',
          proxy.country || '',
          Number(proxy.latency || 0),
          proxy.status || 'untested',
          Number(proxy.assignedAccountsCount || 0),
          rawJson,
          proxy.createdAt || now
        );
      }
    });
    this.exportProxiesSnapshot();
  }

  replaceProxies(proxies) {
    const now = new Date().toISOString();
    this.transaction(() => {
      this.db.exec('DELETE FROM proxies;');
      for (const proxy of proxies) {
        const encPassword = proxy.password ? encryptSensitiveData(proxy.password) : '';
        const storedProxy = {
          ...proxy,
          password: encPassword
        };
        const rawJson = JSON.stringify(storedProxy);
        this.stmtInsertProxy.run(
          proxy.id,
          proxy.ip,
          Number(proxy.port),
          (proxy.protocol || 'http').toLowerCase(),
          (proxy.type || 'datacenter').toLowerCase(),
          proxy.username || '',
          encPassword,
          proxy.city || '',
          proxy.country || '',
          Number(proxy.latency || 0),
          proxy.status || 'untested',
          Number(proxy.assignedAccountsCount || 0),
          rawJson,
          proxy.createdAt || now
        );
      }
    });
    this.exportProxiesSnapshot();
  }

  deleteProxy(id) {
    this.stmtDeleteProxy.run(id);
    this.exportProxiesSnapshot();
  }

  getProxiesCount() {
    const row = this.stmtCountProxies.get();
    return row ? Number(row.count) : 0;
  }

  // =========================================================================
  // CAMPAIGN HISTORY CRUD
  // =========================================================================
  getAllHistory() {
    const rows = this.stmtSelectAllHistory.all();
    return rows.map(r => JSON.parse(r.raw_json));
  }

  addHistory(record) {
    const now = new Date().toISOString();
    const rawJson = JSON.stringify(record);
    this.stmtInsertHistory.run(
      record.id,
      record.campaignId || '',
      record.name || '',
      record.roomId || '',
      record.startTime || now,
      record.endTime || now,
      Number(record.durationMinutes || 0),
      Number(record.peakViewers || 0),
      Number(record.accumulatedViews || 0),
      Number(record.totalLikes || 0),
      Number(record.totalComments || 0),
      Number(record.totalCartClicks || 0),
      Number(record.bandwidthMb || 0),
      record.stopReason || 'manual_stop',
      rawJson,
      record.createdAt || now
    );
    this.exportHistorySnapshot();
    return record;
  }

  clearHistory() {
    this.stmtClearHistory.run();
    this.exportHistorySnapshot();
  }

  deleteHistory(id) {
    this.stmtDeleteHistory.run(id, id);
    this.exportHistorySnapshot();
  }

  // =========================================================================
  // SCHEDULES CRUD
  // =========================================================================
  getAllSchedules() {
    const rows = this.stmtSelectAllSchedules.all();
    return rows.map(r => JSON.parse(r.raw_json));
  }

  saveSchedule(sched) {
    const now = new Date().toISOString();
    const rawJson = JSON.stringify(sched);
    this.stmtInsertSchedule.run(
      sched.id,
      sched.title || '',
      sched.targetUrl || '',
      Number(sched.targetViewers || 0),
      Number(sched.durationMinutes || 0),
      sched.scheduledAt || now,
      sched.status || 'scheduled',
      rawJson,
      sched.createdAt || now
    );
    this.exportSchedulesSnapshot();
    return sched;
  }

  deleteSchedule(id) {
    this.stmtDeleteSchedule.run(id);
    this.exportSchedulesSnapshot();
  }

  // =========================================================================
  // COMMENT BANKS CRUD
  // =========================================================================
  getAllCommentBanks() {
    const rows = this.stmtSelectAllCommentBanks.all();
    const result = {};
    for (const r of rows) {
      result[r.category] = JSON.parse(r.comments_json);
    }
    return result;
  }

  saveCommentBank(category, comments) {
    const now = new Date().toISOString();
    this.stmtInsertCommentBank.run(category, JSON.stringify(comments), now);
    this.exportCommentBanksSnapshot();
  }

  saveAllCommentBanks(banks) {
    const now = new Date().toISOString();
    this.transaction(() => {
      for (const [category, comments] of Object.entries(banks)) {
        this.stmtInsertCommentBank.run(category, JSON.stringify(comments), now);
      }
    });
    this.exportCommentBanksSnapshot();
  }

  // =========================================================================
  // SYSTEM CONFIG CRUD
  // =========================================================================
  getConfig(key) {
    const row = this.stmtSelectConfig.get(key);
    return row ? JSON.parse(row.value_json) : null;
  }

  saveConfig(key, value) {
    const now = new Date().toISOString();
    this.stmtInsertConfig.run(key, JSON.stringify(value), now);
    this.exportConfigSnapshot();
  }

  getAllConfig() {
    const rows = this.stmtSelectAllConfig.all();
    const result = {};
    for (const r of rows) {
      result[r.key] = JSON.parse(r.value_json);
    }
    return result;
  }

  // =========================================================================
  // AUTOMATED JSON MIGRATOR (Cold Bootstrap)
  // =========================================================================
  autoMigrateFromJson() {
    try {
      // 1. Migrasi Akun jika tabel kosong
      const accCount = this.getAccountsCount();
      const accountsJsonPath = path.join(DATA_DIR, 'accounts.json');
      if (accCount === 0 && fs.existsSync(accountsJsonPath)) {
        const raw = fs.readFileSync(accountsJsonPath, 'utf8');
        const list = JSON.parse(raw || '[]');
        if (list.length > 0) {
          this.saveAccountsBatch(list);
          console.log(`[SQLite Migrator] ✅ Berhasil memigrasi ${list.length} akun dari accounts.json ke SQLite.`);
        }
      }

      // 2. Migrasi Proxy jika tabel kosong
      const prxCount = this.getProxiesCount();
      const proxiesJsonPath = path.join(DATA_DIR, 'proxies.json');
      if (prxCount === 0 && fs.existsSync(proxiesJsonPath)) {
        const raw = fs.readFileSync(proxiesJsonPath, 'utf8');
        const list = JSON.parse(raw || '[]');
        if (list.length > 0) {
          this.saveProxiesBatch(list);
          console.log(`[SQLite Migrator] ✅ Berhasil memigrasi ${list.length} proxy dari proxies.json ke SQLite.`);
        }
      }

      // 3. Migrasi Riwayat Siaran
      const historyJsonPath = path.join(DATA_DIR, 'campaign-history.json');
      if (fs.existsSync(historyJsonPath)) {
        const raw = fs.readFileSync(historyJsonPath, 'utf8');
        const list = JSON.parse(raw || '[]');
        const currentHist = this.getAllHistory();
        if (currentHist.length === 0 && list.length > 0) {
          this.transaction(() => {
            for (const h of list) {
              this.addHistory(h);
            }
          });
          console.log(`[SQLite Migrator] ✅ Berhasil memigrasi ${list.length} riwayat siaran ke SQLite.`);
        }
      }

      // 4. Migrasi Jadwal
      const schedJsonPath = path.join(DATA_DIR, 'schedules.json');
      if (fs.existsSync(schedJsonPath)) {
        const raw = fs.readFileSync(schedJsonPath, 'utf8');
        const list = JSON.parse(raw || '[]');
        const currentSched = this.getAllSchedules();
        if (currentSched.length === 0 && list.length > 0) {
          this.transaction(() => {
            for (const s of list) {
              this.saveSchedule(s);
            }
          });
          console.log(`[SQLite Migrator] ✅ Berhasil memigrasi ${list.length} jadwal siaran ke SQLite.`);
        }
      }

      // 5. Migrasi Comment Banks
      const banksJsonPath = path.join(DATA_DIR, 'comment-banks.json');
      if (fs.existsSync(banksJsonPath)) {
        const raw = fs.readFileSync(banksJsonPath, 'utf8');
        const banks = JSON.parse(raw || '{}');
        const currentBanks = this.getAllCommentBanks();
        if (Object.keys(currentBanks).length === 0 && Object.keys(banks).length > 0) {
          this.saveAllCommentBanks(banks);
          console.log(`[SQLite Migrator] ✅ Berhasil memigrasi comment-banks ke SQLite.`);
        }
      }

      // 6. Migrasi System Config
      const configJsonPath = path.join(DATA_DIR, 'config.json');
      if (fs.existsSync(configJsonPath)) {
        const raw = fs.readFileSync(configJsonPath, 'utf8');
        const cfg = JSON.parse(raw || '{}');
        const currentCfg = this.getAllConfig();
        if (Object.keys(currentCfg).length === 0 && Object.keys(cfg).length > 0) {
          this.transaction(() => {
            for (const [k, v] of Object.entries(cfg)) {
              const now = new Date().toISOString();
              this.stmtInsertConfig.run(k, JSON.stringify(v), now);
            }
          });
          console.log(`[SQLite Migrator] ✅ Berhasil memigrasi system configuration ke SQLite.`);
        }
      }
    } catch (err) {
      console.error('[SQLite Migrator Error]:', err.message);
    }
  }

  // =========================================================================
  // DUAL-SYNC SNAPSHOT EXPORTS (Menjaga integritas file JSON untuk backup & audit)
  // =========================================================================
  exportAccountsSnapshot() {
    try {
      const accounts = this.getAllAccounts();
      fs.writeFileSync(path.join(DATA_DIR, 'accounts.json'), JSON.stringify(accounts, null, 2), 'utf8');
    } catch (e) {
      console.error('Gagal export accounts.json snapshot:', e.message);
    }
  }

  exportProxiesSnapshot() {
    try {
      const proxies = this.getAllProxies();
      fs.writeFileSync(path.join(DATA_DIR, 'proxies.json'), JSON.stringify(proxies, null, 2), 'utf8');
    } catch (e) {
      console.error('Gagal export proxies.json snapshot:', e.message);
    }
  }

  exportHistorySnapshot() {
    try {
      const history = this.getAllHistory();
      fs.writeFileSync(path.join(DATA_DIR, 'campaign-history.json'), JSON.stringify(history, null, 2), 'utf8');
    } catch (e) {
      console.error('Gagal export campaign-history.json snapshot:', e.message);
    }
  }

  exportSchedulesSnapshot() {
    try {
      const schedules = this.getAllSchedules();
      fs.writeFileSync(path.join(DATA_DIR, 'schedules.json'), JSON.stringify(schedules, null, 2), 'utf8');
    } catch (e) {
      console.error('Gagal export schedules.json snapshot:', e.message);
    }
  }

  exportCommentBanksSnapshot() {
    try {
      const banks = this.getAllCommentBanks();
      fs.writeFileSync(path.join(DATA_DIR, 'comment-banks.json'), JSON.stringify(banks, null, 2), 'utf8');
    } catch (e) {
      console.error('Gagal export comment-banks.json snapshot:', e.message);
    }
  }

  exportConfigSnapshot() {
    try {
      const cfg = this.getAllConfig();
      if (Object.keys(cfg).length > 0) {
        fs.writeFileSync(path.join(DATA_DIR, 'config.json'), JSON.stringify(cfg, null, 2), 'utf8');
      }
    } catch (e) {
      console.error('Gagal export config.json snapshot:', e.message);
    }
  }

  exportAllSnapshots() {
    this.exportAccountsSnapshot();
    this.exportProxiesSnapshot();
    this.exportHistorySnapshot();
    this.exportSchedulesSnapshot();
    this.exportCommentBanksSnapshot();
    this.exportConfigSnapshot();
  }

  // =========================================================================
  // ACTIVE CAMPAIGNS STATE (Crash Auto-Resume Recovery)
  // =========================================================================
  saveActiveCampaignState(state) {
    const now = new Date().toISOString();
    this.stmtInsertActiveCampaignState.run(
      state.id,
      state.roomId || '',
      Number(state.targetViewers || 0),
      state.retentionMode || 'dynamic_churn',
      state.status || 'RUNNING',
      JSON.stringify(state.config || state),
      state.startedAt || now,
      now
    );
  }

  getActiveCampaignStates() {
    const rows = this.stmtSelectAllActiveCampaignStates.all();
    return rows.map(r => ({
      id: r.id,
      roomId: r.room_id,
      targetViewers: Number(r.target_viewers),
      retentionMode: r.retention_mode,
      status: r.status,
      config: JSON.parse(r.config_json || '{}'),
      startedAt: r.started_at,
      updatedAt: r.updated_at
    }));
  }

  clearActiveCampaignState(id) {
    this.stmtDeleteActiveCampaignState.run(id);
  }

  clearAllActiveCampaignStates() {
    this.stmtClearActiveCampaignStates.run();
  }

  // =========================================================================
  // AUTOMATED ONLINE DATABASE SNAPSHOT (VACUUM INTO) & ROTATION
  // =========================================================================
  createAutomatedBackup(customDestPath = null) {
    const backupsDir = path.join(DATA_DIR, '../backups');
    if (!fs.existsSync(backupsDir)) {
      fs.mkdirSync(backupsDir, { recursive: true });
    }
    const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = customDestPath || path.join(backupsDir, `shopee_bot_${dateStr}.db`);

    const escapedPath = backupPath.replace(/'/g, "''");
    if (fs.existsSync(backupPath)) {
      try { fs.unlinkSync(backupPath); } catch (e) {}
    }
    this.db.exec(`VACUUM INTO '${escapedPath}';`);

    const targetCleanDir = customDestPath ? path.dirname(customDestPath) : backupsDir;
    const cleaned = this.cleanOldBackups(targetCleanDir, 7);

    return {
      success: true,
      backupPath,
      sizeBytes: fs.existsSync(backupPath) ? fs.statSync(backupPath).size : 0,
      cleanedOldBackupsCount: cleaned,
      timestamp: new Date().toISOString()
    };
  }

  cleanOldBackups(dir, retentionDays = 7) {
    try {
      if (!fs.existsSync(dir)) return 0;
      const files = fs.readdirSync(dir);
      const now = Date.now();
      const maxAgeMs = retentionDays * 24 * 60 * 60 * 1000;
      let deletedCount = 0;
      for (const file of files) {
        if (file.endsWith('.db')) {
          const filePath = path.join(dir, file);
          const stat = fs.statSync(filePath);
          if (now - stat.mtimeMs > maxAgeMs) {
            fs.unlinkSync(filePath);
            deletedCount++;
          }
        }
      }
      return deletedCount;
    } catch (e) {
      return 0;
    }
  }

  // =========================================================================
  // AUTH SESSIONS MANAGEMENT (STATEFUL TOKEN & REVOCATION)
  // =========================================================================
  saveSession({ token, username, ip, userAgent, createdAt, lastActivityAt, expiresAt }) {
    try {
      this.stmtInsertSession.run(
        String(token),
        String(username || 'admin'),
        String(ip || '127.0.0.1'),
        String(userAgent || ''),
        Number(createdAt || Date.now()),
        Number(lastActivityAt || Date.now()),
        Number(expiresAt)
      );
      return true;
    } catch (err) {
      console.error('[SqliteManager] Gagal menyimpan auth session:', err.message);
      return false;
    }
  }

  getSession(token) {
    if (!token) return null;
    try {
      return this.stmtSelectSession.get(token) || null;
    } catch (err) {
      console.error('[SqliteManager] Gagal mengambil auth session:', err.message);
      return null;
    }
  }

  updateSessionActivity(token, timestamp = Date.now()) {
    if (!token) return false;
    try {
      this.stmtUpdateSessionActivity.run(timestamp, token);
      return true;
    } catch (err) {
      return false;
    }
  }

  deleteSession(token) {
    if (!token) return false;
    try {
      this.stmtDeleteSession.run(token);
      return true;
    } catch (err) {
      return false;
    }
  }

  deleteAllSessions() {
    try {
      this.stmtDeleteAllSessions.run();
      return true;
    } catch (err) {
      return false;
    }
  }

  cleanExpiredSessions(now = Date.now()) {
    try {
      this.stmtCleanExpiredSessions.run(now);
      return true;
    } catch (err) {
      return false;
    }
  }

  close() {
    if (this.db) {
      this.db.close();
    }
  }
}

// Singleton database instance
const sqliteManager = new SqliteManager();

module.exports = sqliteManager;
module.exports.SqliteManager = SqliteManager;
module.exports.encryptSensitiveData = encryptSensitiveData;
module.exports.decryptSensitiveData = decryptSensitiveData;
