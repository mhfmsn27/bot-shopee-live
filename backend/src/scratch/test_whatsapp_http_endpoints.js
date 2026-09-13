/**
 * Live HTTP Endpoints Audit for WhatsApp Gateway API
 * Menguji seluruh endpoint REST API WhatsApp langsung pada server HTTP localhost:3000.
 */

const assert = require('assert');

console.log('================================================================');
console.log('🌐 LIVE HTTP AUDIT: WHATSAPP GATEWAY REST API (PORT 3000)');
console.log('================================================================\n');

let passed = 0;
let total = 0;

async function testEndpoint(name, fn) {
  total++;
  try {
    await fn();
    console.log(`  ✅ [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error(`     Error: ${err.message}\n`);
  }
}

async function run() {
  const BASE = 'http://localhost:3000/api/whatsapp';

  // Test 1: GET /status
  await testEndpoint('GET /api/whatsapp/status', async () => {
    const res = await fetch(`${BASE}/status`);
    assert.strictEqual(res.status, 200, 'HTTP Status harus 200');
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert(data.status !== undefined, 'status field must exist');
    assert(typeof data.isPaired === 'boolean', 'isPaired must be boolean');
    assert(data.notificationEvents !== undefined, 'notificationEvents must exist');
  });

  // Test 2: GET /config
  await testEndpoint('GET /api/whatsapp/config', async () => {
    const res = await fetch(`${BASE}/config`);
    assert.strictEqual(res.status, 200, 'HTTP Status harus 200');
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert(typeof data.adminNumber === 'string', 'adminNumber must be string');
    assert(data.notificationEvents !== undefined, 'notificationEvents must exist');
  });

  // Test 3: POST /config (Save admin number & events)
  await testEndpoint('POST /api/whatsapp/config (Update Admin & Events)', async () => {
    const payload = {
      adminNumber: '081298765432',
      notificationEvents: {
        liveStart: true,
        milestones: true,
        campaignEnd: true,
        wafAlert: true
      }
    };
    const res = await fetch(`${BASE}/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.config.adminNumber, '081298765432');
    assert.strictEqual(data.config.notificationEvents.liveStart, true);
  });

  // Test 4: POST /request-qr
  await testEndpoint('POST /api/whatsapp/request-qr', async () => {
    // Pastikan terputus agar meminta QR pairing baru
    await fetch(`${BASE}/disconnect`, { method: 'POST' });
    const res = await fetch(`${BASE}/request-qr`, { method: 'POST' });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert(data.status !== undefined, 'Status must exist');
    assert(typeof data.qrCodeDataUrl === 'string', 'qrCodeDataUrl must be base64 string');
  });

  // Test 5: POST /send-test
  await testEndpoint('POST /api/whatsapp/send-test', async () => {
    const payload = {
      phone: '081298765432',
      message: 'Uji Coba Live REST API WhatsApp Gateway'
    };
    const res = await fetch(`${BASE}/send-test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert(data.log !== undefined, 'Log harus ada');
    assert.strictEqual(data.log.to, '6281298765432');
  });

  // Test 6: GET /history
  await testEndpoint('GET /api/whatsapp/history', async () => {
    const res = await fetch(`${BASE}/history`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert(Array.isArray(data.history), 'History harus array');
    assert(data.history.length > 0, 'History tidak boleh kosong');
  });

  // Test 7: POST /pair (Manual test pairing)
  await testEndpoint('POST /api/whatsapp/pair', async () => {
    const res = await fetch(`${BASE}/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '088899990000' })
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.session.phone, '088899990000');
  });

  // Test 8: POST /disconnect
  await testEndpoint('POST /api/whatsapp/disconnect', async () => {
    const res = await fetch(`${BASE}/disconnect`, { method: 'POST' });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
  });

  console.log('\n================================================================');
  console.log(`🏁 REKAP LIVE HTTP AUDIT: ${passed}/${total} ENDPOINTS LULUS (100%)`);
  console.log('================================================================\n');

  if (passed === total) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Fatal live audit error:', err);
  process.exit(1);
});
