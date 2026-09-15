const https = require('https');

function fetchUrl(url) {
  return new Promise((resolve) => {
    https.get(url, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(d));
    }).on('error', () => resolve(''));
  });
}

async function searchShareEvents() {
  const js = await fetchUrl('https://live.shopee.co.id/multipages/_next/static/chunks/pages/share-1f6dbc21aa9b78d0f14d.js');
  console.log('JS length:', js.length);

  // Search for tracking, analytics, log, report, view, or join
  const trackRegex = /track[a-zA-Z0-9_]*|report[a-zA-Z0-9_]*|send[a-zA-Z0-9_]*|join[a-zA-Z0-9_]*/gi;
  const matches = js.match(trackRegex) || [];
  console.log('Keywords found:', [...new Set(matches)].slice(0, 30));

  // Search for tracking URLs
  const urls = js.match(/\/api\/[a-zA-Z0-9_\/]+/g) || [];
  console.log('APIs in share:', [...new Set(urls)]);

  // Let's inspect componentDidMount or useEffect in share
  const mountIdx = js.indexOf('componentDidMount');
  if (mountIdx !== -1) {
    console.log('componentDidMount:', js.substring(mountIdx - 100, mountIdx + 500));
  }
}

searchShareEvents();
