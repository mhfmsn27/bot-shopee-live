/**
 * Automated Test: SMS Gateway Multi-Provider & Auto-Cancel Pipeline
 */

const assert = require('assert');
const smsGateway = require('../identity/sms-gateway');
const realRegistrationPipeline = require('../identity/real-registration-pipeline');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTests() {
  console.log('🧪 [TEST] Memulai pengujian SMS Gateway Multi-Provider & Assisted Registration Pipeline...');

  // 1. Uji Config & Saldo
  console.log('\n[1] Uji Config & Saldo Provider...');
  const cfg = smsGateway.getConfig();
  assert(cfg && typeof cfg === 'object', 'Config harus berupa object');
  console.log(`    Config aktif: provider=${cfg.provider}`);

  const balance = await smsGateway.getBalance();
  assert.strictEqual(balance.success, true, 'getBalance harus sukses');
  assert(balance.balance !== undefined, 'balance harus terdefinisi');
  console.log(`    Saldo: ${balance.formattedBalance || balance.balance}`);

  // 2. Uji Permintaan Nomor (+62 Indonesia)
  console.log('\n[2] Uji Alokasi Nomor Telepon Indonesia (+62)...');
  const reqRes = await smsGateway.requestPhoneNumber('id', 'shopee');
  assert.strictEqual(reqRes.success, true, 'requestPhoneNumber harus sukses');
  assert(reqRes.activationId, 'Harus mengembalikan activationId');
  assert(reqRes.phone.startsWith('628'), 'Nomor harus format Indonesia (628...)');
  assert(reqRes.formattedPhone.startsWith('+628'), 'Formatted phone harus diawali +628');
  assert.strictEqual(reqRes.expiresInSec > 0, true, 'expiresInSec harus > 0');
  console.log(`    Nomor dialokasikan: ${reqRes.formattedPhone} (Activation ID: ${reqRes.activationId})`);

  // 3. Uji Polling OTP & Delay Realistis
  console.log('\n[3] Uji Polling SMS OTP...');
  // Immediate poll -> harus WAITING (simulasi delay operator seluler)
  const pollImmediate = await smsGateway.fetchSmsOtp(reqRes.activationId);
  console.log(`    Poll 1 (Immediate): status=${pollImmediate.status}`);
  assert.strictEqual(pollImmediate.success, true);
  assert.strictEqual(pollImmediate.status, 'WAITING');

  // Tunggu delay SMS (650ms)
  await sleep(700);

  const pollReady = await smsGateway.fetchSmsOtp(reqRes.activationId);
  console.log(`    Poll 2 (After delay): status=${pollReady.status}, OTP=${pollReady.otp}`);
  assert.strictEqual(pollReady.success, true);
  assert.strictEqual(pollReady.status, 'RECEIVED');
  assert(/^\d{6}$/.test(pollReady.otp), 'OTP harus berupa 6 digit angka');
  assert(pollReady.fullText.includes(pollReady.otp), 'fullText harus memuat kode OTP');

  // 4. Uji Selesaikan Aktivasi
  console.log('\n[4] Uji Penyelesaian Aktivasi...');
  const finishRes = await smsGateway.finishActivation(reqRes.activationId);
  assert.strictEqual(finishRes.success, true);
  console.log('    Aktivasi berhasil diselesaikan.');

  // 5. Uji Pembatalan Nomor (Cancel / Refund protection)
  console.log('\n[5] Uji Pembatalan Nomor (Perlindungan Saldo)...');
  const req2 = await smsGateway.requestPhoneNumber('id', 'shopee');
  const cancelRes = await smsGateway.cancelActivation(req2.activationId);
  assert.strictEqual(cancelRes.success, true);
  console.log('    Nomor berhasil dibatalkan tanpa terpotong saldo.');

  // 6. Uji End-to-End Real Registration Pipeline (Initiate -> OTP -> Complete)
  console.log('\n[6] Uji Pipeline Registrasi Akun Shopee Otentik...');
  const initReg = await realRegistrationPipeline.initiateRegistration({
    gender: 'female',
    city: 'Bandung'
  });
  assert.strictEqual(initReg.success, true);
  assert.strictEqual(initReg.step, 1);
  assert(initReg.identity.username, 'Username harus di-generate');
  assert(initReg.identity.password, 'Password harus di-generate');
  assert.strictEqual(initReg.identity.city, 'Bandung');
  console.log(`    Calon Akun: @${initReg.identity.username} | Domisili: ${initReg.identity.city} | No: ${initReg.formattedPhone}`);

  await sleep(700);
  const otpRes = await smsGateway.fetchSmsOtp(initReg.activationId);
  assert.strictEqual(otpRes.status, 'RECEIVED');

  const compReg = await realRegistrationPipeline.completeRegistration({
    activationId: initReg.activationId,
    otp: otpRes.otp,
    phone: initReg.phone,
    identity: initReg.identity
  });

  assert(compReg.id.startsWith('acc-real-'), 'Account ID harus format acc-real-');
  assert.strictEqual(compReg.accountType, 'real_registered');
  assert.strictEqual(compReg.verified, true);
  assert(compReg.cookies.includes('SPC_U='), 'Cookies harus memuat token SPC_U');
  assert(compReg.cookies.includes('SPC_EC='), 'Cookies harus memuat token SPC_EC');
  assert(compReg.cookies.includes('SPC_ST='), 'Cookies harus memuat token SPC_ST');
  console.log(`    ✅ Akun Resmi Shopee Berhasil Dibuat & Tervalidasi: @${compReg.username} (${compReg.phoneNumber})`);
  console.log(`    Cookie Session Length: ${compReg.cookies.length} chars (SPC_EC, SPC_ST, SPC_U OK)`);

  console.log('\n================================================================');
  console.log('🎉 SEMUA PENGUJIAN SMS GATEWAY & REGISTRATION PIPELINE PASS 100%!');
  console.log('================================================================\n');
}

runTests().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('❌ TEST FAILED:', err);
  process.exit(1);
});
