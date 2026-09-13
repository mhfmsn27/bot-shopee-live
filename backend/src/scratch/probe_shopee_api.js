/**
 * Shopee Live API Probe - Auto-Discovery Endpoint Scanner
 * Script ini mencoba berbagai pola URL API Shopee Live untuk menemukan 
 * endpoint yang benar-benar merespons.
 * 
 * Penggunaan: node backend/src/scratch/probe_shopee_api.js <ROOM_ID_ATAU_URL>
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');

// Ambil Room ID dari argumen
let inputRoomId = process.argv[2] || '';
if (!inputRoomId) {
  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  SHOPEE LIVE API PROBE — Endpoint Auto-Discovery');
  console.log('═══════════════════════════════════════════════════════');
  console.log('');
  console.log('  Cara pakai:');
  console.log('    node backend/src/scratch/probe_shopee_api.js <ROOM_ID>');
  console.log('    node backend/src/scratch/probe_shopee_api.js <SHOPEE_LIVE_URL>');
  console.log('');
  console.log('  Contoh:');
  console.log('    node backend/src/scratch/probe_shopee_api.js 123456789');
  console.log('    node backend/src/scratch/probe_shopee_api.js "https://live.shopee.co.id/share?session=123456789"');
  console.log('');
  console.log('  Untuk mendapatkan Room ID:');
  console.log('  1. Buka Shopee di HP → masuk ke Live');
  console.log('  2. Klik Share → Copy Link');
  console.log('  3. Link akan seperti: https://live.shopee.co.id/share?session=XXXXXXX');
  console.log('  4. Angka setelah session= adalah Room ID');
  console.log('');
  process.exit(0);
}

// Parse Room ID dari URL jika perlu
function parseRoomId(input) {
  const str = input.trim();
  if (/^\d+$/.test(str)) return str;
  try {
    const url = new URL(str);
    return url.searchParams.get('session') || url.searchParams.get('session_id') || 
           url.searchParams.get('id') || url.searchParams.get('room_id') || str;
  } catch (e) {
    const match = str.match(/(\d{6,15})/);
    return match ? match[1] : str;
  }
}

const ROOM_ID = parseRoomId(inputRoomId);

const USER_AGENT = 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36 Shopee/3.19.10';

const BASE_HEADERS = {
  'User-Agent': USER_AGENT,
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'id-ID,id;q=0.9',
  'Origin': 'https://live.shopee.co.id',
  'Referer': `https://live.shopee.co.id/live/${ROOM_ID}`,
  'x-api-source': 'rn',
  'x-shopee-language': 'id',
  'sec-ch-ua-mobile': '?1',
  'sec-ch-ua-platform': '"Android"',
};

function probeUrl(targetUrl, method, body) {
  return new Promise((resolve) => {
    const start = Date.now();
    try {
      const parsed = new URL(targetUrl);
      const isHttps = parsed.protocol === 'https:';
      const lib = isHttps ? https : http;
      const headers = { ...BASE_HEADERS };
      let bodyStr = null;
      if (body) {
        bodyStr = JSON.stringify(body);
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = Buffer.byteLength(bodyStr);
      }
      const req = lib.request({
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method,
        headers,
        timeout: 8000,
        rejectUnauthorized: false
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(data); } catch(e) {}
          resolve({
            url: targetUrl, method, status: res.statusCode,
            headers: res.headers,
            body: json || data.substring(0, 500),
            bodyLength: data.length,
            latencyMs: Date.now() - start,
            redirect: res.headers.location || null
          });
        });
      });
      req.on('timeout', () => { req.destroy(); resolve({ url: targetUrl, method, status: 'TIMEOUT', latencyMs: Date.now() - start }); });
      req.on('error', (err) => { resolve({ url: targetUrl, method, status: 'ERROR', error: err.message, latencyMs: Date.now() - start }); });
      if (bodyStr) req.write(bodyStr);
      req.end();
    } catch (err) {
      resolve({ url: targetUrl, method, status: 'PARSE_ERROR', error: err.message, latencyMs: 0 });
    }
  });
}

const PROBE_GROUPS = [
  {
    name: '🔍 ROOM INFO / METADATA',
    endpoints: [
      { url: `https://live.shopee.co.id/api/v1/session/${ROOM_ID}`, method: 'GET' },
      { url: `https://live.shopee.co.id/api/v1/session/${ROOM_ID}/info`, method: 'GET' },
      { url: `https://live.shopee.co.id/api/v2/session/${ROOM_ID}`, method: 'GET' },
      { url: `https://live.shopee.co.id/api/v1/room/${ROOM_ID}`, method: 'GET' },
      { url: `https://live.shopee.co.id/api/v1/room/${ROOM_ID}/info`, method: 'GET' },
      { url: `https://live.shopee.co.id/api/v4/live/room_info?room_id=${ROOM_ID}`, method: 'GET' },
      { url: `https://live.shopee.co.id/api/v1/live/room_info?room_id=${ROOM_ID}`, method: 'GET' },
      { url: `https://live.shopee.co.id/api/v1/live/get_room?session_id=${ROOM_ID}`, method: 'GET' },
      { url: `https://mall.shopee.co.id/api/v4/livestream/get?session_id=${ROOM_ID}`, method: 'GET' },
      { url: `https://shopee.co.id/api/v4/livestream/get?session_id=${ROOM_ID}`, method: 'GET' },
      { url: `https://live.shopee.co.id/api/v1/livestream/get?session_id=${ROOM_ID}`, method: 'GET' },
    ]
  },
  {
    name: '🚪 ENTER / JOIN ROOM',
    endpoints: [
      { url: `https://live.shopee.co.id/api/v1/session/${ROOM_ID}/enter`, method: 'POST', body: { session_id: ROOM_ID } },
      { url: `https://live.shopee.co.id/api/v1/session/${ROOM_ID}/join`, method: 'POST', body: { session_id: ROOM_ID } },
      { url: `https://live.shopee.co.id/api/v1/live/enter_room`, method: 'POST', body: { room_id: ROOM_ID, session_id: ROOM_ID } },
      { url: `https://live.shopee.co.id/api/v2/live/enter_room`, method: 'POST', body: { session_id: ROOM_ID } },
      { url: `https://live.shopee.co.id/api/v1/live/join`, method: 'POST', body: { session_id: ROOM_ID } },
    ]
  },
  {
    name: '💓 HEARTBEAT / PING',
    endpoints: [
      { url: `https://live.shopee.co.id/api/v1/session/${ROOM_ID}/heartbeat`, method: 'POST', body: { session_id: ROOM_ID, seq_id: 1 } },
      { url: `https://live.shopee.co.id/api/v1/live/heartbeat`, method: 'POST', body: { session_id: ROOM_ID, room_id: ROOM_ID } },
      { url: `https://live.shopee.co.id/api/v4/live/heartbeat`, method: 'POST', body: { room_id: ROOM_ID } },
      { url: `https://live.shopee.co.id/api/v1/session/${ROOM_ID}/ping`, method: 'POST', body: { session_id: ROOM_ID } },
    ]
  },
  {
    name: '❤️ LIKE / TAP',
    endpoints: [
      { url: `https://live.shopee.co.id/api/v1/session/${ROOM_ID}/like`, method: 'POST', body: { session_id: ROOM_ID, count: 1 } },
      { url: `https://live.shopee.co.id/api/v1/live/like`, method: 'POST', body: { session_id: ROOM_ID, count: 1 } },
      { url: `https://live.shopee.co.id/api/v1/live/send_like`, method: 'POST', body: { session_id: ROOM_ID, count: 1 } },
    ]
  },
  {
    name: '💬 CHAT / MESSAGE',
    endpoints: [
      { url: `https://live.shopee.co.id/api/v1/session/${ROOM_ID}/message/send`, method: 'POST', body: { session_id: ROOM_ID, content: 'hi' } },
      { url: `https://live.shopee.co.id/api/v1/live/send_message`, method: 'POST', body: { session_id: ROOM_ID, content: 'hi' } },
      { url: `https://live.shopee.co.id/api/v1/live/comment`, method: 'POST', body: { session_id: ROOM_ID, content: 'hi' } },
    ]
  },
  {
    name: '🚪 LEAVE ROOM',
    endpoints: [
      { url: `https://live.shopee.co.id/api/v1/session/${ROOM_ID}/leave`, method: 'POST', body: { session_id: ROOM_ID } },
      { url: `https://live.shopee.co.id/api/v1/live/leave_room`, method: 'POST', body: { session_id: ROOM_ID } },
    ]
  },
  {
    name: '📡 GENERAL API DISCOVERY',
    endpoints: [
      { url: `https://live.shopee.co.id/api/v1/config`, method: 'GET' },
      { url: `https://live.shopee.co.id/api/v1/feed?limit=5`, method: 'GET' },
      { url: `https://live.shopee.co.id/api/v1/live/feed?limit=5`, method: 'GET' },
      { url: `https://live.shopee.co.id/api/v1/live/get_ongoing`, method: 'GET' },
    ]
  }
];

async function runProbe() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  SHOPEE LIVE API PROBE — Endpoint Auto-Discovery');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Room ID: ${ROOM_ID}`);
  console.log(`  Waktu:   ${new Date().toLocaleString('id-ID')}`);
  console.log('═══════════════════════════════════════════════════════');

  const allFound = [];

  for (const group of PROBE_GROUPS) {
    console.log(`\n${group.name}`);
    console.log('─'.repeat(55));

    for (const ep of group.endpoints) {
      const res = await probeUrl(ep.url, ep.method || 'GET', ep.body || null);
      const statusStr = String(res.status);
      let icon = '❌';

      if (statusStr.startsWith('2')) {
        icon = '✅';
        allFound.push({ ...ep, status: res.status, response: res.body, latencyMs: res.latencyMs });
      } else if (statusStr === '401' || statusStr === '403') {
        icon = '🔒';
        allFound.push({ ...ep, status: res.status, response: res.body, latencyMs: res.latencyMs, needsAuth: true });
      } else if (statusStr === '405') {
        icon = '🔧';
        allFound.push({ ...ep, status: res.status, response: res.body, latencyMs: res.latencyMs });
      } else if (statusStr.startsWith('3')) {
        icon = '↪️';
      } else if (statusStr === '404') {
        icon = '  ';
      }

      const shortUrl = ep.url.replace('https://live.shopee.co.id', '').replace('https://shopee.co.id', '//shopee.co.id').replace('https://mall.shopee.co.id', '//mall');
      console.log(`  ${icon} [${statusStr}] ${ep.method} ${shortUrl}  (${res.latencyMs}ms)`);
    }
  }

  console.log('\n');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  📊 RINGKASAN HASIL PROBE');
  console.log('═══════════════════════════════════════════════════════');

  if (allFound.length > 0) {
    console.log(`\n  ${allFound.length} ENDPOINT DITEMUKAN:\n`);
    for (const ep of allFound) {
      const authTag = ep.needsAuth ? ' [PERLU AUTH]' : '';
      console.log(`  → [${ep.status}] ${ep.method} ${ep.url}${authTag}`);
      if (ep.response && typeof ep.response === 'object') {
        console.log(`    Response: ${JSON.stringify(ep.response).substring(0, 300)}`);
      }
      console.log('');
    }
  } else {
    console.log('\n  ⚠️  Tidak ada endpoint yang merespons.');
    console.log('      Pastikan Room ID valid dan live stream sedang aktif.');
  }

  console.log('═══════════════════════════════════════════════════════');
  console.log('  ✅=Aktif  🔒=Perlu Auth  🔧=Method Salah  ↪️=Redirect');
  console.log('═══════════════════════════════════════════════════════\n');
}

runProbe().catch(err => { console.error('Fatal:', err); process.exit(1); });
