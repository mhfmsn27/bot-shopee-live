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

async function inspectLiveSnapshot() {
  const url = 'https://cdngarenanow-a.akamaihd.net/shopee/shopee-livestreaming-live-id/static/js/Share.9aeb3dd9.chunk.js';
  const js = await fetchUrl(url);
  const p = js.indexOf('LiveSnapshot');
  if (p !== -1) {
    console.log('LiveSnapshot around', p);
    console.log(js.substring(p - 100, p + 2000));
  }
}

inspectLiveSnapshot().catch(console.error);
