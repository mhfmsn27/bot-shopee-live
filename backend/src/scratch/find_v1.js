const https = require('https');

function fetchUrl(url) {
  return new Promise((resolve) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', () => resolve(''));
  });
}

async function findV1Usage() {
  const mainJs = await fetchUrl('https://cdngarenanow-a.akamaihd.net/shopee/shopee-livestreaming-live-id/static/js/main.f1fe8f92.js');
  let idx = 0;
  while ((idx = mainJs.indexOf('/api/v1', idx)) !== -1) {
    console.log(`\nMatch at ${idx}:`);
    console.log(mainJs.substring(Math.max(0, idx - 100), Math.min(mainJs.length, idx + 200)));
    idx += 7;
  }
}

findV1Usage().catch(console.error);
