const assert = require('assert');
const express = require('express');
const http = require('http');
const routes = require('../api/routes');

async function testEndpoint() {
  console.log('Testing POST /api/campaigns/test-connectivity on test server...');

  const app = express();
  app.use(express.json());
  app.use('/api', routes);

  const server = http.createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const payload = JSON.stringify({
    urlOrRoomId: 'https://live.shopee.co.id/share?session=12345678'
  });

  const options = {
    hostname: '127.0.0.1',
    port,
    path: '/api/campaigns/test-connectivity',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  };

  try {
    const resData = await new Promise((resolve, reject) => {
      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(data) }));
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });

    console.log('Response status:', resData.status);
    console.log('Response body:', resData.data);

    assert.strictEqual(resData.status, 200);
    assert.strictEqual(resData.data.success, true);
    assert.strictEqual(resData.data.roomId, '12345678');
    assert.ok(resData.data.antiBotStatus);
    assert.ok(resData.data.antiBotStatus.recommendation);
    console.log('✅ PASS: /api/campaigns/test-connectivity responds with valid diagnostics!');
    process.exit(0);
  } finally {
    await new Promise(r => server.close(r));
  }
}

testEndpoint().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
