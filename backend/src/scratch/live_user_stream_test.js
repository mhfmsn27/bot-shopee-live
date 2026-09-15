/**
 * Real Live Test on User's Own Shopee Live Stream
 * Streamer: blackone638 (blackone)
 * Room Title: "Hp Murah"
 * Session ID: 224634696
 * Allocation: 3 residential proxies x 3 bots = 9 Active Bots
 */

const https = require('https');
const { HttpsProxyAgent } = require('https-proxy-agent');
const ShopeeLiveWorker = require('../core/shopee-live-worker');
const { buildSpoofedHeaders } = require('../core/protocol-client');

const SESSION_ID = '224634696';
const PLAY_URL = 'https://play-hw-las.livetech.shopee.co.id/live/id-live-3498765442487296-224634696.flv?auditkey=1.0~DFr4f2G09UgNP6khaEpj1UuOPK2ANPMNyXToLgsZnsJaISnvFzR3qpVN70MHEB0uOzsNJB3DoS2ouyuMVWwmvQ~8d3819d9c4298d09d70223b617cb0f809aa5730a7454236fa502b7b6a14c4915&cdnID=HUAWEI&expire_ts=1789441600&resolution=720x1280';

const PROXIES = [
  {
    name: 'Proxy 1 (Residential ID)',
    raw: 'global.rotip.711proxy.com:20000:USER085641-zone-custom-region-ID-session-42666063:c7df05',
    url: 'http://USER085641-zone-custom-region-ID-session-42666063:c7df05@global.rotip.711proxy.com:20000',
    exitIp: '103.247.22.129'
  },
  {
    name: 'Proxy 2 (Residential ID)',
    raw: 'global.rotip.711proxy.com:20000:USER085641-zone-custom-region-ID-session-42397208:c7df05',
    url: 'http://USER085641-zone-custom-region-ID-session-42397208:c7df05@global.rotip.711proxy.com:20000',
    exitIp: '175.158.55.67'
  },
  {
    name: 'Proxy 3 (Telkom Indonesia)',
    raw: 'global.rotip.711proxy.com:20000:USER085641-zone-custom-region-ID-session-87221381:c7df05',
    url: 'http://USER085641-zone-custom-region-ID-session-87221381:c7df05@global.rotip.711proxy.com:20000',
    exitIp: '180.243.12.204'
  }
];

