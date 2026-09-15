/**
 * Test Multi-Browser Live Worker with 711Proxy Residential Proxies
 * Menjalankan 3 worker browser headless stealth secara simultan pada proxy residensial yang berbeda,
 * memantau koneksi, event heartbeat, RAM, resource interception, dan graceful teardown.
 */

const BrowserLiveWorker = require('../core/browser-live-worker');

const TEST_PROXIES = [
  {
    id: 'proxy-res-1',
    ip: 'global.rotip.711proxy.com',
    port: 20000,
    username: 'USER085641-zone-custom-region-ID-session-42666063',
    password: 'c7df05',
    protocol: 'http',
    type: 'residential'
  },
  {
    id: 'proxy-res-2',
    ip: 'global.rotip.711proxy.com',
    port: 20000,
    username: 'USER085641-zone-custom-region-ID-session-42397208',
    password: 'c7df05',
    protocol: 'http',
    type: 'residential'
  },
  {
    id: 'proxy-res-3',
    ip: 'global.rotip.711proxy.com',
    port: 20000,
    username: 'USER085641-zone-custom-region-ID-session-87221381',
    password: 'c7df05',
    protocol: 'http',
    type: 'residential'
  }
];

const ROOM_ID = '224634696'; // Sesi siaran Hp Murah

async function runMultiBrowserTest() {
  console.log('================================================================');
  console.log('🚀 MEMULAI VALIDASI MULTI-BROWSER HEADLESS STEALTH WORKER');
  console.log(`🎯 Room ID: ${ROOM_ID}`);
  console.log(`🌐 Total Workers: 3 (1 Worker per Residential Proxy)`);
  console.log('================================================================\n');

  const workers = [];
  const startMem = process.memoryUsage().rss / 1024 / 1024;
  console.log(`📊 Initial Node RSS Memory: ${startMem.toFixed(1)} MB`);

  for (let i = 0; i < TEST_PROXIES.length; i++) {
    const proxy = TEST_PROXIES[i];
    const worker = new BrowserLiveWorker({
      id: `bwrk-test-${i + 1}`,
      roomId: ROOM_ID,
      proxy,
      heartbeatIntervalSec: 6, // interval pendek untuk testing
      blockHeavyResources: true
    });

    worker.on('connected', (data) => {
      console.log(`✅ [Worker ${i + 1}] Connected! Room: ${data.roomId} | Engine: ${data.engine} | Proxy: ${data.proxyIp}:${data.proxyPort}`);
    });

    worker.on('heartbeat', (data) => {
      console.log(`💓 [Worker ${i + 1}] Heartbeat #${data.heartbeatCount} (Active: ${data.durationSec}s, Net: ${(data.bytesTransferred / 1024).toFixed(1)} KB)`);
    });

    worker.on('error', (err) => {
      console.error(`❌ [Worker ${i + 1}] Error:`, err.error || err);
    });

    worker.on('leave', (data) => {
      console.log(`🚪 [Worker ${i + 1}] Left room. Reason: ${data.reason}, Duration: ${data.durationWatchedSec}s, Data: ${(data.bytesTransferred / 1024).toFixed(1)} KB`);
    });

    workers.push(worker);
  }

  console.log('⏳ Meluncurkan 3 Browser Workers...');
  const launchPromises = workers.map((w, idx) => {
    return new Promise(resolve => {
      setTimeout(async () => {
        console.log(`▶️ Launching Worker ${idx + 1}...`);
        await w.start();
        resolve();
      }, idx * 1500); // staggered startup
    });
  });

  await Promise.all(launchPromises);

  console.log('\n🟢 Seluruh 3 worker telah terinisialisasi. Memantau sesi selama 20 detik...\n');

  // Uji coba micro-action tap like
  setTimeout(async () => {
    console.log('❤️ Mengirimkan simulasi micro-action (Tap Like) pada Worker 1...');
    try {
      await workers[0].sendTapLike(5);
      console.log(`❤️ Worker 1 total likes sent: ${workers[0].likesSent}`);
    } catch (e) {
      console.error('Like test error:', e.message);
    }
  }, 10000);

  // Tunggu total durasi observasi
  await new Promise(r => setTimeout(r, 22000));

  const endMem = process.memoryUsage().rss / 1024 / 1024;
  console.log(`\n📊 Peak Node RSS Memory: ${endMem.toFixed(1)} MB (Delta: +${(endMem - startMem).toFixed(1)} MB)`);

  console.log('\n🛑 Menghentikan seluruh worker...');
  for (let i = 0; i < workers.length; i++) {
    const m = workers[i].getMetrics();
    console.log(`📋 Worker ${i + 1} Final Metrics: State=${m.state}, Heartbeats=${m.heartbeatCount}, Transferred=${(m.bytesTransferred / 1024).toFixed(1)} KB`);
    await workers[i].stop();
  }

  console.log('\n✨ MULTI-BROWSER VALIDATION COMPLETED SUCCESSFULLY!');
  process.exit(0);
}

runMultiBrowserTest().catch(err => {
  console.error('FATAL TEST ERROR:', err);
  process.exit(1);
});
