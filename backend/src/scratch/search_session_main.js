const https = require('https');

function fetchUrl(url) {
  return new Promise((resolve) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', () => resolve(''));
  });
}

async function findSessionCalls() {
  const mainJs = await fetchUrl('https://cdngarenanow-a.akamaihd.net/shopee/shopee-livestreaming-live-id/static/js/main.f1fe8f92.js');
  console.log('mainJs length:', mainJs.length);
  
  // Cari substring "/api/v1/session"
  let idx = 0;
  while ((idx = mainJs.indexOf('/api/v1/session', idx)) !== -1) {
    console.log(`\nFound at ${idx}:`);
    console.log(mainJs.substring(Math.max(0, idx - 100), Math.min(mainJs.length, idx + 250)));
    idx += 15;
  }

  // Cari substring "play_url"
  let pIdx = 0;
  let count = 0;
  while ((pIdx = mainJs.indexOf('play_url', pIdx)) !== -1 && count < 3) {
    console.log(`\nPlay URL at ${pIdx}:`);
    console.log(mainJs.substring(Math.max(0, pIdx - 100), Math.min(mainJs.length, pIdx + 200)));
    pIdx += 8;
    count++;
  }
}

findSessionCalls().catch(console.error);
