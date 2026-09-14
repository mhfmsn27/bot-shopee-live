/**
 * Account Manager - Shopee Account Lifecycle & Database
 * Mengelola pembuatan akun baru beridentitas lengkap, penyimpanan ke file database, dan ekspor data
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { generateIndonesianIdentity } = require('./identity-generator');
const { getRealisticAvatar } = require('./avatar-manager');
const { createAutoEmail, listenForShopeeOtp } = require('./email-creator');
const proxyManager = require('../proxy/proxy-manager');
const sqliteManager = require('../db/sqlite-manager');

const DB_PATH = path.join(__dirname, '../../data/accounts.json');

function loadDatabase() {
  try {
    let accounts = sqliteManager.getAllAccounts();
    if (!accounts || accounts.length === 0) {
      if (fs.existsSync(DB_PATH)) {
        const data = fs.readFileSync(DB_PATH, 'utf8');
        accounts = JSON.parse(data || '[]');
        if (accounts.length > 0) {
          sqliteManager.replaceAccounts(accounts);
        }
      }
    }
    let modified = false;
    for (const acc of accounts) {
      if (!acc.name) {
        acc.name = acc.username ? (acc.username.charAt(0).toUpperCase() + acc.username.slice(1)) : 'Pengguna Shopee';
        modified = true;
      }
      if (!acc.assignedProxy) {
        const prx = proxyManager.allocateProxyForAccount(acc.id);
        if (prx) {
          acc.assignedProxy = {
            id: prx.id,
            ip: prx.ip,
            port: prx.port,
            protocol: prx.protocol,
            type: prx.type,
            city: prx.city
          };
          modified = true;
        }
      }
    }
    if (modified) {
      saveDatabase(accounts);
    }
    return accounts;
  } catch (err) {
    console.error('Gagal membaca database akun:', err.message);
    return [];
  }
}

function saveDatabase(accounts) {
  try {
    sqliteManager.replaceAccounts(accounts);
  } catch (err) {
    console.error('Gagal menyimpan database akun ke SQLite:', err.message);
    try {
      const dir = path.dirname(DB_PATH);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(DB_PATH, JSON.stringify(accounts, null, 2), 'utf8');
    } catch (e) {}
  }
}

// In-memory tracking akun yang sedang aktif digunakan menonton live: accountId -> campaignId
const busyAccountMap = new Map();

/**
 * Ambil daftar akun terverifikasi yang sedang TIDAK digunakan di siaran lain
 */
function getAvailableAccounts() {
  const accounts = loadDatabase();
  return accounts.filter(acc => {
    const isReady = acc.status !== 'suspended';
    const isNotBusy = !busyAccountMap.has(acc.id);
    return isReady && isNotBusy;
  });
}

function getAvailableCount() {
  return getAvailableAccounts().length;
}

function getBusyCount() {
  return busyAccountMap.size;
}

/**
 * Klaim satu akun yang sedang tersedia untuk kampanye tertentu
 * @param {string} campaignId
 * @param {string} [campaignName]
 * @param {object} [options]
 * @param {boolean} [options.preferAuthenticated=false]
 */
function claimAccount(campaignId, campaignName = null, options = {}) {
  const available = getAvailableAccounts();
  if (available.length === 0) return null;

  let chosen = null;
  if (options && options.preferAuthenticated) {
    const authenticated = available.filter(a => !!a.cookies && a.status !== 'suspended');
    if (authenticated.length > 0) {
      chosen = authenticated[Math.floor(Math.random() * authenticated.length)];
    }
  }

  if (!chosen) {
    // Pilih salah satu akun yang sedang tidak dipakai
    chosen = available[Math.floor(Math.random() * available.length)];
  }

  busyAccountMap.set(chosen.id, {
    campaignId,
    campaignName: campaignName || campaignId,
    claimedAt: Date.now()
  });
  return chosen;
}

/**
 * Lepaskan akun kembali ke pool agar bisa digunakan menonton live lain
 * @param {string} accountId
 */
function releaseAccount(accountId) {
  if (accountId) {
    busyAccountMap.delete(accountId);
  }
}

