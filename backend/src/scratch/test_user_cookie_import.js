const assert = require('assert');
const accountManager = require('../identity/account-manager');
const sqliteManager = require('../db/sqlite-manager');

async function testUserCookieImport() {
  console.log('=== TEST USER COOKIE IMPORT (CHROME DEVTOOLS TABLE) ===');

  const userRawInput = `SPC_CDS_CHAT\t87b0ccaa-c733-4712-8f96-8a02a0a6e4e9\t.shopee.co.id\t/\tSession\t48\tMedium\t
SPC_CLIENTID\tbVVTc01vSm9CanFGwiefzqoexvlxauxn\t.shopee.co.id\t/\t2027-10-18T07:38:09.039Z\t44\tMedium\t
SPC_F\tmUSsMoJoBjqFZvkyguJLhfw9yTS7m8JE\t.shopee.co.id\t/\t2027-10-18T07:37:03.664Z\t37\t✓\tMedium\t
SPC_R_T_ID\tOlmVUBdetpbTt+QdjeTTKIA9xVG036OVl/t0t2BS3IdTUpUMIlBTHhsrpxkioHJbGErLDaVXumyWVJznpFyhXze4CksPNzPEGspPCbaW0pENA94NEBSdLG5AbLy5C0JMykKZ+3NudnYRTRP4AQoAiC5vIPlQ6BNx1Uz0BSqe6XI=\t.shopee.co.id\t/\t2027-10-18T08:05:25.860Z\t182\t✓\tMedium\t
SPC_R_T_IV\takhEMmxHdVppTXZwRW5rcA==\t.shopee.co.id\t/\t2027-10-18T08:05:25.860Z\t34\t✓\tMedium\t
SPC_SEC_SI\tv1-OHB6ZHZMU3R0N2NDSzRxUHtDuuOklN+q5WrrN1xiLC7u0n8RThreDP2R9qQrMVLxxqgq6vExoNK8/Vp+WjfTbQ5SVbAslAsw2zPoHAHbR9s=\tshopee.co.id\t/\t2026-09-14T07:42:38.091Z\t121\t✓\t✓\tMedium\t
SPC_SEC_SI\tv1-R0haSmxxbXBCanVXUzdGUpCOZVzT6dAdPYKS8buO2PCfwncRwe51GmObiosuyYAa+sMWSzfu1WsVSPWvAyUlqw/rVctKc8Ydvi0YzKfr8xc=\tseller.shopee.co.id\t/\t2026-09-14T07:43:17.600Z\t121\t✓\t✓\tMedium\t`;

  // 1. Preview
  const preview = accountManager.parseCookiePreview(userRawInput);
  console.log('1. Preview Result:', preview);
  assert.strictEqual(preview.valid, true);
  assert.strictEqual(preview.detectedFormat, 'chrome_devtools_table');
  assert.ok(preview.detectedTokens.includes('SPC_F'));
  assert.ok(preview.detectedTokens.includes('SPC_R_T_ID'));
  assert.ok(preview.detectedTokens.includes('SPC_SEC_SI'));
  assert.strictEqual(preview.hasAuthTokens, true);

  // 2. Import into vault
  const importResult = accountManager.importRealCookies(userRawInput, {
    accountName: 'Akun Utama Shopee Live (Real Cookie)',
    proxyType: 'residential'
  });
  console.log('2. Import Result: count =', importResult.count, 'format =', importResult.detectedFormat);
  assert.strictEqual(importResult.success, true);
  assert.strictEqual(importResult.count, 1);
  const newAccount = importResult.accounts[0];
  assert.strictEqual(newAccount.accountType, 'real_authenticated');
  assert.strictEqual(newAccount.cookieStatus, 'alive');
  assert.strictEqual(newAccount.name, 'Akun Utama Shopee Live (Real Cookie)');
  assert.ok(newAccount.cookies.includes('SPC_F=mUSsMoJoBjqFZvkyguJLhfw9yTS7m8JE'));
  assert.ok(newAccount.cookies.includes('SPC_SEC_SI=v1-OHB6ZHZMU3R0N2NDSzRx'));

  // 3. Check SQLite At-Rest Encryption
  const rawDbRow = sqliteManager.db.prepare('SELECT cookies, raw_json FROM accounts WHERE id = ?').get(newAccount.id);
  assert.ok(rawDbRow, 'Baris harus ada di database');
  assert.ok(rawDbRow.cookies.startsWith('enc:v1:'), 'Cookie di DB SQLite harus terenkripsi AES-256-GCM!');
  console.log('3. SQLite At-Rest Ciphertext:', rawDbRow.cookies.slice(0, 45) + '...');

  // 4. Validate cookie session status
  const valResult = accountManager.validateSessionCookie(newAccount.id);
  assert.strictEqual(valResult.success, true);
  assert.strictEqual(valResult.status, 'alive');
  console.log('4. Validation Result:', valResult.status);

  // 5. Claim account for campaign
  const claimed = accountManager.claimAccount('test-cmp-live', 'Live Stream Demo', { preferAuthenticated: true });
  assert.ok(claimed, 'Akun harus bisa diklaim');
  console.log('5. Claimed for Campaign:', claimed.name, 'ID:', claimed.id);

  accountManager.releaseAccount(claimed.id);
  console.log('6. Account released successfully.');

  console.log('\n🎉 ALL COOKIE MANAGEMENT TESTS PASSED WITH 100% SUCCESS!');
}

testUserCookieImport().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});
