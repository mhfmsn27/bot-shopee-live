# 🚀 RENCANA PENGEMBANGAN SISTEM SHOPEE LIVE VIEW BOT
## Versi 2.0 - Dari "Teori" ke "Real Production Ready"

---

## 📊 ANALISIS AWAL

### Kondisi Saat Ini

| Aspek | Status | Catatan |
|-------|--------|---------|
| Arsitektur | ⭐⭐⭐⭐⭐ | Modular, terstruktur |
| Dashboard UI | ⭐⭐⭐⭐⭐ | Modern, SSE real-time |
| Database Layer | ⭐⭐⭐⭐ | SQLite dengan encryption |
| Bot Live View Engine | ⭐⭐ | BELUM TERBUKTI |
| Google SSO Pipeline | ⭐⭐ | Anti-detection lemah |
| Account Registration | ⭐ | Cookie kosong semua |

---

## 🎯 TUJUAN PENGEMBANGAN

1. **Bot Live View** → Berfungsi nyata, menambah viewer count Shopee
2. **Account Creation** → Akun Google + Email yang benar-benar bisa login
3. **Anti-Detection** → Tidak terdeteksi sebagai bot oleh Shopee
4. **Validasi Nyata** → Bukti screenshot/video fitur berjalan

---

## 📋 RENCANA PENGEMBANGAN FASE PER FASE

### FASE 1: STABILISASI & KEAMANAN (1-2 Hari)

### 1.1 Hapus Scratch Files

HAPUS folder: ackend/src/scratch/ (50+ file tidak perlu)

### 1.2 Security Fix - Password Encryption

**File:** ackend/src/identity/account-manager.js

SEKARANG (RENTAN):
`json
{ "password": "Shopee4822!Pass" }  // PLAINTEXT!
`

MENJADI: Hapus field password atau encrypt dengan bcrypt

### 1.3 Persistent State Management

SEKARANG (RENTAN):
`javascript
const busyAccountMap = new Map();  // LOST ON RESTART!
`

MENJADI: SQLite tables untuk state management

### 1.4 Cookie Validation yang Kuat

SEKARANG (LEMAH):
`javascript
const hasSpc = cookies.includes('SPC_'); // terlalu lemah!
`

MENJADI: Call Shopee API untuk verify token

---

## FASE 2: BOT LIVE VIEW ENGINE (3-5 Hari)

### 2.1 Enhanced Browser Stealth

**File:** ackend/src/core/browser-live-worker.js

Tambahkan:
`javascript
await page.evaluateOnNewDocument(() => {
  // Canvas fingerprint randomization
  const origGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function(type, ...args) {
    const ctx = origGetContext.call(this, type, ...args);
    if (type === '2d') {
      // Add tiny variations
      const origFillText = ctx.fillText;
      ctx.fillText = function(...a) {
        a[0] = a[0] + '\u200B';
        return origFillText.apply(this, a);
      };
    }
    return ctx;
  };
  
  // WebGL spoofing
  const origGetParameter = WebGLRenderingContext.prototype.getParameter;
  WebGLRenderingContext.prototype.getParameter = function(p) {
    if (p === 37445) return 'Intel Inc.';
    if (p === 37446) return 'Intel Iris OpenGL Engine';
    return origGetParameter.call(this, p);
  };
});
`

### 2.2 Real WebSocket Connection

Shopee Live menggunakan WebSocket untuk real-time:
`javascript
const ws = new WebSocket('wss://msg-api.shopee.co.id/ws');
ws.onopen = () => {
  ws.send(JSON.stringify({
    type: 'join',
    room_id: roomId,
    user_id: userId
  }));
};
`

### 2.3 Human-like Behavior

`javascript
async function humanLikeScroll(page) {
  for (let i = 0; i < 5; i++) {
    await page.mouse.wheel({ deltaY: 100 });
    await delay(Math.random() * 300 + 100);
  }
}

const delay = (min, max) => new Promise(r => setTimeout(r, Math.random() * (max - min) + min));
`

### 2.4 Testing Script

**File:** ackend/test/real_integration_test.js

`javascript
async function testBotLiveView() {
  const roomId = 'ROOM_ID_ANDA'; // Dari environment
  const beforeCount = await getShopeeViewerCount(roomId);
  
  // Jalankan 50 bot
  for (let i = 0; i < 50; i++) {
    workers.push(new BrowserLiveWorker({ roomId }));
    await workers[i].start();
    await delay(500);
  }
  
  await delay(60000); // 1 menit
  
  const afterCount = await getShopeeViewerCount(roomId);
  const increase = afterCount - beforeCount;
  
  if (increase >= 30) {
    console.log('SUCCESS: +' + increase + ' viewers');
  }
}
`

---

## FASE 3: ACCOUNT CREATION (3-5 Hari)

### 3.1 Enhanced Google OAuth

**File:** ackend/src/identity/google-sso-pipeline.js

Tambahkan stealth lanjutan:
`javascript
await page.evaluateOnNewDocument(() => {
  delete navigator.webdriver;
  Object.defineProperty(navigator, 'plugins', {
    get: () => [
      { name: 'Chrome PDF Plugin' },
      { name: 'Chrome PDF Viewer' }
    ]
  });
});

// Human-like typing
async function humanType(page, selector, text) {
  await page.click(selector);
  for (const char of text) {
    await page.keyboard.type(char, { delay: Math.random() * 100 + 50 });
  }
}
`

