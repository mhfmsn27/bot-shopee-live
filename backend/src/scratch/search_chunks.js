const https = require('https');

const chunks = [
  '/multipages/_next/static/chunks/main-bbef85e93448560afdea.js',
  '/multipages/_next/static/chunks/pages/_app-dbc06a3841864da44dcb.js',
  '/multipages/_next/static/chunks/pages/share-1f6dbc21aa9b78d0f14d.js',
  '/multipages/_next/static/chunks/2a3e82bf55782fe5a0e4fb7e1f57aba5ed2412c3.78aae7c0a84f00470c30.js',
  '/multipages/_next/static/chunks/4d7af9f83210d7a6b5a203c14138c87d70a7d4cf.b6e61e9e7b876418ff48.js'
];

async function fetchFile(path) {
  return new Promise((resolve) => {
    https.get('https://live.shopee.co.id' + path, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(d));
    }).on('error', () => resolve(''));
  });
}

(async () => {
  for (const c of chunks) {
    const content = await fetchFile(c);
    console.log(`\n=== Chunk: ${c} (${content.length} bytes) ===`);
    const apis = content.match(/["'`]\/api\/[^"'`]+/g) || [];
    if (apis.length > 0) {
      console.log('  APIs:', [...new Set(apis)].slice(0, 10));
    }
    const endpoints = content.match(/https?:\/\/[^"'`\s]+/g) || [];
    const shopeeEndpoints = endpoints.filter(e => e.includes('shopee'));
    if (shopeeEndpoints.length > 0) {
      console.log('  Shopee URLs:', [...new Set(shopeeEndpoints)].slice(0, 10));
    }
  }
})();
