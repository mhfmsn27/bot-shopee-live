/**
 * Automated Verification Suite for Single Operator Authentication & Route Guarding
 */

const http = require('http');
const sqliteManager = require('../src/db/sqlite-manager');
const authManager = require('../src/security/auth-manager');

const BASE_URL = 'http://127.0.0.1:3000';

function request(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data
        });
      });
    });
    req.on('error', reject);
    if (postData) {
      req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    }
    req.end();
  });
}

async function runTests() {
  console.log('===============================================================');
  console.log('🧪 RUNNING COMPREHENSIVE AUTHENTICATION & ROUTE GUARD TEST SUITE');
  console.log('===============================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${message}`);
      failed++;
    }
  }

  try {
    // 1. Unauthenticated Route Guard Check (GET /)
    console.log('[Test 1] Verifikasi Server-Side Route Guard untuk Halaman Dashboard (/)');
    const resRoot = await request({
      hostname: '127.0.0.1',
      port: 3000,
      path: '/',
      method: 'GET'
    });
    assert(resRoot.statusCode === 302, `Status code harus 302 Redirect (didapat: ${resRoot.statusCode})`);
    assert(resRoot.headers.location === '/login.html', `Redirect location harus /login.html (didapat: ${resRoot.headers.location})`);

    // 2. Unauthenticated Route Guard Check (GET /index.html)
    console.log('\n[Test 2] Verifikasi Server-Side Route Guard untuk /index.html');
    const resIndex = await request({
      hostname: '127.0.0.1',
      port: 3000,
      path: '/index.html',
      method: 'GET'
    });
    assert(resIndex.statusCode === 302, `Status code harus 302 Redirect (didapat: ${resIndex.statusCode})`);
    assert(resIndex.headers.location === '/login.html', `Redirect location harus /login.html (didapat: ${resIndex.headers.location})`);

    // 3. Unauthenticated Route Guard Check (GET /js/app.js)
    console.log('\n[Test 3] Verifikasi Server-Side Route Guard untuk Aset Internal (/js/app.js)');
    const resAppJs = await request({
      hostname: '127.0.0.1',
      port: 3000,
      path: '/js/app.js',
      method: 'GET'
    });
    assert(resAppJs.statusCode === 302, `Status code harus 302 Redirect (didapat: ${resAppJs.statusCode})`);

    // 4. Public File Check (GET /login.html)
    console.log('\n[Test 4] Verifikasi File Statis Publik (/login.html)');
    const resLogin = await request({
      hostname: '127.0.0.1',
      port: 3000,
      path: '/login.html',
      method: 'GET'
    });
    assert(resLogin.statusCode === 200, `Status code harus 200 OK (didapat: ${resLogin.statusCode})`);
    assert(resLogin.body.includes('Shopee Live View Bot Pro'), 'Halaman login harus memuat judul aplikasi');

    // 5. Public File Check (GET /css/login.css)
    console.log('\n[Test 5] Verifikasi File CSS Publik (/css/login.css)');
    const resLoginCss = await request({
      hostname: '127.0.0.1',
      port: 3000,
      path: '/css/login.css',
      method: 'GET'
    });
    assert(resLoginCss.statusCode === 200, `Status code harus 200 OK (didapat: ${resLoginCss.statusCode})`);

    // 6. Unauthenticated API Guard (GET /api/campaigns)
    console.log('\n[Test 6] Verifikasi Proteksi API (/api/campaigns tanpa token)');
    const resApi = await request({
      hostname: '127.0.0.1',
      port: 3000,
      path: '/api/campaigns',
      method: 'GET'
    });
    assert(resApi.statusCode === 401, `API tanpa token harus mengembalikan 401 Unauthorized (didapat: ${resApi.statusCode})`);
    const apiJson = JSON.parse(resApi.body);
    assert(apiJson.locked === true, 'Response JSON harus memiliki field locked: true');

    // 7. Login Gagal dengan Kredensial Salah
    console.log('\n[Test 7] Verifikasi Login Gagal dengan Password Salah');
    const resWrongPass = await request({
      hostname: '127.0.0.1',
      port: 3000,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { username: 'admin', password: 'wrongPassword123!' });
    assert(resWrongPass.statusCode === 401, `Status code harus 401 (didapat: ${resWrongPass.statusCode})`);
    const wrongJson = JSON.parse(resWrongPass.body);
    assert(wrongJson.success === false, 'success harus false');

    // 8. Login Berhasil dengan Username & Password Standar
    console.log('\n[Test 8] Verifikasi Login Berhasil dengan admin & shopee@admin2026');
    const resLoginSuccess = await request({
      hostname: '127.0.0.1',
      port: 3000,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { username: 'admin', password: 'shopee@admin2026', rememberMe: false });
    assert(resLoginSuccess.statusCode === 200, `Status code harus 200 OK (didapat: ${resLoginSuccess.statusCode})`);
    const loginJson = JSON.parse(resLoginSuccess.body);
    assert(loginJson.success === true, 'Response harus success: true');
    assert(loginJson.username === 'admin', `Username harus admin (didapat: ${loginJson.username})`);
    assert(loginJson.timeoutMinutes === 120, `Default timeoutMinutes harus 120 menit (didapat: ${loginJson.timeoutMinutes})`);

    // Check Set-Cookie
    const setCookie = resLoginSuccess.headers['set-cookie'];
    assert(setCookie && setCookie.length > 0, 'Header Set-Cookie harus ada');
    const cookieStr = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    assert(cookieStr.includes('HttpOnly'), 'Cookie harus memiliki flag HttpOnly');
    assert(cookieStr.includes('SameSite=Strict'), 'Cookie harus memiliki flag SameSite=Strict');
    assert(cookieStr.includes('sb_session='), 'Cookie harus mengandung sb_session');

    // Extract cookie value for subsequent tests
    const sessionCookieMatch = cookieStr.match(/sb_session=([^;]+)/);
    const sessionCookieVal = sessionCookieMatch ? sessionCookieMatch[1] : '';
    const cookieHeader = `sb_session=${sessionCookieVal}`;
    const token = decodeURIComponent(sessionCookieVal);

    // 9. Stateful Session di SQLite Check
    console.log('\n[Test 9] Verifikasi Sesi Tersimpan Secara Stateful di SQLite (auth_sessions)');
    const dbSession = sqliteManager.getSession(token);
    assert(dbSession !== null && dbSession !== undefined, 'Sesi harus ditemukan di database auth_sessions');
    assert(dbSession.username === 'admin', `Sesi di database milik admin (didapat: ${dbSession.username})`);

    // 10. Akses Halaman Dashboard DENGAN Cookie Valid
    console.log('\n[Test 10] Verifikasi Akses Dashboard (/) Menggunakan Cookie Sesi Valid');
    const resRootAuthed = await request({
      hostname: '127.0.0.1',
      port: 3000,
      path: '/',
      method: 'GET',
      headers: { 'Cookie': cookieHeader }
    });
    assert(resRootAuthed.statusCode === 200, `Status code harus 200 OK (didapat: ${resRootAuthed.statusCode})`);
    assert(resRootAuthed.body.includes('Shopee Live View Bot Pro'), 'Dashboard index.html berhasil disajikan');

    // 11. Akses /login.html saat Sudah Login -> Redirect ke /
    console.log('\n[Test 11] Verifikasi Akses /login.html saat Sudah Login (Auto-Redirect ke /)');
    const resLoginRedirect = await request({
      hostname: '127.0.0.1',
      port: 3000,
      path: '/login.html',
      method: 'GET',
      headers: { 'Cookie': cookieHeader }
    });
    assert(resLoginRedirect.statusCode === 302, `Status code harus 302 (didapat: ${resLoginRedirect.statusCode})`);
    assert(resLoginRedirect.headers.location === '/', `Location redirect harus / (didapat: ${resLoginRedirect.headers.location})`);

    // 12. Profil Operator API (/api/auth/user-profile)
    console.log('\n[Test 12] Verifikasi Endpoint Profil Operator (/api/auth/user-profile)');
    const resProfile = await request({
      hostname: '127.0.0.1',
      port: 3000,
      path: '/api/auth/user-profile',
      method: 'GET',
      headers: { 'Cookie': cookieHeader }
    });
    assert(resProfile.statusCode === 200, `Status code harus 200 (didapat: ${resProfile.statusCode})`);
    const profJson = JSON.parse(resProfile.body);
    assert(profJson.data.username === 'admin', `Username profil harus admin (didapat: ${profJson.data.username})`);
    assert(profJson.data.sessionTimeoutMinutes === 120, `Timeout harus 120 menit (didapat: ${profJson.data.sessionTimeoutMinutes})`);

    // 13. Ubah Kredensial Operator (Single User Management)
    console.log('\n[Test 13] Verifikasi Pengubahan Username & Password Operator');
    const resChange = await request({
      hostname: '127.0.0.1',
      port: 3000,
      path: '/api/auth/change-credentials',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': cookieHeader }
    }, {
      oldPassword: 'shopee@admin2026',
      newUsername: 'operator_utama',
      newPassword: 'SuperSecret2026!'
    });
    assert(resChange.statusCode === 200, `Status code harus 200 (didapat: ${resChange.statusCode})`);
    const changeJson = JSON.parse(resChange.body);
    assert(changeJson.username === 'operator_utama', `Username baru harus operator_utama (didapat: ${changeJson.username})`);

    // Check that old session was wiped
    const oldSessionCheck = sqliteManager.getSession(token);
    assert(oldSessionCheck === null, 'Sesi lama harus terhapus/di-revoke seketika dari SQLite saat kredensial diubah');

    // 14. Login dengan Kredensial Baru
    console.log('\n[Test 14] Verifikasi Login Ulang Menggunakan Kredensial Baru (operator_utama)');
    const resLoginNew = await request({
      hostname: '127.0.0.1',
      port: 3000,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { username: 'operator_utama', password: 'SuperSecret2026!' });
    assert(resLoginNew.statusCode === 200, `Login dengan kredensial baru harus 200 OK (didapat: ${resLoginNew.statusCode})`);
    const newLoginCookie = resLoginNew.headers['set-cookie'][0].match(/sb_session=([^;]+)/)[1];
    const newCookieHeader = `sb_session=${newLoginCookie}`;

    // 15. Logout & Revocation Test
    console.log('\n[Test 15] Verifikasi Logout & Penghapusan Sesi Kriptografis dari Database (No Zombie Token)');
    const resLogout = await request({
      hostname: '127.0.0.1',
      port: 3000,
      path: '/api/auth/logout',
      method: 'POST',
      headers: { 'Cookie': newCookieHeader }
    });
    assert(resLogout.statusCode === 200, `Logout harus 200 OK (didapat: ${resLogout.statusCode})`);
    const logoutCookieStr = resLogout.headers['set-cookie'][0];
    assert(logoutCookieStr.includes('Max-Age=0'), 'Header Set-Cookie harus memiliki Max-Age=0 untuk menghapus cookie di browser');

    // Verify token is deleted in SQLite
    const newToken = decodeURIComponent(newLoginCookie);
    const dbSessionAfterLogout = sqliteManager.getSession(newToken);
    assert(dbSessionAfterLogout === null, 'Token sesi harus terhapus permanen dari auth_sessions di SQLite');

    // Subsequent access with logged-out token must fail
    const resAfterLogout = await request({
      hostname: '127.0.0.1',
      port: 3000,
      path: '/api/campaigns',
      method: 'GET',
      headers: { 'Cookie': newCookieHeader }
    });
    assert(resAfterLogout.statusCode === 401, `Token yang sudah di-logout harus ditolak 401 (didapat: ${resAfterLogout.statusCode})`);

    // 16. Inactivity Idle Timeout Simulation
    console.log('\n[Test 16] Simulasi Pemeriksaan Inactivity Idle Timeout di Server');
    // Buat session uji coba di database dengan last_activity_at 125 menit yang lalu (melebihi 120 menit)
    const testIdleSession = authManager.createSession('operator_utama', '127.0.0.1', 'test-agent', false);
    const idleToken = testIdleSession.token;
    // Mundurkan waktu last_activity_at sebesar 125 menit
    const expiredTimestamp = Date.now() - (125 * 60 * 1000);
    sqliteManager.updateSessionActivity(idleToken, expiredTimestamp);

    // Cek verifikasi
    const idleVerification = authManager.verifySessionToken(idleToken);
    assert(idleVerification.valid === false, 'Sesi idle > 120 menit harus invalid (valid: false)');
    assert(idleVerification.idleExpired === true, 'idleExpired harus bernilai true');
    assert(sqliteManager.getSession(idleToken) === null, 'Sesi idle otomatis dihapus dari database SQLite');

    // 17. Kembalikan kredensial ke default admin & shopee@admin2026
    console.log('\n[Test 17] Reset Kredensial Kembali ke Standar (admin & shopee@admin2026, timeout 120m)');
    authManager.changeCredentials('SuperSecret2026!', 'admin', 'shopee@admin2026');
    authManager.updateSettings({ sessionTimeoutMinutes: 120 });
    const finalConfig = authManager.getPublicConfig();
    assert(finalConfig.username === 'admin', `Username akhir harus admin (didapat: ${finalConfig.username})`);
    assert(finalConfig.sessionTimeoutMinutes === 120, `Timeout akhir harus 120 (didapat: ${finalConfig.sessionTimeoutMinutes})`);

    console.log('\n===============================================================');
    console.log(`🎉 TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log('===============================================================');

    if (failed === 0) {
      process.exit(0);
    } else {
      process.exit(1);
    }
  } catch (err) {
    console.error('💥 Test execution error:', err);
    process.exit(1);
  }
}

runTests();
