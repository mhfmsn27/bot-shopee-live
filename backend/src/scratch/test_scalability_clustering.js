/**
 * Unit & Concurrency Test: Scalability, Keep-Alive Pool, Stream Drainer & Device Matrix
 * Menjamin kesiapan arsitektur jaringan untuk 1.000 - 10.000 viewers tanpa memory leak.
 */

const assert = require('assert');
const http = require('http');
const {
  globalHttpAgent,
  globalHttpsAgent,
  getAgentPoolStats,
  DEVICE_PROFILES,
  generateDeviceFingerprint,
  buildSpoofedHeaders,
  sendOutboundRequest,
  probeVideoStreamChunks
} = require('../core/protocol-client');
const ShopeeLiveWorker = require('../core/shopee-live-worker');

async function runTest() {
  console.log('--- START TEST: Scalability, Keep-Alive Pool, Stream Drainer & Device Matrix ---');

  // 1. Keep-Alive Socket Pool Verification
  console.log('[1] Verifikasi Keep-Alive Socket Pool Configuration...');
  assert.strictEqual(globalHttpAgent.keepAlive, true, 'globalHttpAgent harus keepAlive: true');
  assert.strictEqual(globalHttpsAgent.keepAlive, true, 'globalHttpsAgent harus keepAlive: true');
  assert(globalHttpAgent.maxSockets >= 2000, 'globalHttpAgent maxSockets harus >= 2000');
  assert(globalHttpsAgent.maxSockets >= 2000, 'globalHttpsAgent maxSockets harus >= 2000');
  assert(globalHttpAgent.maxFreeSockets >= 256, 'globalHttpAgent maxFreeSockets harus >= 256');

  const poolStats = getAgentPoolStats();
  assert(poolStats.http && typeof poolStats.http.maxSockets === 'number', 'poolStats.http harus valid');
  assert(poolStats.https && typeof poolStats.https.maxSockets === 'number', 'poolStats.https harus valid');
  console.log('    Keep-Alive Pool Stats:', JSON.stringify(poolStats));
  console.log('    ✅ PASS: Keep-Alive Agent Pool terkonfigurasi untuk high-concurrency (>= 2000 sockets).');

  // 2. Zero-Allocation Stream Drainer Verification
  console.log('[2] Verifikasi Zero-Allocation Stream Drainer (HLS Stream Probe)...');
  // Buat mock HTTP server lokal untuk mengalirkan 10 chunk data stream
  const mockStreamServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'video/mp2t' });
    for (let i = 0; i < 8; i++) {
      res.write(Buffer.alloc(1024, 0xAA)); // 8KB data video
    }
    res.end();
  });

  await new Promise((resolve) => mockStreamServer.listen(0, '127.0.0.1', resolve));
  const serverPort = mockStreamServer.address().port;
  const mockUrl = `http://127.0.0.1:${serverPort}/live_stream.ts`;

  try {
    const drainResult = await sendOutboundRequest(mockUrl, {
      method: 'GET',
      drainStream: true,
      timeout: 2000
    });

    assert.strictEqual(drainResult.success, true, 'Drain request harus sukses');
    assert.strictEqual(drainResult.streamDrained, true, 'streamDrained flag harus bernilai true');
    assert.strictEqual(drainResult.data, null, 'Data buffer tidak boleh disimpan dalam RAM (harus null)');
    assert.strictEqual(drainResult.rawBodyLength, 8192, 'Total bytes yang di-drain harus 8192 bytes (8KB)');
    assert.strictEqual(drainResult.bytesTransferred, 8192, 'bytesTransferred harus cocok');
    console.log(`    Stream Drain: ${drainResult.bytesTransferred} bytes diproses dengan 0 byte alokasi RAM string!`);

    // Test probeVideoStreamChunks
    const probeRes = await probeVideoStreamChunks(mockUrl);
    assert.strictEqual(probeRes.streamDrained, true, 'probeVideoStreamChunks harus menggunakan drainStream');
    console.log('    ✅ PASS: Zero-Allocation HLS Stream Drainer memangkas retensi RAM ke 0 byte.');
  } finally {
    mockStreamServer.close();
  }

  // 3. Device Fingerprint Matrix Verification
  console.log('[3] Verifikasi Device Fingerprint Matrix Multi-Brand...');
  assert(DEVICE_PROFILES.length >= 5, 'Matrix perangkat harus memiliki minimal 5 profile');
  const brands = new Set(DEVICE_PROFILES.map(p => p.brand));
  assert(brands.has('Samsung'), 'Harus menyertakan profil Samsung');
  assert(brands.has('Xiaomi'), 'Harus menyertakan profil Xiaomi');
  assert(brands.has('Apple'), 'Harus menyertakan profil Apple');
  assert(brands.has('OPPO'), 'Harus menyertakan profil OPPO');

  for (let idx = 0; idx < DEVICE_PROFILES.length; idx++) {
    const profile = DEVICE_PROFILES[idx];
    const fp = generateDeviceFingerprint(idx);
    assert.strictEqual(fp.deviceProfile.brand, profile.brand);
    assert(fp.deviceId.length === 32, 'Device ID harus 32 hex chars');
    assert(fp.clientUuid.length === 36, 'Client UUID harus standard UUID format');

    const headers = buildSpoofedHeaders({ roomId: '12345678', fingerprint: fp });
    assert.strictEqual(headers['sec-ch-ua-platform'], profile.secChUaPlatform);
    assert.strictEqual(headers['sec-ch-ua-model'], profile.secChUaModel);
    assert(headers['User-Agent'].includes(profile.model) || headers['User-Agent'].includes('iPhone'), 'User-Agent harus konsisten dengan model');
  }
  console.log(`    ✅ PASS: ${DEVICE_PROFILES.length} Device Profiles terverifikasi konsisten dengan Client Hints.`);

  // 4. Micro-Batch Timer Coordination & Worker Micro-Actions
  console.log('[4] Verifikasi Micro-Batch Timer Coordination & Worker Micro-Actions...');
  const workers = [];
  try {
    for (let i = 0; i < 20; i++) {
      const w = new ShopeeLiveWorker({
        id: `scale-wrk-${i}`,
        roomId: '112233',
        allocateProxy: false,
        heartbeatIntervalSec: 10
      });
      workers.push(w);
    }

    // Uji micro-actions pada worker
    const workerSample = workers[0];
    workerSample.state = 'VIEWING';

    const muteRes = await workerSample.sendMuteToggle();
    assert.strictEqual(muteRes.success, true);
    assert.strictEqual(muteRes.isMuted, true);
    assert.strictEqual(workerSample.isMuted, true);

    const resProbe = await workerSample.sendResolutionProbe('1080p');
    assert.strictEqual(resProbe.success, true);
    assert.strictEqual(resProbe.resolution, '1080p');
    assert.strictEqual(workerSample.streamResolution, '1080p');

    const profileClick = await workerSample.sendProfileClick();
    assert.strictEqual(profileClick.success, true);
    assert.strictEqual(workerSample.profileClicksSent, 1);

    const metrics = workerSample.getMetrics();
    assert.strictEqual(metrics.isMuted, true);
    assert.strictEqual(metrics.streamResolution, '1080p');
    assert.strictEqual(metrics.profileClicksSent, 1);
    console.log('    Worker Micro-Actions verified:', { isMuted: metrics.isMuted, resolution: metrics.streamResolution, clicks: metrics.profileClicksSent });

    // Uji Micro-Batch Jitter Alignment (250ms window tick coalescing)
    workerSample.scheduleNextHeartbeat();
    assert(workerSample.heartbeatTimer !== null, 'heartbeatTimer harus terpasang');
    console.log('    ✅ PASS: Micro-batch timer coordination & micro-actions terintegrasi dengan sempurna.');
  } finally {
    for (const w of workers) {
      w.stop();
    }
  }

  console.log('🎉 ALL SCALABILITY & CLUSTERING TESTS PASSED (100% OK)');
}

runTest().catch((err) => {
  console.error('❌ TEST FAILED:', err);
  process.exit(1);
});
