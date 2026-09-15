/**
 * Real Live Injection: 9 Browser Workers on 3 711Proxy Residential IPs (3 Workers/Proxy)
 * Target Room: 224644833 (https://id.shp.ee/TTs2WeTY)
 */

const BrowserLiveWorker = require('../core/browser-live-worker');

const PROXIES = [
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

const ROOM_ID = '224641702'; // Sesi Siaran Baru (https://id.shp.ee/6LKt1uUK)
const TOTAL_WORKERS = 9;

async function startInjection() {
  console.log('================================================================');
  console.log('🚀 INJEKSI REAL LIVE SHOPEE: 9 BROWSER STEALTH WORKERS');
  console.log(`🎯 Room ID Target: ${ROOM_ID}`);
  console.log(`🌐 Total Proxy Residensial: 3 IP (3 Bot / Proxy)`);
  console.log(`⏱️  Waktu Mulai: ${new Date().toLocaleTimeString('id-ID')}`);
  console.log('================================================================\n');

  const workers = [];
  let connectedCount = 0;
  let totalLikesSent = 0;

  for (let i = 0; i < TOTAL_WORKERS; i++) {
    const proxyIdx = i % PROXIES.length;
    const proxy = PROXIES[proxyIdx];
    const workerId = `bwrk-live-${i + 1}`;

    const worker = new BrowserLiveWorker({
      id: workerId,
      roomId: ROOM_ID,
      proxy,
      heartbeatIntervalSec: 15,
      blockHeavyResources: true
    });

    worker.on('connected', (data) => {
      connectedCount++;
      console.log(`✅ [Bot #${i + 1}] BERHASIL MASUK! (Proxy ${proxyIdx + 1} | Active Viewers: ${connectedCount}/${TOTAL_WORKERS})`);
    });

    worker.on('heartbeat', (data) => {
      console.log(`💓 [Bot #${i + 1}] Heartbeat #${data.heartbeatCount} (Online: ${data.durationSec}s | Data: ${(data.bytesTransferred / 1024).toFixed(1)} KB)`);
    });

    worker.on('error', (err) => {
      console.error(`⚠️ [Bot #${i + 1}] Error:`, err.error || err);
    });

    worker.on('leave', (data) => {
      connectedCount = Math.max(0, connectedCount - 1);
      console.log(`🚪 [Bot #${i + 1}] Keluar. Alasan: ${data.reason} (Sisa Aktif: ${connectedCount})`);
    });

    workers.push(worker);
  }

  console.log('⏳ Meluncurkan 9 Browser Headless secara bertahap (Staggered Ramp-Up)...');

  // Staggered launch 2 detik per worker untuk kurva alami
  for (let i = 0; i < workers.length; i++) {
    const w = workers[i];
    const pIdx = (i % PROXIES.length) + 1;
    console.log(`▶️ [${i + 1}/${TOTAL_WORKERS}] Memulai Bot #${i + 1} melalui Proxy Residensial ${pIdx}...`);
    w.start().catch(err => {
      console.error(`Gagal start worker #${i + 1}:`, err.message);
    });
    await new Promise(r => setTimeout(r, 2200));
  }

  console.log('\n✨ Seluruh 9 worker browser telah diluncurkan! Sistem sekarang aktif menonton siaran.');
  console.log('❤️ Menjalankan simulasi interaksi otomatis (Tap Like berkala)...\n');

  // Interval kirim like otomatis setiap 8 detik dari random worker
  const likeInterval = setInterval(async () => {
    const active = workers.filter(w => w.state === 'VIEWING');
    if (active.length > 0) {
      const randomWorker = active[Math.floor(Math.random() * active.length)];
      const taps = Math.floor(Math.random() * 5) + 3;
      try {
        await randomWorker.sendTapLike(taps);
        totalLikesSent += taps;
        console.log(`❤️ [Interaksi] ${randomWorker.id} mengirim ${taps} likes! Total: ${totalLikesSent} likes.`);
      } catch (e) {}
    }
  }, 8000);

  // Status reporter setiap 30 detik
  const statusInterval = setInterval(() => {
    const active = workers.filter(w => w.state === 'VIEWING').length;
    const totalBytes = workers.reduce((acc, w) => acc + w.bytesTransferred, 0);
    console.log(`\n📊 [Laporan Sesi Live] Aktif: ${active}/${TOTAL_WORKERS} Viewers | Total Likes: ${totalLikesSent} | Bandwidth: ${(totalBytes / 1024 / 1024).toFixed(2)} MB\n`);
  }, 30000);

  // Graceful shutdown handler
  async function cleanup() {
    console.log('\n🛑 Menghentikan seluruh 9 bot penonton...');
    clearInterval(likeInterval);
    clearInterval(statusInterval);
    for (const w of workers) {
      try { await w.stop(); } catch (e) {}
    }
    console.log('🏁 Seluruh bot telah ditutup. Selesai.');
    process.exit(0);
  }

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

startInjection().catch(err => {
  console.error('FATAL INJECTION ERROR:', err);
  process.exit(1);
});
