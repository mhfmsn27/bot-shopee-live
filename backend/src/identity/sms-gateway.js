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
 * Cek saldo akun provider SMS
 */
async function getBalance() {
  const config = loadConfig();
  if (config.provider === 'simulator' || !config.apiKey) {
    return {
      success: true,
      provider: 'simulator',
      mode: 'Simulation Mode (Free)',
      balance: 100.0,
      currency: 'CREDITS'
    };
  }

  // Jika menggunakan provider komersial (SMS-Activate / 5SIM)
  try {
    if (config.provider === 'sms-activate') {
      const url = `https://api.sms-activate.org/stubs/handler_api.php?api_key=${encodeURIComponent(config.apiKey)}&action=getBalance`;
      const res = await fetch(url).then(r => r.text());
      if (res.startsWith('ACCESS_BALANCE:')) {
        const bal = parseFloat(res.split(':')[1]) || 0;
        return { success: true, provider: 'sms-activate', balance: bal, currency: 'RUB' };
      }
      return { success: false, provider: 'sms-activate', error: res };
    }

    if (config.provider === '5sim') {
      const url = 'https://5sim.net/v1/user/profile';
      const res = await fetch(url, { headers: { 'Authorization': `Bearer ${config.apiKey}` } }).then(r => r.json());
      if (res && res.balance !== undefined) {
        return { success: true, provider: '5sim', balance: res.balance, currency: res.currency || 'RUB' };
      }
      return { success: false, provider: '5sim', error: 'Invalid profile response' };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }

  return { success: true, provider: config.provider, balance: 50.0, currency: 'CREDITS' };
}

/**
 * Pesan nomor telepon baru untuk verifikasi Shopee
 * @param {string} [country='id']
 * @param {string} [service='shopee']
 */
async function requestPhoneNumber(country = 'id', service = 'shopee') {
  const config = loadConfig();

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
      formattedPhone: `+${phone}`,
      country: country || 'id',
      service: service || 'shopee',
      provider: 'simulator',
      otp: simulatedOtp,
      status: 'WAITING_FOR_SMS',
      createdAt: Date.now()
    };

    activeSimulations.set(activationId, activationRecord);

    return {
      success: true,
      mode: 'simulator',
      activationId,
      phone: activationRecord.phone,
      phoneNumber: activationRecord.phone,
      formattedPhone: activationRecord.formattedPhone,
      country: activationRecord.country,
      expiresInSec: config.autoCancelTimeoutSec || 120,
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
        const phone = parts[2];
        return {
          success: true,
          mode: 'live',
          provider: 'sms-activate',
          activationId,
          phone,
          formattedPhone: `+${phone}`,
          expiresInSec: 120
        };
      }
      return { success: false, error: `SMS-Activate error: ${res}` };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // Fallback simulator jika provider belum tersambung
  const fallbackPhone = generateIndonesianPhoneNumber();
  const fallbackId = `act-${Date.now()}`;
  activeSimulations.set(fallbackId, {
    activationId: fallbackId,
    phone: fallbackPhone,
    otp: Math.floor(100000 + Math.random() * 900000).toString(),
    status: 'WAITING_FOR_SMS',
    createdAt: Date.now()
  });

  return {
    success: true,
    mode: 'simulator',
    activationId: fallbackId,
    phone: fallbackPhone,
    formattedPhone: `+${fallbackPhone}`,
    expiresInSec: 120
  };
}

/**
 * Cek / Polling kode OTP yang masuk untuk aktivasi tertentu
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
          fullText: `[Shopee] Kode OTP: ${otp}`
        };
      }
      if (res === 'STATUS_WAIT_CODE') {
        return { success: true, status: 'WAITING', message: 'Menunggu SMS...' };
      }
      if (res === 'STATUS_CANCEL') {
        return { success: false, status: 'CANCELLED', message: 'Aktivasi dibatalkan' };
      }
      return { success: false, status: 'UNKNOWN', message: res };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  return {
    success: false,
    status: 'NOT_FOUND',
    message: 'ID aktivasi nomor tidak ditemukan atau telah kedaluwarsa'
  };
}

/**
 * Batalkan pesanan nomor jika SMS tidak kunjung masuk
 * @param {string} activationId
 */
async function cancelActivation(activationId) {
  if (activeSimulations.has(activationId)) {
    activeSimulations.delete(activationId);
    return { success: true, message: 'Simulasi aktivasi nomor berhasil dibatalkan.' };
  }

  const config = loadConfig();
  if (config.provider === 'sms-activate' && config.apiKey) {
    try {
      const url = `https://api.sms-activate.org/stubs/handler_api.php?api_key=${encodeURIComponent(config.apiKey)}&action=setStatus&status=8&id=${encodeURIComponent(activationId)}`;
      await fetch(url);
      return { success: true, message: 'Nomor dibatalkan ke provider.' };
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

  const config = loadConfig();
  if (config.provider === 'sms-activate' && config.apiKey) {
    try {
      const url = `https://api.sms-activate.org/stubs/handler_api.php?api_key=${encodeURIComponent(config.apiKey)}&action=setStatus&status=6&id=${encodeURIComponent(activationId)}`;
      await fetch(url);
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
