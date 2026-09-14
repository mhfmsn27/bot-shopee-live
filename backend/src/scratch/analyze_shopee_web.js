const https = require('https');
const fs = require('fs');

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

async function analyze() {
  console.log('Fetching main.js...');
  const mainJs = await fetchUrl('https://cdngarenanow-a.akamaihd.net/shopee/shopee-livestreaming-live-id/static/js/main.f1fe8f92.js');
  console.log('main.js size:', mainJs.length);

  // Cari semua URL
  const urls = mainJs.match(/https?:\/\/[a-zA-Z0-9.\-_/]+/g) || [];
  console.log('\n--- URLs found in main.js ---');
  console.log([...new Set(urls)].slice(0, 30));

  // Cari API paths
  const apiPaths = mainJs.match(/\/api\/[a-zA-Z0-9._\-/]+/g) || [];
  console.log('\n--- API paths found in main.js ---');
  console.log([...new Set(apiPaths)]);

  // Cari WSS / WebSocket
  const wss = mainJs.match(/wss?:\/\/[a-zA-Z0-9._\-/]+/g) || [];
  console.log('\n--- WebSocket URLs ---');
  console.log([...new Set(wss)]);

  // Cari chunk Share (chunk 8: 9aeb3dd9)
  // s.p + "static/js/" + ({8: "Share"}[t] || t) + "." + ({8: "9aeb3dd9"}[t]) + ".chunk.js"
  console.log('\nFetching Share chunk (Share.9aeb3dd9.chunk.js)...');
  const shareChunkUrl = 'https://cdngarenanow-a.akamaihd.net/shopee/shopee-livestreaming-live-id/static/js/Share.9aeb3dd9.chunk.js';
  try {
    const shareJs = await fetchUrl(shareChunkUrl);
    console.log('Share chunk size:', shareJs.length);

    const shareApis = shareJs.match(/\/api\/[a-zA-Z0-9._\-/]+/g) || [];
    console.log('\n--- API paths in Share chunk ---');
    console.log([...new Set(shareApis)]);

    const shareWss = shareJs.match(/wss?:\/\/[a-zA-Z0-9._\-/]+/g) || [];
    console.log('\n--- WS in Share chunk ---');
    console.log([...new Set(shareWss)]);

    // Cari teks berkaitan dengan join, viewer, stream, player
    const keywords = ['play_url', 'session_id', 'join', 'leave', 'heartbeat', 'viewer', 'flv', 'm3u8', 'websocket', 'chat', 'ws://', 'wss://'];
    console.log('\n--- Keywords context in Share chunk ---');
    for (const kw of keywords) {
      let pos = 0;
      let count = 0;
      while ((pos = shareJs.indexOf(kw, pos)) !== -1 && count < 3) {
        const snippet = shareJs.substring(Math.max(0, pos - 40), Math.min(shareJs.length, pos + 80));
        console.log(`[${kw}] @ ${pos}: ${snippet.replace(/\n/g, ' ')}`);
        pos += kw.length;
        count++;
      }
    }
  } catch (err) {
    console.error('Error fetching share chunk:', err.message);
  }
}

analyze().catch(console.error);
