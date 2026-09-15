const https = require('https');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { buildSpoofedHeaders } = require('../core/protocol-client');

const sessionId = '224634696';
const proxies = [
  'http://USER085641-zone-custom-region-ID-session-42666063:c7df05@global.rotip.711proxy.com:20000',
  'http://USER085641-zone-custom-region-ID-session-42397208:c7df05@global.rotip.711proxy.com:20000',
  'http://USER085641-zone-custom-region-ID-session-87221381:c7df05@global.rotip.711proxy.com:20000'
];

async function checkProxy(pUrl, idx) {
  return new Promise((resolve) => {
    const agent = new HttpsProxyAgent(pUrl);
    const headers = buildSpoofedHeaders({ roomId: sessionId });
    
    const req = https.request({
      hostname: 'live.shopee.co.id',
      path: `/api/v1/session/${sessionId}`,
      method: 'GET',
      headers,
      agent,
      timeout: 10000
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        console.log(`[Proxy ${idx + 1}] Status:`, res.statusCode);
        console.log(`[Proxy ${idx + 1}] Body:`, d.substring(0, 350));
        resolve({ status: res.statusCode, body: d });
      });
    });
    req.on('error', (err) => {
      console.log(`[Proxy ${idx + 1}] Error:`, err.message);
      resolve({ error: err.message });
    });
    req.end();
  });
}

async function run() {
  for (let i = 0; i < proxies.length; i++) {
    await checkProxy(proxies[i], i);
  }
}

run();
