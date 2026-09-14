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

async function inspectFingerprintModule() {
  const mainJs = await fetchUrl('https://cdngarenanow-a.akamaihd.net/shopee/shopee-livestreaming-live-id/static/js/main.f1fe8f92.js');

  const p = mainJs.indexOf('getFingerprint');
  console.log('getFingerprint found at pos:', p);
  let pos = 0;
  while ((pos = mainJs.indexOf('getFingerprint', pos)) !== -1) {
    console.log(`\nMatch at ${pos}:`);
    console.log(mainJs.substring(Math.max(0, pos - 200), Math.min(mainJs.length, pos + 400)).replace(/\n/g, ' '));
    pos += 14;
  }
}

inspectFingerprintModule().catch(console.error);
