/**
 * Server Entrypoint - Shopee Live View Bot Application
 * Melayani antarmuka Web Dashboard dan REST API Backend
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const apiRoutes = require('./api/routes');
const retentionController = require('./core/retention-controller');
const authManager = require('./security/auth-manager');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
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

// Full-Stack Access Gatekeeper Middleware
app.use('/api', (req, res, next) => {
  // Public whitelisted endpoints
  const isWhitelisted = (
    req.path === '/health' ||
    req.path.startsWith('/auth/status') ||
    req.path.startsWith('/auth/login') ||
    req.path.startsWith('/auth/verify-otp')
  );
  if (isWhitelisted) return next();

  // Extract token from Bearer header or Cookie
  const authHeader = req.headers.authorization || '';
  let token = '';
  if (authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else if (req.query && req.query.token) {
    token = req.query.token;
  } else if (req.headers.cookie) {
    const match = req.headers.cookie.match(/sb_session=([^;]+)/);
    if (match) token = match[1];
  }

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

  return res.status(401).json({
    success: false,
    error: 'Unauthorized: Akses ditolak. Sesi tidak valid atau telah kedaluwarsa.',
    message: 'Autentikasi diperlukan. Akses ditolak. Sesi tidak valid atau telah kedaluwarsa.',
    locked: true,
    reason: verification.reason || 'Authentication required'
  });
});

// Serve static frontend files
const frontendPath = path.join(__dirname, '../../frontend');
app.use(express.static(frontendPath));

// API Routes
app.use('/api', apiRoutes);

// Fallback untuk SPA
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// Start HTTP Server
const server = app.listen(PORT, () => {
  console.log('================================================================');
  console.log('🚀 SHOPEE LIVE VIEW BOT APPS - RUNNING SUCCESSFULLY');
  console.log(`🌐 Dashboard URL: http://localhost:${PORT}`);
  console.log(`📡 REST API Base: http://localhost:${PORT}/api`);
  console.log(`⏱️  Status: Siap melayani siaran live streaming 24 jam nonstop`);
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

module.exports = { app, server };
