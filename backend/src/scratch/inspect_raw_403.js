const https = require('https');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { buildSpoofedHeaders } = require('../core/protocol-client');

const roomId = '224612499';
const proxyStr = 'global.rotip.711proxy.com:20000:USER085641-zone-custom-region-ID-session-42666063:c7df05';
const [host, port, user, pass] = proxyStr.split(':');
const proxyUrl = `http://${user}:${pass}@${host}:${port}`;
const agent = new HttpsProxyAgent(proxyUrl);

const headers = buildSpoofedHeaders({ roomId });

const req = https.request({
  hostname: 'live.shopee.co.id',
  port: 443,
  path: `/api/v1/session/${roomId}`,
  method: 'GET',
  headers,
  agent
}, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Headers:', res.headers);
    console.log('Body:', data);
  });
});
req.on('error', console.error);
req.end();
