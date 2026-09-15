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

async function findApiRoutes() {
  const mainJs = await fetchUrl('https://cdngarenanow-a.akamaihd.net/shopee/shopee-livestreaming-live-id/static/js/main.f1fe8f92.js');
  const m = mainJs.match(/\/api\/[a-zA-Z0-9_\/]+/g) || [];
  const unique = [...new Set(m)];
  console.log('Total unique API paths:', unique.length);
  console.log('Sample paths:', unique.slice(0, 30));

  // Find occurrences with 'session'
  const sessionPaths = unique.filter(p => p.toLowerCase().includes('session'));
  console.log('Session paths:', sessionPaths);
}

findApiRoutes().catch(console.error);
