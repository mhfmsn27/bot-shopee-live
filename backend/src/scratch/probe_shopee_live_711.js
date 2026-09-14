const { SocksProxyAgent } = require('socks-proxy-agent');
const https = require('https');
const { buildSpoofedHeaders, generateDeviceFingerprint } = require('../core/protocol-client');

const proxyUrl = 'socks5://USER085641-zone-custom-region-ID-session-91715830:c7df05@global.rotip.711proxy.com:20000';
const agent = new SocksProxyAgent(proxyUrl);
const roomId = '224524664';

function testReq(name, headers, path = `/api/v1/session/${roomId}`) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'live.shopee.co.id',
      port: 443,
      path,
      method: 'GET',
      headers,
      agent,
      rejectUnauthorized: false
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        console.log(`\n=== [${name}] ===`);
        console.log(`Path: ${path}`);
        console.log(`Status: ${res.statusCode}`);
        console.log(`Headers:`, {
          'content-type': res.headers['content-type'],
          'server': res.headers['server'],
          'set-cookie': res.headers['set-cookie'] ? res.headers['set-cookie'].length : 0
        });
        console.log(`Body (first 250 chars):`, d.substring(0, 250));
        resolve({ status: res.statusCode, body: d });
      });
    });

    req.on('error', (e) => {
      console.log(`=== [${name}] ERROR:`, e.message);
      resolve({ error: e.message });
    });
    req.setTimeout(8000, () => { req.destroy(); resolve({ error: 'timeout' }); });
    req.end();
  });
}

async function run() {
  const fp = generateDeviceFingerprint();

  // Test A: Mobile Browser Headers
  const hA = {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-G981B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'id-ID,id;q=0.9',
    'Referer': `https://live.shopee.co.id/pc/live?session=${roomId}`,
    'Origin': 'https://live.shopee.co.id',
    'x-shopee-client-timezone': 'Asia/Jakarta'
  };
  await testReq('A. Simple Mobile Headers', hA);

  // Test B: First visit the HTML page to obtain initial cookies (like real user)
  console.log('\n--- Test B: Mengunjungi Halaman HTML Utama Dulu untuk Mendapat Cookie Sesi Asli ---');
  const hPage = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8',
    'Upgrade-Insecure-Requests': '1'
  };
  const pageRes = await testReq('B1. Visit HTML Page', hPage, `/pc/live?session=${roomId}`);

  // Test B2: Authenticated RN Header test
  console.log('\n--- Test B2: Menguji dengan Cookie Sesi Shopee & RN Headers ---');
  const testCookie = 'SPC_F=WieXhLnQv4RTmZYs6ps6nsMQxIobVXCY; SPC_CLIENTID=V2llWGhMblF2NFJUurqoicoaffgkfczv; SPC_U=27958959; SPC_R_T_ID=qRWXJg53tND/1TZkl1nb6Vyos4z8Uq/1lzSkSescQuxkDVizBB+dpw87/sILni/bGC+EiVB+ZbREhAWsIbGT9Z5mmjPsf1l8pBAPiWpgcT4mLuG7KBTOz0PvihEJM2V1UeuEqYIrKwEDsUzoYvhS6gJOlaGvQtBtW2+cDrvpP6Y=; SPC_R_T_IV=VnZSZ2t0N0tTbWphbWduMQ==; SPC_IA=1; SPC_CDS_CHAT=45600a24-dcd1-4aab-ae03-3d67342d6917';
  const hAuth = {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 14; SM-A135F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
    'Accept': 'application/json',
    'Accept-Language': 'id-ID,id;q=0.9',
    'Origin': 'https://live.shopee.co.id',
    'Referer': `https://live.shopee.co.id/live/${roomId}`,
    'Cookie': testCookie,
    'x-api-source': 'rn',
    'x-shopee-language': 'id',
    'x-sz-sdk-version': '3.2.1',
    'x-connection-type': 'wifi',
    'sec-ch-ua-mobile': '?1',
    'sec-ch-ua-platform': '"Android"'
  };
  await testReq('B2. Authenticated Session API', hAuth, `/api/v1/session/${roomId}`);

  // Test C: Second Proxy Provided by User
  console.log('\n--- Test C: Menguji Proxy ke-2 dari User (session-81228958) ---');
  const proxy2Url = 'socks5://USER085641-zone-custom-region-ID-session-81228958:c7df05@global.rotip.711proxy.com:20000';
  const agent2 = new SocksProxyAgent(proxy2Url);

  const req2 = https.request({
    hostname: 'live.shopee.co.id',
    port: 443,
    path: `/api/v1/session/${roomId}`,
    method: 'GET',
    headers: hA,
    agent: agent2,
    rejectUnauthorized: false
  }, (res) => {
    let d = '';
    res.on('data', c => d += c);
    res.on('end', () => {
      console.log(`Status Proxy 2: ${res.statusCode}`);
      console.log(`Body: ${d.substring(0, 250)}`);
    });
  });
  req2.on('error', e => console.log('Proxy 2 error:', e.message));
  req2.end();
}

run();
