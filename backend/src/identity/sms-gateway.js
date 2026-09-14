/**
 * SMS Gateway Client & Simulator
 * Mengelola integrasi penyedia SMS Virtual (SMS-Activate, 5SIM, Custom Gateway)
 * serta menyediakan High-Fidelity Simulator untuk pengujian pendaftaran akun Shopee nyata.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONFIG_PATH = path.join(__dirname, '../../data/config.json');

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed.smsGateway) return parsed.smsGateway;
    }
  } catch (e) {
    console.error('Gagal membaca config smsGateway:', e.message);
  }
  return {
    provider: 'simulator',
    apiKey: '',
    customWebhookUrl: '',
    defaultCountry: 'id',
    serviceCode: 'shopee',
    autoCancelTimeoutSec: 120
  };
}

function saveConfig(smsConfig) {
  try {
    let fullConfig = {};
    if (fs.existsSync(CONFIG_PATH)) {
      fullConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8') || '{}');
    }
    fullConfig.smsGateway = { ...loadConfig(), ...smsConfig };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(fullConfig, null, 2), 'utf8');
    return fullConfig.smsGateway;
  } catch (e) {
    console.error('Gagal menyimpan config smsGateway:', e.message);
    return smsConfig;
  }
}

// In-memory simulator storage for pending activations
const activeSimulations = new Map();
// In-memory tracker for live provider activations to manage auto-cancel timeouts
const trackedActivations = new Map();

/**
 * Generate real-looking Indonesian Mobile Phone Number (+628...)
 */
function generateIndonesianPhoneNumber() {
  const prefixes = ['812', '813', '821', '822', '852', '853', '817', '818', '819', '859', '857', '856', '896', '895'];
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  const suffix = Math.floor(10000000 + Math.random() * 90000000).toString().slice(0, 8);
  return `62${prefix}${suffix}`;
}

/**
 * Ambil konfigurasi aktif SMS Gateway
 */
function getConfig() {
  return loadConfig();
}

/**
 * Perbarui konfigurasi provider SMS
 */
function updateConfig(newConfig = {}) {
  return saveConfig(newConfig);
}

/**
 * Cek saldo akun provider SMS dengan estimasi konversi IDR
 */
