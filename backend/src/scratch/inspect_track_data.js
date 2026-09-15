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
  let idx = 0;
  while ((idx = js.indexOf('trackData', idx)) !== -1) {
    console.log(`trackData at ${idx}:`);
    console.log(js.substring(Math.max(0, idx - 100), Math.min(js.length, idx + 300)));
    idx += 9;
  }

  let rIdx = 0;
  while ((rIdx = js.indexOf('report', rIdx)) !== -1) {
    console.log(`\nreport at ${rIdx}:`);
    console.log(js.substring(Math.max(0, rIdx - 100), Math.min(js.length, rIdx + 300)));
    rIdx += 6;
  }
}

main();