### 3.2 Real Cookie Capture

`javascript
async function captureShopeeCookies(page) {
  await page.waitForFunction(() => {
    return document.cookie.includes('SPC_ST') && document.cookie.includes('SPC_U');
  }, { timeout: 30000 });
  
  const cookies = await page.cookies(['.shopee.co.id']);
  const spcSt = cookies.find(c => c.name === 'SPC_ST');
  if (!spcSt) throw new Error('Login gagal');
  
  return cookies.map(c => c.name + '=' + c.value).join('; ');
}
`

### 3.3 Email Verification

**File:** ackend/src/identity/email-verification.js (BARU)

`javascript
// Gunakan layanan dengan inbox API
// - temp-mail.org
// - guerrillamail.com
// - emailondeck.com

async function createRealEmail() {
  const email = 'user_' + Date.now() + '@mailnesia.com';
  return { email, provider: 'mailnesia' };
}

async function checkInboxForOtp(email, maxWaitMs = 120000) {
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    const messages = await fetchMailnesiaInbox(email);
    for (const msg of messages) {
      if (msg.from.includes('shopee')) {
        const otp = msg.body.match(/\d{6}/);
        if (otp) return otp[0];
      }
    }
    await delay(5000);
  }
  throw new Error('OTP timeout');
}
`

### 3.4 Complete Registration Pipeline

`javascript
async function registerShopeeAccount(options) {
  const { email, phoneNumber, otp } = options;
  
  await page.goto('https://shopee.co.id/user/register');
  await humanType(page, '#phone-input', phoneNumber);
  await page.click('button[type="submit"]');
  
  const smsOtp = await waitForSmsOtp(phoneNumber);
  await humanType(page, '#otp-input', smsOtp);
  await page.click('button[type="submit"]');
  
  await humanType(page, '#email-input', email);
  await page.click('button[type="submit"]');
  
  const cookies = await captureShopeeCookies(page);
  return { success: true, cookies };
}
`

---

## FASE 4: TESTING & VALIDATION (2-3 Hari)

### 4.1 Test Suite

`javascript
// backend/test/real_integration_tests.js

describe('Real Integration Tests', () => {
  it('Bot Live View menambah viewer count', async () => {
    const roomId = process.env.TEST_ROOM_ID;
    if (!roomId) return; // Skip if no test room
    
    const before = await getViewerCount(roomId);
    await runBots(roomId, 100);
    await delay(60000);
    const after = await getViewerCount(roomId);
    
    expect(after - before).toBeGreaterThanOrEqual(50);
  });
  
  it('Account Creation - cookie valid', async () => {
    const account = await createAccount();
    const valid = await verifyCookie(account.cookies);
    expect(valid).toBe(true);
  });
});
`

### 4.2 Success Criteria

Untuk Bot Live View:
- [ ] 100 bot viewers dijalankan
- [ ] Viewer count bertambah minimal 50 setelah 1 menit
- [ ] Bot bertahan 30 menit tanpa di-kick
- [ ] Screenshot/video bukti

Untuk Account Creation:
- [ ] Akun dengan cookie valid
- [ ] Cookie bisa untuk login
- [ ] Email OTP diterima
- [ ] Akun tidak di-suspend

---

## FASE 5: PRODUCTION HARDENING (2-3 Hari)

### 5.1 Error Handling
- Retry logic dengan exponential backoff
- Circuit breaker pattern

### 5.2 Rate Limiting
`javascript
class RateLimiter {
  constructor(maxPerMinute = 60) {
    this.max = maxPerMinute;
    this.requests = [];
  }
  async acquire() {
    const now = Date.now();
    this.requests = this.requests.filter(t => now - t < 60000);
    if (this.requests.length >= this.max) {
      await delay(60000 - (now - this.requests[0]));
    }
    this.requests.push(Date.now());
  }
}
`

### 5.3 Monitoring
- Structured logging dengan Pino
- Alert on critical events

---

## 📅 TIMELINE

| Fase | Durasi |
|------|--------|
| Fase 1: Stabilisasi | 1-2 hari |
| Fase 2: Bot Live View | 3-5 hari |
| Fase 3: Account Creation | 3-5 hari |
| Fase 4: Testing | 2-3 hari |
| Fase 5: Production | 2-3 hari |
| **Total** | **11-18 hari** |

---

## 📁 FILE BARU YANG AKAN DIBUAT

`
backend/
├── src/
│   ├── core/
│   │   ├── enhanced-browser-worker.js   # Browser worker dengan stealth
│   │   └── shopee-websocket-client.js # WebSocket client
│   ├── identity/
│   │   ├── email-verification.js     # Real inbox checking
│   │   └── shopee-registration.js    # Full registration
│   └── utils/
│       ├── stealth-injector.js        # Anti-detection
│       ├── rate-limiter.js           # Rate limiting
│       └── circuit-breaker.js         # Circuit breaker
├── test/
│   ├── real_integration_tests.js     # Integration tests
│   ├── bot_view_tests.js             # Bot functionality
│   └── account_creation_tests.js     # Account creation
└── scripts/
    └── validate.sh                   # Validation script
`

---

## 🚀 NEXT STEPS

1. **Setujui rencana ini**
2. **Siapkan test room ID Shopee** yang aktif
3. **Mulai Fase 1** (Stabilisasi & Keamanan)
4. **Test dengan room nyata**

---

*Plan dibuat: September 2026*
*Versi: 1.0*
