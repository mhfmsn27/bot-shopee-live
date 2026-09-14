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

async function searchMain() {
  const mainJs = await fetchUrl('https://cdngarenanow-a.akamaihd.net/shopee/shopee-livestreaming-live-id/static/js/main.f1fe8f92.js');
  
  const searchTerms = [
    '/session/',
    'play_url',
    'chatroom',
    '/join',
    'heartbeat',
    '/like',
    '/message',
    'viewer_count',
    'watch',
    'streaming',
    'flv',
    'hls'
  ];

  for (const term of searchTerms) {
    console.log(`\n=================== SEARCH: ${term} ===================`);
    let pos = 0;
    let count = 0;
    while ((pos = mainJs.indexOf(term, pos)) !== -1 && count < 5) {
      const start = Math.max(0, pos - 100);
      const end = Math.min(mainJs.length, pos + 150);
      console.log(`[Pos ${pos}]:`);
      console.log(mainJs.substring(start, end).replace(/\n/g, ' '));
      pos += term.length;
      count++;
    }
    if (count === 0) {
      console.log('Not found');
    }
  }
}

searchMain().catch(console.error);
