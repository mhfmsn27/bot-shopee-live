const assert = require('assert');
const BrowserLiveWorker = require('../src/core/browser-live-worker');

async function test() {
  console.log('--- Testing BrowserLiveWorker Initializer & Capabilities ---');

  const worker = new BrowserLiveWorker({
    id: 'test-browser-worker-1',
    roomId: '224634696',
    allocateProxy: false // Direct for unit test
  });

  assert.strictEqual(worker.id, 'test-browser-worker-1');
  assert.strictEqual(worker.roomId, '224634696');
  assert.strictEqual(worker.state, 'INITIAL');
  assert.ok(worker.chromePath, 'Chrome executable harus terdeteksi');
  console.log('  ✅ [PASS] Constructor & Chrome Detection OK (Path: ' + worker.chromePath + ')');

  console.log('--- Testing Browser Launch, Stealth Injection & Teardown ---');
  let connectedFired = false;
  let leaveFired = false;

  worker.on('connected', (data) => {
    connectedFired = true;
    console.log('  ✅ [PASS] Event connected fired with engine:', data.engine);
  });

  worker.on('leave', (data) => {
    leaveFired = true;
    console.log('  ✅ [PASS] Event leave fired with reason:', data.reason);
  });

  // Launch browser worker
  console.log('Launching browser worker test session...');
  await worker.start();

  assert.strictEqual(worker.state, 'VIEWING', 'State harus VIEWING setelah start()');
  assert.ok(connectedFired, 'Event connected harus terpicu');

  // Verify stealth within the running page
  const webdriverVal = await worker.page.evaluate(() => navigator.webdriver);
  assert.strictEqual(webdriverVal, false, 'navigator.webdriver harus false');
  console.log('  ✅ [PASS] Stealth verified: navigator.webdriver ===', webdriverVal);

  const chromeRuntime = await worker.page.evaluate(() => !!window.chrome && !!window.chrome.runtime);
  assert.strictEqual(chromeRuntime, true, 'window.chrome.runtime harus ada');
  console.log('  ✅ [PASS] Stealth verified: window.chrome.runtime exists');

  // Test teardown
  console.log('Closing browser worker...');
  await worker.leave('unit_test_done');

  assert.strictEqual(worker.state, 'STOPPED', 'State harus STOPPED setelah leave()');
  assert.ok(leaveFired, 'Event leave harus terpicu');
  console.log('  ✅ [PASS] Teardown & memory cleanup verified.');

  console.log('\n🎉 ALL BROWSER WORKER UNIT TESTS PASSED 100%!');
}

test().then(() => process.exit(0)).catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
