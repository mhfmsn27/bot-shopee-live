/**
 * Test Suite: Persiapan Operasional Jangka Panjang (Produksi)
 * Menguji: Canary Security Watchdog, WhatsApp Lifecycle Events, Proxy Purge/Health, Account Health Audit & Regional Demographics.
 */

const assert = require('assert');
const canaryWatchdog = require('../security/canary-watchdog');
const proxyManager = require('../proxy/proxy-manager');
const accountManager = require('../identity/account-manager');
const waGateway = require('../wa-gateway/whatsapp-service');
const retentionController = require('../core/retention-controller');

let totalTests = 0;
let passedTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  ✅ PASS: ${name}`);
  } catch (err) {
    console.error(`  ❌ FAIL: ${name} -> ${err.message}`);
  }
}

async function runAsyncTest(name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  ✅ PASS: ${name}`);
  } catch (err) {
    console.error(`  ❌ FAIL: ${name} -> ${err.message}`);
  }
}

async function runAllTests() {
  console.log('\n======================================================');
  console.log('🧪 TEST SUITE: OPERASIONAL JANGKA PANJANG & PRODUKSI');
  console.log('======================================================\n');

  // -----------------------------------------------------------------
  // 1. CANARY SECURITY WATCHDOG & WAF DETECTION
  // -----------------------------------------------------------------
  console.log('--- 1. CANARY SECURITY WATCHDOG & WAF SYSTEM ---');

  runTest('Watchdog Status & Configuration Initialized', () => {
    const status = canaryWatchdog.getStatus();
    assert(status.status === 'HEALTHY' || status.status === 'PAUSED', 'Status awal harus valid');
    assert(typeof status.intervalMinutes === 'number', 'Interval menit harus angka');
    assert(Array.isArray(status.recentHistory), 'recentHistory harus array');
  });

  await runAsyncTest('Passive Canary Probe Execution', async () => {
    const result = await canaryWatchdog.performCanaryCheck();
    assert(result !== null, 'Hasil check tidak boleh null');
    assert(typeof result.latencyMs === 'number', 'latencyMs harus angka');
    assert(result.statusCode === 200 || result.statusCode === 429 || result.statusCode === 503, 'Status code harus valid');
    assert(typeof result.message === 'string', 'Message harus string deskriptif');
  });

  runTest('Circuit Breaker & Reset Flow', () => {
    canaryWatchdog.consecutiveFailures = 5;
    canaryWatchdog.status = 'WAF_ALERT';
    canaryWatchdog.circuitBreakerActive = true;

    const resetState = canaryWatchdog.resetCircuitBreaker();
    assert.strictEqual(resetState.status, 'HEALTHY', 'Status setelah reset harus HEALTHY');
    assert.strictEqual(resetState.circuitBreakerActive, false, 'Circuit breaker harus nonaktif');
    assert.strictEqual(resetState.consecutiveFailures, 0, 'Consecutive failures harus 0');
  });

  // -----------------------------------------------------------------
  // 2. PROXY POOL HEALTH STATS & DEAD PROXY PURGING
  // -----------------------------------------------------------------
  console.log('\n--- 2. PROXY POOL HEALTH STATS & PURGING ---');

  runTest('Proxy Health Metrics Calculation', () => {
    const health = proxyManager.getHealthStats();
    assert(typeof health.total === 'number', 'Total proxy harus berupa angka');
    assert(typeof health.alive === 'number', 'Alive proxy harus berupa angka');
    assert(typeof health.dead === 'number', 'Dead proxy harus berupa angka');
    assert(typeof health.healthRatio === 'number', 'Health ratio harus berupa persentase');
    assert(health.healthRatio >= 0 && health.healthRatio <= 100, 'Health ratio antara 0-100');
  });

  runTest('Dead Proxy Purge Functionality', () => {
    // Tambah mock dead proxy ke pool untuk pengujian
    const initialTotal = proxyManager.getAll().length;
    proxyManager.proxies.push({
      id: 'mock-dead-proxy-test',
      ip: '192.0.2.1',
      port: 9999,
      status: 'dead',
      latency: 0
    });

    const purgeResult = proxyManager.purgeDeadProxies();
    assert(typeof purgeResult.purgedCount === 'number', 'purgedCount harus angka');
    assert(purgeResult.purgedCount >= 1, 'Mock dead proxy harus terhapus');
    
    // Pastikan proxy yang mati sudah tidak ada di pool
    const exists = proxyManager.getAll().some(p => p.id === 'mock-dead-proxy-test');
    assert.strictEqual(exists, false, 'Proxy mock mati tidak boleh tersisa');
  });

  // -----------------------------------------------------------------
  // 3. ACCOUNT HEALTH AUDIT & INDONESIAN REGIONAL DEMOGRAPHICS
  // -----------------------------------------------------------------
  console.log('\n--- 3. ACCOUNT HEALTH AUDIT & REGIONAL TARGETING ---');

  await runAsyncTest('Generate Account With Specific Indonesian City', async () => {
    const created = await accountManager.createAccountBatch({
      count: 2,
      gender: 'female',
      city: 'Surabaya',
      autoEmail: false,
      enrichProfile: true,
      autoAvatar: true
    });

    assert.strictEqual(created.length, 2, 'Harus membuat 2 akun');
    created.forEach(acc => {
      assert.strictEqual(acc.city, 'Surabaya', 'Kota domisili akun harus Surabaya');
      assert.strictEqual(acc.gender, 'female', 'Gender harus female');
      assert(acc.avatar !== null, 'Avatar harus terpasang');
    });

    // Cleanup akun test
    created.forEach(acc => accountManager.deleteAccount(acc.id));
  });

  runTest('Validate All Accounts Health Audit', () => {
    const audit = accountManager.validateAllAccounts();
    assert(typeof audit.total === 'number', 'Total akun harus angka');
    assert(typeof audit.valid === 'number', 'Valid akun harus angka');
    assert(typeof audit.warning === 'number', 'Warning akun harus angka');
    assert(typeof audit.averageHealthScore === 'number', 'Rata-rata skor harus angka');
    assert(audit.averageHealthScore >= 0 && audit.averageHealthScore <= 100, 'Rata-rata skor harus 0-100');
    assert(Array.isArray(audit.auditedAccounts), 'auditedAccounts harus array');

    if (audit.auditedAccounts.length > 0) {
      const first = audit.auditedAccounts[0];
      assert(typeof first.score === 'number', 'Score harus angka');
      assert(['healthy', 'warning', 'critical'].includes(first.status), 'Status harus valid');
      assert(Array.isArray(first.issues), 'Issues harus array');
    }
  });

  // -----------------------------------------------------------------
  // 4. WHATSAPP LIFECYCLE NOTIFICATION PREFERENCES
  // -----------------------------------------------------------------
  console.log('\n--- 4. WHATSAPP GATEWAY EVENT PREFERENCES ---');

  runTest('WhatsApp Config Read & Update', () => {
    const originalAdmin = waGateway.adminNumber;
    const updated = waGateway.updateConfig({
      adminNumber: '6281298765432',
      notificationEvents: {
        liveStart: false,
        milestones: true,
        campaignEnd: true,
        wafAlert: true
      }
    });

    assert.strictEqual(updated.adminNumber, '6281298765432', 'Nomor admin harus tersimpan');
    assert.strictEqual(updated.notificationEvents.liveStart, false, 'liveStart harus false');
    assert.strictEqual(updated.notificationEvents.milestones, true, 'milestones harus true');

    // Kembalikan nomor admin ke semula agar tidak mempengaruhi test suite lain
    waGateway.updateConfig({ adminNumber: originalAdmin || '081298765432' });
  });

  await runAsyncTest('Respect Notification Event Preferences on Dispatch', async () => {
    // liveStart diset false, pengiriman harus diskip
    const startResult = await waGateway.notifyLiveStart({ roomId: '12345', targetViewers: 100 });
    assert(startResult && startResult.skipped === true, 'Pengiriman live start harus diskip saat dimatikan');

    // Aktifkan kembali
    waGateway.updateConfig({
      notificationEvents: { liveStart: true }
    });

    const activeStartResult = await waGateway.notifyLiveStart({ roomId: '12345', targetViewers: 100 });
    assert(activeStartResult && activeStartResult.success === true, 'Pengiriman live start harus diproses saat aktif');
  });

  await runAsyncTest('WAF Alert WhatsApp Notification Dispatch & Toggle', async () => {
    // Nonaktifkan alert WAF
    waGateway.updateConfig({ notificationEvents: { wafAlert: false } });
    const skipResult = await waGateway.notifyWafAlert({ statusCode: 429, message: 'Challenge test' });
    assert(skipResult && skipResult.skipped === true, 'WAF Alert harus diskip jika disabled');

    // Aktifkan kembali
    waGateway.updateConfig({ notificationEvents: { wafAlert: true } });
    const activeResult = await waGateway.notifyWafAlert({ statusCode: 429, message: 'Challenge test' });
    assert(activeResult && activeResult.success === true, 'WAF Alert harus terkirim jika enabled');
  });

  // -----------------------------------------------------------------
  // 5. CAMPAIGN LIFECYCLE & CIRCUIT BREAKER INTERACTION
  // -----------------------------------------------------------------
  console.log('\n--- 5. RETENTION CONTROLLER & CIRCUIT BREAKER ENFORCEMENT ---');

  runTest('Circuit Breaker Blocks Starting Campaign When Active', () => {
    canaryWatchdog.circuitBreakerActive = true;
    let blocked = false;

    try {
      retentionController.createCampaign({
        name: 'Blocked Live Test',
        roomId: '88776655',
        targetViewers: 1
      });
    } catch (err) {
      if (err.message.includes('Circuit Breaker')) {
        blocked = true;
      }
    }

    assert.strictEqual(blocked, true, 'Campaign harus diblokir saat Circuit Breaker aktif');

    // Test bypass option
    let allowedBypass = false;
    let bypassCampaign = null;
    try {
      bypassCampaign = retentionController.createCampaign({
        name: 'Bypass Live Test',
        roomId: '88776655',
        targetViewers: 1,
        bypassCircuitBreaker: true
      });
      allowedBypass = true;
    } catch (e) {}

    assert.strictEqual(allowedBypass, true, 'Campaign dengan bypassCircuitBreaker harus diizinkan');
    if (bypassCampaign) {
      retentionController.removeCampaign(bypassCampaign.id);
      const historyManager = require('../analytics/history-manager');
      const allHist = historyManager.getAll();
      allHist.filter(h => h.roomId === '88776655').forEach(h => historyManager.deleteItem(h.id));
    }

    // Reset circuit breaker
    canaryWatchdog.resetCircuitBreaker();
    assert.strictEqual(canaryWatchdog.circuitBreakerActive, false, 'Circuit breaker harus nonaktif setelah reset');
  });

  runTest('Canary Watchdog Clean Idle State Under Load', () => {
    const status = canaryWatchdog.getStatus();
    assert(status.status !== null, 'Status Canary tidak boleh null');
  });

  console.log('\n======================================================');
  console.log(`🏁 HASIL AUDIT PRODUKSI: ${passedTests}/${totalTests} Pengujian Berhasil`);
  console.log('======================================================\n');

  if (passedTests === totalTests) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runAllTests().catch(err => {
  console.error('Fatal Test Error:', err);
  process.exit(1);
});
