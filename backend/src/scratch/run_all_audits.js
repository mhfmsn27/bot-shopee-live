/**
 * Master Audit Runner - Shopee Live View Bot Apps
 * Menjalankan seluruh test suite secara berurutan dan mengompilasi hasil audit komprehensif.
 */

const { execSync } = require('child_process');
const path = require('path');

const SUITES = [
  { name: 'Real Accounts Deep Audit v2 (Edge Cases & Lifecycle)', file: 'test_real_accounts_audit_v2.js' },
  { name: 'Real Accounts & Virtual SMS Pipeline Core', file: 'test_real_accounts_system.js' },
  { name: 'UI/UX Responsiveness, Reactivity & Real Data Audit', file: 'test_ui_ux_real_data_audit.js' },
  { name: 'Multi-Screen Resolution Breakpoints (360px - 1440px)', file: 'test_responsive_screens.js' },
  { name: 'Deep Audit v2 (Syntax, DOM, API, Sentinel, Cart Click)', file: 'test_deep_audit_v2.js' },
  { name: 'Advanced Features (Sentinel, Scheduler, History, Cart)', file: 'test_advanced_features.js' },
  { name: 'Production Readiness & Security Sandbox', file: 'test_production_readiness.js' },
  { name: 'Interaction Engine & Comment Banks Audit', file: 'test_interaction_deep_audit.js' },
  { name: 'WhatsApp Gateway Baileys Multi-Device & Notification Engine', file: 'test_whatsapp_baileys_audit.js' },
  { name: 'WhatsApp Gateway Live HTTP REST Endpoints Audit', file: 'test_whatsapp_http_endpoints.js' },
  { name: 'Core Engine Protocol & Identity Audit', file: 'test_audit.js' },
  { name: 'Proxy Multi-Protocol (HTTPS/SOCKS5), Multi-Type & Real TCP Probe', file: 'test_proxy_real_distribution_audit.js' },
  { name: 'API Integration Endpoints', file: 'test_api_integration.js' },
  { name: 'Account Limit & Pool Release Enforcer', file: 'test_account_limit.js' },
  { name: 'Table Controls, Skeleton Shimmer & Smart Pagination', file: 'test_table_controls_audit.js' },
  { name: 'Enterprise SQLite Database, WAL & Dual-Sync Integrity', file: 'test_sqlite_persistence_audit.js' },
  { name: 'Comprehensive End-to-End CRUD Flows & Persistence', file: 'test_crud_flows_audit.js' },
  { name: 'Live Stream Protocol, Mobile TLS Evasion & IP Deduplication', file: 'test_live_stream_protocol_audit.js' },
  { name: 'High-Concurrency Keep-Alive Pool, Stream Drainer & Device Matrix', file: 'test_scalability_clustering.js' },
  { name: 'Dynamic Backconnect Rotating Gateway, Auto-Quarantine & Failover', file: 'test_backconnect_proxy_gateway.js' },
  { name: 'Organic Sigmoid Curve Ramp-Up & Human Behavioral Micro-Actions', file: 'test_organic_curve_micro_actions.js' },
  { name: 'Disaster Recovery, Online Atomic Backup & Crash Auto-Resume State', file: 'test_disaster_recovery_backup.js' },
  { name: 'At-Rest AES-256-GCM Credential Encryption & Security Governance', file: 'test_credential_encryption.js' },
  { name: 'Access Gatekeeper, Anti-Brute-Force & Production Security Subsystem', file: 'test_security_gatekeeper.js', noPreload: true }
];

console.log('================================================================');
console.log('🚀 MASTER AUDIT RUNNER: SHOPEE LIVE VIEW BOT APPS');
console.log('================================================================\n');

let totalSuitesPassed = 0;
let totalSuitesFailed = 0;
const preloadPath = path.join(__dirname, 'audit_auth_preload.js');

for (const suite of SUITES) {
  process.stdout.write(`▶ Menjalankan suite: ${suite.name}... `);
  const suitePath = path.join(__dirname, suite.file);
  const cmd = suite.noPreload
    ? `node "${suitePath}"`
    : `node -r "${preloadPath}" "${suitePath}"`;
  try {
    const output = execSync(cmd, {
      cwd: path.join(__dirname, '../../..'),
      encoding: 'utf8',
      timeout: 90000
    });
    console.log('✅ PASS');
    totalSuitesPassed++;
  } catch (err) {
    console.log('❌ FAIL');
    console.error(`\nDetail Kegagalan [${suite.name}]:\n`, err.stdout || err.message);
    totalSuitesFailed++;
  }
}

console.log('\n================================================================');
console.log(`🏁 REKAPITULASI MASTER AUDIT: ${totalSuitesPassed}/${SUITES.length} SUITES LULUS`);
console.log('================================================================');

if (totalSuitesFailed > 0) {
  console.log(`❌ Ditemukan ${totalSuitesFailed} suite yang gagal.`);
  process.exit(1);
} else {
  console.log('🎉 SELURUH SISTEM 100% BEBAS DARI ERROR, BUG, ATAU REGRESI!\n');
  process.exit(0);
}