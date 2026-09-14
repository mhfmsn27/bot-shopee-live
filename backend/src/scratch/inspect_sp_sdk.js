const https = require('https');

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function inspectSpSdk() {
  const url = 'https://cdngarenanow-a.akamaihd.net/shopee/shopee-livestreaming-live-id/static/js/13.e04147db.chunk.js';
  const js = await fetchUrl(url);

  const keywords = ['getClientCheckData', 'init', 'canvas', 'webgl', 'device', 'fingerprint', 'token'];
  for (const kw of keywords) {
    let p = js.indexOf(kw);
    console.log(`\nKeyword "${kw}" at ${p}`);
    if (p !== -1) {
      console.log(js.substring(Math.max(0, p - 60), Math.min(js.length, p + 140)).replace(/\n/g, ' '));
    }
  }
}

inspectSpSdk().catch(console.error);
