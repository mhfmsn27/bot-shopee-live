/**
 * Auth Manager - Enterprise Access Gatekeeper & Single-Operator Authentication Subsystem
 * Menyediakan proteksi akses penuh untuk Shopee Live View Bot Apps:
 * - Single-User Operator Standard Authentication (Username + Password)
 * - PBKDF2 Password Hashing dengan Salt acak 16-byte (100.000 iterasi)
 * - HMAC-SHA256 Cryptographic Session Token (Stateful & Persistent di SQLite)
 * - Inactivity Idle Timeout (Default 120 Menit dengan opsi kustomisasi)
 * - Stateful Token Revocation Instan (Tanpa Zombie Token saat logout atau ganti password)
 * - Anti-Brute-Force IP Jail (Maksimal 5 kegagalan per 10 menit, lockout 15 menit)
 * - Persistensi konfigurasi keamanan di database SQLite (system_config & auth_sessions)
 */

const crypto = require('crypto');
const sqliteManager = require('../db/sqlite-manager');
const waGateway = require('../wa-gateway/whatsapp-service');

// Secret key untuk penandatanganan token sesi
const SESSION_SECRET = process.env.SESSION_SECRET || 'shopee-live-gatekeeper-session-secret-2026-xyz!';
const DEFAULT_USERNAME = process.env.APP_MASTER_USERNAME || 'admin';
const DEFAULT_PASSWORD = process.env.APP_MASTER_PASSWORD || 'shopee@admin2026';
const DEFAULT_TIMEOUT_MINUTES = 120; // Default 120 Menit sesuai instruksi

class AuthManager {
  constructor() {
    this.failedAttempts = new Map(); // ip -> { count, firstAttemptTime, blockedUntil }
    this.pendingOtp = new Map();     // otpCode -> { expiresAt, createdAt, ip }
    this.maxFailedAttempts = 5;
    this.blockDurationMs = 15 * 60 * 1000; // 15 menit blokir IP
    this.attemptWindowMs = 10 * 60 * 1000; // 10 menit jendela kegagalan

    this.initSecurityConfig();
  }

  /**
   * Getter kompatibilitas ke database SQLite auth_sessions
   */
  get activeSessions() {
    return {
      has: (token) => !!sqliteManager.getSession(token),
      get: (token) => sqliteManager.getSession(token),
      delete: (token) => sqliteManager.deleteSession(token)
    };
  }

  /**
   * Inisialisasi konfigurasi keamanan di SQLite jika belum tersedia
   */
  initSecurityConfig() {
    try {
      const existingConfig = sqliteManager.getConfig('security');
      if (!existingConfig || !existingConfig.passwordHash) {
        const { hash, salt } = this.hashPassword(DEFAULT_PASSWORD);
        const initialConfig = {
          enabled: true,
          username: DEFAULT_USERNAME,
          passwordHash: hash,
          salt: salt,
          sessionTimeoutMinutes: DEFAULT_TIMEOUT_MINUTES,
          enable2faWhatsapp: false,
          adminPhone: '',
          updatedAt: new Date().toISOString()
        };
        sqliteManager.saveConfig('security', initialConfig);
      } else {
        // Migrasi seamless jika data lama belum memiliki username atau sessionTimeoutMinutes
        let modified = false;
        if (!existingConfig.username) {
          existingConfig.username = DEFAULT_USERNAME;
          modified = true;
        }
        if (!existingConfig.sessionTimeoutMinutes || existingConfig.sessionTimeoutMinutes === 60) {
          existingConfig.sessionTimeoutMinutes = DEFAULT_TIMEOUT_MINUTES;
          modified = true;
        }
        if (modified) {
          existingConfig.updatedAt = new Date().toISOString();
          sqliteManager.saveConfig('security', existingConfig);
        }
      }

      // Bersihkan sesi yang kadaluwarsa saat startup
      sqliteManager.cleanExpiredSessions();
    } catch (err) {
      console.error('[AuthManager] Gagal inisialisasi konfigurasi keamanan:', err.message);
    }
  }

