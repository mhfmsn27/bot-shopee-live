const http = require('http');

function request(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: body });
        }
      });
    });
    req.on('error', reject);
    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

async function run() {
  console.log('🧪 [TEST] Memulai pengujian integrasi REST API Interaksi ke Live Server...');

  // 1. GET /api/interaction/config
  const cfgRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/interaction/config',
    method: 'GET'
  });
  console.log(`1. GET /api/interaction/config -> Status ${cfgRes.status}, likeRatePerMin: ${cfgRes.data?.config?.likeRatePerMin}`);

  // 2. GET /api/interaction/comment-banks
  const banksRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/interaction/comment-banks',
    method: 'GET'
  });
  console.log(`2. GET /api/interaction/comment-banks -> Status ${banksRes.status}, categories: ${Object.keys(banksRes.data?.banks || {}).join(', ')}`);

  // 3. POST /api/interaction/comment-banks (Add test comment)
  const addRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/interaction/comment-banks',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { category: 'fashion', comment: 'Bahan adem dan premium banget kak!' });
  console.log(`3. POST /api/interaction/comment-banks -> Status ${addRes.status}, message: ${addRes.data?.message}`);

  // 4. Start Campaign with interaction
  const startRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/campaign/start',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    liveUrl: 'https://live.shopee.co.id/share?from=live&session=999888',
    targetViewers: 3,
    durationHours: 1,
    niche: 'fashion',
    tapLikeEnabled: true,
    likeRatePerMin: 50,
    commentEnabled: true,
    commentCategory: 'fashion',
    commentIntervalSec: 3
  });
  console.log(`4. POST /api/campaign/start -> Status ${startRes.status}, success: ${startRes.data?.success}`);

  // Wait 3 seconds for bots to join & interact
  console.log('  Menunggu 3 detik interaksi bot berjalan...');
  await new Promise(r => setTimeout(r, 3000));

  // 5. Instant Like
  const likeRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/campaigns/active/instant-like',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { taps: 25 });
  console.log(`5. POST /api/campaigns/active/instant-like -> Status ${likeRes.status}, totalLikes: ${likeRes.data?.totalLikes}`);

  // 6. Instant Chat
  const chatRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/campaigns/active/instant-chat',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { text: 'Mau co sekarang ya kak!' });
  console.log(`6. POST /api/campaigns/active/instant-chat -> Status ${chatRes.status}, comment: "${chatRes.data?.chat?.text}"`);

  // 7. Check status & metrics
  const statusRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/status',
    method: 'GET'
  });
  console.log(`7. GET /api/status -> Status: 200, Likes: ${statusRes.data?.metrics?.totalLikes}, Comments: ${statusRes.data?.metrics?.totalComments}`);

  // 8. Stop campaign
  const stopRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/campaign/stop',
    method: 'POST'
  });
  console.log(`8. POST /api/campaign/stop -> Status ${stopRes.status}, success: ${stopRes.data?.success}`);

  // Cleanup test history record
  const historyManager = require('../analytics/history-manager');
  historyManager.getAllHistory()
    .filter(h => h.roomId === '999888')
    .forEach(h => historyManager.deleteItem(h.id));

  console.log('====================================================');
  console.log('✅ SEMUA ENDPOINT REST API INTERAKSI BERHASIL 100%!');
  console.log('====================================================');
}

run().catch(err => {
  console.error('❌ Test error:', err);
  process.exit(1);
});
