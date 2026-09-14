const https = require('https');

https.get('https://live.shopee.co.id/multipages/_next/static/chunks/pages/share-1f6dbc21aa9b78d0f14d.js', (res) => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    console.log('Share bundle length:', d.length);
    const apis = d.match(/["'`]\/api\/[^"'`]+/g) || [];
    console.log('APIs found in share bundle:', [...new Set(apis)]);

    const sessions = d.match(/["'`][^"'`]*session[^"'`]*["']/gi) || [];
    const filtered = sessions.filter(s => s.includes('/') || s.includes('http'));
    console.log('Session endpoints:', [...new Set(filtered)]);
  });
});
