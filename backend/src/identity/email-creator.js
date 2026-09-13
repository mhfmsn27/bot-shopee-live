/**
 * Email Creator - Automated Burner / Domain Mailbox Engine
 * Membuat alamat email otomatis dan menyediakan Inbox Listener untuk membaca OTP / Tautan Aktivasi
 */

const crypto = require('crypto');

const EMAIL_DOMAINS = [
  'inboxmail.id',
  'cepatmail.org',
  'tempxmail.com',
  'kilatmail.biz',
  'liveviewbot.net',
  'flashinbox.io'
];

/**
 * Generate alamat email unik berdasarkan username
 * @param {string} username
 * @param {string} [customDomain]
 * @returns {object} { email, mailboxId, token }
 */
function createAutoEmail(username, customDomain) {
  const domain = customDomain || EMAIL_DOMAINS[Math.floor(Math.random() * EMAIL_DOMAINS.length)];
  const cleanUser = (username || 'user').toLowerCase().replace(/[^a-z0-9]/g, '');
  const salt = crypto.randomBytes(3).toString('hex');
  const email = `${cleanUser}.${salt}@${domain}`;
  const mailboxId = Buffer.from(email).toString('base64');
  const token = crypto.randomBytes(16).toString('hex');

  return {
    email,
    mailboxId,
    token,
    domain,
    createdAt: new Date().toISOString()
  };
}

/**
 * Listener simulasi untuk membaca OTP verifikasi Shopee dari inbox email
 * @param {string} email
 * @param {number} timeoutMs
 * @returns {Promise<{otp: string, sender: string, receivedAt: string}>}
 */
async function listenForShopeeOtp(email, timeoutMs = 30000) {
  // Simulasi polling inbox email secara cepat dan efisien
  const delay = Math.floor(Math.random() * 200) + 100;
  await new Promise(resolve => setTimeout(resolve, delay));

  // Generate 6 digit OTP acak khas Shopee
  const simulatedOtp = Math.floor(100000 + Math.random() * 900000).toString();

  return {
    success: true,
    email,
    otp: simulatedOtp,
    sender: 'Shopee Verification <info@shopee.co.id>',
    subject: `Kode Verifikasi Akun Shopee Anda: ${simulatedOtp}`,
    receivedAt: new Date().toISOString()
  };
}

module.exports = {
  createAutoEmail,
  listenForShopeeOtp,
  EMAIL_DOMAINS
};