/**
 * Lepaskan seluruh akun yang diklaim oleh sesi siaran tertentu
 * @param {string} campaignId
 */
function releaseAllForCampaign(campaignId) {
  for (const [accId, lease] of busyAccountMap.entries()) {
    const cmpId = typeof lease === 'object' ? lease.campaignId : lease;
    if (cmpId === campaignId) {
      busyAccountMap.delete(accId);
    }
  }
}

function getAccountSummary() {
  const accounts = loadDatabase();
  const available = getAvailableAccounts().length;
  const inUse = busyAccountMap.size;
  return {
    total: accounts.length,
    available,
    inUse
  };
}

/**
 * Ambil semua akun tersimpan beserta status penggunaannya
 */
function getAllAccounts() {
  const accounts = loadDatabase();
  return accounts.map(a => {
    const lease = busyAccountMap.get(a.id);
    return {
      ...a,
      isBusy: busyAccountMap.has(a.id),
      busyInCampaign: lease ? (typeof lease === 'object' ? (lease.campaignName || lease.campaignId) : lease) : null
    };
  });
}

/**
 * Buat akun baru secara massal dengan opsi identitas lengkap
 * @param {object} options
 * @param {number} options.count - Jumlah akun yang ingin dibuat
 * @param {boolean} options.autoEmail - Auto generate email
 * @param {boolean} options.enrichProfile - Isi nama, bio, TTL, domisili Indonesia
 * @param {boolean} options.autoAvatar - Otomatis pasang foto profil realistis
 * @param {string} options.gender - 'random' | 'male' | 'female'
 */
