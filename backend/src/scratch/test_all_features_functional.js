/**
 * COMPREHENSIVE FEATURE FUNCTIONAL TEST
 * Menguji seluruh fitur utama aplikasi secara end-to-end via HTTP API
 */
const http = require('http');

let sessionToken = '';

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opt = {
      hostname: 'localhost', port: 3000,
      path: '/api' + path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(sessionToken ? { 'Authorization': `Bearer ${sessionToken}` } : {})
      }
    };
    if (data) opt.headers['Content-Length'] = Buffer.byteLength(data);

    const req = http.request(opt, (res) => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(buf) }); }
        catch { resolve({ status: res.statusCode, data: buf }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function test(name, fn) {
  try {
    const result = await fn();
    if (result.pass) {
      console.log(`  ✅ ${name}`);
    } else {
      console.log(`  ❌ ${name} — ${result.reason}`);
    }
    return result.pass;
  } catch (err) {
    console.log(`  ❌ ${name} — EXCEPTION: ${err.message}`);
    return false;
  }
}

async function main() {
  let passed = 0, failed = 0;
  const check = async (name, fn) => { (await test(name, fn)) ? passed++ : failed++; };

  console.log('\n══════════════════════════════════════════════════════');
  console.log('🔍 FUNCTIONAL INTEGRATION TEST: SEMUA FITUR UTAMA');
  console.log('══════════════════════════════════════════════════════\n');

  // ═══════════════════════════════════════════════════
  // MODUL 1: SECURITY & AUTHENTICATION
  // ═══════════════════════════════════════════════════
  console.log('📦 MODUL 1: SECURITY & AUTHENTICATION');

  await check('Health endpoint (tanpa auth)', async () => {
    const r = await request('GET', '/health');
    return { pass: r.status === 200 && r.data.status === 'ok', reason: `status=${r.status}` };
  });

  await check('Auth status (tanpa auth, publik)', async () => {
    const r = await request('GET', '/auth/status');
    return { pass: r.status === 200 && r.data.config, reason: `status=${r.status}` };
  });

  await check('Login dengan password salah → 401', async () => {
    const r = await request('POST', '/auth/login', { password: 'wrong', rememberMe: false });
    return { pass: r.status === 401 && r.data.success === false, reason: `status=${r.status}` };
  });

  await check('Login dengan password benar → token', async () => {
    const r = await request('POST', '/auth/login', { password: 'shopee@admin2026', rememberMe: false });
    if (r.data.token) sessionToken = r.data.token;
    return { pass: r.status === 200 && !!r.data.token, reason: `status=${r.status}, token=${!!r.data.token}` };
  });

  await check('API dilindungi (akses tanpa token → 401)', async () => {
    const saved = sessionToken;
    sessionToken = '';
    const r = await request('GET', '/accounts');
    sessionToken = saved;
    return { pass: r.status === 401, reason: `status=${r.status}` };
  });

  await check('Logout → destroy session', async () => {
    const r = await request('POST', '/auth/logout');
    return { pass: r.status === 200 && r.data.success, reason: `status=${r.status}` };
  });

  // Re-login untuk sisa tes
  const loginRes = await request('POST', '/auth/login', { password: 'shopee@admin2026', rememberMe: false });
  sessionToken = loginRes.data.token;

  await check('Auth settings GET', async () => {
    const r = await request('GET', '/auth/settings');
    return { pass: r.status === 200 && r.data.config, reason: `status=${r.status}` };
  });

  await check('Auth toggle (disable & re-enable)', async () => {
    const r1 = await request('POST', '/auth/toggle', { enabled: false });
    const r2 = await request('POST', '/auth/toggle', { enabled: true });
    return { pass: r1.status === 200 && r2.status === 200, reason: `status1=${r1.status}, status2=${r2.status}` };
  });

  // ═══════════════════════════════════════════════════
  // MODUL 2: ACCOUNT MANAGEMENT
  // ═══════════════════════════════════════════════════
  console.log('\n📦 MODUL 2: ACCOUNT MANAGEMENT');

  await check('GET /accounts → 184 akun real', async () => {
    const r = await request('GET', '/accounts');
    return { pass: r.status === 200 && r.data.total === 184, reason: `total=${r.data.total}` };
  });

  await check('GET /accounts/summary → ringkasan akun', async () => {
    const r = await request('GET', '/accounts/summary');
    return { pass: r.status === 200 && r.data.summary, reason: `status=${r.status}` };
  });

  await check('POST /accounts/validate → health score', async () => {
    const r = await request('POST', '/accounts/validate');
    return { pass: r.status === 200 && typeof r.data.total === 'number', reason: `total=${r.data.total}` };
  });

  await check('GET /accounts/export → CSV export', async () => {
    const r = await request('GET', '/accounts/export');
    return { pass: r.status === 200 && typeof r.data === 'string' && r.data.length > 50, reason: `length=${typeof r.data === 'string' ? r.data.length : 0}` };
  });

  await check('POST /accounts/validate-cookies → cookie audit', async () => {
    const r = await request('POST', '/accounts/validate-cookies');
    return { pass: r.status === 200 && typeof r.data.totalWithCookies === 'number', reason: `status=${r.status}` };
  });

  // ═══════════════════════════════════════════════════
  // MODUL 3: PROXY MANAGEMENT
  // ═══════════════════════════════════════════════════
  console.log('\n📦 MODUL 3: PROXY MANAGEMENT');

  await check('GET /proxies → 6 proxy', async () => {
    const r = await request('GET', '/proxies');
    return { pass: r.status === 200 && r.data.total === 6, reason: `total=${r.data.total}` };
  });

  await check('GET /proxies/health → statistik kesehatan proxy', async () => {
    const r = await request('GET', '/proxies/health');
    return { pass: r.status === 200 && r.data.stats, reason: `status=${r.status}` };
  });

  await check('POST /proxies/test → tes konektivitas proxy', async () => {
    const r = await request('POST', '/proxies/test', { mockFallback: true });
    return { pass: r.status === 200 && r.data.total === 6, reason: `total=${r.data.total}, alive=${r.data.alive}` };
  });

  // ═══════════════════════════════════════════════════
  // MODUL 4: CAMPAIGN / LIVE VIEW BOT ENGINE
  // ═══════════════════════════════════════════════════
  console.log('\n📦 MODUL 4: CAMPAIGN / LIVE VIEW BOT ENGINE');

  await check('GET /campaigns → daftar kampanye', async () => {
    const r = await request('GET', '/campaigns');
    return { pass: r.status === 200 && typeof r.data.total === 'number', reason: `total=${r.data.total}` };
  });

  await check('POST /campaigns → buat kampanye baru', async () => {
    const r = await request('POST', '/campaigns', {
      name: 'Test Live Audit',
      urlOrRoomId: '1234567890',
      targetViewers: 5,
      retentionMode: 'dynamic_churn',
      minWatchMinutes: 1,
      maxWatchMinutes: 3,
      rampUpRatePerMin: 30
    });
    return { pass: r.status === 200 && r.data.success, reason: `status=${r.status}, success=${r.data.success}, msg=${r.data.message}` };
  });

  // Tunggu campaign berjalan sebentar
  await new Promise(r => setTimeout(r, 2000));

  await check('GET /campaigns → kampanye terdaftar & running', async () => {
    const r = await request('GET', '/campaigns');
    const hasRunning = r.data.campaigns && r.data.campaigns.some(c => c.status === 'RUNNING');
    return { pass: r.status === 200 && hasRunning, reason: `hasRunning=${hasRunning}` };
  });

  await check('GET /status → metrik sistem real-time', async () => {
    const r = await request('GET', '/status');
    return { pass: r.status === 200 && r.data.metrics && r.data.metrics.activeViewers >= 0, reason: `viewers=${r.data.metrics?.activeViewers}` };
  });

  await check('GET /logs → log buffer', async () => {
    const r = await request('GET', '/logs');
    return { pass: r.status === 200 && Array.isArray(r.data.logs) && r.data.logs.length > 0, reason: `count=${r.data.logs?.length}` };
  });

  await check('GET /chats → recent chats', async () => {
    const r = await request('GET', '/chats');
    return { pass: r.status === 200 && Array.isArray(r.data.chats), reason: `count=${r.data.chats?.length}` };
  });

  // Stop kampanye
  await check('POST /campaign/stop → hentikan semua kampanye', async () => {
    const r = await request('POST', '/campaign/stop');
    return { pass: r.status === 200 && r.data.success, reason: `stoppedCount=${r.data.stoppedCount}` };
  });

  // ═══════════════════════════════════════════════════
  // MODUL 5: INTERACTION ENGINE
  // ═══════════════════════════════════════════════════
  console.log('\n📦 MODUL 5: INTERACTION ENGINE');

  await check('GET /interaction/config → konfigurasi interaksi global', async () => {
    const r = await request('GET', '/interaction/config');
    return { pass: r.status === 200 && r.data.config && r.data.commentBanks, reason: `categories=${Object.keys(r.data.commentBanks || {}).length}` };
  });

  await check('GET /interaction/comment-banks → 6 kategori komentar', async () => {
    const r = await request('GET', '/interaction/comment-banks');
    const count = Object.keys(r.data.banks || {}).length;
    return { pass: r.status === 200 && count === 6, reason: `categories=${count}` };
  });

  await check('POST /interaction/config → update konfigurasi interaksi', async () => {
    const r = await request('POST', '/interaction/config', {
      enableLike: true, likeRatePerMin: 100,
      enableComment: true, commentIntervalSec: 30
    });
    return { pass: r.status === 200 && r.data.success, reason: `status=${r.status}` };
  });

  // ═══════════════════════════════════════════════════
  // MODUL 6: WHATSAPP GATEWAY
  // ═══════════════════════════════════════════════════
  console.log('\n📦 MODUL 6: WHATSAPP GATEWAY');

  await check('GET /whatsapp/status → status koneksi WA', async () => {
    const r = await request('GET', '/whatsapp/status');
    return { pass: r.status === 200 && r.data.success, reason: `status=${r.status}` };
  });

  await check('GET /whatsapp/config → konfigurasi notifikasi', async () => {
    const r = await request('GET', '/whatsapp/config');
    return { pass: r.status === 200 && r.data.success, reason: `status=${r.status}` };
  });

  await check('GET /whatsapp/history → riwayat pesan', async () => {
    const r = await request('GET', '/whatsapp/history');
    return { pass: r.status === 200 && Array.isArray(r.data.history), reason: `count=${r.data.history?.length}` };
  });

  // ═══════════════════════════════════════════════════
  // MODUL 7: SMART SCHEDULER
  // ═══════════════════════════════════════════════════
  console.log('\n📦 MODUL 7: SMART SCHEDULER');

  await check('GET /schedules → daftar jadwal', async () => {
    const r = await request('GET', '/schedules');
    return { pass: r.status === 200 && Array.isArray(r.data.schedules), reason: `count=${r.data.schedules?.length}` };
  });

  await check('POST /schedules → buat jadwal baru', async () => {
    const r = await request('POST', '/schedules', {
      title: 'Jadwal Test Audit',
      scheduledTime: '20:00',
      config: { urlOrRoomId: '111222333', targetViewers: 10, retentionMode: 'dynamic_churn' }
    });
    return { pass: r.status === 200 && r.data.success, reason: `status=${r.status}` };
  });

  let scheduleId = null;
  await check('GET /schedules → jadwal baru tersimpan', async () => {
    const r = await request('GET', '/schedules');
    const found = r.data.schedules.find(s => s.title === 'Jadwal Test Audit');
    if (found) scheduleId = found.id;
    return { pass: r.status === 200 && !!found, reason: `found=${!!found}` };
  });

  await check('PATCH /schedules/:id/toggle → nonaktifkan jadwal', async () => {
    if (!scheduleId) return { pass: false, reason: 'No schedule ID' };
    const r = await request('PATCH', `/schedules/${scheduleId}/toggle`, { enabled: false });
    return { pass: r.status === 200 && r.data.success, reason: `status=${r.status}` };
  });

  await check('DELETE /schedules/:id → hapus jadwal', async () => {
    if (!scheduleId) return { pass: false, reason: 'No schedule ID' };
    const r = await request('DELETE', `/schedules/${scheduleId}`);
    return { pass: r.status === 200 && r.data.success, reason: `status=${r.status}` };
  });

  // ═══════════════════════════════════════════════════
  // MODUL 8: CAMPAIGN HISTORY & ANALYTICS
  // ═══════════════════════════════════════════════════
  console.log('\n📦 MODUL 8: CAMPAIGN HISTORY & ANALYTICS');

  await check('GET /history → riwayat kampanye', async () => {
    const r = await request('GET', '/history');
    return { pass: r.status === 200 && Array.isArray(r.data.history) && r.data.summary, reason: `count=${r.data.history?.length}` };
  });

  await check('GET /history/export → CSV export riwayat', async () => {
    const r = await request('GET', '/history/export');
    return { pass: r.status === 200, reason: `status=${r.status}` };
  });

  // ═══════════════════════════════════════════════════
  // MODUL 9: CANARY SECURITY WATCHDOG
  // ═══════════════════════════════════════════════════
  console.log('\n📦 MODUL 9: CANARY SECURITY WATCHDOG');

  await check('GET /security/canary-status → status WAF detector', async () => {
    const r = await request('GET', '/security/canary-status');
    return { pass: r.status === 200 && r.data.success, reason: `status=${r.status}` };
  });

  await check('POST /security/canary-check → manual probe', async () => {
    const r = await request('POST', '/security/canary-check');
    return { pass: r.status === 200, reason: `status=${r.status}` };
  });

  await check('POST /security/circuit-breaker/reset → reset CB', async () => {
    const r = await request('POST', '/security/circuit-breaker/reset');
    return { pass: r.status === 200 && r.data.success, reason: `status=${r.status}` };
  });

  // ═══════════════════════════════════════════════════
  // MODUL 10: BACKUP & DISASTER RECOVERY
  // ═══════════════════════════════════════════════════
  console.log('\n📦 MODUL 10: BACKUP & DISASTER RECOVERY');

  await check('POST /system/backup → buat backup database', async () => {
    const r = await request('POST', '/system/backup');
    return { pass: r.status === 200 && r.data.success, reason: `status=${r.status}` };
  });

  await check('GET /system/interrupted-campaigns → sesi terputus', async () => {
    const r = await request('GET', '/system/interrupted-campaigns');
    return { pass: r.status === 200 && Array.isArray(r.data.interruptedCampaigns), reason: `count=${r.data.interruptedCampaigns?.length}` };
  });

  // ═══════════════════════════════════════════════════
  // MODUL 11: PIN GUARD & SMS GATEWAY
  // ═══════════════════════════════════════════════════
  console.log('\n📦 MODUL 11: PIN GUARD & SMS GATEWAY');

  await check('GET /security/pin/status → status PIN Guard', async () => {
    const r = await request('GET', '/security/pin/status');
    return { pass: r.status === 200 && typeof r.data.enabled === 'boolean', reason: `enabled=${r.data.enabled}` };
  });

  await check('GET /accounts/sms-gateway/config → konfigurasi SMS Gateway', async () => {
    const r = await request('GET', '/accounts/sms-gateway/config');
    return { pass: r.status === 200 && r.data.config, reason: `status=${r.status}` };
  });

  // ═══════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════
  const total = passed + failed;
  console.log('\n══════════════════════════════════════════════════════');
  console.log(`🏁 REKAPITULASI: ${passed}/${total} TES FUNGSIONAL LULUS`);
  if (failed === 0) {
    console.log('🎉 SELURUH FITUR UTAMA 100% BERFUNGSI DENGAN BENAR!');
  } else {
    console.log(`⚠️  ${failed} tes gagal, perlu investigasi.`);
  }
  console.log('══════════════════════════════════════════════════════\n');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
