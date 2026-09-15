const https = require('https');

https.get('https://live.shopee.co.id/multipages/_next/static/chunks/4d7af9f83210d7a6b5a203c14138c87d70a7d4cf.b6e61e9e7b876418ff48.js', (res) => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    console.log(d.substring(33000, 35500));
  });
});
