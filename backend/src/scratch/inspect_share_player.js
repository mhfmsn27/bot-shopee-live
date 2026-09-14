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

async function inspectSharePlayer() {
  const url = 'https://cdngarenanow-a.akamaihd.net/shopee/shopee-livestreaming-live-id/static/js/Share.9aeb3dd9.chunk.js';
  const js = await fetchUrl(url);
  console.log('Share chunk length:', js.length);
  
  // Search for video tag or player
  let p = 0;
  while ((p = js.indexOf('<video', p)) !== -1) {
    console.log('\nVideo tag match at', p);
    console.log(js.substring(p - 100, p + 300));
    p += 6;
  }

  // Search for setInterval or polling or api calls
  const terms = ['setInterval', 'fetch', 'axios', 'api', 'session', 'player', 'play'];
  for (const t of terms) {
    let pos = 0;
    let c = 0;
    while ((pos = js.indexOf(t, pos)) !== -1 && c < 2) {
      console.log(`\nMatch "${t}" at ${pos}:`);
      console.log(js.substring(Math.max(0, pos - 80), Math.min(js.length, pos + 150)).replace(/\n/g, ' '));
      pos += t.length;
      c++;
    }
  }
}

inspectSharePlayer().catch(console.error);
