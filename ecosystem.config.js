/**
 * PM2 Ecosystem Configuration - Shopee Live View Bot Apps (24/7 Production)
 * Digunakan untuk deployment production VPS (Ubuntu/Debian/CentOS)
 * Penggunaan:
 *   pm2 start ecosystem.config.js --env production
 *   pm2 save
 *   pm2 startup
 */

module.exports = {
  apps: [
    {
      name: 'shopee-live-view-bot',
      script: 'backend/src/server.js',
      instances: 1, // Single stateful event-loop coordinator
      autorestart: true,
      watch: false,
      max_memory_restart: '2G',
      kill_timeout: 5000,
      listen_timeout: 8000,
      env: {
        NODE_ENV: 'development',
        PORT: 3000
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000
      }
    }
  ]
};
