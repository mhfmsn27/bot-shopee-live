/**
 * Server Entrypoint - Shopee Live View Bot Application
 * Melayani antarmuka Web Dashboard dan REST API Backend dengan Server-Side Route Guarding
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const apiRoutes = require('./api/routes');
const retentionController = require('./core/retention-controller');
const authManager = require('./security/auth-manager');

const app = express();
const PORT = process.env.PORT || 3000;

// Helper: Ekstraksi session token dari Cookie, Header, atau Query Param
function extractSessionToken(req) {
  // 1. Authorization Bearer header
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  // 2. HttpOnly Cookie 'sb_session'
  if (req.headers.cookie) {
    const match = req.headers.cookie.match(/(?:^|;\s*)sb_session=([^;]+)/);
    if (match) {
      return decodeURIComponent(match[1]);
    }
  }
  // 3. Query param token (e.g. for SSE stream-events)
  if (req.query && req.query.token) {
    return req.query.token;
  }
  return '';
}

// Middleware Dasar
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Enterprise Security Headers Middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

const frontendPath = path.join(__dirname, '../../frontend');

// ============================================================================
// 1. SERVER-SIDE ROUTE GUARD (Memblokir akses ke halaman & aset jika belum login)
// ============================================================================
app.use((req, res, next) => {
  // Lewatkan request API agar ditangani oleh API Guard terpisah
  if (req.path.startsWith('/api')) {
    return next();
  }

  // File statis publik yang diizinkan untuk dibuka tanpa login
  const publicStaticPaths = [
    '/login.html',
    '/css/login.css',
    '/favicon.ico'
  ];

  if (publicStaticPaths.includes(req.path)) {
    // Jika pengguna sudah memiliki sesi valid dan membuka /login.html, redirect langsung ke dashboard
    if (req.path === '/login.html') {
      const token = extractSessionToken(req);
      const verification = authManager.verifySessionToken(token);
      if (verification.valid) {
        return res.redirect('/');
      }
    }
    return next();
  }

  // Verifikasi token sesi
  const token = extractSessionToken(req);
  const verification = authManager.verifySessionToken(token);

  if (verification.valid) {
    req.sessionInfo = verification;
    return next();
  }

  // Jika belum login atau sesi kedaluwarsa/idle:
  // Alihkan langsung via HTTP 302 ke /login.html
  let redirectUrl = '/login.html';
  if (verification.idleExpired) {
    redirectUrl = '/login.html?reason=idle_timeout';
  }
  return res.redirect(redirectUrl);
});

// ============================================================================
// 2. STATIC FRONTEND FILES (Hanya disajikan setelah lolos Server-Side Route Guard)
// ============================================================================
app.use(express.static(frontendPath));

// ============================================================================
// 3. API ACCESS GATEKEEPER MIDDLEWARE (Untuk seluruh endpoint /api/*)
// ============================================================================
app.use('/api', (req, res, next) => {
  // Public whitelisted API endpoints
  const isWhitelisted = (
    req.path === '/health' ||
    req.path.startsWith('/system/health-telemetry') ||
    req.path.startsWith('/auth/status') ||
    req.path.startsWith('/auth/login') ||
    req.path.startsWith('/auth/verify-otp')
  );
  if (isWhitelisted) return next();

  const token = extractSessionToken(req);

  // Allow custom env token if configured
  const envBearer = process.env.API_BEARER_TOKEN;
  if (envBearer && token === envBearer) {
    return next();
  }

  // Verify session token
  const verification = authManager.verifySessionToken(token);
  if (verification.valid) {
    req.sessionInfo = verification;
    return next();
  }

  // Bersihkan cookie yang tidak valid
  res.setHeader('Set-Cookie', 'sb_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');

  return res.status(401).json({
    success: false,
    error: 'Unauthorized: Akses ditolak. Sesi tidak valid atau telah kedaluwarsa.',
    message: verification.idleExpired 
      ? 'Sesi Anda telah kedaluwarsa karena tidak ada aktivitas (Idle Timeout). Silakan login kembali.' 
      : 'Autentikasi diperlukan. Akses ditolak. Sesi tidak valid atau telah kedaluwarsa.',
    locked: true,
    idleExpired: !!verification.idleExpired,
    reason: verification.reason || 'Authentication required'
  });
});

// ============================================================================
// 4. API ROUTES
// ============================================================================
app.use('/api', apiRoutes);

// ============================================================================
// 5. SPA FALLBACK (Tetap dilindungi route guard)
// ============================================================================
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  const token = extractSessionToken(req);
  const verification = authManager.verifySessionToken(token);
  if (!verification.valid) {
    return res.redirect('/login.html');
  }
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// Start HTTP Server
const server = app.listen(PORT, () => {
  console.log('================================================================');
  console.log('🚀 SHOPEE LIVE VIEW BOT APPS - RUNNING SUCCESSFULLY');
  console.log(`🌐 Dashboard URL: http://localhost:${PORT}`);
  console.log(`📡 REST API Base: http://localhost:${PORT}/api`);
  console.log(`🔒 Route Guard: Active (Unauthenticated users blocked & redirected)`);
  console.log(`⏱️  Session Lifetime: Default 120 Minutes Idle Timeout`);
  console.log('================================================================');
});

// Graceful Shutdown
function handleShutdown(signal) {
  console.log(`\nMenangkap ${signal}, membersihkan koneksi bot Shopee...`);
  retentionController.stopCampaign('server_shutdown').finally(() => {
    server.close(() => {
      console.log('Server HTTP ditutup dengan aman.');
      process.exit(0);
    });
  });
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

process.on('uncaughtException', (err) => {
  console.error('⚠️ [Server Error Guard] Uncaught Exception:', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('⚠️ [Server Error Guard] Unhandled Rejection:', reason?.message || reason);
});

module.exports = { app, server };
