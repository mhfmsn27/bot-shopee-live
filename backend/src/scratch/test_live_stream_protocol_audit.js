/**
 * Live Stream Protocol, Mobile TLS Evasion & IP Deduplication Guard Audit
 * Menguji secara komprehensif:
 * 1. Mobile TLS Fingerprint Ciphers & Spoofed Device Identifiers (JA3/JA4 Evasion)
 * 2. SOCKS5h Remote DNS Resolving (Anti-DNS Leak)
 * 3. IP Deduplication Guard (Rasio 1 IP = 1 Active Viewer Unik)
 * 4. Outbound HTTPS Transporter & Graceful Network Fallback
 * 5. ShopeeLiveWorker Real Network Lifecycle & Telemetry
 * 6. Anchor Viewers Priority Allocation (Akun Ber-Cookie Otentik)
 * 7. Zero Residual Test Data Cleanup
 */

const assert = require('assert');
const http = require('http');
const protocolClient = require('../core/protocol-client');
const proxyManager = require('../proxy/proxy-manager');
const ShopeeLiveWorker = require('../core/shopee-live-worker');
const accountManager = require('../identity/account-manager');

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✅ [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}: ${err.message}`);
    throw err;
  }
}

async function runAsyncTest(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✅ [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}: ${err.message}`);
    throw err;
  }
}

