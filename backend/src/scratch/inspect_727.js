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

async function inspectModule727() {
  const url = 'https://cdngarenanow-a.akamaihd.net/shopee/shopee-livestreaming-live-id/static/js/Share.9aeb3dd9.chunk.js';
  const js = await fetchUrl(url);
  const p = js.indexOf('727:');
  if (p !== -1) {
    console.log('Module 727:');
    console.log(js.substring(p, p + 3000));
  }
}

inspectModule727().catch(console.error);
