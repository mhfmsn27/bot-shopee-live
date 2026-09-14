const assert = require('assert');
const http = require('http');
const { PersistentStreamConsumer, createPersistentStreamConsumer } = require('../core/protocol-client');
const ShopeeLiveWorker = require('../core/shopee-live-worker');

async function runTest() {
  console.log('=== TEST: PersistentStreamConsumer & Real Stream Integration ===');

  let serverConnections = 0;
  let serverBytesSent = 0;
  let serverInterval = null;

  // Mock Streaming Server (mensimulasikan CDN HTTP-FLV Live Stream)
  const streamServer = http.createServer((req, res) => {
    serverConnections++;
    res.writeHead(200, {
      'Content-Type': 'video/x-flv',
      'Transfer-Encoding': 'chunked',
      'Connection': 'keep-alive'
    });

    // Kirim chunk video berkala (misal 1KB per 50ms)
    const chunk = Buffer.alloc(1024, 0x42); // 1KB
    serverInterval = setInterval(() => {
      try {
        res.write(chunk);
        serverBytesSent += chunk.length;
      } catch (e) {
        clearInterval(serverInterval);
      }
    }, 50);

    req.on('close', () => {
      clearInterval(serverInterval);
    });
  });

  await new Promise(r => streamServer.listen(0, '127.0.0.1', r));
  const port = streamServer.address().port;
  const streamUrl = `http://127.0.0.1:${port}/live/test-stream.flv`;

  try {
    // 1. Uji PersistentStreamConsumer mandiri
    console.log('[1] Pengujian PersistentStreamConsumer mandiri...');
    const consumer = createPersistentStreamConsumer(streamUrl, { roomId: '123456' });

    let connectedEvent = false;
    let progressCount = 0;

    consumer.on('connected', (data) => {
      connectedEvent = true;
      assert.strictEqual(data.status, 200);
    });

    consumer.on('progress', (p) => {
      progressCount++;
    });

    consumer.start();

    // Tunggu data mengalir selama 400ms
    await new Promise(r => setTimeout(r, 400));

    assert.strictEqual(connectedEvent, true, 'Consumer harus terhubung ke stream server');
    assert.strictEqual(consumer.connected, true, 'Consumer status harus connected');
    assert(consumer.bytesStreamed > 2048, 'Bytes streamed harus lebih besar dari 2KB');
    console.log(`    Consumer streamed: ${consumer.bytesStreamed} bytes, ${consumer.chunksReceived} chunks!`);

    // Stop consumer
    consumer.stop();
    assert.strictEqual(consumer.connected, false, 'Consumer harus disconnected setelah stop()');
    console.log('    ✅ PASS: PersistentStreamConsumer mengalirkan data dan berhenti dengan bersih.');

    // 2. Uji Integrasi ShopeeLiveWorker dengan PersistentStreamConsumer
    console.log('[2] Pengujian Integrasi ShopeeLiveWorker...');
    const worker = new ShopeeLiveWorker({
      roomId: 'room_stream_test',
      account: { name: 'Streamer Tester', username: 'stream_tester' },
      networkTimeout: 1000
    });

    // Set playUrl langsung ke mock stream server
    worker.playUrl = streamUrl;

    // Start stream consumer pada worker
    worker.streamConsumer = createPersistentStreamConsumer(streamUrl, {
      roomId: worker.roomId,
      fingerprint: worker.fingerprint
    });
    worker.streamConsumer.start();

    await new Promise(r => setTimeout(r, 300));

    const metrics = worker.getMetrics();
    assert.strictEqual(metrics.isStreaming, true, 'Worker metrics harus menunjukkan isStreaming: true');
    assert(metrics.streamBytes > 1024, 'streamBytes harus bertambah');
    console.log(`    Worker metrics streaming: isStreaming=${metrics.isStreaming}, streamBytes=${metrics.streamBytes}`);

    // Leave worker
    await worker.leave('test_done');
    assert.strictEqual(worker.streamConsumer, null, 'streamConsumer harus di-cleanup saat leave');
    console.log('    ✅ PASS: ShopeeLiveWorker mengintegrasikan stream consumer dan melakukan cleanup total.');

  } finally {
    if (serverInterval) clearInterval(serverInterval);
    await new Promise(r => streamServer.close(r));
  }

  console.log('\n🎉 ALL PERSISTENT STREAM CONSUMER TESTS PASSED (100% OK)!');
}

runTest().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});
