const { SocksProxyAgent } = require('socks-proxy-agent');
const { HttpsProxyAgent } = require('https-proxy-agent');
const protocolClient = require('../core/protocol-client');
const proxyManager = require('../proxy/proxy-manager');

const roomId = '224612499';
const proxyStr = 'global.rotip.711proxy.com:20000:USER085641-zone-custom-region-ID-session-42666063:c7df05';
const [host, port, user, pass] = proxyStr.split(':');
const proxyUrl = `http://${user}:${pass}@${host}:${port}`;
const agent = new HttpsProxyAgent(proxyUrl);

async function check() {
  console.log('Fetching room info with protocolClient...');
  const res = await protocolClient.fetchLiveRoomInfo(roomId, {
    proxyAgent: agent,
    timeout: 10000
  });
  console.log('Result:', JSON.stringify(res, null, 2));
}

check().catch(console.error);
