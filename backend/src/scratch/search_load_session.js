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
  const chunks = [
    'https://live.shopee.co.id/multipages/_next/static/chunks/pages/share-1f6dbc21aa9b78d0f14d.js',
    'https://live.shopee.co.id/multipages/_next/static/chunks/main-bbef85e93448560afdea.js',
    'https://live.shopee.co.id/multipages/_next/static/chunks/6a599a6a.34a8cec47e42d39ca963.js',
    'https://live.shopee.co.id/multipages/_next/static/chunks/8313d723.415c56bf2f12054a02a2.js'
  ];

  for (const url of chunks) {
    const js = await fetchUrl(url);
    const idx = js.indexOf('loadSession');
    if (idx !== -1) {
      console.log(`Found loadSession in ${url.split('/').pop()} at ${idx}:`);
      console.log(js.substring(Math.max(0, idx - 100), Math.min(js.length, idx + 400)));
    }
  }
}

main();
