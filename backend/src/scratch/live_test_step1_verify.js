const https = require('https');
const http = require('http');
const { SocksProxyAgent } = require('socks-proxy-agent');
const { HttpsProxyAgent } = require('https-proxy-agent');
const proxyManager = require('../proxy/proxy-manager');
const sqliteManager = require('../db/sqlite-manager');

const targetShortlink = 'https://id.shp.ee/6ynkZXa1';
const proxiesRaw = [
  'global.rotip.711proxy.com:20000:USER085641-zone-custom-region-ID-session-42666063:c7df05',
  'global.rotip.711proxy.com:20000:USER085641-zone-custom-region-ID-session-42397208:c7df05',
  'global.rotip.711proxy.com:20000:USER085641-zone-custom-region-ID-session-87221381:c7df05'
];

async function resolveRedirect(url) {
  return new Promise((resolve) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }, (res) => {
      if (res.headers.location) {
        resolve(res.headers.location);
      } else {
        resolve(url);
      }
    }).on('error', () => resolve(url));
  });
}

function testProxyIp(proxyStr) {
  return new Promise((resolve) => {
    const [host, port, user, pass] = proxyStr.split(':');
    // Try both SOCKS5 and HTTP
    const proxyUrl = `http://${user}:${pass}@${host}:${port}`;
    const agent = new HttpsProxyAgent(proxyUrl);
    const start = Date.now();
    const req = https.get('https://api.ipify.org?format=json', { agent, timeout: 8000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ ok: true, ip: json.ip, latency: Date.now() - start, protocol: 'http' });
        } catch (e) {
          resolve({ ok: false, error: 'Invalid response: ' + data });
        }
      });
    });
    req.on('error', (err) => {
      // Try SOCKS5
      const socksUrl = `socks5://${user}:${pass}@${host}:${port}`;
      const socksAgent = new SocksProxyAgent(socksUrl);
      const req2 = https.get('https://api.ipify.org?format=json', { agent: socksAgent, timeout: 8000 }, (res2) => {
        let d = '';
        res2.on('data', c => d += c);
        res2.on('end', () => {
          try {
            const j = JSON.parse(d);
            resolve({ ok: true, ip: j.ip, latency: Date.now() - start, protocol: 'socks5' });
          } catch (e2) {
            resolve({ ok: false, error: 'Socks failed' });
          }
        });
      });
      req2.on('error', (err2) => resolve({ ok: false, error: err2.message }));
    });
  });
}

function fetchRoomInfoThroughProxy(roomId, proxyStr) {
  return new Promise((resolve) => {
    const [host, port, user, pass] = proxyStr.split(':');
    const proxyUrl = `http://${user}:${pass}@${host}:${port}`;
    const agent = new HttpsProxyAgent(proxyUrl);
    const req = https.get(`https://live.shopee.co.id/api/v1/session/${roomId}`, {
      agent,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Referer': `https://live.shopee.co.id/pc/live?session=${roomId}`
      },
      timeout: 10000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, data: json.data });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data.substring(0, 100) });
        }
      });
    });
    req.on('error', (err) => resolve({ error: err.message }));
  });
}

async function main() {
  console.log('=== STEP 1: RESOLVING TARGET LIVE STREAM ===');
  const finalUrl = await resolveRedirect(targetShortlink);
  console.log('Resolved URL:', finalUrl);
  
  let roomId = null;
  const match = finalUrl.match(/session=(\d+)/);
  if (match) {
    roomId = match[1];
  } else {
    // try numeric match
    const numMatch = finalUrl.match(/\/(\d{7,})/);
    if (numMatch) roomId = numMatch[1];
  }
  console.log('Detected Room/Session ID:', roomId);

  console.log('\n=== STEP 2: TESTING USER PROXIES & FETCHING BASELINE METRICS ===');
  let baselineData = null;
  const proxyResults = [];
  for (let i = 0; i < proxiesRaw.length; i++) {
    const p = proxiesRaw[i];
    console.log(`Testing Proxy [${i + 1}/${proxiesRaw.length}]...`);
    const testRes = await testProxyIp(p);
    console.log(`Proxy ${i + 1}:`, testRes);
    proxyResults.push({ raw: p, test: testRes });

    if (testRes.ok && roomId && !baselineData) {
      console.log(`Querying Live Room Info via Proxy ${i + 1}...`);
      const roomRes = await fetchRoomInfoThroughProxy(roomId, p);
      if (roomRes.data && roomRes.data.session) {
        baselineData = roomRes.data.session;
        console.log('Room Status:', baselineData.status === 1 ? 'ONLINE' : `Status ${baselineData.status}`);
        console.log('Streamer:', baselineData.user_name || baselineData.nickname);
        console.log('Title:', baselineData.title);
        console.log('Baseline Viewer Count:', baselineData.viewer_count || baselineData.view_count || baselineData.online_count || baselineData.member_count);
        console.log('Baseline Likes:', baselineData.like_cnt || baselineData.likes);
      } else {
        console.log('Room response:', roomRes);
      }
    }
  }

  console.log('\n=== STEP 3: IMPORTING PROXIES INTO DATABASE ===');
  for (const p of proxiesRaw) {
    const [host, port, user, pass] = p.split(':');
    const proxyItem = {
      id: `prx-711-${user.slice(-8)}`,
      ip: host,
      port: parseInt(port, 10),
      protocol: 'http',
      type: 'residential',
      username: user,
      password: pass,
      country: 'ID',
      city: 'Jakarta, Indonesia',
      isp: '711proxy Residential Rotating (ID)',
      latency: 120,
      status: 'alive',
      isOnline: true,
      lastChecked: new Date().toISOString(),
      assignedAccountsCount: 0,
      failCount: 0
    };
    sqliteManager.saveProxy(proxyItem);
    console.log(`Saved proxy ${proxyItem.id} to SQLite.`);
  }

  const allDbProxies = sqliteManager.getAllProxies();
  console.log(`Total Proxies in DB now: ${allDbProxies.length}`);

  return { roomId, baselineData, proxyResults };
}

main().then(res => {
  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(res, null, 2));
  process.exit(0);
}).catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
