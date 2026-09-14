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

async function findModule126() {
  const mainJs = await fetchUrl('https://cdngarenanow-a.akamaihd.net/shopee/shopee-livestreaming-live-id/static/js/main.f1fe8f92.js');
  
  // Look for 126: in webpack bundles
  const regex = /126:\s*function\s*\([^\)]*\)\s*\{/g;
  let match;
  while ((match = regex.exec(mainJs)) !== null) {
    console.log('Match at', match.index);
    console.log(mainJs.substring(match.index, match.index + 2000));
  }
}

findModule126().catch(console.error);
