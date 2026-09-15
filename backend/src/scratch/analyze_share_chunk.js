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
  const js = await fetch('https://cdngarenanow-a.akamaihd.net/shopee/shopee-livestreaming-live-id/static/js/Share.9aeb3dd9.chunk.js');
  console.log('Share chunk length:', js.length);

  // Search for axios/fetch or session calls
  const matches = js.match(/[\w\.\$]+\.(get|post)\([^\)]+\)/g) || [];
  console.log('HTTP calls found:', matches.slice(0, 10));

  // Search for session
  const sessionIdx = js.indexOf('session_id');
  if (sessionIdx !== -1) {
    console.log('Around session_id:', js.substring(sessionIdx - 150, sessionIdx + 250));
  }

  // Search for play_url or flv
  const flvIdx = js.indexOf('play_url');
  if (flvIdx !== -1) {
    console.log('Around play_url:', js.substring(flvIdx - 150, flvIdx + 250));
  }
}

main();
