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

async function findInVendor() {
  console.log('Fetching vendor bundle...');
  const vendorJs = await fetchUrl('https://cdngarenanow-a.akamaihd.net/shopee/shopee-livestreaming-live-id/static/js/vendor.bundle.66a51905.js');
  console.log('Vendor bundle size:', vendorJs.length);
  
  let pos = 0;
  while ((pos = vendorJs.indexOf('126:', pos)) !== -1) {
    console.log('Found 126: at pos', pos);
    console.log(vendorJs.substring(pos - 50, pos + 800));
    console.log('\n--------------------\n');
    pos += 4;
  }
}

findInVendor().catch(console.error);
