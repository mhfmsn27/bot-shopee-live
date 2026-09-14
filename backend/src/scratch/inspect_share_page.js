const https = require('https');

https.get('https://live.shopee.co.id/share?from=live&session=224524664', (res) => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    const regex = /src=["']([^"']+\.js[^"']*)["']/g;
    let match;
    console.log('Script sources:');
    while ((match = regex.exec(d)) !== null) {
      console.log(' -', match[1]);
    }
  });
});

