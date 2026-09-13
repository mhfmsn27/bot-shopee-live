/**
 * Shopee Live API Probe WITH Authentication
 * Menggunakan cookie SPC_ asli dari browser
 */
const https = require('https');
const { URL } = require('url');

const ROOM_ID = process.argv[2] || '222231076';

const COOKIE = 'SPC_F=WieXhLnQv4RTmZYs6ps6nsMQxIobVXCY; SPC_CLIENTID=V2llWGhMblF2NFJUurqoicoaffgkfczv; SPC_U=27958959; SPC_R_T_ID=qRWXJg53tND/1TZkl1nb6Vyos4z8Uq/1lzSkSescQuxkDVizBB+dpw87/sILni/bGC+EiVB+ZbREhAWsIbGT9Z5mmjPsf1l8pBAPiWpgcT4mLuG7KBTOz0PvihEJM2V1UeuEqYIrKwEDsUzoYvhS6gJOlaGvQtBtW2+cDrvpP6Y=; SPC_R_T_IV=VnZSZ2t0N0tTbWphbWduMQ==; SPC_IA=1; SPC_CDS_CHAT=45600a24-dcd1-4aab-ae03-3d67342d6917';

// Cookie tambahan dari HttpOnly - PASTE DI SINI JIKA ADA:
const EXTRA_COOKIE = process.argv[3] || '';
const FULL_COOKIE = EXTRA_COOKIE ? `${COOKIE}; ${EXTRA_COOKIE}` : COOKIE;

const UA = 'Mozilla/5.0 (Linux; Android 14; SM-A135F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

function req(targetUrl, method, body) {
  return new Promise((resolve) => {
    const start = Date.now();
    const parsed = new URL(targetUrl);
    const headers = {
      'User-Agent': UA,
      'Accept': 'application/json',
      'Accept-Language': 'id-ID,id;q=0.9',
      'Origin': 'https://live.shopee.co.id',
      'Referer': `https://live.shopee.co.id/live/${ROOM_ID}`,
      'Cookie': FULL_COOKIE,
      'x-api-source': 'rn',
      'x-shopee-language': 'id',
      'x-sz-sdk-version': '3.2.1',
      'x-connection-type': 'wifi',
      'sec-ch-ua-mobile': '?1',
      'sec-ch-ua-platform': '"Android"',
    };
    let bodyStr = null;
    if (body) {
      bodyStr = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }
    const r = https.request({
      hostname: parsed.hostname, path: parsed.pathname + parsed.search,
      method, headers, timeout: 10000, rejectUnauthorized: false
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch(e) {}
        resolve({ url: targetUrl, method, status: res.statusCode, body: json || data.substring(0, 800), latencyMs: Date.now() - start });
      });
    });
    r.on('timeout', () => { r.destroy(); resolve({ url: targetUrl, status: 'TIMEOUT', latencyMs: Date.now() - start }); });
    r.on('error', (e) => { resolve({ url: targetUrl, status: 'ERR', error: e.message, latencyMs: Date.now() - start }); });
    if (bodyStr) r.write(bodyStr);
    r.end();
  });
}

async function run() {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  SHOPEE LIVE API PROBE — WITH AUTHENTICATION');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Room/Session ID: ${ROOM_ID}`);
  console.log(`  Cookie SPC_U: 27958959 (authenticated)`);
  console.log('═══════════════════════════════════════════════════════\n');

  const probes = [
    // ROOM INFO
    { label: 'Room Info v1', url: `https://live.shopee.co.id/api/v1/session/${ROOM_ID}`, method: 'GET' },
    { label: 'Room Info query', url: `https://live.shopee.co.id/api/v1/session/${ROOM_ID}?source=share`, method: 'GET' },

    // JOIN
    { label: 'Join Room', url: `https://live.shopee.co.id/api/v1/session/${ROOM_ID}/join`, method: 'POST', body: {} },
    { label: 'Join w/ payload', url: `https://live.shopee.co.id/api/v1/session/${ROOM_ID}/join`, method: 'POST', body: { session_id: Number(ROOM_ID) } },
    { label: 'Enter Room', url: `https://live.shopee.co.id/api/v1/session/${ROOM_ID}/enter`, method: 'POST', body: { session_id: Number(ROOM_ID) } },

    // VIEWER ACTIONS
    { label: 'Like', url: `https://live.shopee.co.id/api/v1/session/${ROOM_ID}/like`, method: 'POST', body: { count: 1 } },
    { label: 'Heartbeat', url: `https://live.shopee.co.id/api/v1/session/${ROOM_ID}/heartbeat`, method: 'POST', body: { seq_id: 1 } },
    { label: 'Comment', url: `https://live.shopee.co.id/api/v1/session/${ROOM_ID}/comment`, method: 'POST', body: { content: 'keren' } },
    { label: 'Message', url: `https://live.shopee.co.id/api/v1/session/${ROOM_ID}/message`, method: 'POST', body: { content: 'bagus' } },

    // LEAVE
    { label: 'Leave', url: `https://live.shopee.co.id/api/v1/session/${ROOM_ID}/leave`, method: 'POST', body: {} },

    // OTHER PATTERNS
    { label: 'Fetch Comments', url: `https://live.shopee.co.id/api/v1/session/${ROOM_ID}/comment`, method: 'GET' },
    { label: 'Fetch Viewers', url: `https://live.shopee.co.id/api/v1/session/${ROOM_ID}/viewer`, method: 'GET' },
    { label: 'Fetch Products', url: `https://live.shopee.co.id/api/v1/session/${ROOM_ID}/product`, method: 'GET' },
    { label: 'Fetch Info sub', url: `https://live.shopee.co.id/api/v1/session/${ROOM_ID}/info`, method: 'GET' },
    { label: 'Buy ticket', url: `https://live.shopee.co.id/api/v1/session/${ROOM_ID}/buy`, method: 'POST', body: {} },
    { label: 'Follow', url: `https://live.shopee.co.id/api/v1/session/${ROOM_ID}/follow`, method: 'POST', body: {} },
    { label: 'Share', url: `https://live.shopee.co.id/api/v1/session/${ROOM_ID}/share`, method: 'POST', body: {} },
  ];

  for (const p of probes) {
    const res = await req(p.url, p.method, p.body || null);
    const s = String(res.status);
    let icon = '❌';
    if (s.startsWith('2')) icon = '✅';
    else if (s === '403') icon = '🔒';
    else if (s === '401') icon = '🔑';
    else if (s === '404') icon = '  ';
    else if (s === '405') icon = '🔧';

    const short = p.url.replace('https://live.shopee.co.id', '');
    console.log(`${icon} [${s}] ${p.method.padEnd(4)} ${p.label.padEnd(20)} ${short}  (${res.latencyMs}ms)`);
    
    // Tampilkan response untuk endpoint yang merespons (bukan 404)
    if (s !== '404' && res.body && typeof res.body === 'object') {
      const bodyStr = JSON.stringify(res.body);
      if (bodyStr.length > 2) {
        console.log(`   └─ ${bodyStr.substring(0, 250)}`);
      }
    }
  }

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  SELESAI. Endpoint dengan ✅ = siap digunakan bot');
  console.log('  🔒 = cookie kurang (butuh SPC_EC/SPC_ST HttpOnly)');
  console.log('═══════════════════════════════════════════════════════\n');
}

run().catch(e => { console.error(e); process.exit(1); });
