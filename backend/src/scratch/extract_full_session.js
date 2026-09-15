const https = require('https');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { buildSpoofedHeaders } = require('../core/protocol-client');

const sessionId = '224634696';

async function fetchSession() {
  for (let attempt = 0; attempt < 10; attempt++) {
    const randomSess = Math.floor(Math.random() * 90000000 + 10000000);
    const pUrl = `http://USER085641-zone-custom-region-ID-session-${randomSess}:c7df05@global.rotip.711proxy.com:20000`;
    const agent = new HttpsProxyAgent(pUrl);
    const headers = buildSpoofedHeaders({ roomId: sessionId });

    const res = await new Promise((resolve) => {
      const req = https.request({
        hostname: 'live.shopee.co.id',
        path: `/api/v1/session/${sessionId}`,
        method: 'GET',
        headers,
        agent,
        timeout: 7000
      }, (r) => {
        let d = '';
        r.on('data', c => d += c);
        r.on('end', () => {
          try {
            resolve({ status: r.statusCode, json: JSON.parse(d) });
          } catch(e) {
            resolve({ status: r.statusCode, text: d });
          }
        });
      });
      req.on('error', e => resolve({ error: e.message }));
      req.end();
    });

    if (res.json && res.json.err_code === 0 && res.json.data && res.json.data.session) {
      console.log('SUCCESS on attempt', attempt + 1);
      console.log(JSON.stringify(res.json.data.session, null, 2));
      return res.json.data.session;
    } else {
      console.log(`Attempt ${attempt + 1}: status=${res.status} error=${res.json ? res.json.error : 'err'}`);
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

fetchSession().then(s => {
  if (s) process.exit(0);
  else process.exit(1);
});