  /**
   * Ambil konfigurasi keamanan saat ini (tanpa menyertakan salt/hash)
   */
  getPublicConfig() {
    try {
      const config = sqliteManager.getConfig('security') || {};
      return {
        enabled: config.enabled !== false,
        username: config.username || DEFAULT_USERNAME,
        sessionTimeoutMinutes: config.sessionTimeoutMinutes || DEFAULT_TIMEOUT_MINUTES,
        enable2faWhatsapp: !!config.enable2faWhatsapp,
        adminPhone: config.adminPhone ? config.adminPhone.slice(0, 4) + '****' + config.adminPhone.slice(-3) : '',
        updatedAt: config.updatedAt || null
      };
    } catch (e) {
      return { 
        enabled: true, 
        username: DEFAULT_USERNAME, 
        sessionTimeoutMinutes: DEFAULT_TIMEOUT_MINUTES, 
        enable2faWhatsapp: false 
      };
    }
  }

  /**
   * Dapatkan konfigurasi internal lengkap (termasuk hash dan salt)
   */
  getInternalConfig() {
    return sqliteManager.getConfig('security') || {
      enabled: true,
      username: DEFAULT_USERNAME,
      passwordHash: '',
      salt: '',
      sessionTimeoutMinutes: DEFAULT_TIMEOUT_MINUTES,
      enable2faWhatsapp: false
    };
  }

  /**
   * Generate PBKDF2 hash dengan salt acak 16 byte (100.000 iterasi SHA-256)
   */
  hashPassword(password, customSalt = null) {
    const salt = customSalt || crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha256').toString('hex');
    return { hash, salt };
  }