async function getBalance() {
  const config = loadConfig();
  if (config.provider === 'simulator' || !config.apiKey) {
    return {
      success: true,
      provider: 'simulator',
      mode: 'Simulation Mode (Free)',
      balance: 100.0,
      currency: 'CREDITS',
      formattedBalance: '100.0 CREDITS (Mode Simulasi Bebas Biaya)'
    };
  }

  // Jika menggunakan provider komersial (SMS-Activate / 5SIM)
  try {
    if (config.provider === 'sms-activate') {
      const url = `https://api.sms-activate.org/stubs/handler_api.php?api_key=${encodeURIComponent(config.apiKey)}&action=getBalance`;
      const res = await fetch(url).then(r => r.text());
      if (res.startsWith('ACCESS_BALANCE:')) {
        const bal = parseFloat(res.split(':')[1]) || 0;
        const estIdr = Math.round(bal * 170);
        return {
          success: true,
          provider: 'sms-activate',
          balance: bal,
          currency: 'RUB',
          formattedBalance: `${bal} RUB (~Rp ${estIdr.toLocaleString('id-ID')})`
        };
      }
      return { success: false, provider: 'sms-activate', error: res };
    }

    if (config.provider === '5sim') {
      const url = 'https://5sim.net/v1/user/profile';
      const res = await fetch(url, { headers: { 'Authorization': `Bearer ${config.apiKey}` } }).then(r => r.json());
      if (res && res.balance !== undefined) {
        const bal = parseFloat(res.balance) || 0;
        const currency = res.currency || 'RUB';
        const estIdr = Math.round(bal * 170);
        return {
          success: true,
          provider: '5sim',
          balance: bal,
          currency,
          rating: res.rating,
          formattedBalance: `${bal} ${currency} (~Rp ${estIdr.toLocaleString('id-ID')})`
        };
      }
      return { success: false, provider: '5sim', error: res.message || 'Respon profil 5SIM tidak valid' };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }

  return { success: true, provider: config.provider, balance: 50.0, currency: 'CREDITS' };
}

/**
 * Pesan nomor telepon baru untuk verifikasi Shopee (+62 Indonesia)
 * Mendukung Simulator, SMS-Activate, dan 5SIM
 * @param {string} [country='id']
 * @param {string} [service='shopee']
 */
async function requestPhoneNumber(country = 'id', service = 'shopee') {
  const config = loadConfig();
  const timeoutSec = config.autoCancelTimeoutSec || 120;

  // Mode Simulator / Dev Mode
  if (config.provider === 'simulator' || !config.apiKey) {
    // Bersihkan simulasi usang (> 10 menit) untuk mencegah memory leak
    const now = Date.now();
    for (const [id, rec] of activeSimulations.entries()) {
      if (now - rec.createdAt > 600000) activeSimulations.delete(id);
    }

    const activationId = `act-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const phone = generateIndonesianPhoneNumber();
    const simulatedOtp = Math.floor(100000 + Math.random() * 900000).toString();

    const activationRecord = {
      activationId,
      phone,
      phoneNumber: phone,
      formattedPhone: `+${phone}`,
      country: country || 'id',
      service: service || 'shopee',
      provider: 'simulator',
      otp: simulatedOtp,
      status: 'WAITING_FOR_SMS',
      createdAt: Date.now(),
      timeoutSec
    };

    activeSimulations.set(activationId, activationRecord);

    return {
      success: true,
      mode: 'simulator',
      provider: 'simulator',
      activationId,
      phone: activationRecord.phone,
      phoneNumber: activationRecord.phone,
      formattedPhone: activationRecord.formattedPhone,
      country: activationRecord.country,
      expiresInSec: timeoutSec,
      note: 'Nomor virtual Indonesia dialokasikan. OTP akan siap ditangkap saat polling.'
    };
  }

  // Live Provider: SMS-Activate
  if (config.provider === 'sms-activate') {
    try {
      const countryCode = country === 'id' ? '6' : '6'; // 6 = Indonesia in SMS-Activate
      const serviceCode = 'ka'; // ka = Shopee
      const url = `https://api.sms-activate.org/stubs/handler_api.php?api_key=${encodeURIComponent(config.apiKey)}&action=getNumber&service=${serviceCode}&country=${countryCode}`;
      const res = await fetch(url).then(r => r.text());
      if (res.startsWith('ACCESS_NUMBER:')) {
        const parts = res.split(':');
        const activationId = parts[1];
        const rawPhone = parts[2];
        const cleanPhone = rawPhone.replace(/^\+/, '');
        const formattedPhone = `+${cleanPhone}`;

        trackedActivations.set(activationId, {
          activationId,
          provider: 'sms-activate',
          phone: cleanPhone,
          createdAt: Date.now(),
          timeoutSec
        });

        return {
          success: true,
          mode: 'live',
          provider: 'sms-activate',
          activationId,
          phone: cleanPhone,
          phoneNumber: cleanPhone,
          formattedPhone,
          expiresInSec: timeoutSec
        };
      }
      return { success: false, error: `SMS-Activate error: ${res}` };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // Live Provider: 5SIM
  if (config.provider === '5sim') {
    try {
      const countryName = (country === 'id' || country === '62') ? 'indonesia' : country;
      const operator = 'any';
      const serviceCode = (service === 'ka' || service === 'shopee') ? 'shopee' : service;
      const url = `https://5sim.net/v1/user/buy/activation/${encodeURIComponent(countryName)}/${encodeURIComponent(operator)}/${encodeURIComponent(serviceCode)}`;
      const res = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
          'Accept': 'application/json'
        }
      });
      const json = await res.json();
      if (json && json.id && json.phone) {
        const cleanPhone = String(json.phone).replace(/^\+/, '');
        const formattedPhone = `+${cleanPhone}`;
        const activationId = String(json.id);

        trackedActivations.set(activationId, {
          activationId,
          provider: '5sim',
          phone: cleanPhone,
          createdAt: Date.now(),
          timeoutSec
        });

        return {
          success: true,
          mode: 'live',
          provider: '5sim',
          activationId,
          phone: cleanPhone,
          phoneNumber: cleanPhone,
          formattedPhone,
          operator: json.operator || 'any',
          price: json.price || 0,
          expiresInSec: timeoutSec
        };
      }
      return {
        success: false,
        error: `5SIM Error: ${typeof json === 'string' ? json : (json.message || JSON.stringify(json))}`
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // Fallback simulator jika provider belum tersambung
  const fallbackPhone = generateIndonesianPhoneNumber();
  const fallbackId = `act-${Date.now()}`;
  activeSimulations.set(fallbackId, {
    activationId: fallbackId,
    phone: fallbackPhone,
    phoneNumber: fallbackPhone,
    formattedPhone: `+${fallbackPhone}`,
    otp: Math.floor(100000 + Math.random() * 900000).toString(),
    status: 'WAITING_FOR_SMS',
    createdAt: Date.now(),
    timeoutSec
  });

  return {
    success: true,
    mode: 'simulator',
    provider: 'simulator',
    activationId: fallbackId,
    phone: fallbackPhone,
    phoneNumber: fallbackPhone,
    formattedPhone: `+${fallbackPhone}`,
    expiresInSec: timeoutSec
  };
}

/**
 * Cek / Polling kode OTP yang masuk untuk aktivasi tertentu
 * Mendukung auto-cancel jika timeout tercapai agar saldo pengguna tidak terpotong
 * @param {string} activationId
 */
async function fetchSmsOtp(activationId) {
  const config = loadConfig();

  // Mode Simulator
  if (activeSimulations.has(activationId)) {
    const sim = activeSimulations.get(activationId);
    const elapsedMs = Date.now() - sim.createdAt;

    // Simulasi delay pengiriman SMS operator (siap dalam 500-800ms)
    if (elapsedMs < 600) {
      return {
        success: true,
        status: 'WAITING',
        message: 'Menunggu SMS OTP dari Shopee...'
      };
    }

    sim.status = 'RECEIVED';
    return {
      success: true,
      status: 'RECEIVED',
      otp: sim.otp,
      phone: sim.phone,
      sender: 'SHOPEE_SMS',
      fullText: `[Shopee] Jangan berikan kode ini ke siapa pun. KODE RAHASIA OTP Registrasi Anda: ${sim.otp}`
    };
  }

  // Check auto-cancel timeout untuk live provider tracking
  if (trackedActivations.has(activationId)) {
    const rec = trackedActivations.get(activationId);
    const elapsedMs = Date.now() - rec.createdAt;
    if (elapsedMs > rec.timeoutSec * 1000) {
      // Waktu tunggu habis: batalkan nomor otomatis agar saldo provider tidak terpotong
      await cancelActivation(activationId);
      trackedActivations.delete(activationId);
      return {
        success: false,
        status: 'CANCELLED',
        autoCancelled: true,
        message: `Batas waktu ${rec.timeoutSec} detik tercapai tanpa SMS. Nomor dibatalkan otomatis agar saldo provider Anda tidak terpotong.`
      };
    }
  }

  // Live Provider: SMS-Activate
  if (config.provider === 'sms-activate' && config.apiKey) {
    try {
      const url = `https://api.sms-activate.org/stubs/handler_api.php?api_key=${encodeURIComponent(config.apiKey)}&action=getStatus&id=${encodeURIComponent(activationId)}`;
      const res = await fetch(url).then(r => r.text());
      if (res.startsWith('STATUS_OK:')) {
        const otp = res.split(':')[1];
        return {
          success: true,
          status: 'RECEIVED',
          otp,
          sender: 'Shopee',
          fullText: `[Shopee] Kode OTP: ${otp}`
        };
      }
      if (res === 'STATUS_WAIT_CODE') {
        return { success: true, status: 'WAITING', message: 'Menunggu SMS...' };
      }
      if (res === 'STATUS_CANCEL') {
        trackedActivations.delete(activationId);
        return { success: false, status: 'CANCELLED', message: 'Aktivasi dibatalkan' };
      }
      return { success: false, status: 'UNKNOWN', message: res };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // Live Provider: 5SIM
  if (config.provider === '5sim' && config.apiKey) {
    try {
      const url = `https://5sim.net/v1/user/check/${encodeURIComponent(activationId)}`;
      const res = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
          'Accept': 'application/json'
        }
      });
      const json = await res.json();
      if (json) {
        if (json.sms && Array.isArray(json.sms) && json.sms.length > 0) {
          const latestSms = json.sms[json.sms.length - 1];
          const otpCode = latestSms.code || (latestSms.text ? (latestSms.text.match(/\b\d{6}\b/) || [])[0] : null);
          if (otpCode) {
            return {
              success: true,
              status: 'RECEIVED',
              otp: otpCode,
              phone: json.phone,
              sender: latestSms.sender || 'Shopee',
              fullText: latestSms.text || `[Shopee] Kode OTP: ${otpCode}`
            };
          }
        }
        if (json.status === 'PENDING') {
          return { success: true, status: 'WAITING', message: 'Menunggu SMS dari Shopee...' };
        }
        if (json.status === 'CANCELED' || json.status === 'TIMEOUT') {
          trackedActivations.delete(activationId);
          return { success: false, status: 'CANCELLED', message: 'Aktivasi nomor telah dibatalkan atau timeout di 5SIM' };
        }
        return { success: true, status: 'WAITING', message: `Status: ${json.status}. Menunggu kode SMS...` };
      }
      return { success: false, status: 'UNKNOWN', message: 'Respon tidak valid dari 5SIM' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  return {
    success: false,
    status: 'NOT_FOUND',
    message: 'ID aktivasi nomor tidak ditemukan atau telah kedaluwarsa'
  };
}

/**
 * Batalkan pesanan nomor jika SMS tidak kunjung masuk (saldo aman tidak terpotong)
 * @param {string} activationId
 */
async function cancelActivation(activationId) {
  if (activeSimulations.has(activationId)) {
    activeSimulations.delete(activationId);
    return { success: true, message: 'Simulasi aktivasi nomor berhasil dibatalkan.' };
  }

  trackedActivations.delete(activationId);
  const config = loadConfig();

  if (config.provider === 'sms-activate' && config.apiKey) {
    try {
      const url = `https://api.sms-activate.org/stubs/handler_api.php?api_key=${encodeURIComponent(config.apiKey)}&action=setStatus&status=8&id=${encodeURIComponent(activationId)}`;
      await fetch(url);
      return { success: true, message: 'Nomor dibatalkan ke provider SMS-Activate.' };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  if (config.provider === '5sim' && config.apiKey) {
    try {
      const url = `https://5sim.net/v1/user/cancel/${encodeURIComponent(activationId)}`;
      await fetch(url, {
        headers: { 'Authorization': `Bearer ${config.apiKey}`, 'Accept': 'application/json' }
      });
      return { success: true, message: 'Nomor dibatalkan ke provider 5SIM.' };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  return { success: true };
}

/**
 * Selesaikan aktivasi (konfirmasi SMS OTP diterima)
 * @param {string} activationId
 */
async function finishActivation(activationId) {
  if (activeSimulations.has(activationId)) {
    activeSimulations.delete(activationId);
    return { success: true };
  }

  trackedActivations.delete(activationId);
  const config = loadConfig();

  if (config.provider === 'sms-activate' && config.apiKey) {
    try {
      const url = `https://api.sms-activate.org/stubs/handler_api.php?api_key=${encodeURIComponent(config.apiKey)}&action=setStatus&status=6&id=${encodeURIComponent(activationId)}`;
      await fetch(url);
    } catch (e) {}
  }

  if (config.provider === '5sim' && config.apiKey) {
    try {
      const url = `https://5sim.net/v1/user/finish/${encodeURIComponent(activationId)}`;
      await fetch(url, {
        headers: { 'Authorization': `Bearer ${config.apiKey}`, 'Accept': 'application/json' }
      });
    } catch (e) {}
  }

  return { success: true };
}

module.exports = {
  getConfig,
  updateConfig,
  getBalance,
  requestPhoneNumber,
  fetchSmsOtp,
  cancelActivation,
  finishActivation,
  generateIndonesianPhoneNumber
};
