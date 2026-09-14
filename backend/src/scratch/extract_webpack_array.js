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

async function extractWebpackArray() {
  const mainJs = await fetchUrl('https://cdngarenanow-a.akamaihd.net/shopee/shopee-livestreaming-live-id/static/js/main.f1fe8f92.js');
  console.log('main.js start:');
  console.log(mainJs.substring(0, 500));

  // Find occurrences of "baseURL" or "baseURL:" or "timeout:" or "headers:" or "axios.create"
  const terms = ['baseURL', 'axios.create', 'api/v1', '/api/v1', 'live.shopee'];
  for (const t of terms) {
    let p = 0;
    let cnt = 0;
    while ((p = mainJs.indexOf(t, p)) !== -1 && cnt < 5) {
      console.log(`\nMatch "${t}" at ${p}:`);
      console.log(mainJs.substring(Math.max(0, p - 80), Math.min(mainJs.length, p + 120)).replace(/\n/g, ' '));
      p += t.length;
      cnt++;
    }
  }
}

extractWebpackArray().catch(console.error);