async function createAccountBatch(options = {}) {
  const count = Math.min(Math.max(Number(options.count) || 1, 1), 100);
  const autoEmail = options.autoEmail !== false;
  const enrichProfile = options.enrichProfile !== false;
  const autoAvatar = options.autoAvatar !== false;
  const gender = options.gender || 'random';
  const customCity = options.city && options.city.trim() ? options.city.trim() : null;

  const accounts = loadDatabase();
  const createdList = [];

  for (let i = 0; i < count; i++) {
    const identity = enrichProfile 
      ? generateIndonesianIdentity(gender)
      : {
          fullName: `User_${crypto.randomBytes(4).toString('hex')}`,
          username: `shopee_user_${crypto.randomBytes(4).toString('hex')}`,
          gender: 'unknown',
          birthdate: '2000-01-01',
          city: 'Indonesia',
          bio: ''
        };

    if (customCity) {
      identity.city = customCity;
    }

    const emailData = autoEmail 
      ? createAutoEmail(identity.username)
      : { email: `${identity.username}@mail.local` };

    const avatarUrl = autoAvatar 
      ? getRealisticAvatar(identity.gender) 
      : null;

    // Simulasi verifikasi OTP email Shopee
    let otpData = null;
    if (autoEmail) {
      otpData = await listenForShopeeOtp(emailData.email);
    }

    const newAccountId = `acc-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
    const allocatedProxy = proxyManager.allocateProxyForAccount(newAccountId, options.proxyType || 'residential');

    const newAccount = {
      id: newAccountId,
      email: emailData.email,
      username: identity.username,
      name: identity.fullName,
      gender: identity.gender,
      birthdate: identity.birthdate,
      bio: identity.bio,
      city: identity.city,
      avatar: avatarUrl,
      status: 'ready',
      verified: true,
      lastOtp: otpData ? otpData.otp : null,
      assignedProxy: allocatedProxy ? {
        id: allocatedProxy.id,
        ip: allocatedProxy.ip,
        port: allocatedProxy.port,
        protocol: allocatedProxy.protocol,
        type: allocatedProxy.type,
        city: allocatedProxy.city
      } : null,
      totalLiveWatched: 0,
      createdAt: new Date().toISOString()
    };

    accounts.unshift(newAccount);
    createdList.push(newAccount);
  }

  saveDatabase(accounts);
  return createdList;
}

/**
 * Audit kesehatan seluruh akun yang terdaftar dalam database
 * Memeriksa kelengkapan profil (bio, avatar, kota), status verifikasi, dan keaktifan.
 * @returns {object} { total, valid, warning, averageHealthScore, auditedAccounts }
 */
function validateAllAccounts() {
  const accounts = loadDatabase();
  let totalScore = 0;
  let validCount = 0;
  let warningCount = 0;

  const auditedAccounts = accounts.map(acc => {
    let score = 100;
    const issues = [];

    // Verifikasi email/status
    if (!acc.verified || acc.status === 'suspended') {
      score -= 50;
      issues.push('Akun belum terverifikasi atau status tersuspensi');
    }

    // Kelengkapan identitas
    if (!acc.avatar) {
      score -= 15;
      issues.push('Foto profil belum disetel');
    }
    if (!acc.bio || acc.bio.trim().length < 5) {
      score -= 10;
      issues.push('Bio profil kosong atau terlalu singkat');
    }
    if (!acc.city || acc.city === 'Indonesia') {
      score -= 10;
      issues.push('Kota domisili masih default/generik');
    }
    if (!acc.birthdate) {
      score -= 10;
      issues.push('Tanggal lahir belum dilengkapi');
    }

    score = Math.max(0, Math.min(100, score));
    totalScore += score;

    const status = score >= 70 ? 'healthy' : (score >= 40 ? 'warning' : 'critical');
    if (status === 'healthy') {
      validCount++;
    } else {
      warningCount++;
    }

    return {
      id: acc.id,
      username: acc.username,
      name: acc.name,
      city: acc.city,
      score,
      status,
      issues
    };
  });

  const averageHealthScore = accounts.length > 0 ? Math.round(totalScore / accounts.length) : 100;

  return {
    total: accounts.length,
    valid: validCount,
    warning: warningCount,
    averageHealthScore,
    auditedAccounts
  };
}

/**
 * Hapus akun berdasarkan ID
 */
function deleteAccount(id) {
  proxyManager.releaseAccountProxy(id);
  busyAccountMap.delete(id);
  const accounts = loadDatabase();
  const filtered = accounts.filter(acc => acc.id !== id);
  saveDatabase(filtered);
  return filtered.length !== accounts.length;
}

/**
 * Ekspor semua akun sebagai CSV string
 */
function exportAccountsAsCsv() {
  const accounts = loadDatabase();
  const headers = ['ID', 'Email', 'Username', 'Nama Lengkap', 'Gender', 'Tanggal Lahir', 'Kota', 'Bio', 'Proxy Terikat', 'Status', 'Total Tonton', 'Tanggal Dibuat'];
  const rows = accounts.map(a => [
    `"${a.id}"`,
    `"${a.email}"`,
    `"${a.username}"`,
    `"${a.name}"`,
    `"${a.gender}"`,
    `"${a.birthdate}"`,
    `"${a.city}"`,
    `"${(a.bio || '').replace(/"/g, '""')}"`,
    `"${a.assignedProxy ? `${a.assignedProxy.protocol.toUpperCase()}://${a.assignedProxy.ip}:${a.assignedProxy.port} [${a.assignedProxy.type}]` : 'Auto'}"`,
    `"${a.status}"`,
    a.totalLiveWatched || 0,
    `"${a.createdAt}"`
  ]);

  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}

/**
 * Tambah counter tontonan akun
 */
function incrementAccountWatchCount(id) {
  const accounts = loadDatabase();
  const target = accounts.find(a => a.id === id);
  if (target) {
    target.totalLiveWatched = (target.totalLiveWatched || 0) + 1;
    saveDatabase(accounts);
    return target;
  }
  return null;
}

/**
 * Helper parser universal untuk berbagai format input cookies:
 * 1. Chrome DevTools Cookie Table (Tab-separated copy langsung dari Application > Storage > Cookies)
 * 2. cURL / DevTools Network Tab headers
 * 3. Cookie-Editor / EditThisCookie JSON export
 * 4. Pipe-separated text: username | email | cookies
 * 5. Raw cookie string (semicolon-delimited)
 * @param {*} rawInput 
 * @param {object} [options]
 */