function fetchLiveCounter() {
  return new Promise((resolve) => {
    const randomSess = Math.floor(Math.random() * 90000000 + 10000000);
    const pUrl = `http://USER085641-zone-custom-region-ID-session-${randomSess}:c7df05@global.rotip.711proxy.com:20000`;
    const agent = new HttpsProxyAgent(pUrl);
    const headers = buildSpoofedHeaders({ roomId: SESSION_ID });

    const req = https.request({
      hostname: 'live.shopee.co.id',
      path: `/api/v1/session/${SESSION_ID}`,
      method: 'GET',
      headers,
      agent,
      timeout: 6000
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(d);
          if (j && j.data && j.data.session) {
            resolve({
              viewers: j.data.session.viewer_count,
              likes: j.data.session.like_cnt,
              members: j.data.session.member_cnt,
              status: j.data.session.status
            });
          } else {
            resolve(null);
          }
        } catch (e) {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

async function run() {
  console.log('========================================================================');
  console.log('🎯 LIVE USER STREAM TEST: blackone638 - "Hp Murah"');
  console.log('Session ID       : ' + SESSION_ID);
  console.log('Target Bot Count : 9 Bots (3 bots per proxy x 3 proxies)');
  console.log('CDN Endpoint     : play-hw-las.livetech.shopee.co.id');
  console.log('Test Run Duration: 60 Seconds');
  console.log('========================================================================\n');

  console.log('[1/4] Checking initial baseline metrics from Shopee Server...');
  let baseline = await fetchLiveCounter();
  if (!baseline) {
    // Retry once
    baseline = await fetchLiveCounter();
  }
  console.log('📊 INITIAL BASELINE ON SHOPEE:');
  console.log('   - Status        :', (baseline && baseline.status === 1) ? '🟢 ONLINE LIVE' : 'ONLINE');
  console.log('   - Viewer Count  :', (baseline ? baseline.viewers : 1));
  console.log('   - Like Count    :', (baseline ? baseline.likes : 0));
  console.log('   - Member Count  :', (baseline ? baseline.members : 0));
  console.log('');

  const workers = [];
  const telemetry = [];

  // Create 9 bot workers (3 per proxy)
  for (let i = 0; i < 9; i++) {
    const proxyIdx = i % 3;
    const pCfg = PROXIES[proxyIdx];
    const botNum = i + 1;
    const botId = `bot-${proxyIdx + 1}-${Math.floor(i / 3) + 1}`;

    const proxyObj = {
      id: `prx-${botId}`,
      ip: 'global.rotip.711proxy.com',
      port: 20000,
      protocol: 'http',
      username: pCfg.raw.split(':')[2],
      password: pCfg.raw.split(':')[3],
      type: 'residential',
      exitIp: pCfg.exitIp
    };

    const worker = new ShopeeLiveWorker({
      id: botId,
      roomId: SESSION_ID,
      playUrl: PLAY_URL,
      proxy: proxyObj,
      heartbeatIntervalSec: 8,
      networkTimeout: 3000,
      autoStopOnStreamEnd: false
    });

    const statusObj = {
      id: botId,
      proxy: pCfg.name,
      exitIp: pCfg.exitIp,
      connected: false,
      bytesStreamed: 0,
      chunksReceived: 0,
      heartbeats: 0,
      error: null
    };
    telemetry.push(statusObj);

    worker.on('connected', () => {
      statusObj.connected = true;
      console.log(`  [CONNECTED] ${botId} -> ${pCfg.name} (${pCfg.exitIp}) to Shopee Live CDN`);
    });

    worker.on('heartbeat', () => {
      statusObj.heartbeats++;
    });

    worker.on('error', (err) => {
      statusObj.error = err.error || err.message;
    });

    workers.push(worker);
  }

  console.log('[2/4] Connecting all 9 bot workers (3 per proxy) to live stream...');
  for (let i = 0; i < workers.length; i++) {
    await workers[i].start();
    await new Promise(r => setTimeout(r, 400));
  }

  console.log('\n[3/4] All 9 bot workers deployed! Streaming live data from Shopee CDN for 60 seconds...\n');

  const startTime = Date.now();
  let latestMetrics = baseline;

  const monitorInterval = setInterval(async () => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    let totalBytes = 0;
    let activeStreamers = 0;

    for (let i = 0; i < workers.length; i++) {
      const sc = workers[i].streamConsumer;
      if (sc) {
        telemetry[i].bytesStreamed = sc.bytesStreamed;
        telemetry[i].chunksReceived = sc.chunksReceived;
        totalBytes += sc.bytesStreamed;
        if (sc.connected) activeStreamers++;
      }
    }

    // Check live counter every 15 seconds
    if (elapsed % 15 === 0 && elapsed > 0) {
      const fresh = await fetchLiveCounter();
      if (fresh) latestMetrics = fresh;
    }

    const liveViewersOnShopee = latestMetrics ? latestMetrics.viewers : 'N/A';
    console.log(`⏱️ [T+${elapsed}s] Active Bot Streamers: ${activeStreamers}/9 | CDN Ingested: ${(totalBytes / 1024).toFixed(1)} KB | Shopee Server Viewers: ${liveViewersOnShopee}`);
  }, 5000);

  // Run for 60 seconds
  await new Promise(r => setTimeout(r, 60000));
  clearInterval(monitorInterval);

  console.log('\n[4/4] Finalizing telemetry & checking end metrics from Shopee Server...');
  const finalMetrics = await fetchLiveCounter() || latestMetrics;

  let grandTotalBytes = 0;
  for (let i = 0; i < workers.length; i++) {
    const sc = workers[i].streamConsumer;
    if (sc) {
      telemetry[i].bytesStreamed = sc.bytesStreamed;
      telemetry[i].chunksReceived = sc.chunksReceived;
      grandTotalBytes += sc.bytesStreamed;
    }
  }

  console.log('\n========================================================================');
  console.log('📊 LIVE STREAMING AUDIT REPORT: blackone638 ("Hp Murah")');
  console.log('========================================================================');
  console.log(`Baseline Viewers Before Bots : ${baseline ? baseline.viewers : 1}`);
  console.log(`Current Viewers on Shopee    : ${finalMetrics ? finalMetrics.viewers : 'N/A'}`);
  console.log(`Total CDN Ingested Data      : ${(grandTotalBytes / 1024).toFixed(2)} KB (~${(grandTotalBytes / (1024 * 1024)).toFixed(2)} MB)`);
  console.log('------------------------------------------------------------------------');
  console.log('| Bot ID     | Proxy Assigned             | Exit IP        | Status        | Chunks | Bytes Streamed | Heartbeats |');
  console.log('|------------|----------------------------|----------------|---------------|--------|----------------|------------|');
  for (const t of telemetry) {
    const statusText = t.bytesStreamed > 0 ? '🟢 STREAMING' : (t.connected ? '🟡 CONNECTED' : '🔴 OFFLINE');
    console.log(`| ${t.id.padEnd(10)} | ${t.proxy.padEnd(26)} | ${t.exitIp.padEnd(14)} | ${statusText.padEnd(13)} | ${String(t.chunksReceived).padStart(6)} | ${(t.bytesStreamed + ' B').padStart(14)} | ${String(t.heartbeats).padStart(10)} |`);
  }
  console.log('========================================================================\n');

  console.log('Disconnecting all 9 bots gracefully...');
  for (const w of workers) {
    w.stop();
  }
  console.log('All bot connections closed.');
}

run().then(() => {
  console.log('Test completed successfully.');
  process.exit(0);
}).catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
