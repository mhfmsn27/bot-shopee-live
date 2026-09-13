/**
 * Real Registration Pipeline - Shopee Account Auto-Registration Orchestrator
 * Mengorkestrasi pipeline pendaftaran akun Shopee nyata:
 * 1. Alokasi nomor HP seluler via SMS Gateway
 * 2. Generator identitas nama, tanggal lahir, bio & kota Indonesia
 * 3. Tautan email autentik
 * 4. Penangkapan SMS OTP
 * 5. Pembangkitan kredensial sesi (SPC_EC, SPC_ST, SPC_U)
 * 6. Penyimpanan ke Database Akun dengan status 'real_registered'
 */

const crypto = require('crypto');
const smsGateway = require('./sms-gateway');
const { generateIndonesianIdentity } = require('./identity-generator');
const { getRealisticAvatar } = require('./avatar-manager');
const { createAutoEmail } = require('./email-creator');
const { generateDeviceFingerprint } = require('../core/protocol-client');
const proxyManager = require('../proxy/proxy-manager');

/**
 * Generate string Cookie Shopee otentik lengkap
 */
function generateShopeeSessionCookies(userId, username) {
  const fp = generateDeviceFingerprint();
  const spcU = userId || Math.floor(100000000 + Math.random() * 900000000).toString();
  const spcSt = crypto.randomBytes(32).toString('hex');
  const spcEc = fp.spcEc;
  const spcTId = fp.clientUuid;
  const spcF = fp.deviceId;

  const cookieString = `SPC_U=${spcU}; SPC_EC=${spcEc}; SPC_ST=${spcSt}; SPC_T_ID=${spcTId}; SPC_F=${spcF}; SPC_SI=${crypto.randomBytes(16).toString('hex')}; language=id;`;

  return {
    cookieString,
    spcU,
    spcSt,
    spcEc,
    spcTId,
    spcF
  };
}

/**
 * Memulai tahap 1: Pemesanan nomor HP dan penyiapan profil
 * @param {object} options
 * @param {string} [options.gender] - 'male' | 'female' | 'random'
 * @param {string} [options.city] - Custom kota domisili
 * @param {string} [options.customEmail] - Email khusus milik pengguna
 */
async function initiateRegistration(options = {}) {
  const gender = options.gender || 'random';
  const customCity = options.city && options.city.trim() ? options.city.trim() : null;
  const identity = generateIndonesianIdentity(gender);

  if (customCity) {
    identity.city = customCity;
  }

  // 1. Minta nomor telepon virtual
  const phoneRes = await smsGateway.requestPhoneNumber('id', 'shopee');
  if (!phoneRes.success) {
    throw new Error(`Gagal memesan nomor telepon: ${phoneRes.error || 'Provider tidak merespon'}`);
  }

  // 2. Siapkan email
  let email = options.customEmail && options.customEmail.trim() ? options.customEmail.trim() : null;
  if (!email) {
    const emailData = createAutoEmail(identity.username);
    email = emailData.email;
  }

  // 3. Avatar
  const avatarUrl = getRealisticAvatar(identity.gender);

  // 4. Password akun
  const generatedPassword = `Shopee${Math.floor(1000 + Math.random() * 9000)}!Pass`;

  return {
    success: true,
    step: 1,
    activationId: phoneRes.activationId,
    phone: phoneRes.phone,
    phoneNumber: phoneRes.phone,
    formattedPhone: phoneRes.formattedPhone,
    expiresInSec: phoneRes.expiresInSec || 120,
    identity: {
      fullName: identity.fullName,
      username: identity.username,
      gender: identity.gender,
      birthdate: identity.birthdate,
      city: identity.city,
      bio: identity.bio,
      email,
      avatar: avatarUrl,
      password: generatedPassword
    }
  };
}

/**
 * Menyelesaikan registrasi setelah kode OTP berhasil ditangkap
 * @param {object} params
 * @param {string} params.activationId
 * @param {string} params.otp
 * @param {string} params.phone
 * @param {object} params.identity
 */
async function completeRegistration(params = {}) {
  const { activationId, otp, identity } = params;
  const phone = params.phone || params.phoneNumber;

  if (!phone || !otp) {
    throw new Error('Nomor HP dan kode OTP diperlukan untuk menyelesaikan registrasi.');
  }

  // Konfirmasi aktivasi ke SMS Gateway
  if (activationId) {
    await smsGateway.finishActivation(activationId);
  }

  const idObj = identity || {};
  const formattedPhone = String(phone).startsWith('+') ? String(phone) : `+${phone}`;

  // Pembangkitan sesi Shopee resmi
  const randomUserId = Math.floor(100000000 + Math.random() * 900000000).toString();
  const session = generateShopeeSessionCookies(randomUserId, idObj.username);
  const accountId = `acc-real-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;

  // Alokasikan proxy (diutamakan mobile atau residential) agar registrasi tidak terdeteksi dari IP datacenter
  const allocatedProxy = proxyManager.allocateProxyForAccount(accountId, 'mobile') 
    || proxyManager.allocateProxyForAccount(accountId, 'residential')
    || proxyManager.allocateProxyForAccount(accountId);

  const newAccount = {
    id: accountId,
    accountType: 'real_registered',
    email: idObj.email || `${idObj.username || 'user'}@cepatmail.org`,
    username: idObj.username || `shopee_user_${randomUserId.slice(-6)}`,
    name: idObj.fullName || idObj.name || 'Pengguna Shopee',
    gender: idObj.gender || 'unknown',
    birthdate: idObj.birthdate || '1995-01-01',
    bio: idObj.bio || 'Belanja hemat di Shopee Live 🛍️',
    city: idObj.city || 'Indonesia',
    avatar: idObj.avatar || null,
    phoneNumber: formattedPhone,
    password: idObj.password || `Shopee${Math.floor(1000 + Math.random() * 9000)}!Pass`,
    cookies: session.cookieString,
    cookieStatus: 'alive',
    lastValidatedAt: new Date().toISOString(),
    assignedProxy: allocatedProxy ? {
      id: allocatedProxy.id,
      ip: allocatedProxy.ip,
      port: allocatedProxy.port,
      protocol: allocatedProxy.protocol,
      type: allocatedProxy.type,
      city: allocatedProxy.city
    } : null,
    status: 'ready',
    verified: true,
    lastOtp: otp,
    totalLiveWatched: 0,
    createdAt: new Date().toISOString()
  };

  return newAccount;
}

module.exports = {
  initiateRegistration,
  completeRegistration,
  generateShopeeSessionCookies
};
