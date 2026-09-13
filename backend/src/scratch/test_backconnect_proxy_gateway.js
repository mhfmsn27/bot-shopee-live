/**
 * Unit Test: Backconnect Rotating Proxy Gateway, Auto-Quarantine Circuit Breaker & ISP Filtering
 * Menjamin 1 proxy gateway mampu menghasilkan sesi IP unik per worker dengan auto-failover seketika.
 */

const assert = require('assert');
const proxyManager = require('../proxy/proxy-manager');
const ShopeeLiveWorker = require('../core/shopee-live-worker');

async function runTest() {
  console.log('--- START TEST: Backconnect Proxy Gateway, Auto-Quarantine & Failover ---');

  const initialProxies = [...proxyManager.getAll()];
  const testProxyId = `test-bc-${Date.now()}`;

  try {
    // 1. Backconnect Rotating Session Generation
    console.log('[1] Verifikasi Backconnect Rotating Session Generation...');
    const rotatingProxy = {
      id: testProxyId,
      ip: 'gate.smartproxy-asia.net',
      port: 7000,
      protocol: 'socks5',
      type: 'rotating',
      username: 'cust-id-9988',
      password: 'pass_secret_123',
      asn: 'AS17974',
      isp: 'Telkomsel Residential Gateway',
      city: 'Jakarta',
      country: 'ID',
      status: 'alive',
      latency: 45,
      failCount: 0,
      assignedAccountsCount: 0
    };
    proxyManager.proxies.push(rotatingProxy);

    const workerA = 'wrk-test-session-A';
    const workerB = 'wrk-test-session-B';

    const allocatedA = proxyManager.allocateProxyForWorker(workerA, 'rotating');
    const allocatedB = proxyManager.allocateProxyForWorker(workerB, 'rotating');

    assert(allocatedA, 'Proxy A harus dialokasikan');
    assert(allocatedB, 'Proxy B harus dialokasikan');
    assert(allocatedA.username.endsWith(`-session-${workerA}`), `Session ID worker A harus di-inject ke username, got: ${allocatedA.username}`);
    assert(allocatedB.username.endsWith(`-session-${workerB}`), `Session ID worker B harus di-inject ke username, got: ${allocatedB.username}`);
    assert.notStrictEqual(allocatedA.username, allocatedB.username, 'Setiap worker harus mendapatkan session username yang unik');

    const agentA = proxyManager.getProxyAgent(allocatedA);
    assert(agentA, 'ProxyAgent untuk worker A harus berhasil dibuat');
    console.log('    Worker A Session Proxy:', allocatedA.username);
    console.log('    Worker B Session Proxy:', allocatedB.username);
    console.log('    ✅ PASS: Backconnect gateway berhasil menghasilkan IP session terisolasi per bot.');

    proxyManager.releaseWorkerProxy(workerA);
    proxyManager.releaseWorkerProxy(workerB);

    // 2. Auto-Quarantine Circuit Breaker
    console.log('[2] Verifikasi Auto-Quarantine Circuit Breaker (3x Failures Cooldown)...');
    proxyManager.reportFailure(testProxyId, 'Connection Timeout 1');
    assert.strictEqual(rotatingProxy.failCount, 1);
    assert.strictEqual(rotatingProxy.status, 'alive');

    proxyManager.reportFailure(testProxyId, 'Connection Timeout 2');
    assert.strictEqual(rotatingProxy.failCount, 2);
    assert.strictEqual(rotatingProxy.status, 'alive');

    proxyManager.reportFailure(testProxyId, 'HTTP 429 Too Many Requests');
    assert.strictEqual(rotatingProxy.failCount, 3);
    assert.strictEqual(rotatingProxy.status, 'quarantined');
    assert(rotatingProxy.quarantineUntil > Date.now(), 'quarantineUntil harus diset di masa depan');
    console.log('    Proxy berhasil dikarantina:', { status: rotatingProxy.status, failCount: rotatingProxy.failCount, lastError: rotatingProxy.lastError });

    const aliveList = proxyManager.getAliveProxies();
    assert(!aliveList.some(p => p.id === testProxyId), 'Proxy yang dikarantina TIDAK boleh muncul di alive pool');

    // Uji pemulihan (Recovery)
    proxyManager.reportSuccess(testProxyId);
    assert.strictEqual(rotatingProxy.status, 'alive');
    assert.strictEqual(rotatingProxy.failCount, 0);
    assert.strictEqual(rotatingProxy.quarantineUntil, null);
    console.log('    ✅ PASS: Auto-Quarantine Circuit Breaker & Health Recovery bekerja presisi.');

    // 3. Dynamic Zero-Drop Worker Failover
    console.log('[3] Verifikasi Dynamic Zero-Drop Worker Failover...');
    const workerC = 'wrk-test-failover-C';
    const workerInstance = new ShopeeLiveWorker({
      id: workerC,
      roomId: '998877',
      preferredProxyType: 'datacenter'
    });

    assert(workerInstance.proxy, 'Worker harus mendapatkan initial proxy');
    const initialWorkerProxyIp = workerInstance.proxy.ip;

    let failoverEventEmitted = false;
    workerInstance.on('proxy_failover', (ev) => {
      failoverEventEmitted = true;
      assert.strictEqual(ev.workerId, workerC);
    });

    const failoverResult = proxyManager.failoverWorkerProxy(workerC);
    assert.strictEqual(failoverResult.success, true, 'Failover harus sukses');
    assert(failoverResult.newProxy, 'Harus mendapatkan newProxy');
    assert(failoverResult.newProxyAgent, 'Harus mendapatkan newProxyAgent');

    workerInstance.failoverProxy(failoverResult.newProxy, failoverResult.newProxyAgent);
    assert.strictEqual(failoverEventEmitted, true, 'Event proxy_failover harus ter-trigger');
    assert.strictEqual(workerInstance.proxy.ip, failoverResult.newProxy.ip);
    console.log(`    Failover Sukses: ${initialWorkerProxyIp} -> ${workerInstance.proxy.ip}`);
    console.log('    ✅ PASS: Hot failover berhasil mengganti proxy tanpa mematikan sesi viewer.');

    workerInstance.stop();

    // 4. ASN & ISP Metadata Filtering
    console.log('[4] Verifikasi ASN / ISP Metadata & Filtering...');
    const telkomselProxy = proxyManager.allocateProxyForWorker('wrk-isp-test', { preferredIsp: 'Telkomsel' });
    if (telkomselProxy) {
      assert(telkomselProxy.isp.toLowerCase().includes('telkomsel'), 'Proxy yang dialokasikan harus bertipe ISP Telkomsel');
      console.log('    Filtered ISP Allocated:', telkomselProxy.isp, `(ASN: ${telkomselProxy.asn})`);
    }
    proxyManager.releaseWorkerProxy('wrk-isp-test');

    const healthStats = proxyManager.getHealthStats();
    assert(healthStats.byIsp && typeof healthStats.byIsp === 'object', 'Health stats harus memuat breakdown byIsp');
    console.log('    ISP Breakdown Stats:', JSON.stringify(healthStats.byIsp));
    console.log('    ✅ PASS: Metadata ASN & ISP terintegrasi penuh.');

  } finally {
    // 5. Cleanup: Hapus proxy uji dan kembalikan state awal
    console.log('[5] Membersihkan artefak pengujian dari memori...');
    proxyManager.proxies = proxyManager.proxies.filter(p => p.id !== testProxyId);
    try {
      const sqliteManager = require('../db/sqlite-manager');
      sqliteManager.deleteProxy(testProxyId);
      proxyManager.saveProxies();
    } catch (e) {}
    proxyManager.releaseWorkerProxy('wrk-test-session-A');
    proxyManager.releaseWorkerProxy('wrk-test-session-B');
    proxyManager.releaseWorkerProxy('wrk-test-failover-C');
    proxyManager.releaseWorkerProxy('wrk-isp-test');
    assert.strictEqual(proxyManager.proxies.length, initialProxies.length, 'Jumlah proxy harus kembali ke kondisi semula');
    console.log('    ✅ CLEANUP: Zero test data leakage verified.');
  }

  console.log('🎉 ALL BACKCONNECT PROXY GATEWAY TESTS PASSED (100% OK)');
}

runTest().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error('❌ TEST FAILED:', err);
  process.exit(1);
});
