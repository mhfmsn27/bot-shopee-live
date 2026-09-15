const https = require('https');

function fetchUrl(url) {
  return new Promise((resolve) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    }).on('error', () => resolve(''));
  });
}

async function main() {
  const js = await fetchUrl('https://live.shopee.co.id/multipages/_next/static/chunks/pages/share-1f6dbc21aa9b78d0f14d.js');
  console.log(js.substring(19500, 22000));
}

main();
