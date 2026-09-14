const fs = require('fs');

const html = fs.readFileSync('frontend/index.html', 'utf8');
const requiredIds = [
  'waf-status-badge', 'campaign-status-badge', 'node-meta-badge',
  'btn-open-scheduler', 'btn-open-history', 'btn-open-security', 'btn-lock-screen', 'btn-theme-toggle',
  'nav-btn-controller', 'nav-btn-accounts', 'nav-btn-proxy', 'nav-btn-whatsapp', 'nav-btn-interaction',
  'metric-active-viewers', 'metric-accumulated-views', 'metric-churn-rotations', 'metric-elapsed-time',
  'metric-bandwidth', 'metric-total-likes', 'metric-total-comments', 'metric-total-cart-clicks',
  'shopee-url-input', 'target-viewers-slider', 'btn-start-campaign', 'btn-stop-campaign',
  'floating-live-bar', 'accounts-tbody', 'proxy-tbody', 'securityGateOverlay'
];

const missing = requiredIds.filter(id => !html.includes(`id="${id}"`));
console.log('UI Integrity Check:');
if (missing.length === 0) {
  console.log('SUCCESS: All 29 critical UI element IDs are present and intact!');
} else {
  console.error('FAILED: Missing IDs:', missing);
}
