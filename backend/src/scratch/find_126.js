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

async function findWebpack126() {
  const mainJs = await fetchUrl('https://cdngarenanow-a.akamaihd.net/shopee/shopee-livestreaming-live-id/static/js/main.f1fe8f92.js');
  
  // Cari substring "126:"
  let pos = 0;
  while ((pos = mainJs.indexOf('126:', pos)) !== -1) {
    console.log('Found 126: at pos', pos);
    console.log(mainJs.substring(pos - 50, pos + 800));
    console.log('\n--------------------\n');
    pos += 4;
  }
}

findWebpack126().catch(console.error);
