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

async function main() {
  const mainJs = await fetchUrl('https://cdngarenanow-a.akamaihd.net/shopee/shopee-livestreaming-live-id/static/js/main.f1fe8f92.js');
  let idx = 0;
  while ((idx = mainJs.indexOf('API_VERSION', idx)) !== -1) {
    console.log(`\nAPI_VERSION at ${idx}:`);
    console.log(mainJs.substring(Math.max(0, idx - 50), Math.min(mainJs.length, idx + 200)));
    idx += 11;
  }
}

main();
