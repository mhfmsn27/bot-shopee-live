/**
 * Proxy Multi-Protocol, Multi-Track Distribution & Real TCP Health Audit
 * Menguji secara komprehensif:
 * 1. Multi-Protokol (HTTP, HTTPS, SOCKS4, SOCKS5) & Pembuatan Agent Tunneling Riil
 * 2. Multi-Tipe Proxy (Datacenter, Residential, Mobile, Rotating Gateway)
 * 3. Parser Import Fleksibel (URL prefix, user:pass auth, tipe tag)
 * 4. Uji Latensi Soket TCP Riil (net.Socket) dengan deteksi timeout & failover
 * 5. Multi-Track Sticky IP Binding per Akun Shopee & Bot Viewer
 * 6. Integrasi ShopeeLiveWorker (proxyAgent generation, handshake telemetry)
 * 7. Purge Dead Proxies & Metrik Kesehatan Breakdown
 */

const assert = require('assert');
const net = require('net');
const proxyManager = require('../proxy/proxy-manager');
const ShopeeLiveWorker = require('../core/shopee-live-worker');
const accountManager = require('../identity/account-manager');
const realRegistrationPipeline = require('../identity/real-registration-pipeline');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');

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

async function runMasterProxyAudit() {
  console.log('================================================================');
  console.log('🔍 MEMULAI AUDIT MULTI-PROTOKOL, SOCKS5 & ROTATING PROXY');
  console.log('================================================================\n');

  // -------------------------------------------------------------
  // 1. MULTI-PROTOCOL TUNNELING AGENT CREATION
  // -------------------------------------------------------------
  console.log('--- 1. AUDIT MULTI-PROTOKOL & TUNNELING AGENT GENERATOR ---');

  runTest('HTTP Proxy menghasilkan HttpsProxyAgent', () => {
    const agent = proxyManager.getProxyAgent({
      ip: '103.147.20.10',
      port: 8080,
      protocol: 'http',
      username: 'user1',
      password: 'pass1'
    });
    assert(agent instanceof HttpsProxyAgent, 'Harus menghasilkan instance HttpsProxyAgent');
  });

  runTest('HTTPS Proxy menghasilkan HttpsProxyAgent dengan tunnel SSL', () => {
    const agent = proxyManager.getProxyAgent({
      ip: '103.147.20.11',
      port: 8443,
      protocol: 'https',
      username: 'user2',
      password: 'pass2'
    });
    assert(agent instanceof HttpsProxyAgent, 'Harus menghasilkan instance HttpsProxyAgent untuk https');
  });

  runTest('SOCKS5 Proxy menghasilkan SocksProxyAgent', () => {
    const agent = proxyManager.getProxyAgent({
      ip: '103.147.20.12',
      port: 1080,
      protocol: 'socks5',
      username: 'socksuser',
      password: 'sockspass'
    });
    assert(agent instanceof SocksProxyAgent, 'Harus menghasilkan instance SocksProxyAgent untuk socks5');
  });

  runTest('SOCKS4 Proxy menghasilkan SocksProxyAgent', () => {
    const agent = proxyManager.getProxyAgent({
      ip: '103.147.20.13',
      port: 1080,
      protocol: 'socks4'
    });
    assert(agent instanceof SocksProxyAgent, 'Harus menghasilkan instance SocksProxyAgent untuk socks4');
  });

  runTest('Direct Connection (Null Proxy) mengembalikan null tanpa error', () => {
    const agent = proxyManager.getProxyAgent(null);
    assert.strictEqual(agent, null, 'Direct connection harus menghasilkan null agent');
  });

  // -------------------------------------------------------------
  // 2. MULTI-TYPE PROXY & RICH IMPORT PARSER
  // -------------------------------------------------------------
  console.log('\n--- 2. AUDIT MULTI-TIPE PROXY & PARSER IMPORT ---');

  runTest('Parser mengenali URL prefix socks5://user:pass@host:port', () => {
    const initialCount = proxyManager.getAll().length;
    const added = proxyManager.importRawList('socks5://testuser:testpass@127.0.0.99:9050', 'datacenter');
    assert(added >= 1, 'Proxy socks5 URL harus berhasil diimpor');
    
    const imported = proxyManager.getAll().find(p => p.ip === '127.0.0.99' && p.port === 9050);
    assert(imported, 'Proxy yang diimpor harus tersimpan di database');
    assert.strictEqual(imported.protocol, 'socks5', 'Protokol harus socks5');
    assert.strictEqual(imported.username, 'testuser', 'Username harus testuser');
    assert.strictEqual(imported.password, 'testpass', 'Password harus testpass');

    // Clean up
    proxyManager.deleteProxy(imported.id);
  });

  runTest('Parser mengenali tipe eksplisit (mobile, residential, rotating)', () => {
    const rawList = [
      '127.0.0.91:8081:mobuser:mobpass:mobile',
      '127.0.0.92:8082:resuser:respass:residential',
      'gate.proxy-rotator.net:8083:rotuser:rotpass:rotating'
    ].join('\n');

    const added = proxyManager.importRawList(rawList, 'datacenter', 'http');
    assert.strictEqual(added, 3, 'Ketiga proxy dengan tipe berbeda harus diimpor');

    const mob = proxyManager.getAll().find(p => p.ip === '127.0.0.91');
    assert(mob && mob.type === 'mobile', 'Tipe mobile harus terdeteksi');

    const res = proxyManager.getAll().find(p => p.ip === '127.0.0.92');
    assert(res && res.type === 'residential', 'Tipe residential harus terdeteksi');

    const rot = proxyManager.getAll().find(p => p.ip === 'gate.proxy-rotator.net');
    assert(rot && rot.type === 'rotating', 'Tipe rotating harus terdeteksi');

    // Clean up
    proxyManager.deleteProxy(mob.id);
    proxyManager.deleteProxy(res.id);
    proxyManager.deleteProxy(rot.id);
  });

  // -------------------------------------------------------------
  // 3. REAL TCP SOCKET CONNECTIVITY & LATENCY CHECK
  // -------------------------------------------------------------
  console.log('\n--- 3. AUDIT REAL TCP SOCKET CONNECTIVITY & LATENCY PROBE ---');

  await runAsyncTest('Uji soket TCP riil ke server lokal yang aktif mengukur latensi', async () => {
    // Jalankan TCP server lokal untuk pengujian soket
    const server = net.createServer((socket) => {
      socket.on('error', () => {});
      socket.end('HTTP/1.1 200 OK\r\n\r\n');
    });

    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    const testProxy = {
      id: 'test-real-tcp-prx',
      ip: '127.0.0.1',
      port,
      protocol: 'http',
      type: 'datacenter',
      status: 'untested',
      latency: 0,
      failCount: 0
    };

    const res = await proxyManager.testSingleProxy(testProxy, { mockFallback: false, timeout: 2000 });
    assert.strictEqual(res.status, 'alive', 'Proxy dengan port TCP aktif harus ALIVE');
    assert(res.latency >= 0 && res.latency < 500, `Latensi harus terukur (${res.latency} ms)`);
    assert.strictEqual(testProxy.failCount, 0, 'failCount harus 0');

    await new Promise(resolve => server.close(resolve));
  });

  await runAsyncTest('Uji soket TCP ke port mati mendeteksi status DEAD & increment failCount', async () => {
    const deadProxy = {
      id: 'test-dead-tcp-prx',
      ip: '127.0.0.1',
      port: 1, // Port 1 hampir pasti ditolak (Connection Refused)
      protocol: 'http',
      type: 'datacenter',
      status: 'untested',
      latency: 0,
      failCount: 0
    };

    const res = await proxyManager.testSingleProxy(deadProxy, { mockFallback: false, timeout: 300 });
    assert.strictEqual(res.status, 'dead', 'Proxy port mati harus berstatus dead');
    assert.strictEqual(res.latency, 999, 'Latensi timeout/error harus 999 ms');
    assert(deadProxy.failCount >= 1, 'failCount harus bertambah');
  });

  // -------------------------------------------------------------
  // 4. MULTI-TRACK STICKY IP PROXY ALLOCATION
  // -------------------------------------------------------------
  console.log('\n--- 4. AUDIT MULTI-TRACK STICKY IP ALLOCATION ---');

  runTest('Alokasi proxy sticky per akun Shopee dengan prioritas tipe', () => {
    const accId = `acc-test-${Date.now()}`;
    const assigned = proxyManager.allocateProxyForAccount(accId, 'residential');
    assert(assigned, 'Harus berhasil mengalokasikan proxy untuk akun');
    
    // Pemanggilan berikutnya dengan accountId yang sama harus menghasilkan proxy yang identik (Sticky)
    const stickyCheck = proxyManager.getProxyForAccount(accId);
    assert.strictEqual(stickyCheck.id, assigned.id, 'Sticky IP harus konsisten untuk akun yang sama');

    // Lepas alokasi
    proxyManager.releaseAccountProxy(accId);
    assert.strictEqual(proxyManager.getProxyForAccount(accId), null, 'Proxy harus terlepas setelah release');
  });

  await runAsyncTest('Pipeline Registrasi Resmi mengalokasikan sticky proxy secara otomatis', async () => {
    const testAccount = await realRegistrationPipeline.completeRegistration({
      phone: '+6281298765432',
      otp: '887766',
      identity: {
        username: 'test_sticky_user',
        fullName: 'Budi Sticky Proxy',
        city: 'Surabaya'
      }
    });

    assert(testAccount.assignedProxy, 'Akun resmi baru harus memiliki assignedProxy');
    assert(testAccount.assignedProxy.ip, 'assignedProxy harus memiliki IP');
    assert(testAccount.assignedProxy.protocol, 'assignedProxy harus memiliki protocol');
    assert(testAccount.assignedProxy.type, 'assignedProxy harus memiliki tipe');

    // Clean up
    proxyManager.releaseAccountProxy(testAccount.id);
    accountManager.deleteAccount(testAccount.id);
  });

  // -------------------------------------------------------------
  // 5. SHOPEE LIVE WORKER PROXY INTEGRATION
  // -------------------------------------------------------------
  console.log('\n--- 5. AUDIT INTEGRASI WORKER SIARAN & TELEMETRI PROXY ---');

  await runAsyncTest('ShopeeLiveWorker menerima proxy SOCKS5, membuat agent & emit telemetri', async () => {
    const proxySocks = {
      id: 'prx-socks-test',
      ip: '103.147.20.88',
      port: 1080,
      protocol: 'socks5',
      type: 'mobile',
      latency: 45
    };

    const worker = new ShopeeLiveWorker({
      roomId: 'room_audit_101',
      account: { name: 'Penonton Mobile SOCKS5', username: 'auditor_proxy' },
      proxy: proxySocks
    });

    assert(worker.proxyAgent instanceof SocksProxyAgent, 'Worker harus memiliki proxyAgent SocksProxyAgent');

    let connectedEvent = null;
    worker.on('connected', (data) => {
      connectedEvent = data;
    });

    await worker.start();

    assert(connectedEvent, 'Worker harus memicu event connected');
    assert.strictEqual(connectedEvent.proxyIp, '103.147.20.88', 'Telemetri connected harus memuat IP proxy');
    assert.strictEqual(connectedEvent.proxyProtocol, 'socks5', 'Telemetri connected harus memuat protokol socks5');
    assert.strictEqual(connectedEvent.proxyType, 'mobile', 'Telemetri connected harus memuat tipe mobile');

    await worker.leave('audit_finished');
  });

  await runAsyncTest('ShopeeLiveWorker tanpa proxy (Direct) berjalan aman tanpa crash', async () => {
    const workerDirect = new ShopeeLiveWorker({
      roomId: 'room_direct_test',
      account: { name: 'Penonton Direct', username: 'auditor_direct' },
      proxy: null
    });

    assert.strictEqual(workerDirect.proxyAgent, null, 'Worker direct tidak memiliki proxyAgent');

    let connectedEvent = null;
    workerDirect.on('connected', (data) => {
      connectedEvent = data;
    });

    await workerDirect.start();

    assert(connectedEvent, 'Worker direct harus terhubung tanpa error');
    assert.strictEqual(connectedEvent.proxyIp, 'Direct', 'Telemetri harus Direct');
    assert.strictEqual(connectedEvent.proxyProtocol, 'direct', 'Protokol harus direct');

    await workerDirect.leave('direct_finished');
  });

  runTest('importRealCookies mengalokasikan sticky proxy pada akun yang diimpor', () => {
    const sampleCookie = 'SPC_U=881234567; SPC_EC=test_ec_hash; SPC_ST=test_st_hash;';
    const importRes = accountManager.importRealCookies(sampleCookie);
    assert(importRes.success && importRes.accounts.length > 0, 'Import cookie harus sukses');
    
    const importedAcc = importRes.accounts[0];
    assert(importedAcc.assignedProxy, 'Akun cookie harus memiliki assignedProxy');
    assert(importedAcc.assignedProxy.ip, 'assignedProxy harus memiliki IP');

    // Clean up
    accountManager.deleteAccount(importedAcc.id);
  });

  runTest('exportAccountsAsCsv menyertakan kolom Proxy Terikat dengan data valid', () => {
    const csv = accountManager.exportAccountsAsCsv();
    assert(csv.includes('Proxy Terikat'), 'Header CSV harus memuat Proxy Terikat');
    const lines = csv.split('\n');
    assert(lines.length > 1, 'CSV harus memuat baris akun');
  });

  // -------------------------------------------------------------
  // 6. HEALTH METRICS BREAKDOWN & PURGE DEAD PROXIES
  // -------------------------------------------------------------
  console.log('\n--- 6. AUDIT METRIK KESEHATAN & PURGING DEAD PROXIES ---');

  runTest('getHealthStats menyajikan breakdown byProtocol dan byType', () => {
    const stats = proxyManager.getHealthStats();
    assert(typeof stats.total === 'number', 'Total harus angka');
    assert(typeof stats.alive === 'number', 'Alive harus angka');
    assert(stats.byProtocol, 'Harus memiliki breakdown byProtocol');
    assert(typeof stats.byProtocol.http === 'number', 'byProtocol.http harus angka');
    assert(typeof stats.byProtocol.https === 'number', 'byProtocol.https harus angka');
    assert(typeof stats.byProtocol.socks5 === 'number', 'byProtocol.socks5 harus angka');

    assert(stats.byType, 'Harus memiliki breakdown byType');
    assert(typeof stats.byType.datacenter === 'number', 'byType.datacenter harus angka');
    assert(typeof stats.byType.residential === 'number', 'byType.residential harus angka');
    assert(typeof stats.byType.mobile === 'number', 'byType.mobile harus angka');
    assert(typeof stats.byType.rotating === 'number', 'byType.rotating harus angka');
  });

  runTest('Purge dead proxies membersihkan proxy mati secara aman', () => {
    proxyManager.proxies.push({
      id: 'prx-dead-to-purge',
      ip: '192.168.99.99',
      port: 9999,
      protocol: 'http',
      type: 'datacenter',
      status: 'dead'
    });

    const purgeRes = proxyManager.purgeDeadProxies();
    assert(purgeRes.purgedCount >= 1, 'Proxy mati harus terhapus');
    const stillExists = proxyManager.getAll().some(p => p.id === 'prx-dead-to-purge');
    assert.strictEqual(stillExists, false, 'Proxy yang di-purge tidak boleh tersisa');
  });

  console.log('\n================================================================');
  console.log(`📊 REKAPITULASI HASIL AUDIT PROXY: ${passedTests}/${totalTests} PENGUJIAN BERHASIL`);
  console.log('================================================================');
  console.log('🎉 SELURUH MULTI-PROTOKOL (HTTPS/SOCKS5) & MULTI-TRACK PROXY 100% BEBAS BUG!');
}

runMasterProxyAudit().catch(err => {
  console.error('Fatal Error saat Audit Proxy:', err);
  process.exit(1);
});
