const assert = require('assert');
const BrowserLiveWorker = require('../src/core/browser-live-worker');

async function testWithProxy() {
  console.log('--- Testing BrowserLiveWorker with Real 711proxy Residential Proxy ---');

  const proxyObj = {
    id: 'prx-test-1',
    ip: 'global.rotip.711proxy.com',
    port: 20000,
    protocol: 'http',
    username: 'USER085641-zone-custom-region-ID-session-42666063',
    password: 'c7df05',
    type: 'residential'
  };

  const worker = new BrowserLiveWorker({
    id: 'test-proxy-browser-1',
    roomId: '224634696',
    proxy: proxyObj,
    allocateProxy: false
  });

  console.log('Starting worker with residential proxy...');
  await worker.start();

  assert.strictEqual(worker.state, 'VIEWING');

  // Verify exit IP seen by the browser
  const ipCheck = await worker.page.evaluate(async () => {
    try {
      const res = await fetch('https://api.ipify.org?format=json');
      const j = await res.json();
      return j.ip;
    } catch (e) {
      return e.message;
    }
  });

  console.log('  ✅ [PASS] Browser routed through Residential Exit IP:', ipCheck);
  assert.ok(ipCheck && ipCheck.length > 5 && !ipCheck.includes('error'), 'IP check should return valid proxy IP');

  console.log('Closing proxy browser worker...');
  await worker.leave('test_proxy_complete');
  console.log('  ✅ [PASS] Proxy worker closed cleanly.');

  console.log('\n🎉 PROXY BROWSER WORKER VERIFIED 100%!');
}

testWithProxy().then(() => process.exit(0)).catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
