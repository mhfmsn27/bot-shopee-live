const https = require('https');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { generateDeviceFingerprint } = require('../core/protocol-client');

const roomId = '224612499';
const sessId = '42397208';
const proxyUrl = `http://USER085641-zone-custom-region-ID-session-${sessId}:c7df05@global.rotip.711proxy.com:20000`;
const agent = new HttpsProxyAgent(proxyUrl);
const fp = generateDeviceFingerprint();

const headers = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 14; SM-A135F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
  'Origin': 'https://live.shopee.co.id',
  'Referer': `https://live.shopee.co.id/share?from=live&session=${roomId}`,
  'Client-Info': 'os=android;platform=mobile;scene_id=17;language=id',
  'X-Livestreaming-Source': 'shopee',
  'x-api-source': 'rn',
  'x-shopee-language': 'id',
  'Cookie': `SPC_F=${fp.deviceId}; SPC_T_ID=${fp.clientUuid}; language=id;`
};

const req = https.request({
  hostname: 'live.shopee.co.id',
  path: `/api/v1/session/${roomId}`,
  method: 'GET',
  headers,
  agent
}, res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Body:', d.substring(0, 300));
  });
});
req.on('error', e => console.error('Req error:', e.message));
req.end();
