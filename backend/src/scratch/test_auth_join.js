const { enterLiveRoom, buildSpoofedHeaders } = require('../core/protocol-client');
const sqliteManager = require('../db/sqlite-manager');
const { HttpsProxyAgent } = require('https-proxy-agent');

const SESSION_ID = '224634696';
const pUrl = 'http://USER085641-zone-custom-region-ID-session-42666063:c7df05@global.rotip.711proxy.com:20000';
const agent = new HttpsProxyAgent(pUrl);

const accounts = sqliteManager.getAllAccounts().filter(a => a.cookies && a.cookies.length > 20);
console.log('Found authenticated accounts:', accounts.length);

async function testJoin() {
  const acc = accounts[0];
  console.log('Testing join with account:', acc.username);
  
  const res = await enterLiveRoom(SESSION_ID, {
    cookie: acc.cookies,
    proxyAgent: agent,
    timeout: 8000
  });

  console.log('enterLiveRoom Result:', JSON.stringify(res, null, 2));
}

testJoin();
