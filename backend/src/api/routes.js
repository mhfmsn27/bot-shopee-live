/**
 * REST API Routes - Controller API Endpoints
 * Menghubungkan dashboard antarmuka dengan engine backend bot, akun, proxy, dan WhatsApp
 */

const express = require('express');
const router = express.Router();
const retentionController = require('../core/retention-controller');
const proxyManager = require('../proxy/proxy-manager');
const accountManager = require('../identity/account-manager');
const waGateway = require('../wa-gateway/whatsapp-service');
const interactionManager = require('../interaction/interaction-manager');
const canaryWatchdog = require('../security/canary-watchdog');
const historyManager = require('../analytics/history-manager');
const streamScheduler = require('../scheduler/stream-scheduler');
const smsGateway = require('../identity/sms-gateway');
const realRegistrationPipeline = require('../identity/real-registration-pipeline');
const sqliteManager = require('../db/sqlite-manager');
const authManager = require('../security/auth-manager');
const protocolClient = require('../core/protocol-client');
const systemTelemetry = require('../core/system-telemetry');

// Inisialisasi pengawas keamanan proaktif (Canary Watchdog)
canaryWatchdog.start();

// SSE (Server-Sent Events) clients
let sseClients = [];

function broadcastSse(eventType, data) {
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(client => client.res.write(payload));
}

// Forward events ke SSE
retentionController.on('stats', (stats) => broadcastSse('stats', stats));
retentionController.on('log', (log) => broadcastSse('log', log));
retentionController.on('status_change', (sc) => broadcastSse('status_change', sc));
retentionController.on('campaigns_updated', (c) => broadcastSse('campaigns_updated', c));
retentionController.on('chat_message', (chat) => broadcastSse('chat_message', chat));
retentionController.on('like_burst', (like) => broadcastSse('like_burst', like));
retentionController.on('cart_click', (cart) => broadcastSse('cart_click', cart));
canaryWatchdog.on('status_change', (sc) => broadcastSse('canary_status', sc));
canaryWatchdog.on('waf_alert', (alert) => broadcastSse('waf_alert', alert));
historyManager.on('history_updated', (h) => broadcastSse('history_updated', h));
streamScheduler.on('schedules_updated', (s) => broadcastSse('schedules_updated', s));
waGateway.on('qr', (data) => broadcastSse('wa_qr', data));
waGateway.on('connected', (user) => broadcastSse('wa_connected', user));
waGateway.on('disconnected', () => broadcastSse('wa_disconnected', {}));
waGateway.on('message_sent', (msg) => broadcastSse('wa_message_sent', msg));

/**
 * Endpoint SSE Real-time Feed
 */
router.get('/stream-events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const clientId = Date.now();
  const newClient = { id: clientId, res };
  sseClients.push(newClient);

  // Kirim snapshot pertama
  res.write(`event: stats\ndata: ${JSON.stringify(retentionController.getMetrics())}\n\n`);
  res.write(`event: campaigns_updated\ndata: ${JSON.stringify(retentionController.getAllCampaigns())}\n\n`);
  res.write(`event: canary_status\ndata: ${JSON.stringify(canaryWatchdog.getStatus())}\n\n`);
  res.write(`event: chat_history\ndata: ${JSON.stringify(retentionController.getRecentChats())}\n\n`);

  req.on('close', () => {
    sseClients = sseClients.filter(c => c.id !== clientId);
  });
});

/**
 * HEALTH CHECK (Untuk Docker Container & Load Balancers)
 */
router.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

/**
 * SISTEM TELEMETRI & INFRASTRUKTUR HEALTH MONITOR
 * Menyediakan snapshot real-time CPU, RAM Heap, Event Loop Latency,
 * Bandwidth data rate, dan kesehatan pool proxy armada enterprise.
 */