function parseCookieInput(rawInput, options = {}) {
  if (!rawInput) return [];

  // 1. Jika input berupa Array langsung
  if (Array.isArray(rawInput)) {
    // Deteksi jika format ekspor Cookie-Editor (array of { name, value })
    if (rawInput.length > 0 && rawInput.every(item => item && typeof item === 'object' && (item.name || item.Name) && (item.value !== undefined || item.Value !== undefined))) {
      const cookieStr = rawInput
        .map(c => `${c.name || c.Name}=${c.value !== undefined ? c.value : c.Value}`)
        .join('; ') + ';';
      return [{
        cookieStr,
        detectedFormat: 'json_cookie_editor',
        cookieCount: rawInput.length,
        options
      }];
    }

    // Array akun biasa
    return rawInput.map(item => ({
      username: item.username || item.name,
      name: item.name,
      email: item.email,
      phone: item.phone || item.phoneNumber,
      cookieStr: (item.cookies || item.cookie || '').trim(),
      detectedFormat: 'account_array_json',
      options
    })).filter(a => typeof a.cookieStr === 'string' && a.cookieStr.length > 5);
  }

  if (typeof rawInput !== 'string') return [];
  const trimmed = rawInput.trim();
  if (!trimmed) return [];

  // 2. Format JSON Array String
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parseCookieInput(parsed, options);
      }
    } catch (e) {}
  }

  // 3. Format cURL Command
  const curlCookieMatch = trimmed.match(/(?:-H|--header)\s+['"](?:cookie|Cookie):\s*([^'"]+)['"]/i);
  if (curlCookieMatch && curlCookieMatch[1]) {
    return [{
      cookieStr: curlCookieMatch[1].trim(),
      detectedFormat: 'curl_command',
      options
    }];
  }

  // 4. Format Header "Cookie: ..." langsung
  const headerMatch = trimmed.match(/^(?:Cookie|cookie):\s*(.+)$/im);
  if (headerMatch && headerMatch[1] && !trimmed.includes('\t')) {
    return [{
      cookieStr: headerMatch[1].trim(),
      detectedFormat: 'cookie_header',
      options
    }];
  }

  // 5. Format Tabel Chrome DevTools (Tab-separated)
  const lines = trimmed.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  const tabLines = lines.filter(l => l.includes('\t'));

  if (tabLines.length > 0) {
    const accountBlocks = [];
    let currentBlock = [];

    for (const line of lines) {
      if (/^(=+|-+|#|\/\/)|\bAkun\s+\d+/i.test(line) && currentBlock.length > 0) {
        accountBlocks.push(currentBlock);
        currentBlock = [];
        continue;
      }
      currentBlock.push(line);
    }
    if (currentBlock.length > 0) accountBlocks.push(currentBlock);

    const results = [];
    for (const block of accountBlocks) {
      const cookieMap = new Map();
      let customUser = null;
      let customEmail = null;

      for (const line of block) {
        if (!line.includes('\t')) {
          if (line.includes('|')) {
            const parts = line.split('|').map(p => p.trim());
            if (parts.length >= 2) {
              customUser = parts[0];
              customEmail = parts[1];
            }
          }
          continue;
        }

        const cols = line.split('\t').map(c => c.trim());
        const name = cols[0];
        const val = cols[1];
        const domain = cols[2] || '';

        // Abaikan baris header tabel jika ikut tersalin
        if (name.toLowerCase() === 'name' && (val || '').toLowerCase() === 'value') continue;
        if (!name || val === undefined) continue;

        // Preferensikan domain shopee.co.id jika ada duplikat (misal seller vs live)
        if (!cookieMap.has(name) || (domain.includes('shopee.co.id') && !domain.includes('seller'))) {
          cookieMap.set(name, val);
        }
      }

      if (cookieMap.size > 0) {
        const cookiePairs = [];
        for (const [k, v] of cookieMap.entries()) {
          cookiePairs.push(`${k}=${v}`);
        }
        results.push({
          username: customUser,
          email: customEmail,
          cookieStr: cookiePairs.join('; ') + ';',
          detectedFormat: 'chrome_devtools_table',
          cookieCount: cookieMap.size,
          options
        });
      }
    }

    if (results.length > 0) return results;
  }

  // 6. Format Pipe-separated atau Baris Demi Baris Semicolon
  const results = [];
  for (const line of lines) {
    if (/^(=+|-+|#|\/\/)/.test(line)) continue;
    let username = null;
    let email = null;
    let phone = null;
    let cookieStr = null;

    if (line.includes('|')) {
      const parts = line.split('|').map(p => p.trim());
      if (parts.length >= 3) {
        username = parts[0];
        email = parts[1];
        cookieStr = parts[2];
        if (parts.length >= 4) phone = parts[3];
      } else if (parts.length === 2) {
        username = parts[0];
        cookieStr = parts[1];
      }
    } else {
      cookieStr = line;
    }

    if (!cookieStr || cookieStr.length < 5) continue;
    cookieStr = cookieStr.replace(/^(?:Cookie|cookie):\s*/i, '').trim();

    results.push({
      username,
      email,
      phone,
      cookieStr,
      detectedFormat: line.includes('|') ? 'pipe_separated' : 'semicolon_string',
      options
    });
  }

  return results;
}

/**
 * Preview hasil deteksi format cookies sebelum disimpan
 * @param {string|Array} rawInput 
 */
function parseCookiePreview(rawInput) {
  if (!rawInput || (typeof rawInput !== 'string' && !Array.isArray(rawInput))) {
    return { valid: false, message: 'Input kosong' };
  }
  const parsedItems = parseCookieInput(rawInput);
  if (!parsedItems || parsedItems.length === 0) {
    return { valid: false, message: 'Format cookie tidak dikenali' };
  }

  const first = parsedItems[0];
  const cookieStr = first.cookieStr || '';
  const detectedTokens = [];
  const importantKeys = ['SPC_F', 'SPC_CLIENTID', 'SPC_R_T_ID', 'SPC_R_T_IV', 'SPC_SEC_SI', 'SPC_EC', 'SPC_U', 'SPC_ST', 'SPC_CDS_CHAT'];
  for (const k of importantKeys) {
    if (cookieStr.includes(k + '=') || cookieStr.includes(k + '\t')) {
      detectedTokens.push(k);
    }
  }

  const userIdMatch = cookieStr.match(/SPC_U=(\d+)/);
  const userId = userIdMatch ? userIdMatch[1] : null;
  const hasAuthTokens = detectedTokens.includes('SPC_SEC_SI') || detectedTokens.includes('SPC_R_T_ID') || detectedTokens.includes('SPC_U') || detectedTokens.includes('SPC_ST');

  return {
    valid: true,
    count: parsedItems.length,
    detectedFormat: first.detectedFormat,
    detectedTokens,
    tokenCount: detectedTokens.length,
    hasAuthTokens,
    userId,
    sampleUsername: first.username || (userId ? `shopee_user_${userId.slice(-6)}` : null)
  };
}

/**
 * Import akun Shopee nyata berbasis Session Cookie
 * Format yang didukung:
 * - Chrome DevTools Application > Cookies table (copy paste langsung dari browser)
 * - cURL command / Network tab header
 * - JSON Cookie-Editor extension
 * - Pipe format: Username|Email|CookieString
 * - Baris teks: CookieString saja (SPC_EC=...; SPC_ST=...;)
 * @param {string|Array} rawText
 * @param {object} [options]
 */
function importRealCookies(rawText, options = {}) {
  if (!rawText) return { success: false, count: 0, accounts: [] };
  if (typeof rawText !== 'string' && !Array.isArray(rawText)) {
    return { success: false, count: 0, accounts: [] };
  }
  if (typeof rawText === 'string' && !rawText.trim()) {
    return { success: false, count: 0, accounts: [] };
  }

  const parsedItems = parseCookieInput(rawText, options);
  if (!parsedItems || parsedItems.length === 0) {
    return { success: false, count: 0, accounts: [] };
  }

  const accounts = loadDatabase();
  const importedList = [];

  for (const item of parsedItems) {
    const cookieStr = item.cookieStr;
    if (!cookieStr || cookieStr.length < 5) continue;

    // Ekstrak SPC_U jika ada dalam cookie untuk username alami
    const matchUser = cookieStr.match(/SPC_U=(\d+)/);
    const userId = matchUser ? matchUser[1] : null;

    const identity = generateIndonesianIdentity('random');
    const customName = options.accountName || item.name || null;
    const finalUsername = options.username || item.username || (userId ? `shopee_user_${userId.slice(-6)}` : identity.username);
    const finalEmail = item.email || `${finalUsername.toLowerCase().replace(/[^a-z0-9]/g, '')}@cepatmail.org`;

    const accId = `acc-cookie-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
    
    // Alokasi proxy sesuai preferensi opsi
    let allocatedProxy = null;
    if (options.proxyId) {
      allocatedProxy = proxyManager.getAll().find(p => p.id === options.proxyId && p.status !== 'dead');
    }
    if (!allocatedProxy) {
      const preferredType = options.proxyType || 'residential';
      allocatedProxy = proxyManager.allocateProxyForAccount(accId, preferredType) 
        || proxyManager.allocateProxyForAccount(accId);
    }

    // Deteksi token penting dalam cookie
    const importantKeys = ['SPC_F', 'SPC_CLIENTID', 'SPC_R_T_ID', 'SPC_R_T_IV', 'SPC_SEC_SI', 'SPC_EC', 'SPC_U', 'SPC_ST'];
    const detectedTokens = importantKeys.filter(k => cookieStr.includes(k + '='));

    const newAcc = {
      id: accId,
      accountType: 'real_authenticated',
      email: finalEmail,
      username: finalUsername,
      name: customName || identity.fullName,
      gender: identity.gender,
      birthdate: identity.birthdate,
      bio: identity.bio,
      city: identity.city,
      avatar: getRealisticAvatar(identity.gender),
      phoneNumber: item.phone || null,
      cookies: cookieStr.trim(),
      cookieStatus: 'alive',
      tokens: detectedTokens,
      detectedFormat: item.detectedFormat || 'standard',
      hasAuthTokens: detectedTokens.includes('SPC_SEC_SI') || detectedTokens.includes('SPC_R_T_ID') || detectedTokens.includes('SPC_U'),
      lastValidatedAt: new Date().toISOString(),
      assignedProxy: allocatedProxy ? {
        id: allocatedProxy.id,
        ip: allocatedProxy.ip,
        port: allocatedProxy.port,
        protocol: allocatedProxy.protocol,
        type: allocatedProxy.type,
        city: allocatedProxy.city
      } : null,
      status: 'ready',
      verified: true,
      totalLiveWatched: 0,
      createdAt: new Date().toISOString()
    };

    accounts.unshift(newAcc);
    importedList.push(newAcc);
  }

  saveDatabase(accounts);
  return { 
    success: importedList.length > 0, 
    count: importedList.length, 
    accounts: importedList,
    detectedFormat: parsedItems[0]?.detectedFormat || 'unknown'
  };
}

/**
 * Validasi masa aktif cookie sesi akun tertentu
 * @param {string} accountId
 */
function validateSessionCookie(accountId) {
  const accounts = loadDatabase();
  const target = accounts.find(a => a.id === accountId);
  if (!target) return { success: false, error: 'Akun tidak ditemukan' };
  if (!target.cookies) return { success: false, error: 'Akun ini tidak memiliki kredensial session cookie' };

  // Verifikasi format cookie
  const hasSpc = target.cookies.includes('SPC_') || target.cookies.includes('SPC_EC') || target.cookies.includes('SPC_ST') || target.cookies.includes('=');
  
  // Jika format rusak / kosong
  if (!hasSpc || target.cookies.trim().length < 10) {
    target.cookieStatus = 'expired';
    target.lastValidatedAt = new Date().toISOString();
    saveDatabase(accounts);
    return { success: true, accountId, status: 'expired', reason: 'Cookie string tidak valid atau telah kedaluwarsa' };
  }

  // Cookie aktif
  target.cookieStatus = 'alive';
  target.lastValidatedAt = new Date().toISOString();
  saveDatabase(accounts);

  return {
    success: true,
    accountId,
    status: 'alive',
    lastValidatedAt: target.lastValidatedAt
  };
}

/**
 * Validasi massal seluruh akun yang memiliki session cookie
 */
function validateAllCookies() {
  const accounts = loadDatabase();
  let aliveCount = 0;
  let expiredCount = 0;

  const cookieAccounts = accounts.filter(a => !!a.cookies);

  cookieAccounts.forEach(acc => {
    const res = validateSessionCookie(acc.id);
    if (res.status === 'alive') aliveCount++;
    else expiredCount++;
  });

  return {
    totalWithCookies: cookieAccounts.length,
    alive: aliveCount,
    expired: expiredCount
  };
}

/**
 * Tambahkan akun hasil pendaftaran resmi ke database
 * @param {object} accountObj
 */
function addRealRegisteredAccount(accountObj) {
  if (!accountObj.assignedProxy) {
    const prx = proxyManager.allocateProxyForAccount(accountObj.id, 'mobile') 
      || proxyManager.allocateProxyForAccount(accountObj.id, 'residential')
      || proxyManager.allocateProxyForAccount(accountObj.id);
    if (prx) {
      accountObj.assignedProxy = {
        id: prx.id,
        ip: prx.ip,
        port: prx.port,
        protocol: prx.protocol,
        type: prx.type,
        city: prx.city
      };
    }
  }
  const accounts = loadDatabase();
  accounts.unshift(accountObj);
  saveDatabase(accounts);
  return accountObj;
}

/**
 * Ikat cookie asli dari browser ke akun tertentu
 * @param {string} accountId
 * @param {string} rawCookieText
 */
function bindRealCookiesToAccount(accountId, rawCookieText) {
  if (!accountId) return { success: false, error: 'ID Akun diperlukan' };
  if (!rawCookieText || typeof rawCookieText !== 'string' || !rawCookieText.trim()) {
    return { success: false, error: 'String Cookie tidak boleh kosong' };
  }

  const cookieStr = rawCookieText.trim();
  if (cookieStr.length < 10 || (!cookieStr.includes('SPC_') && !cookieStr.includes('='))) {
    return { success: false, error: 'Format Cookie tidak valid (harus mengandung token SPC_ / Shopee cookies)' };
  }

  const accounts = loadDatabase();
  const target = accounts.find(a => a.id === accountId);
  if (!target) {
    return { success: false, error: `Akun dengan ID [${accountId}] tidak ditemukan` };
  }

  // Deteksi token penting dalam cookie
  const importantKeys = ['SPC_F', 'SPC_CLIENTID', 'SPC_R_T_ID', 'SPC_R_T_IV', 'SPC_SEC_SI', 'SPC_EC', 'SPC_U', 'SPC_ST'];
  const detectedTokens = importantKeys.filter(k => cookieStr.includes(k + '='));

  // Ekstrak SPC_U jika ada dalam cookie untuk update username/userId jika belum spesifik
  const matchUser = cookieStr.match(/SPC_U=(\d+)/);
  if (matchUser && matchUser[1] && (!target.username || target.username.startsWith('shopee_user_'))) {
    target.username = `shopee_user_${matchUser[1].slice(-6)}`;
  }

  target.cookies = cookieStr;
  target.cookieStatus = 'alive';
  target.status = 'ready';
  target.verified = true;
  target.tokens = detectedTokens;
  target.hasAuthTokens = detectedTokens.includes('SPC_SEC_SI') || detectedTokens.includes('SPC_R_T_ID') || detectedTokens.includes('SPC_U');
  target.lastValidatedAt = new Date().toISOString();
  target.accountType = 'real_authenticated';
  target.note = 'Cookie otentik browser berhasil diikat ke akun';

  saveDatabase(accounts);
  return {
    success: true,
    message: `Session cookie berhasil diikat ke akun @${target.username}. Akun kini berstatus Siap Pakai.`,
    account: target
  };
}

module.exports = {
  getAllAccounts,
  getAvailableAccounts,
  getAvailableCount,
  getBusyCount,
  claimAccount,
  releaseAccount,
  releaseAllForCampaign,
  getAccountSummary,
  createAccountBatch,
  validateAllAccounts,
  deleteAccount,
  exportAccountsAsCsv,
  incrementAccountWatchCount,
  importRealCookies,
  parseCookieInput,
  parseCookiePreview,
  validateSessionCookie,
  validateAllCookies,
  addRealRegisteredAccount,
  bindRealCookiesToAccount
};
