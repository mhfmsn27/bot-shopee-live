const https = require('https');

function fetch(url) {
  return new Promise((resolve) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    }).on('error', () => resolve(''));
  });
}

async function main() {
  const js = await fetch('https://live.shopee.co.id/multipages/_next/static/chunks/pages/share-1f6dbc21aa9b78d0f14d.js');
  console.log('Downloaded JS length:', js.length);
  const matches = js.match(/\/api\/[a-zA-Z0-9_\-\/\.]+/g) || [];
  console.log('API routes found:', [...new Set(matches)]);
  
  // Look for session or live keywords
  const urls = js.match(/https?:\/\/[a-zA-Z0-9_\-\.\/]+/g) || [];
  console.log('HTTP URLs found:', [...new Set(urls)].filter(u => u.includes('shopee')));

  // Look for query params like session
  const sessionMentions = js.match(/.{0,50}session.{0,50}/g) || [];
  console.log('Session mentions sample:', sessionMentions.slice(0, 5));
}

main();