router.get('/system/health-telemetry', (req, res) => {
  try {
    const snapshot = systemTelemetry.getSnapshot(retentionController, proxyManager);
    res.json({
      success: true,
      data: snapshot
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * AUTHENTICATION & ACCESS GATEKEEPER
 */
router.get('/auth/status', (req, res) => {
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
  const isBlocked = authManager.isIpBlocked(clientIp);

  let token = '';
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else if (req.headers.cookie) {
    const match = req.headers.cookie.match(/(?:^|;\s*)sb_session=([^;]+)/);
    if (match) token = decodeURIComponent(match[1]);
  }
  const verification = authManager.verifySessionToken(token);

  res.json({
    success: true,
    authenticated: verification.valid,
    username: verification.username || null,
    config: authManager.getPublicConfig(),
    isBlocked
  });
});

router.post('/auth/login', async (req, res) => {
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
  const userAgent = req.headers['user-agent'] || '';
  const { username = 'admin', password, rememberMe } = req.body;

  if (authManager.isIpBlocked(clientIp)) {
    return res.status(429).json({
      success: false,
      blocked: true,
      error: 'Terlalu banyak percobaan gagal. IP Anda diblokir sementara selama 15 menit untuk alasan keamanan.'
    });
  }

  // Verifikasi kredensial Username & Password
  const isValid = authManager.verifyCredentials(username, password);
  if (!isValid) {
    const record = authManager.recordFailedAttempt(clientIp);
    const remaining = authManager.maxFailedAttempts - (record ? record.count : 1);
    return res.status(401).json({
      success: false,
      error: 'Username atau Password yang Anda masukkan salah.',
      remainingAttempts: Math.max(0, remaining),
      blocked: remaining <= 0
    });
  }

  authManager.recordSuccessfulLogin(clientIp);

  const config = authManager.getInternalConfig();
  if (config.enable2faWhatsapp) {
    await authManager.generateAndSendWhatsappOtp(clientIp);
    return res.json({
      success: true,
      requireOtp: true,
      message: 'Kredensial valid. Kode OTP verifikasi telah dikirimkan ke nomor WhatsApp Admin.'
    });
  }

  const session = authManager.createSession(username, clientIp, userAgent, rememberMe);
  const cookieMaxAge = session.timeoutMinutes * 60; // dalam detik

  // Set-Cookie HttpOnly; SameSite=Strict
  res.setHeader(
    'Set-Cookie',
    `sb_session=${encodeURIComponent(session.token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${cookieMaxAge}`
  );

  res.json({
    success: true,
    token: session.token,
    username: session.username,
    expiresAt: session.expiresAt,
    timeoutMinutes: session.timeoutMinutes,
    message: 'Autentikasi operator berhasil.'
  });
});

router.post('/auth/verify-otp', (req, res) => {
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
  const userAgent = req.headers['user-agent'] || '';
  const { otp, rememberMe, username = 'admin' } = req.body;

  const validOtp = authManager.verifyOtp(otp);
  if (!validOtp) {
    return res.status(400).json({
      success: false,
      error: 'Kode OTP tidak valid atau telah kedaluwarsa.'
    });
  }

  const session = authManager.createSession(username, clientIp, userAgent, rememberMe);
  const cookieMaxAge = session.timeoutMinutes * 60;

  res.setHeader(
    'Set-Cookie',
    `sb_session=${encodeURIComponent(session.token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${cookieMaxAge}`
  );

  res.json({
    success: true,
    token: session.token,
    username: session.username,
    expiresAt: session.expiresAt,
    timeoutMinutes: session.timeoutMinutes,
    message: 'Verifikasi 2FA berhasil.'
  });
});

router.post('/auth/logout', (req, res) => {
  let token = '';
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else if (req.headers.cookie) {
    const match = req.headers.cookie.match(/(?:^|;\s*)sb_session=([^;]+)/);
    if (match) token = decodeURIComponent(match[1]);
  }

  if (token) {
    authManager.destroySession(token);
  }

  // Hapus cookie sesi HttpOnly
  res.setHeader('Set-Cookie', 'sb_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
  res.json({ success: true, message: 'Sesi operator berhasil diakhiri.' });
});

router.get('/auth/user-profile', (req, res) => {
  const publicConfig = authManager.getPublicConfig();
  res.json({
    success: true,
    data: {
      username: publicConfig.username || 'admin',
      sessionTimeoutMinutes: publicConfig.sessionTimeoutMinutes || 120,
      enabled: publicConfig.enabled,
      updatedAt: publicConfig.updatedAt
    }
  });
});

router.post('/auth/change-credentials', (req, res) => {
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
  const userAgent = req.headers['user-agent'] || '';
  const { oldPassword, newUsername, newPassword } = req.body;

  const result = authManager.changeCredentials(oldPassword, newUsername, newPassword);
  if (!result.success) {
    return res.status(400).json(result);
  }

  // Buatkan session baru untuk klien yang saat ini sedang aktif mengubah password
  const newSession = authManager.createSession(result.username, clientIp, userAgent, false);
  const cookieMaxAge = newSession.timeoutMinutes * 60;

  res.setHeader(
    'Set-Cookie',
    `sb_session=${encodeURIComponent(newSession.token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${cookieMaxAge}`
  );

  res.json({
    success: true,
    message: result.message,
    username: result.username,
    timeoutMinutes: newSession.timeoutMinutes
  });
});

router.post('/auth/session-timeout', (req, res) => {
  const { sessionTimeoutMinutes } = req.body;
  const result = authManager.updateSettings({ sessionTimeoutMinutes });
  res.json(result);
});

router.post('/auth/toggle', (req, res) => {
  const { enabled } = req.body;
  const result = authManager.toggleSecurity(enabled);
  res.json(result);
});

router.get('/auth/settings', (req, res) => {
  res.json({ success: true, config: authManager.getPublicConfig() });
});

router.post('/auth/settings', (req, res) => {
  const result = authManager.updateSettings(req.body);
  res.json(result);
});

/**
 * STATUS SISTEM
 */
router.get('/status', (req, res) => {
  const metrics = retentionController.getMetrics();
  res.json({
    success: true,
    system: {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      nodeVersion: process.version
    },
    metrics,
    campaigns: retentionController.getAllCampaigns(),
    whatsapp: waGateway.getStatus(),
    canary: canaryWatchdog.getStatus()
  });
});

/**
 * KONTROL KAMPANYE LIVE VIEW (SINGLE & MULTI-SESSION)
 */
router.get('/campaigns', (req, res) => {
  res.json({
    success: true,
    total: retentionController.campaigns.size,
    campaigns: retentionController.getAllCampaigns(),
    aggregate: retentionController.getMetrics()
  });
});

router.post('/campaigns', async (req, res) => {
  try {
    const campaign = retentionController.createCampaign(req.body);
    res.json({
      success: true,
      message: `Kampanye [${campaign.name}] berhasil dimulai.`,
      campaign
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.post('/campaigns/:id/stop', (req, res) => {
  const result = retentionController.stopCampaignById(req.params.id, 'manual_stop');
  res.json({ success: result.success, message: result.message || 'Kampanye dihentikan.', ...result });
});

router.delete('/campaigns/:id', (req, res) => {
  const success = retentionController.removeCampaign(req.params.id);
  res.json({ success, message: success ? 'Kampanye dihapus.' : 'Kampanye tidak ditemukan.' });
});

// Real-Time Dynamic Viewer Scaling (Tambah / Kurangi Penonton di Tengah Siaran)
router.post('/campaigns/:id/scale-viewers', (req, res) => {
  try {
    const rawTarget = req.body.targetViewers || req.body.newTargetViewers;
    const targetViewers = parseInt(rawTarget, 10);
    if (!targetViewers || isNaN(targetViewers) || targetViewers < 1) {
      return res.status(400).json({ success: false, message: 'Jumlah target viewers tidak valid.' });
    }
    const result = retentionController.updateCampaignTargetViewers(req.params.id, targetViewers);
    res.json({
      success: true,
      message: `Target viewers berhasil disesuaikan ke ${targetViewers}.`,
      newTargetViewers: result.newTarget,
      previousTargetViewers: result.oldTarget,
      ...result
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// 1-Click Quick Re-Live (Lanjut kirim bot saat sesi live ganti/restart)
router.post('/campaigns/quick-relive', async (req, res) => {
  try {
    const { sourceCampaignId, clientName, targetViewers } = req.body;
    const newLiveUrl = req.body.newLiveUrl || req.body.newUrlOrRoomId || req.body.urlOrRoomId;
    const newName = req.body.newName || req.body.name;

    let baseConfig = null;
    const existing = retentionController.campaigns.get(sourceCampaignId);
    if (existing) {
      baseConfig = { ...existing.getMetrics() };
    } else {
      const historyList = historyManager.getAllHistory();
      const match = historyList.find(h => h.id === sourceCampaignId || h.campaignId === sourceCampaignId);
      if (match) {
        baseConfig = { ...match };
      }
    }

    const payload = {
      ...baseConfig,
      shopeeLiveUrl: newLiveUrl || (baseConfig ? (baseConfig.rawInputUrl || baseConfig.liveUrl || baseConfig.roomId) : ''),
      targetViewers: targetViewers ? parseInt(targetViewers, 10) : (baseConfig ? baseConfig.targetViewers : 100),
      clientName: clientName || (baseConfig ? (baseConfig.clientName || baseConfig.name) : '')
    };

    delete payload.id;
    if (newName) payload.name = newName;

    if (!payload.shopeeLiveUrl) {
      return res.status(400).json({ success: false, message: 'URL / Room ID siaran baru wajib dimasukkan.' });
    }

    const campaign = retentionController.createCampaign(payload);
    res.json({
      success: true,
      message: `⚡ Quick Re-Live [${campaign.name}] berhasil diluncurkan!`,
      campaign
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// Data Lengkap Laporan Eksekutif Klien (PDF Report Data)
router.get('/campaigns/:id/report-data', (req, res) => {
  const id = req.params.id;
  const active = retentionController.campaigns.get(id);
  if (active) {
    return res.json({
      success: true,
      report: {
        ...active.getMetrics(),
        clientName: active.clientName || active.name,
        isLive: true,
        reportGeneratedAt: new Date().toISOString()
      }
    });
  }

  const historyList = historyManager.getAllHistory();
  const match = historyList.find(h => h.id === id || h.campaignId === id);
  if (match) {
    return res.json({
      success: true,
      report: {
        ...match,
        isLive: false,
        reportGeneratedAt: new Date().toISOString()
      }
    });
  }

  return res.status(404).json({ success: false, message: 'Data sesi siaran tidak ditemukan.' });
});

// Preset Toko / Klien Langganan
router.get('/campaigns/presets', (req, res) => {
  try {
    const presets = sqliteManager.getConfig('client_presets') || [];
    res.json({ success: true, presets });
  } catch (err) {
    res.json({ success: true, presets: [] });
  }
});

router.post('/campaigns/presets', (req, res) => {
  try {
    const { targetViewers, retentionMode, category } = req.body;
    const clientName = (req.body.clientName || req.body.name || '').trim();
    const name = (req.body.name || `${clientName} Preset`).trim();
    if (!clientName && !name) {
      return res.status(400).json({ success: false, message: 'Nama preset/klien wajib diisi.' });
    }
    let presets = sqliteManager.getConfig('client_presets') || [];
    presets = presets.filter(p => p.name.toLowerCase() !== name.toLowerCase() && (!p.clientName || p.clientName.toLowerCase() !== clientName.toLowerCase()));
    presets.unshift({
      id: `preset-${Date.now()}`,
      clientName: clientName || name,
      name: name,
      targetViewers: parseInt(targetViewers, 10) || 100,
      retentionMode: retentionMode || 'dynamic_churn',
      category: category || 'general',
      savedAt: new Date().toISOString()
    });
    if (presets.length > 30) presets = presets.slice(0, 30);
    sqliteManager.saveConfig('client_presets', presets);
    res.json({ success: true, message: `Preset Toko [${clientName || name}] berhasil disimpan.`, presets });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/campaigns/presets/:id', (req, res) => {
  try {
    let presets = sqliteManager.getConfig('client_presets') || [];
    presets = presets.filter(p => p.id !== req.params.id && p.name !== req.params.id);
    sqliteManager.saveConfig('client_presets', presets);
    res.json({ success: true, message: 'Preset berhasil dihapus.', presets });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Backward-compatible single-campaign endpoints
router.post('/campaign/start', async (req, res) => {
  try {
    const result = await retentionController.startCampaign(req.body);
    res.json({ success: true, message: 'Kampanye Shopee Live berhasil dimulai.', data: result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.post('/campaign/stop', async (req, res) => {
  try {
    const result = await retentionController.stopCampaign('manual_stop');
    res.json({ success: true, message: 'Seluruh kampanye Shopee Live berhasil dihentikan.', ...result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * DIAGNOSTIK KONEKTIVITAS STREAM SHOPEE LIVE
 * Menguji keterjangkauan room, CDN video stream (FLV/HLS), dan status proteksi WAF Shopee
 */
router.post('/campaigns/test-connectivity', async (req, res) => {
  const { urlOrRoomId, proxyId, cookie } = req.body || {};
  if (!urlOrRoomId) {
    return res.status(400).json({ success: false, message: 'URL atau Room ID wajib diisi.' });
  }

  const roomId = protocolClient.parseLiveRoomId(urlOrRoomId);
  if (!roomId) {
    return res.status(400).json({ success: false, message: 'Format Room ID tidak valid.' });
  }

  let proxyAgent = null;
  let proxyInfo = null;
  if (proxyId) {
    const p = proxyManager.getProxyById(proxyId);
    if (p) {
      proxyAgent = proxyManager.getProxyAgent(p);
      proxyInfo = { id: p.id, ip: p.ip, port: p.port, protocol: p.protocol };
    }
  }

  try {
    const startTime = Date.now();
    const roomInfo = await protocolClient.fetchLiveRoomInfo(roomId, {
      proxyAgent,
      cookie,
      timeout: 6000
    });

    let cdnProbe = null;
    const playUrl = roomInfo.roomData && roomInfo.roomData.playUrl;
    if (playUrl && typeof playUrl === 'string' && playUrl.startsWith('http')) {
      try {
        cdnProbe = await protocolClient.probeVideoStreamChunks(playUrl, {
          proxyAgent,
          timeout: 4000
        });
      } catch (e) {
        cdnProbe = { success: false, error: e.message };
      }
    }

    const isWafBlocked = roomInfo.errCode === 90309999 || (roomInfo.status === 403 && !roomInfo.success);

    res.json({
      success: true,
      roomId,
      online: !!roomInfo.online,
      status: roomInfo.status || 200,
      latencyMs: roomInfo.latencyMs || (Date.now() - startTime),
      roomData: roomInfo.roomData || null,
      cdnProbe,
      proxy: proxyInfo || { mode: 'direct' },
      antiBotStatus: {
        isWafBlocked,
        errCode: roomInfo.errCode || null,
        recommendation: isWafBlocked
          ? 'IP terdeteksi Datacenter/Ter-throttle oleh Shopee. Gunakan proxy Residential Indonesia dan akun ber-cookie SPC_ otentik.'
          : 'Koneksi gateway Shopee Live normal. Siap dijalankan dengan Stream Drainer.'
      }
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      roomId,
      error: err.message
    });
  }
});

router.get('/logs', (req, res) => {
  res.json({ success: true, logs: retentionController.logsBuffer });
});

router.get('/chats', (req, res) => {
  res.json({ success: true, chats: retentionController.getRecentChats() });
});

/**
 * MANAJEMEN AKUN & GENERATOR IDENTITAS
 */
router.get('/accounts', (req, res) => {
  const accounts = accountManager.getAllAccounts();
  const summary = accountManager.getAccountSummary();
  const health = accountManager.validateAllAccounts();
  res.json({ success: true, total: accounts.length, summary, health, accounts });
});

router.get('/accounts/summary', (req, res) => {
  res.json({ success: true, summary: accountManager.getAccountSummary() });
});

router.post('/accounts/generate', async (req, res) => {
  try {
    const created = await accountManager.createAccountBatch(req.body);
    retentionController.addLog('SUCCESS', `Membuat ${created.length} akun Shopee baru dengan identitas Indonesia lengkap & avatar.`);
    res.json({
      success: true,
      message: `Berhasil membuat ${created.length} akun Shopee beridentitas lengkap.`,
      accounts: created
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/accounts/:id', (req, res) => {
  const success = accountManager.deleteAccount(req.params.id);
  res.json({ success });
});

router.get('/accounts/export', (req, res) => {
  const csvData = accountManager.exportAccountsAsCsv();
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="shopee_accounts_export.csv"');
  res.send(csvData);
});

router.post('/accounts/validate', (req, res) => {
  const result = accountManager.validateAllAccounts();
  retentionController.addLog('INFO', `Audit kesehatan akun selesai: ${result.valid}/${result.total} akun sehat (Rata-rata Skor: ${result.averageHealthScore}%).`);
  res.json({ success: true, ...result });
});

// Import akun nyata berbasis Session Cookie
router.post('/accounts/import-cookies', (req, res) => {
  try {
    const rawText = req.body.rawText || req.body.rawCookies || '';
    const options = {
      accountName: req.body.accountName || req.body.name || null,
      username: req.body.username || null,
      proxyType: req.body.proxyType || null,
      proxyId: req.body.proxyId || null,
      tags: req.body.tags || null
    };
    const result = accountManager.importRealCookies(rawText, options);
    if (result.success) {
      retentionController.addLog('SUCCESS', `Berhasil mengimpor ${result.count} akun Shopee terotentikasi (${result.detectedFormat || 'Real Cookie Vault'}).`);
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Preview deteksi parsing cookies
router.post('/accounts/preview-cookies', (req, res) => {
  try {
    const rawText = req.body.rawText || req.body.rawCookies || '';
    const preview = accountManager.parseCookiePreview(rawText);
    res.json(preview);
  } catch (err) {
    res.status(500).json({ valid: false, error: err.message });
  }
});

// Validasi massal sesi cookies
router.post('/accounts/validate-cookies', (req, res) => {
  const result = accountManager.validateAllCookies();
  retentionController.addLog('INFO', `Audit cookie selesai: ${result.alive}/${result.totalWithCookies} cookie aktif (${result.expired} kedaluwarsa).`);
  res.json({ success: true, ...result });
});

// Validasi cookie akun tunggal
router.post('/accounts/:id/validate-cookie', (req, res) => {
  const result = accountManager.validateSessionCookie(req.params.id);
  res.json(result);
});

// Ikat session cookie asli ke akun tertentu
router.post('/accounts/:id/bind-cookies', (req, res) => {
  try {
    const rawText = req.body.cookies || req.body.cookieString || req.body.rawCookies || req.body.rawText || '';
    const result = accountManager.bindRealCookiesToAccount(req.params.id, rawText);
    if (result.success) {
      retentionController.addLog('SUCCESS', `Cookie otentik berhasil diikat ke akun @${result.account.username} (${result.account.phoneNumber || 'ID: ' + req.params.id}). Status akun kini Siap Pakai.`);
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Ambil status & saldo provider SMS Gateway
router.get('/accounts/sms-gateway/config', async (req, res) => {
  const config = smsGateway.getConfig();
  const balance = await smsGateway.getBalance();
  res.json({ success: true, config, balance });
});

// Simpan konfigurasi provider SMS Gateway
router.post('/accounts/sms-gateway/config', (req, res) => {
  const updated = smsGateway.updateConfig(req.body);
  retentionController.addLog('INFO', `Konfigurasi Virtual SMS Gateway diperbarui (Provider: ${updated.provider}).`);
  res.json({ success: true, config: updated });
});

// Minta nomor telepon virtual baru (+62...)
router.post('/accounts/sms-gateway/request-number', async (req, res) => {
  try {
    const result = await smsGateway.requestPhoneNumber(req.body.country || 'id', req.body.service || 'shopee');
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Polling / Periksa SMS OTP yang masuk
router.post('/accounts/sms-gateway/check-otp', async (req, res) => {
  try {
    const result = await smsGateway.fetchSmsOtp(req.body.activationId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Batalkan pesanan nomor
router.post('/accounts/sms-gateway/cancel', async (req, res) => {
  try {
    const result = await smsGateway.cancelActivation(req.body.activationId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Inisiasi pipeline registrasi akun Shopee baru
router.post('/accounts/register-pipeline/init', async (req, res) => {
  try {
    const result = await realRegistrationPipeline.initiateRegistration(req.body);
    retentionController.addLog('INFO', `Memulai pipeline registrasi Shopee: Nomor ${result.formattedPhone} dialokasikan.`);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Selesaikan pipeline registrasi akun Shopee baru & simpan ke database
router.post('/accounts/register-pipeline/complete', async (req, res) => {
  try {
    const newAccount = await realRegistrationPipeline.completeRegistration(req.body);
    accountManager.addRealRegisteredAccount(newAccount);
    retentionController.addLog('SUCCESS', `Akun Shopee Resmi Baru Berhasil Didaftarkan & Disimpan: @${newAccount.username} (${newAccount.phoneNumber}).`);
    res.json({ success: true, account: newAccount });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * MANAJEMEN PROXY POOL
 */
router.get('/proxies', (req, res) => {
  const proxies = proxyManager.getAll();
  const aliveCount = proxyManager.getAliveProxies().length;
  res.json({ success: true, total: proxies.length, alive: aliveCount, proxies });
});

router.get('/proxies/health', (req, res) => {
  const healthStats = proxyManager.getHealthStats();
  res.json({ success: true, stats: healthStats });
});

router.post('/proxies/purge-dead', (req, res) => {
  const result = proxyManager.purgeDeadProxies();
  retentionController.addLog('WARN', `Purge dead proxies: ${result.purgedCount} proxy mati dihapus dari pool. Sisa ${result.remainingAlive} proxy hidup.`);
  res.json({ success: true, ...result });
});

router.post('/proxies/import', (req, res) => {
  const count = proxyManager.importRawList(req.body.rawText, req.body.defaultType, req.body.defaultProtocol);
  retentionController.addLog('INFO', `Import ${count} proxy IP baru ke dalam database (Tipe: ${req.body.defaultType || 'datacenter'}, Protokol: ${req.body.defaultProtocol || 'http'}).`);
  res.json({ success: true, addedCount: count });
});

// Ambil rotating gateway aktif
router.get('/proxies/gateway', (req, res) => {
  const gateway = proxyManager.getRotatingGateway();
  res.json({ success: true, gateway });
});

// Setup atau update Residential Rotating Gateway
router.post('/proxies/gateway', (req, res) => {
  try {
    const result = proxyManager.addRotatingGateway(req.body);
    if (result.success) {
      retentionController.addLog('SUCCESS', `Residential Rotating Gateway berhasil dikonfigurasi: ${result.proxy.ip}:${result.proxy.port} (${result.proxy.protocol.toUpperCase()}).`);
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Uji koneksi proxy langsung sebelum disimpan
router.post('/proxies/probe', async (req, res) => {
  try {
    const host = req.body.host || req.body.ip;
    const port = parseInt(req.body.port, 10);
    const protocol = req.body.protocol || 'http';
    const username = req.body.username || '';
    const password = req.body.password || '';

    const tempProxy = {
      id: 'temp-probe',
      ip: host,
      port,
      protocol,
      username,
      password,
      type: 'rotating'
    };

    const result = await proxyManager.testSingleProxy(tempProxy, { mockFallback: false, timeout: 5000 });
    res.json({ success: result.status === 'alive', ...result });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

router.post('/proxies/test', async (req, res) => {
  const mockFallback = req.body && req.body.mockFallback !== undefined ? req.body.mockFallback : true;
  const results = await proxyManager.testAllProxies({ mockFallback });
  const alive = results.filter(r => r.status === 'alive').length;
  retentionController.addLog('INFO', `Uji proxy selesai: ${alive}/${results.length} proxy aktif dan siap digunakan.`);
  res.json({ success: true, total: results.length, alive, results });
});

router.post('/proxies/:id/test', async (req, res) => {
  const proxy = proxyManager.getAll().find(p => p.id === req.params.id);
  if (!proxy) {
    return res.status(404).json({ success: false, message: 'Proxy tidak ditemukan' });
  }
  const result = await proxyManager.testSingleProxy(proxy, { mockFallback: true });
  res.json({ success: true, proxy: result });
});

router.delete('/proxies/:id', (req, res) => {
  const success = proxyManager.deleteProxy(req.params.id);
  res.json({ success });
});

/**
 * MODUL WHATSAPP GATEWAY
 */
router.get('/whatsapp/status', (req, res) => {
  res.json({ success: true, ...waGateway.getStatus() });
});

router.get('/whatsapp/config', (req, res) => {
  res.json({
    success: true,
    adminNumber: waGateway.adminNumber,
    notificationEvents: waGateway.notificationEvents
  });
});

router.post('/whatsapp/config', (req, res) => {
  const updated = waGateway.updateConfig(req.body);
  retentionController.addLog('INFO', 'Preferensi notifikasi WhatsApp berhasil diperbarui.');
  res.json({ success: true, message: 'Konfigurasi WhatsApp disimpan.', config: updated });
});

router.post('/whatsapp/request-qr', async (req, res) => {
  try {
    const data = await waGateway.requestQrCode();
    res.json({ success: true, ...data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/whatsapp/pair', (req, res) => {
  const phone = req.body.phone || '6281234567890';
  const result = waGateway.confirmPairing(phone);
  retentionController.addLog('SUCCESS', `WhatsApp Gateway berhasil terhubung dengan nomor +${phone}.`);
  res.json({ success: true, ...result });
});

router.post('/whatsapp/disconnect', (req, res) => {
  const result = waGateway.disconnect();
  retentionController.addLog('WARN', 'WhatsApp Gateway telah diputuskan.');
  res.json({ success: true, ...result });
});

router.post('/whatsapp/send-test', async (req, res) => {
  try {
    const { phone, message } = req.body;
    const result = await waGateway.sendMessage(phone, message || 'Test pesan dari Shopee Live View Bot!');
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.get('/whatsapp/history', (req, res) => {
  res.json({ success: true, history: waGateway.messageHistory });
});

/**
 * INTERAKSI & CHAT ENDPOINTS (GLOBAL & PER-SESI)
 */
router.get('/interaction/config', (req, res) => {
  res.json({
    success: true,
    config: interactionManager.getGlobalConfig(),
    commentBanks: interactionManager.commentBank.getAllBanks()
  });
});

router.post('/interaction/config', (req, res) => {
  const updated = interactionManager.updateGlobalConfig(req.body);
  retentionController.addLog('INFO', 'Pengaturan default interaksi bot diperbarui secara global.');
  res.json({ success: true, message: 'Pengaturan interaksi global disimpan.', config: updated });
});

router.get('/interaction/comment-banks', (req, res) => {
  res.json({
    success: true,
    banks: interactionManager.commentBank.getAllBanks()
  });
});

router.post('/interaction/comment-banks', (req, res) => {
  const { category, comments, comment } = req.body;
  if (!category) {
    return res.status(400).json({ success: false, message: 'Kategori diperlukan.' });
  }
  if (comment && typeof comment === 'string') {
    interactionManager.commentBank.addCommentToCategory(category, comment);
    return res.json({ success: true, message: `Komentar berhasil ditambahkan ke kategori [${category}].` });
  }
  if (!Array.isArray(comments)) {
    return res.status(400).json({ success: false, message: 'Kategori dan daftar komentar (array) atau teks komentar diperlukan.' });
  }
  interactionManager.commentBank.updateCategoryComments(category, comments);
  res.json({ success: true, message: `Bank komentar [${category}] berhasil diperbarui.` });
});

router.post('/campaigns/:id/interaction', (req, res) => {
  try {
    const updated = retentionController.updateCampaignInteraction(req.params.id, req.body);
    res.json({ success: true, message: 'Setelan interaksi sesi live berhasil diperbarui.', campaign: updated });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.post('/campaigns/:id/instant-chat', async (req, res) => {
  try {
    const chat = await retentionController.sendInstantComment(req.params.id, req.body.text);
    res.json({ success: true, message: 'Chat instan berhasil dikirim oleh bot.', chat });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.post('/campaigns/:id/instant-like', (req, res) => {
  try {
    const result = retentionController.sendInstantLike(req.params.id, req.body.taps);
    res.json({ success: true, message: `${result.taps} tap like berhasil dikirim.`, ...result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

/**
 * CANARY SECURITY WATCHDOG & WAF STATUS
 */
router.get('/security/canary-status', (req, res) => {
  res.json({ success: true, ...canaryWatchdog.getStatus() });
});

router.post('/security/canary-check', async (req, res) => {
  try {
    const result = await canaryWatchdog.performCanaryCheck();
    retentionController.addLog('INFO', `Manual Canary Watchdog probe dieksekusi: Status ${result.status} (Code: ${result.statusCode || 'OK'})`);
    res.json({ success: true, result, status: canaryWatchdog.getStatus() });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/security/circuit-breaker/reset', (req, res) => {
  canaryWatchdog.resetCircuitBreaker();
  retentionController.addLog('SUCCESS', 'Circuit Breaker direset manual oleh operator. Sistem kembali NORMAL.');
  res.json({ success: true, message: 'Circuit Breaker direset.', status: canaryWatchdog.getStatus() });
});

/**
 * SIMULASI KLIK KERANJANG ORANYE (ORANGE BAG INQUIRY)
 */
router.post('/campaigns/:id/instant-cart', async (req, res) => {
  try {
    const result = await retentionController.sendInstantCartClick(req.params.id, req.body.count || 5);
    res.json({ success: true, message: `${result.clicks}x klik keranjang oranye berhasil dikirim.`, ...result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

/**
 * SMART SCHEDULER (PENJADWALAN SIARAN OTOMATIS)
 */
router.get('/schedules', (req, res) => {
  res.json({ success: true, schedules: streamScheduler.getAllSchedules() });
});

router.post('/schedules', (req, res) => {
  try {
    const created = streamScheduler.createSchedule(req.body);
    retentionController.addLog('INFO', `Jadwal siaran baru ditambahkan: "${created.title}" pada pukul ${created.scheduledTime} WIB.`);
    res.json({ success: true, message: 'Jadwal siaran berhasil disimpan.', schedule: created });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.patch('/schedules/:id/toggle', (req, res) => {
  const updated = streamScheduler.toggleSchedule(req.params.id, req.body.enabled);
  if (!updated) return res.status(404).json({ success: false, message: 'Jadwal tidak ditemukan.' });
  res.json({ success: true, message: `Jadwal [${updated.title}] ${updated.enabled ? 'diaktifkan' : 'dinonaktifkan'}.`, schedule: updated });
});

router.delete('/schedules/:id', (req, res) => {
  const success = streamScheduler.deleteSchedule(req.params.id);
  res.json({ success, message: success ? 'Jadwal berhasil dihapus.' : 'Jadwal tidak ditemukan.' });
});

/**
 * CAMPAIGN HISTORY & CSV EXPORT ANALYTICS
 */
router.get('/history', (req, res) => {
  res.json({
    success: true,
    history: historyManager.getAllHistory(),
    summary: historyManager.getSummary()
  });
});

router.get('/history/export', (req, res) => {
  const csvData = historyManager.exportCsv();
  const filename = `laporan-live-shopee-${new Date().toISOString().slice(0, 10)}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.status(200).send('\uFEFF' + csvData); // BOM for Excel Indonesian encoding
});

router.delete('/history/:id', (req, res) => {
  const success = historyManager.deleteItem(req.params.id);
  res.json({ success, message: success ? 'Riwayat berhasil dihapus.' : 'Riwayat tidak ditemukan.' });
});

router.delete('/history', (req, res) => {
  historyManager.clearAll();
  retentionController.addLog('INFO', 'Seluruh riwayat sesi siaran telah dibersihkan.');
  res.json({ success: true, message: 'Seluruh riwayat berhasil dibersihkan.' });
});

/**
 * MULTI-USER PIN GUARD (SECURITY ACCESS) — Persistent via SQLite
 */
function getPinConfig() {
  try {
    const cfg = sqliteManager.getConfig('pinGuard');
    return cfg || { enabled: false, pin: '' };
  } catch {
    return { enabled: false, pin: '' };
  }
}
function savePinConfig(config) {
  sqliteManager.saveConfig('pinGuard', config);
}

router.get('/security/pin/status', (req, res) => {
  const pinConfig = getPinConfig();
  res.json({ success: true, enabled: pinConfig.enabled });
});

router.post('/security/pin/verify', (req, res) => {
  const { pin } = req.body;
  const pinConfig = getPinConfig();
  if (!pinConfig.enabled) {
    return res.json({ success: true, verified: true, message: 'Proteksi PIN tidak aktif.' });
  }
  const isMatch = pin && pinConfig.pin && pin === pinConfig.pin;
  res.json({ success: isMatch, verified: isMatch, message: isMatch ? 'PIN Valid.' : 'PIN salah.' });
});

router.post('/security/pin/toggle', (req, res) => {
  const pinConfig = getPinConfig();
  const { enabled, pin } = req.body;
  pinConfig.enabled = Boolean(enabled);
  if (pin && typeof pin === 'string' && pin.trim().length >= 4) {
    pinConfig.pin = pin.trim();
  }
  pinConfig.updatedAt = new Date().toISOString();
  savePinConfig(pinConfig);
  retentionController.addLog('INFO', `Pengamanan Master PIN ${pinConfig.enabled ? 'DIAKTIFKAN' : 'DINONAKTIFKAN'}.`);
  res.json({ success: true, enabled: pinConfig.enabled, message: `Proteksi PIN ${pinConfig.enabled ? 'diaktifkan' : 'dinonaktifkan'}.` });
});

/**
 * SYSTEM BACKUP & DISASTER RECOVERY
 */
router.post('/system/backup', (req, res) => {
  try {
    const backupRes = sqliteManager.createAutomatedBackup();
    res.json({ success: true, message: 'Backup database SQLite online berhasil dibuat.', data: backupRes });
  } catch (err) {
    res.status(500).json({ success: false, message: `Gagal membuat backup: ${err.message}` });
  }
});

router.get('/system/interrupted-campaigns', (req, res) => {
  res.json({
    success: true,
    interruptedCampaigns: retentionController.getInterruptedCampaigns()
  });
});

router.post('/system/resume-campaign', (req, res) => {
  try {
    const { campaignState } = req.body;
    const resumed = retentionController.resumeCampaign(campaignState);
    res.json({ success: true, message: 'Kampanye berhasil dipulihkan.', campaign: resumed });
  } catch (err) {
    res.status(400).json({ success: false, message: `Gagal memulihkan kampanye: ${err.message}` });
  }
});

module.exports = router;