  /**
   * Verifikasi kecocokan password dengan hash yang tersimpan
   */
  verifyPassword(inputPassword) {
    if (!inputPassword || typeof inputPassword !== 'string') return false;
    const config = this.getInternalConfig();
    if (!config.passwordHash || !config.salt) return false;

    try {
      const { hash } = this.hashPassword(inputPassword, config.salt);
      return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(config.passwordHash, 'hex'));
    } catch (e) {
      return false;
    }
  }

  /**
   * Verifikasi kredensial Username dan Password operator
   */
  verifyCredentials(inputUsername, inputPassword) {
    if (!inputUsername || !inputPassword) return false;
    const config = this.getInternalConfig();
    const storedUsername = config.username || DEFAULT_USERNAME;

    if (String(inputUsername).trim().toLowerCase() !== String(storedUsername).trim().toLowerCase()) {
      return false;
    }

    return this.verifyPassword(inputPassword);
  }

  /**
   * Ubah kredensial operator (Username dan/atau Password)
   * Menginvalidasi SELURUH sesi aktif di database setelah berhasil
   */
  changeCredentials(oldPassword, newUsername = null, newPassword = null) {
    if (!this.verifyPassword(oldPassword)) {
      return { success: false, message: 'Password lama/saat ini yang Anda masukkan salah.' };
    }

    const config = this.getInternalConfig();
    let updated = false;

    // Perubahan Username
    if (newUsername && typeof newUsername === 'string' && newUsername.trim()) {
      const trimmedUser = newUsername.trim();
      if (trimmedUser.length < 3) {
        return { success: false, message: 'Username baru minimal harus terdiri dari 3 karakter.' };
      }
      config.username = trimmedUser;
      updated = true;
    }

    // Perubahan Password
    if (newPassword && typeof newPassword === 'string' && newPassword.trim()) {
      if (newPassword.length < 6) {
        return { success: false, message: 'Password baru minimal harus terdiri dari 6 karakter.' };
      }
      const { hash, salt } = this.hashPassword(newPassword);
      config.passwordHash = hash;
      config.salt = salt;
      updated = true;
    }

    if (!updated) {
      return { success: false, message: 'Tidak ada perubahan username atau password yang dimasukkan.' };
    }

    config.updatedAt = new Date().toISOString();
    sqliteManager.saveConfig('security', config);

    // Invalidate SELURUH sesi aktif lama di database saat kredensial diubah
    sqliteManager.deleteAllSessions();

    return { 
      success: true, 
      message: 'Kredensial akun operator berhasil diperbarui. Seluruh sesi login lama telah direset demi keamanan.',
      username: config.username
    };
  }

  /**
   * Cek apakah IP klien saat ini sedang terblokir (Anti-Brute-Force)
   */
  isIpBlocked(ip) {
    if (!ip) return false;
    const record = this.failedAttempts.get(ip);
    if (!record) return false;

    if (record.blockedUntil && record.blockedUntil > Date.now()) {
      return true;
    }

    // Jika masa blokir telah usai, bersihkan record
    if (record.blockedUntil && record.blockedUntil <= Date.now()) {
      this.failedAttempts.delete(ip);
      return false;
    }

    return false;
  }

  /**
   * Catat kegagalan login untuk IP klien
   */
  recordFailedAttempt(ip) {
    if (!ip) return;
    const now = Date.now();
    let record = this.failedAttempts.get(ip);

    if (!record || (now - record.firstAttemptTime > this.attemptWindowMs)) {
      record = { count: 1, firstAttemptTime: now, blockedUntil: null };
    } else {
      record.count++;
      if (record.count >= this.maxFailedAttempts) {
        record.blockedUntil = now + this.blockDurationMs;
        console.warn(`[Security Alert] IP ${ip} telah diblokir selama 15 menit akibat 5x percobaan login gagal berturut-turut.`);
      }
    }

    this.failedAttempts.set(ip, record);
    return record;
  }

  /**
   * Bersihkan riwayat kegagalan saat login berhasil
   */
  recordSuccessfulLogin(ip) {
    if (ip) this.failedAttempts.delete(ip);
  }

  /**
   * Buat Cryptographic Session Token (HMAC-SHA256) & simpan secara stateful di SQLite
   */
  createSession(username = null, ip = '127.0.0.1', userAgent = '', rememberMe = false) {
    const config = this.getInternalConfig();
    const activeUsername = username || config.username || DEFAULT_USERNAME;
    // Jika remember me: sesi diperpanjang hingga 7 hari, jika normal: timeout sesuai konfigurasi (default 120 menit)
    const timeoutMinutes = rememberMe ? (7 * 24 * 60) : (config.sessionTimeoutMinutes || DEFAULT_TIMEOUT_MINUTES);
    const now = Date.now();
    const expiresAt = now + (timeoutMinutes * 60 * 1000);

    const payload = `${now}.${expiresAt}.${ip}.${crypto.randomBytes(16).toString('hex')}`;
    const hmac = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
    const token = `sbt_${Buffer.from(payload).toString('base64url')}.${hmac}`;

    // Simpan ke SQLite stateful session table
    sqliteManager.saveSession({
      token,
      username: activeUsername,
      ip,
      userAgent,
      createdAt: now,
      lastActivityAt: now,
      expiresAt
    });

    return { 
      token, 
      username: activeUsername,
      expiresAt, 
      timeoutMinutes 
    };
  }

  /**
   * Validasi keabsahan token sesi klien
   * Melakukan:
   * 1. Cryptographic HMAC Signature check
   * 2. Database state check (Apakah token belum di-revoke / logout?)
   * 3. Hard Expiry check
   * 4. Inactivity Idle Timeout check (Default 120 menit)
   * 5. Rolling touch last_activity_at jika valid
   */
  verifySessionToken(token, ip = null) {
    const config = this.getInternalConfig();
    // Jika proteksi keamanan dinonaktifkan oleh admin (opsional)
    if (config.enabled === false) {
      return { valid: true, bypassed: true, username: config.username || DEFAULT_USERNAME };
    }

    if (!token || typeof token !== 'string' || !token.startsWith('sbt_')) {
      return { valid: false, reason: 'Missing or malformed session token' };
    }

    try {
      const parts = token.slice(4).split('.');
      if (parts.length !== 2) {
        return { valid: false, reason: 'Invalid token structure' };
      }

      const [encodedPayload, signature] = parts;
      const payload = Buffer.from(encodedPayload, 'base64url').toString('utf8');

      // 1. Validasi HMAC signature
      const expectedHmac = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
      if (!crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expectedHmac, 'hex'))) {
        return { valid: false, reason: 'Cryptographic signature mismatch' };
      }

      // 2. Stateful Check di SQLite (Cegah Zombie Token)
      const session = sqliteManager.getSession(token);
      if (!session) {
        return { valid: false, reason: 'Session token has been revoked or logged out' };
      }

      const now = Date.now();

      // 3. Hard Expiry Check
      if (now > session.expires_at) {
        sqliteManager.deleteSession(token);
        return { valid: false, reason: 'Session token has expired' };
      }

      // 4. Inactivity Idle Timeout Check (Default 120 menit)
      const timeoutMinutes = config.sessionTimeoutMinutes || DEFAULT_TIMEOUT_MINUTES;
      const idleTimeoutMs = timeoutMinutes * 60 * 1000;
      if (session.last_activity_at && (now - session.last_activity_at > idleTimeoutMs)) {
        sqliteManager.deleteSession(token);
        return { 
          valid: false, 
          idleExpired: true,
          reason: `Session expired due to inactivity (${timeoutMinutes} minutes idle)` 
        };
      }

      // 5. Sliding window: Touch last_activity_at di database
      sqliteManager.updateSessionActivity(token, now);

      return { 
        valid: true, 
        username: session.username, 
        expiresAt: session.expires_at,
        lastActivityAt: now,
        timeoutMinutes
      };
    } catch (err) {
      return { valid: false, reason: err.message };
    }
  }

  /**
   * Hapus sesi aktif dari SQLite (Logout)
   */
  destroySession(token) {
    if (token) {
      sqliteManager.deleteSession(token);
    }
    return true;
  }

  /**
   * Hapus SELURUH sesi aktif di database
   */
  destroyAllSessions() {
    sqliteManager.deleteAllSessions();
    return true;
  }

  /**
   * Toggle Security Guard (Aktifkan / Nonaktifkan)
   */
  toggleSecurity(enabled) {
    const config = this.getInternalConfig();
    config.enabled = Boolean(enabled);
    config.updatedAt = new Date().toISOString();
    sqliteManager.saveConfig('security', config);
    return { success: true, enabled: config.enabled };
  }

  /**
   * Update pengaturan keamanan (timeout, username)
   */
  updateSettings(settings = {}) {
    const config = this.getInternalConfig();
    if (settings.sessionTimeoutMinutes !== undefined) {
      config.sessionTimeoutMinutes = Math.max(5, parseInt(settings.sessionTimeoutMinutes, 10) || DEFAULT_TIMEOUT_MINUTES);
    }
    if (settings.username && typeof settings.username === 'string' && settings.username.trim()) {
      config.username = settings.username.trim();
    }
    if (settings.enable2faWhatsapp !== undefined) {
      config.enable2faWhatsapp = Boolean(settings.enable2faWhatsapp);
    }
    if (settings.adminPhone) {
      config.adminPhone = String(settings.adminPhone).trim();
    }
    config.updatedAt = new Date().toISOString();

    sqliteManager.saveConfig('security', config);
    return { success: true, config: this.getPublicConfig() };
  }

  /**
   * Generate 2FA WhatsApp OTP (6 Digit angka) - Opsional jika diaktifkan admin
   */
  async generateAndSendWhatsappOtp(ip) {
    const config = this.getInternalConfig();
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + (3 * 60 * 1000); // 3 menit

    this.pendingOtp.set(otpCode, {
      expiresAt,
      createdAt: Date.now(),
      ip
    });

    const adminPhone = config.adminPhone || '';
    const message = `🔐 *KODE VERIFIKASI KEAMANAN (2FA)*\n\nKode OTP Anda: *${otpCode}*\n\nKode ini berlaku selama 3 menit untuk membuka Shopee Live View Bot Pro dari IP: ${ip}.\nJangan berikan kode ini kepada siapapun!`;

    try {
      if (adminPhone && waGateway.isReady && typeof waGateway.sendMessage === 'function') {
        await waGateway.sendMessage(adminPhone, message);
      }
    } catch (e) {
      console.warn('[AuthManager] Gagal mengirim OTP via WhatsApp Gateway:', e.message);
    }

    return { sent: true, expiresAt };
  }

  /**
   * Verifikasi 2FA WhatsApp OTP
   */
  verifyOtp(otpCode) {
    if (!otpCode) return false;
    const record = this.pendingOtp.get(String(otpCode).trim());
    if (!record) return false;

    if (Date.now() > record.expiresAt) {
      this.pendingOtp.delete(otpCode);
      return false;
    }

    this.pendingOtp.delete(otpCode);
    return true;
  }
}

const authManagerInstance = new AuthManager();

module.exports = authManagerInstance;