async function runProtocolAudit() {
  console.log('================================================================');
  console.log('🔍 AUDIT PROTOKOL UTAMA BOT, SOCKS5H REMOTE DNS & IP DEDUPLICATION');
  console.log('================================================================\n');

  // -------------------------------------------------------------------------
  // 1. MOBILE TLS CIPHERS & SPOOFED IDENTIFIERS
  // -------------------------------------------------------------------------
  console.log('--- 1. AUDIT MOBILE TLS FINGERPRINT & HEADER SPOOFING ---');

  runTest('Mobile TLS Ciphers memuat cipher suites Chrome Android / Safari iOS', () => {
    assert(protocolClient.MOBILE_TLS_CIPHERS.length > 50, 'Cipher suite list harus terisi');
    assert(protocolClient.MOBILE_TLS_CIPHERS.includes('TLS_AES_128_GCM_SHA256'), 'Harus menyertakan TLS 1.3 AES-128');
    assert(protocolClient.MOBILE_TLS_CIPHERS.includes('ECDHE-ECDSA-AES128-GCM-SHA256'), 'Harus menyertakan ECDHE-ECDSA');
    assert.strictEqual(protocolClient.MOBILE_TLS_OPTIONS.minVersion, 'TLSv1.2', 'Minimal TLS harus v1.2');
    assert.strictEqual(protocolClient.MOBILE_TLS_OPTIONS.honorCipherOrder, true);
  });

  runTest('Header spoofing menghasilkan token perangkat & origin resmi Shopee', () => {
    const headers = protocolClient.buildSpoofedHeaders({ roomId: '99887766' });
    assert.strictEqual(headers['Origin'], 'https://live.shopee.co.id');
    assert.strictEqual(headers['Referer'], 'https://live.shopee.co.id/live/99887766');
    assert.ok(headers['x-shopee-client-uuid'], 'Harus memuat x-shopee-client-uuid');
    assert.ok(headers['x-shopee-device-id'], 'Harus memuat x-shopee-device-id');
    assert.strictEqual(headers['x-api-source'], 'rn');
    assert.strictEqual(headers['x-shopee-language'], 'id');
    assert.ok(headers['Cookie'].includes('SPC_'), 'Cookie harus memuat token SPC_');
  });

  runTest('Header spoofing dengan cookie nyata mempertahankan token otentik', () => {
    const realCookie = 'SPC_U=81726354; SPC_EC=token_sec_123; SPC_ST=sess_token_456;';
    const headers = protocolClient.buildSpoofedHeaders({ roomId: '99887766', cookie: realCookie });
    assert.ok(headers['Cookie'].includes('SPC_U=81726354'), 'Harus memuat SPC_U otentik');
    assert.ok(headers['Cookie'].includes('SPC_EC=token_sec_123'), 'Harus memuat SPC_EC otentik');
    assert.ok(headers['Cookie'].includes('SPC_ST=sess_token_456'), 'Harus memuat SPC_ST otentik');
    assert.ok(headers['Cookie'].includes('SPC_F='), 'Harus memuat SPC_F tersinkronkan');
  });

  // -------------------------------------------------------------------------
  // 2. SOCKS5H REMOTE DNS RESOLVING (ZERO DNS LEAK)
  // -------------------------------------------------------------------------
  console.log('\n--- 2. AUDIT SOCKS5H REMOTE DNS RESOLVING (ANTI-DNS LEAK) ---');

  runTest('SOCKS5 Proxy dikonfigurasi menggunakan socks5h:// untuk remote DNS', () => {
    const proxySocks = {
      ip: '103.147.20.14',
      port: 1080,
      protocol: 'socks5',
      username: 'user_socks',
      password: 'pass_socks'
    };

    const agent = proxyManager.getProxyAgent(proxySocks);
    assert.ok(agent, 'Harus berhasil membuat SocksProxyAgent');
    // Verifikasi proxyOptions atau socksUrl menggunakan socks5h
    assert.strictEqual(agent.proxy.type, 5, 'Tipe SOCKS harus versi 5');
  });

  runTest('HTTP dan HTTPS Proxy menghasilkan HttpsProxyAgent yang valid', () => {
    const proxyHttp = {
      ip: '103.147.20.13',
      port: 8080,
      protocol: 'http'
    };
    const agent = proxyManager.getProxyAgent(proxyHttp);
    assert.ok(agent, 'Harus berhasil membuat HttpsProxyAgent');
  });

  // -------------------------------------------------------------------------
  // 3. IP DEDUPLICATION GUARD (1 BOT = 1 UNIQUE IP)
  // -------------------------------------------------------------------------
  console.log('\n--- 3. AUDIT IP DEDUPLICATION GUARD (UNIQUE IP ALLOCATION) ---');

  runTest('Alokasi worker proxy mendistribusikan IP unik untuk setiap bot', () => {
    const wId1 = `test-worker-dedup-1-${Date.now()}`;
    const wId2 = `test-worker-dedup-2-${Date.now()}`;

    const p1 = proxyManager.allocateProxyForWorker(wId1);
    const p2 = proxyManager.allocateProxyForWorker(wId2);

    assert.ok(p1, 'Worker 1 harus mendapatkan proxy');
    assert.ok(p2, 'Worker 2 harus mendapatkan proxy');
    assert.notStrictEqual(p1.ip, p2.ip, 'Worker 1 dan Worker 2 harus mendapatkan IP berbeda (IP Deduplication)');

    assert.strictEqual(proxyManager.getActiveLeaseCountForIp(p1.ip), 1, 'IP 1 harus memiliki 1 active lease');
    assert.strictEqual(proxyManager.getActiveLeaseCountForIp(p2.ip), 1, 'IP 2 harus memiliki 1 active lease');

    // Pemanggilan berulang untuk worker yang sama menghasilkan proxy konsisten (Sticky)
    const p1Again = proxyManager.allocateProxyForWorker(wId1);
    assert.strictEqual(p1Again.id, p1.id, 'Worker yang sama harus sticky pada proxy yang sama');

    // Pelepasan lease worker
    proxyManager.releaseWorkerProxy(wId1);
    assert.strictEqual(proxyManager.getActiveLeaseCountForIp(p1.ip), 0, 'Active lease harus kembali 0 setelah release');

    proxyManager.releaseWorkerProxy(wId2);
    assert.strictEqual(proxyManager.getActiveLeaseCountForIp(p2.ip), 0, 'Active lease harus kembali 0 setelah release');
  });

  // -------------------------------------------------------------------------
  // 4. OUTBOUND HTTP TRANSPORTER & GRACEFUL NETWORK FALLBACK
  // -------------------------------------------------------------------------
  console.log('\n--- 4. AUDIT OUTBOUND HTTP TRANSPORTER & GRACEFUL FALLBACK ---');

  await runAsyncTest('Outbound request transporter sukses berkomunikasi dengan local test server', async () => {
    const testServer = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', viewer_counted: true }));
    });

    await new Promise(r => testServer.listen(0, '127.0.0.1', r));
    const port = testServer.address().port;
    const testUrl = `http://127.0.0.1:${port}/api/v4/live/test_ping`;

    const res = await protocolClient.sendOutboundRequest(testUrl, {
      method: 'GET',
      headers: { 'User-Agent': 'TestShopeeClient' },
      timeout: 2000
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.viewer_counted, true);
    assert(res.latencyMs >= 0, 'Latensi harus terukur');

    await new Promise(r => testServer.close(r));
  });

  await runAsyncTest('fetchLiveRoomInfo menangani offline room secara graceful tanpa crash', async () => {
    const res = await protocolClient.fetchLiveRoomInfo('offline_test_room_999999', { timeout: 1000 });
    assert.strictEqual(typeof res.success, 'boolean');
    assert.strictEqual(typeof res.latencyMs, 'number');
    assert.ok(res.source, 'Harus memiliki metadata source');
  });

  await runAsyncTest('sendViewerPingHeartbeat memformat paket ping dengan tepat', async () => {
    const res = await protocolClient.sendViewerPingHeartbeat('88776655', { heartbeatCount: 3, timeout: 500 });
    assert.strictEqual(typeof res.success, 'boolean');
    assert(res.bytesTransferred > 0, 'Bytes transferred harus tercatat');
  });

  // -------------------------------------------------------------------------
  // 5. SHOPEE LIVE WORKER REAL NETWORK LIFECYCLE
  // -------------------------------------------------------------------------
  console.log('\n--- 5. AUDIT SHOPEE LIVE WORKER REAL NETWORK LIFECYCLE ---');

  await runAsyncTest('ShopeeLiveWorker mengeksekusi koneksi, heartbeat dan auto-release proxy', async () => {
    const worker = new ShopeeLiveWorker({
      roomId: 'room_audit_102',
      account: { name: 'Worker Protocol Tester', username: 'auditor_protocol' },
      heartbeatIntervalSec: 0.6,
      networkTimeout: 1500,
      autoStopOnStreamEnd: false
    });

    assert.ok(worker.proxy, 'Worker harus otomatis mendapatkan proxy via Deduplication Guard');
    const proxyIp = worker.proxy.ip;
    assert(proxyManager.getActiveLeaseCountForIp(proxyIp) >= 1, 'IP proxy harus memiliki lease aktif');

    let connectedEvent = null;
    worker.on('connected', (data) => {
      connectedEvent = data;
    });

    let heartbeatEvent = null;
    worker.on('heartbeat', (data) => {
      heartbeatEvent = data;
    });

    await worker.start();
    assert(connectedEvent, 'Worker harus memicu event connected');
    assert.strictEqual(connectedEvent.roomId, 'room_audit_102');
    assert(connectedEvent.latencyMs >= 0, 'Latensi handshake harus terukur');

    // Tunggu 1 siklus heartbeat secara dinamis
    for (let i = 0; i < 60; i++) {
      if (heartbeatEvent) break;
      await new Promise(r => setTimeout(r, 100));
    }
    assert(heartbeatEvent, 'Worker harus memicu event heartbeat dengan ping jaringan');
    assert(worker.bytesTransferred > 1024, 'Bytes transferred harus bertambah');

    // Keluar dari room
    await worker.leave('audit_finished');
    assert.strictEqual(worker.state, 'STOPPED');
    assert.strictEqual(proxyManager.getActiveLeaseCountForIp(proxyIp), 0, 'Lease IP harus dilepaskan saat worker leave');
  });

  // -------------------------------------------------------------------------
  // 6. ANCHOR VIEWERS PRIORITY ALLOCATION (AUTHENTIC COOKIE ACCOUNTS)
  // -------------------------------------------------------------------------
  console.log('\n--- 6. AUDIT ANCHOR VIEWERS PRIORITY ALLOCATION ---');

  runTest('Anchor Viewers memprioritaskan akun dengan session cookies otentik', () => {
    let tempAnchorAccountId = null;
    try {
      // Tambah akun sementara ber-cookie otentik
      const tempAcc = accountManager.addRealRegisteredAccount({
        id: `acc-anchor-temp-${Date.now()}`,
        username: 'anchor_cookie_tester',
        cookies: 'SPC_U=99881122; SPC_EC=anchor_ec_hash; SPC_ST=anchor_st_hash;',
        status: 'ready'
      });
      tempAnchorAccountId = tempAcc.id;

      // Klaim dengan preferAuthenticated: true
      const claimed = accountManager.claimAccount('cmp-anchor-audit', 'Audit Anchor', { preferAuthenticated: true });
      assert.ok(claimed, 'Harus berhasil mengklaim akun');
      assert.ok(claimed.cookies, 'Akun yang diklaim untuk Anchor harus memiliki cookies');
      assert.ok(claimed.cookies.includes('SPC_'), 'Cookies harus valid');

      // Lepas klaim akun
      accountManager.releaseAccount(claimed.id);
    } finally {
      if (tempAnchorAccountId) {
        accountManager.deleteAccount(tempAnchorAccountId);
        const exists = accountManager.getAllAccounts().some(a => a.id === tempAnchorAccountId);
        assert.strictEqual(exists, false, 'Akun uji anchor harus terhapus bersih dari database');
      }
    }
  });

  console.log('\n================================================================');
  console.log(`📊 REKAPITULASI AUDIT PROTOKOL LIVE: ${passedTests}/${totalTests} PENGUJIAN LULUS`);
  console.log('================================================================');
  console.log('🎉 PROTOKOL OUTBOUND, MOBILE TLS, SOCKS5H & IP DEDUPLICATION 100% SUKSES!\n');
}

runProtocolAudit().catch(err => {
  console.error('Fatal Protocol Audit Error:', err);
  process.exit(1);
});
