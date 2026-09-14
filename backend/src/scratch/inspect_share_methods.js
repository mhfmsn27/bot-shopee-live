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

async function inspectShareMethods() {
  const url = 'https://cdngarenanow-a.akamaihd.net/shopee/shopee-livestreaming-live-id/static/js/Share.9aeb3dd9.chunk.js';
  const js = await fetchUrl(url);
  
  // Cari semua method di _proto
  const matches = js.match(/_proto\.([a-zA-Z0-9_]+)\s*=/g) || [];
  console.log('Methods in Share chunk:');
  console.log([...new Set(matches)]);

  // Let's inspect componentDidMount or similar
  const p = js.indexOf('componentDidMount');
  if (p !== -1) {
    console.log('\ncomponentDidMount:');
    console.log(js.substring(p, p + 1000));
  }
}

inspectShareMethods().catch(console.error);
