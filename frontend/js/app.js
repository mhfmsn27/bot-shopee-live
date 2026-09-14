/**
 * Shopee Live View Bot Pro - Frontend Controller & Event Stream Listener
 */

// ============================================================================
// GLOBAL AUTHENTICATION & ACCESS GATEKEEPER INTERCEPTOR
// ============================================================================
let sessionToken = localStorage.getItem('sb_session_token') || sessionStorage.getItem('sb_session_token') || '';
let securityConfig = { enabled: true, sessionTimeoutMinutes: 60 };
let inactivityTimer = null;
let currentEventSource = null;

// Monkey-patch window.fetch to automatically inject Bearer Token and catch 401 Unauthorized
const originalFetch = window.fetch;
window.fetch = async function(url, options = {}) {
  options = options || {};
  options.headers = options.headers || {};

  if (sessionToken && typeof url === 'string' && url.includes('/api/')) {
    if (options.headers instanceof Headers) {
      if (!options.headers.has('Authorization')) {
        options.headers.set('Authorization', `Bearer ${sessionToken}`);
      }
    } else if (Array.isArray(options.headers)) {
      if (!options.headers.some(([k]) => k.toLowerCase() === 'authorization')) {
        options.headers.push(['Authorization', `Bearer ${sessionToken}`]);
      }
    } else {
      if (!options.headers['Authorization'] && !options.headers['authorization']) {
        options.headers['Authorization'] = `Bearer ${sessionToken}`;
      }
    }
  }

  const response = await originalFetch(url, options);

  // Global 401 Unauthorized Interceptor
  if (response.status === 401 && typeof url === 'string' && url.includes('/api/') && !url.includes('/auth/login') && !url.includes('/auth/status')) {
    if (typeof showSecurityGate === 'function') {
      showSecurityGate('Sesi Anda telah kedaluwarsa atau belum terotentikasi. Silakan masukkan Master Password.');
    }
  }

  return response;
};

// Global State
let liveChart = null;
let currentAvailableAccounts = 0;
let totalAccountsCount = 0;

document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const tabs = document.querySelectorAll('.nav-tab');
  const panes = document.querySelectorAll('.tab-pane');
  
  // Real-time Chart
  if (document.getElementById('live-chart-canvas')) {
    liveChart = new LiveViewerChart('live-chart-canvas');
  }

  // Tab Navigation
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      panes.forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      const targetId = tab.getAttribute('data-tab');
      const targetPane = document.getElementById(targetId);
      if (targetPane) targetPane.classList.add('active');

      // Refresh specific tab data
      if (targetId === 'tab-accounts') loadAccounts();
      if (targetId === 'tab-proxy') loadProxies();
      if (targetId === 'tab-whatsapp') checkWhatsAppStatus();
      if (targetId === 'tab-interaction') loadInteractionTab();
    });
  });

  // Slider Value Sync
  const setupSlider = (sliderId, badgeId, suffix = '', prefix = '') => {
    const slider = document.getElementById(sliderId);
    const badge = document.getElementById(badgeId);
    if (!slider || !badge) return;
    slider.addEventListener('input', (e) => {
      badge.textContent = `${prefix}${e.target.value}${suffix}`;
    });
  };

  setupSlider('target-viewers-slider', 'target-viewers-badge', ' Viewers');
  setupSlider('min-watch-slider', 'min-watch-badge', ' Menit');
  setupSlider('max-watch-slider', 'max-watch-badge', ' Menit');
  setupSlider('ramp-up-slider', 'ramp-up-badge', ' View/mnt');
  setupSlider('fixed-duration-slider', 'fixed-duration-badge', ' Menit');
  setupSlider('total-duration-slider', 'total-duration-badge', ' Menit');
  setupSlider('session-like-slider', 'session-like-rate-badge', ' Like/mnt');
  setupSlider('session-comment-slider', 'session-comment-interval-badge', ' dtk', 'Tiap ');
  setupSlider('session-cart-slider', 'session-cart-rate-badge', ' Klik/mnt');
  setupSlider('global-like-rate-slider', 'global-like-rate-badge', ' Like/mnt');
  setupSlider('global-comment-interval-slider', 'global-comment-interval-badge', ' dtk', 'Tiap ');

  // Interaction Toggles & Category Select
  const toggleSessionLike = document.getElementById('session-toggle-like');
  const sessionLikeSliderBox = document.getElementById('session-like-slider-box');
  if (toggleSessionLike && sessionLikeSliderBox) {
    toggleSessionLike.addEventListener('change', (e) => {
      sessionLikeSliderBox.style.display = e.target.checked ? 'block' : 'none';
    });
  }

  const toggleSessionComment = document.getElementById('session-toggle-comment');
  const sessionCommentOptionsBox = document.getElementById('session-comment-options-box');
  if (toggleSessionComment && sessionCommentOptionsBox) {
    toggleSessionComment.addEventListener('change', (e) => {
      sessionCommentOptionsBox.style.display = e.target.checked ? 'block' : 'none';
    });
  }

  const toggleSessionCart = document.getElementById('session-toggle-cart');
  const sessionCartSliderBox = document.getElementById('session-cart-slider-box');
  if (toggleSessionCart && sessionCartSliderBox) {
    toggleSessionCart.addEventListener('change', (e) => {
      sessionCartSliderBox.style.display = e.target.checked ? 'block' : 'none';
    });
  }

  const sessionCategorySelect = document.getElementById('session-comment-category-select');
  const sessionCustomCommentsBox = document.getElementById('session-custom-comments-box');
  if (sessionCategorySelect && sessionCustomCommentsBox) {
    sessionCategorySelect.addEventListener('change', (e) => {
      sessionCustomCommentsBox.style.display = e.target.value === 'custom' ? 'block' : 'none';
    });
  }

  // Smart Hybrid Mode Toggle Listener
  const hybridCheckbox = document.getElementById('campaign-hybrid-mode');
  const targetSlider = document.getElementById('target-viewers-slider');
  const targetWarningText = document.getElementById('target-limit-warning-text');
  const targetWarningBox = document.getElementById('target-limit-warning');

  function syncHybridModeUI() {
    if (!hybridCheckbox || !targetSlider) return;
    const isHybrid = hybridCheckbox.checked;
    if (isHybrid) {
      targetSlider.max = 1000;
      if (targetWarningText) {
        targetWarningText.innerHTML = '<strong>Mode Hybrid Aktif:</strong> Akun ber-cookie diprioritaskan sebagai Anchor Viewers (like & chat). Kuota selebihnya dialirkan sebagai Guest Persistent Streamers via Residential Rotating Proxy.';
      }
      if (targetWarningBox) {
        targetWarningBox.style.color = '#34d399';
      }
    } else {
      const maxAllowed = Math.max(1, currentAvailableAccounts);
      targetSlider.max = maxAllowed;
      if (parseInt(targetSlider.value, 10) > maxAllowed) {
        targetSlider.value = maxAllowed;
        const badge = document.getElementById('target-viewers-badge');
        if (badge) badge.textContent = `${maxAllowed} Viewers`;
      }
      if (targetWarningText) {
        targetWarningText.innerHTML = '<strong>Mode Standar:</strong> Pengiriman bot dibatasi maksimal sejumlah akun aktif terverifikasi yang tersedia.';
      }
      if (targetWarningBox) {
        targetWarningBox.style.color = '#f59e0b';
      }
    }
  }

  if (hybridCheckbox) {
    hybridCheckbox.addEventListener('change', syncHybridModeUI);
  }

  // Mode Selector Change Handler
  const modeRadios = document.querySelectorAll('input[name="retentionMode"]');
  const dynamicSettings = document.getElementById('dynamic-churn-settings');
  const fixedSettings = document.getElementById('fixed-duration-settings');

  modeRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
      const val = e.target.value;
      if (val === 'dynamic_churn' || val === 'organic_curve') {
        if (dynamicSettings) dynamicSettings.style.display = 'block';
        if (fixedSettings) fixedSettings.style.display = 'none';
      } else if (val === 'fixed_duration') {
        if (dynamicSettings) dynamicSettings.style.display = 'none';
        if (fixedSettings) fixedSettings.style.display = 'block';
      } else { // infinite_24h
        if (dynamicSettings) dynamicSettings.style.display = 'none';
        if (fixedSettings) fixedSettings.style.display = 'none';
      }
    });
  });

  // Initialize Server-Sent Events (SSE)
  initSse();

  // Load Initial Data (Semua Tab dengan Data Asli dari Backend)
  loadStatus();
  loadLogs();
  loadAccounts();
  loadProxies();
  checkWhatsAppStatus();
  loadInteractionTab();
  loadChats();

  // Live Clock for Enterprise Brand Bar
  function updateLiveClock() {
    const clockEl = document.getElementById('system-live-clock');
    if (clockEl) {
      const now = new Date();
      clockEl.textContent = now.toLocaleTimeString('id-ID') + ' WIB';
    }
  }
  updateLiveClock();
  setInterval(updateLiveClock, 1000);

  // Periodic Telemetry & Node Health Refresh (every 20s)
  setInterval(() => {
    if (typeof loadStatus === 'function') loadStatus();
  }, 20000);

  // Duration Preset Buttons
  const btnPreset72h = document.getElementById('btn-preset-72h');
  const btnPreset24h = document.getElementById('btn-preset-24h');
  const btnPresetNonstop = document.getElementById('btn-preset-nonstop');
  const sliderTotalDuration = document.getElementById('total-duration-slider');
  const badgeTotalDuration = document.getElementById('total-duration-badge');

  if (btnPreset72h && sliderTotalDuration && badgeTotalDuration) {
    btnPreset72h.addEventListener('click', () => {
      sliderTotalDuration.value = 4320;
      badgeTotalDuration.textContent = '72 Jam (3 Hari)';
      showNotification('⚡ Durasi diset: 72 Jam (3 Hari Nonstop)');
    });
  }
  if (btnPreset24h && sliderTotalDuration && badgeTotalDuration) {
    btnPreset24h.addEventListener('click', () => {
      sliderTotalDuration.value = 1440;
      badgeTotalDuration.textContent = '24 Jam (1 Hari)';
      showNotification('⏱️ Durasi diset: 24 Jam (1 Hari)');
    });
  }
  if (btnPresetNonstop && sliderTotalDuration && badgeTotalDuration) {
    btnPresetNonstop.addEventListener('click', () => {
      sliderTotalDuration.value = 0;
      badgeTotalDuration.textContent = '♾️ Nonstop (24/7)';
      showNotification('♾️ Durasi diset: Nonstop (Standby 24/7)');
    });
  }

  // Campaign Form Listeners
  const campaignForm = document.getElementById('campaign-form');
  const btnStart = document.getElementById('btn-start-campaign');
  const btnStop = document.getElementById('btn-stop-campaign');

  if (btnStart) {
    btnStart.addEventListener('click', async () => {
      const urlOrRoomId = document.getElementById('shopee-url-input').value.trim();
      if (!urlOrRoomId) {
        alert('Harap masukkan URL atau Room ID Shopee Live target.');
        return;
      }

      const name = (document.getElementById('campaign-name-input')?.value || '').trim();
      const modeRadio = document.querySelector('input[name="retentionMode"]:checked');
      
      const isHybrid = document.getElementById('campaign-hybrid-mode')?.checked ?? true;
      
      // Validasi Batasan Akun: Mode Standar vs Mode Hybrid
      if (!isHybrid) {
        if (currentAvailableAccounts <= 0) {
          alert('⚠️ Seluruh akun aktif terverifikasi sedang digunakan menonton siaran live lain (0 akun tersedia). Silakan aktifkan Mode Hybrid Cerdas atau tunggu live lain selesai.');
          return;
        }

        let requestedViewers = parseInt(document.getElementById('target-viewers-slider').value, 10) || 1;
        if (requestedViewers > currentAvailableAccounts) {
          requestedViewers = currentAvailableAccounts;
          document.getElementById('target-viewers-slider').value = requestedViewers;
          document.getElementById('target-viewers-badge').textContent = requestedViewers + ' Viewers';
          showNotification(`ℹ️ Target dibatasi maksimal ${requestedViewers} viewers menyesuaikan akun terverifikasi yang sedang tersedia.`);
        }
      }

      const requestedViewers = parseInt(document.getElementById('target-viewers-slider').value, 10) || 1;

      const payload = {
        name: name || undefined,
        urlOrRoomId,
        targetViewers: requestedViewers,
        hybridMode: isHybrid,
        retentionMode: modeRadio ? modeRadio.value : 'dynamic_churn',
        minWatchMinutes: document.getElementById('min-watch-slider').value,
        maxWatchMinutes: document.getElementById('max-watch-slider').value,
        fixedDurationMinutes: document.getElementById('fixed-duration-slider').value,
        rampUpRatePerMin: document.getElementById('ramp-up-slider').value,
        campaignDurationMinutes: document.getElementById('total-duration-slider').value,
        interaction: {
          enableLike: document.getElementById('session-toggle-like') ? document.getElementById('session-toggle-like').checked : true,
          likeRatePerMin: document.getElementById('session-like-slider') ? parseInt(document.getElementById('session-like-slider').value, 10) : 60,
          enableComment: document.getElementById('session-toggle-comment') ? document.getElementById('session-toggle-comment').checked : true,
          commentIntervalSec: document.getElementById('session-comment-slider') ? parseInt(document.getElementById('session-comment-slider').value, 10) : 20,
          commentCategory: document.getElementById('session-comment-category-select') ? document.getElementById('session-comment-category-select').value : 'general',
          customComments: (document.getElementById('session-custom-comments-text')?.value || '').split('\n').map(s => s.trim()).filter(Boolean),
          enableCartClick: document.getElementById('session-toggle-cart') ? document.getElementById('session-toggle-cart').checked : true,
          cartClickRatePerMin: document.getElementById('session-cart-slider') ? parseInt(document.getElementById('session-cart-slider').value, 10) : 15
        }
      };

      try {
        btnStart.disabled = true;
        btnStart.textContent = 'Memulai Sesi Siaran...';
        const res = await fetch('/api/campaigns', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
          showNotification(`🚀 Sesi [${data.campaign?.name || 'Shopee Live'}] Berhasil Dimulai (${data.campaign?.targetViewers} Viewers)!`);
          updateCampaignStatusBadge('RUNNING');
          loadStatus();
          loadAccounts();
          loadLogs();
        } else {
          showNotification(`⚠️ Gagal: ${data.message}`);
          alert(`Gagal Memulai Siaran:\n${data.message}`);
        }
      } catch (err) {
        showNotification(`❌ Error: ${err.message}`);
      } finally {
        btnStart.disabled = false;
        btnStart.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> 🚀 Mulai / Tambah Siaran Live`;
      }
    });
  }

  // Live Stream Connectivity & CDN Tester
  const btnTestConn = document.getElementById('btn-test-stream-connectivity');
  const testConnStatus = document.getElementById('test-connectivity-status');
  const connResultBox = document.getElementById('connectivity-result-box');

  if (btnTestConn) {
    btnTestConn.addEventListener('click', async () => {
      const urlOrRoomId = (document.getElementById('shopee-url-input')?.value || '').trim();
      if (!urlOrRoomId) {
        alert('Harap masukkan URL atau Session ID Shopee Live terlebih dahulu.');
        return;
      }

      try {
        btnTestConn.disabled = true;
        btnTestConn.innerHTML = `<span style="display:inline-block;animation:pulseAnim 1s infinite;">⏳</span> Menguji...`;
        if (testConnStatus) {
          testConnStatus.style.display = 'inline';
          testConnStatus.textContent = 'Menghubungi Shopee Live gateway...';
        }
        if (connResultBox) connResultBox.style.display = 'none';

        const res = await fetch('/api/campaigns/test-connectivity', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ urlOrRoomId })
        });
        const data = await res.json();

        if (connResultBox) {
          connResultBox.style.display = 'block';
          if (data.success) {
            const isOnline = data.online;
            const rData = data.roomData || {};
            const cdn = data.cdnProbe || {};
            const bot = data.antiBotStatus || {};

            connResultBox.innerHTML = `
              <div style="font-weight:700;font-size:0.88rem;margin-bottom:6px;display:flex;align-items:center;gap:6px;">
                ${isOnline ? '<span style="color:#10b981;">🟢 Live Streaming Terdeteksi AKTIF (Online)</span>' : '<span style="color:#f59e0b;">🟡 Sesi Belum Mulai / Offline</span>'}
                <span style="font-size:0.72rem;background:rgba(238,77,45,0.15);color:#ff8c6d;padding:2px 8px;border-radius:var(--radius-full);">ID: ${data.roomId}</span>
              </div>
              <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:6px;margin-bottom:8px;">
                <div>📺 <strong>Judul:</strong> ${escapeHtml(rData.title || 'Tidak ada judul')}</div>
                <div>👤 <strong>Host:</strong> ${escapeHtml(rData.nickname || rData.username || 'Host Shopee')}</div>
                <div>👥 <strong>Penonton Terkini:</strong> ${(rData.viewerCount || 0).toLocaleString('id-ID')} viewers</div>
                <div>⚡ <strong>Latensi Gateway:</strong> ${data.latencyMs} ms</div>
              </div>
              <div style="padding:6px 10px;border-radius:var(--radius-sm);background:rgba(6,182,212,0.1);border:1px solid rgba(6,182,212,0.25);margin-bottom:6px;">
                🎥 <strong>Video Stream CDN (FLV/HLS):</strong> ${cdn.success ? `<span style="color:#10b981;">Terhubung (${cdn.bytesSampled} B sampled, latensi ${cdn.latencyMs}ms)</span>` : (rData.playUrl ? '<span style="color:#38bdf8;">Siap distream via Persistent Drainer</span>' : '<span style="color:#94a3b8;">Tidak tersedia</span>')}
              </div>
              <div style="padding:6px 10px;border-radius:var(--radius-sm);background:${bot.isWafBlocked ? 'rgba(239,68,68,0.12)' : 'rgba(16,185,129,0.12)'};border:1px solid ${bot.isWafBlocked ? 'rgba(239,68,68,0.3)' : 'rgba(16,185,129,0.3)'};">
                🛡️ <strong>Status Anti-Bot:</strong> ${bot.isWafBlocked ? '<span style="color:#ef4444;font-weight:600;">WAF Challenge Terdeteksi</span>' : '<span style="color:#10b981;font-weight:600;">Lolos / Siap Stream</span>'}
                <div style="font-size:0.73rem;color:var(--text-dim);margin-top:2px;">${escapeHtml(bot.recommendation || '')}</div>
              </div>
            `;
          } else {
            connResultBox.innerHTML = `
              <div style="color:#ef4444;font-weight:600;">❌ Gagal Terhubung ke Shopee Live</div>
              <div style="font-size:0.75rem;color:var(--text-dim);margin-top:4px;">${escapeHtml(data.error || 'Server Shopee tidak merespons')}</div>
            `;
          }
        }
      } catch (err) {
        if (connResultBox) {
          connResultBox.style.display = 'block';
          connResultBox.innerHTML = `
            <div style="color:#ef4444;font-weight:600;">❌ Terjadi Kesalahan Koneksi</div>
            <div style="font-size:0.75rem;color:var(--text-dim);margin-top:4px;">${escapeHtml(err.message)}</div>
          `;
        }
      } finally {
        btnTestConn.disabled = false;
        btnTestConn.innerHTML = `<span>🔍</span> Tes Koneksi Room & Stream CDN`;
        if (testConnStatus) testConnStatus.style.display = 'none';
      }
    });
  }

  if (btnStop) {
    btnStop.addEventListener('click', async () => {
      try {
        btnStop.disabled = true;
        btnStop.innerHTML = `<span style="display:inline-block;animation:pulseAnim 1s infinite;">⏳</span> Menghentikan...`;
        
        const res = await fetch('/api/campaign/stop', { 
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        const data = await res.json();
        
        if (data.success) {
          showNotification('⏹️ Seluruh Sesi Live Berhasil Dihentikan.');
          updateCampaignStatusBadge('IDLE');
          const elActive = document.getElementById('metric-active-viewers');
          if (elActive) elActive.textContent = '0';
          loadStatus();
          loadAccounts();
          loadLogs();
        } else {
          showNotification(`⚠️ ${data.message || 'Gagal menghentikan'}`);
        }
      } catch (err) {
        showNotification(`❌ Error: ${err.message}`);
      } finally {
        btnStop.disabled = false;
        btnStop.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"></rect></svg> Hentikan Semua Sesi`;
      }
    });
  }

  // Clear Terminal Button
  const btnClearLog = document.getElementById('btn-clear-logs');
  if (btnClearLog) {
    btnClearLog.addEventListener('click', () => {
      const container = document.getElementById('terminal-logs');
      if (container) container.innerHTML = '';
    });
  }

  // Account Generation Actions
  setupAccountHandlers();

  // Proxy Actions
  setupProxyHandlers();

  // WhatsApp Gateway Actions
  setupWhatsAppHandlers();

  // Interaction & Live Chat Actions
  setupInteractionHandlers();

  // Canary Security Watchdog & WAF Actions
  setupCanaryHandlers();

  // Modern UI/UX: Theme Toggle (Light/Dark Mode)
  setupThemeToggle();

  // Modern UI/UX: Quick Start 3-Step Guide
  setupQuickGuide();

  // Modern UI/UX: Floating Bottom Live Bar
  setupFloatingLiveBar();

  // Smart Scheduler & History Handlers
  setupSchedulerAndHistoryHandlers();

  // Security Gatekeeper & Access Control Handlers
  setupSecurityGatekeeper();
  checkAuthStatus();
});

// SSE Connection
function initSse() {
  if (currentEventSource) {
    try { currentEventSource.close(); } catch (e) {}
    currentEventSource = null;
  }

  const sseUrl = sessionToken ? `/api/stream-events?token=${encodeURIComponent(sessionToken)}` : '/api/stream-events';
  const eventSource = new EventSource(sseUrl);
  currentEventSource = eventSource;

  eventSource.addEventListener('stats', (e) => {
    try {
      const stats = JSON.parse(e.data);
      updateDashboardMetrics(stats);
    } catch (err) {}
  });

  eventSource.addEventListener('log', (e) => {
    try {
      const log = JSON.parse(e.data);
      appendTerminalLog(log);
    } catch (err) {}
  });

  eventSource.addEventListener('status_change', (e) => {
    try {
      const data = JSON.parse(e.data);
      updateCampaignStatusBadge(data.status);
    } catch (err) {}
  });

  eventSource.addEventListener('campaigns_updated', (e) => {
    try {
      const campaigns = JSON.parse(e.data);
      renderMultiCampaignsList(campaigns);
    } catch (err) {}
  });

  eventSource.addEventListener('chat_message', (e) => {
    try {
      const chat = JSON.parse(e.data);
      appendLiveChatMessage(chat);
    } catch (err) {}
  });

  eventSource.addEventListener('like_burst', (e) => {
    try {
      const like = JSON.parse(e.data);
      updateLikesBurst(like);
    } catch (err) {}
  });

  eventSource.addEventListener('cart_click', (e) => {
    try {
      const cartData = JSON.parse(e.data);
      const elCart = document.getElementById('metric-total-cart-clicks');
      if (elCart && typeof cartData.totalCartClicks === 'number') {
        elCart.textContent = cartData.totalCartClicks.toLocaleString('id-ID');
      }
    } catch (err) {}
  });

  eventSource.addEventListener('history_updated', () => {
    if (document.getElementById('modal-history')?.classList.contains('active')) {
      loadHistory();
    }
  });

  eventSource.addEventListener('schedules_updated', () => {
    if (document.getElementById('modal-scheduler')?.classList.contains('active')) {
      loadSchedules();
    }
  });

  eventSource.addEventListener('chat_history', (e) => {
    try {
      const chats = JSON.parse(e.data);
      if (Array.isArray(chats) && chats.length > 0) {
        renderChatHistory(chats);
      }
    } catch (err) {}
  });

  eventSource.addEventListener('canary_status', (e) => {
    try {
      const canary = JSON.parse(e.data);
      updateWafBadge(canary);
    } catch (err) {}
  });

  eventSource.addEventListener('waf_alert', (e) => {
    try {
      const alertData = JSON.parse(e.data);
      showNotification(`🚨 WAF ALERT: ${alertData.message || 'Peringatan keamanan terdeteksi!'}`, 6000);
      updateWafBadge({ status: 'WAF_ALERT', circuitBreakerActive: true });
    } catch (err) {}
  });

  // WhatsApp Gateway Live Events
  eventSource.addEventListener('wa_qr', (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data && data.qrDataUrl) {
        const qrImg = document.getElementById('wa-qr-img');
        const qrContainer = document.getElementById('wa-qr-container');
        if (qrImg && qrContainer) {
          qrImg.src = data.qrDataUrl;
          qrContainer.style.display = 'block';
        }
      }
    } catch (err) {}
  });

  eventSource.addEventListener('wa_connected', (e) => {
    try {
      showNotification('💬 WhatsApp Bot Pengirim Berhasil Terhubung!');
      checkWhatsAppStatus();
    } catch (err) {}
  });

  eventSource.addEventListener('wa_disconnected', () => {
    try {
      showNotification('⚠️ Device WhatsApp Bot Pengirim Terputus.');
      checkWhatsAppStatus();
    } catch (err) {}
  });

  eventSource.addEventListener('wa_message_sent', () => {
    try {
      loadWhatsAppHistory();
    } catch (err) {}
  });

  eventSource.onerror = () => {
    // Auto reconnect by browser
  };
}

// Render Sesi Multi-Siaran Aktif Simultan
function renderMultiCampaignsList(campaigns) {
  const container = document.getElementById('multi-campaigns-list');
  const countBadge = document.getElementById('active-sessions-count-badge');
  if (!container) return;

  const running = (campaigns || []).filter(c => c.status === 'RUNNING');
  if (countBadge) countBadge.textContent = `${running.length} Sesi Aktif`;

  if (!campaigns || campaigns.length === 0) {
    container.innerHTML = `
      <div style="background:var(--bg-glass);border:1px dashed var(--border-glass);padding:18px;border-radius:var(--radius-sm);text-align:center;font-size:0.8rem;color:var(--text-dim);">
        Belum ada siaran aktif. Masukkan link di form atas lalu klik "Mulai / Tambah Siaran Live".
      </div>
    `;
    return;
  }

  container.innerHTML = '';
  campaigns.forEach(cmp => {
    const isRunning = cmp.status === 'RUNNING';
    const card = document.createElement('div');
    card.className = 'campaign-session-card';
    card.style.background = isRunning ? 'rgba(6, 182, 212, 0.08)' : 'var(--bg-glass)';
    card.style.border = isRunning ? '1px solid rgba(6, 182, 212, 0.35)' : '1px solid var(--border-glass)';
    card.style.borderRadius = 'var(--radius-md)';
    card.style.padding = '14px 16px';

    let timeText = '♾️ Nonstop';
    if (cmp.campaignDurationMinutes > 0) {
      if (cmp.remainingSec !== null && cmp.remainingSec !== undefined) {
        const h = Math.floor(cmp.remainingSec / 3600);
        const m = Math.floor((cmp.remainingSec % 3600) / 60);
        timeText = `⏳ Sisa: ${h}j ${m}m (${Math.round(cmp.campaignDurationMinutes / 60)}j total)`;
      } else {
        timeText = `⏱️ ${Math.round(cmp.campaignDurationMinutes / 60)} Jam`;
      }
    }

    card.innerHTML = `
      <div>
        <div style="font-weight:700;font-size:0.92rem;display:flex;align-items:center;gap:8px;">
          ${isRunning ? '<span class="pulse-dot"></span>' : '<span style="width:8px;height:8px;border-radius:50%;background:#94a3b8;"></span>'}
          ${escapeHtml(cmp.name)}
          <span style="font-size:0.72rem;background:rgba(238,77,45,0.15);color:#ff8c6d;padding:2px 8px;border-radius:var(--radius-full);">
            Room ID: ${cmp.roomId}
          </span>
        </div>
        <div style="font-size:0.78rem;color:var(--text-dim);margin-top:4px;">
          👥 <strong>${cmp.activeViewers || 0}</strong> / ${cmp.targetViewers} Viewers • 🔥 Total ${(cmp.accumulatedViews || 0).toLocaleString('id-ID')} Views • ❤️ <strong>${(cmp.totalLikes || 0).toLocaleString('id-ID')}</strong> Likes • 💬 <strong>${(cmp.totalComments || 0).toLocaleString('id-ID')}</strong> Chat • 🛒 <strong>${(cmp.totalCartClicks || 0).toLocaleString('id-ID')}</strong> Keranjang • ${timeText} • <span style="color:#06b6d4;">${cmp.retentionMode}</span>
        </div>
      </div>
      <div>
        ${isRunning ? `
          <button class="btn btn-secondary" style="padding:6px 12px;font-size:0.78rem;color:#f43f5e;" onclick="stopSingleCampaign('${cmp.id}')">
            ⏹️ Hentikan Sesi
          </button>
        ` : `
          <span style="font-size:0.75rem;color:var(--text-dim);font-weight:600;">SELESAI</span>
        `}
      </div>
    `;
    container.appendChild(card);
  });
}

window.stopSingleCampaign = async function(id) {
  try {
    const res = await fetch(`/api/campaigns/${id}/stop`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showNotification('⏹️ Sesi siaran berhasil dihentikan.');
      loadStatus();
      loadAccounts();
      loadLogs();
    }
  } catch (e) {
    alert(e.message);
  }
};

// Initial status load
async function loadStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    if (data.success) {
      updateDashboardMetrics(data.metrics);
      if (data.campaigns) {
        renderMultiCampaignsList(data.campaigns);
      }
      if (data.canary) {
        updateWafBadge(data.canary);
      }
      const nodeBadge = document.getElementById('node-meta-badge');
      if (nodeBadge && data.system) {
        const memMb = Math.round(data.system.memory.rss / (1024 * 1024));
        nodeBadge.textContent = `Cloud Node ID • ${memMb} MB RAM • Node ${data.system.nodeVersion}`;
      }
    }
  } catch (err) {}
}

async function loadLogs() {
  try {
    const res = await fetch('/api/logs');
    const data = await res.json();
    if (data.success && data.logs) {
      const terminal = document.getElementById('terminal-logs');
      if (terminal) {
        terminal.innerHTML = '';
        data.logs.forEach(appendTerminalLog);
      }
    }
  } catch (err) {}
}

// =========================================================================
// ACCOUNTS HANDLERS & REALISTIC IDENTITY GENERATOR
// =========================================================================
function setupAccountHandlers() {
  const btnOpenModal = document.getElementById('btn-open-gen-modal');
  const modal = document.getElementById('modal-gen-accounts');
  const btnCloseModal = document.getElementById('btn-close-gen-modal');
  const btnSubmitGen = document.getElementById('btn-submit-gen-accounts');
  const btnValidate = document.getElementById('btn-validate-accounts');

  if (btnOpenModal && modal) {
    btnOpenModal.addEventListener('click', () => modal.classList.add('active'));
  }
  if (btnCloseModal && modal) {
    btnCloseModal.addEventListener('click', () => modal.classList.remove('active'));
  }

  if (btnSubmitGen) {
    btnSubmitGen.addEventListener('click', async () => {
      const count = document.getElementById('gen-count-input').value;
      const gender = document.getElementById('gen-gender-select').value;
      const autoEmail = document.getElementById('toggle-auto-email').checked;
      const enrichProfile = document.getElementById('toggle-enrich-identity').checked;
      const autoAvatar = document.getElementById('toggle-auto-avatar').checked;
      const city = (document.getElementById('gen-city-input')?.value || '').trim();

      try {
        btnSubmitGen.disabled = true;
        btnSubmitGen.textContent = 'Membuat Akun Realistis...';

        const res = await fetch('/api/accounts/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ count, gender, autoEmail, enrichProfile, autoAvatar, city })
        });
        const data = await res.json();
        if (data.success) {
          showNotification(`✨ ${data.message}`);
          modal.classList.remove('active');
          loadAccounts();
        } else {
          alert(`Gagal: ${data.message}`);
        }
      } catch (e) {
        alert(e.message);
      } finally {
        btnSubmitGen.disabled = false;
        btnSubmitGen.textContent = '⚡ Generate Akun Lengkap';
      }
    });
  }

  if (btnValidate) {
    btnValidate.addEventListener('click', async () => {
      try {
        btnValidate.disabled = true;
        btnValidate.textContent = '🩺 Mengaudit Akun...';
        const res = await fetch('/api/accounts/validate', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          showNotification(`🩺 Audit Selesai: ${data.valid}/${data.total} akun sehat (${data.averageHealthScore}%).`);
          updateAccountHealthUI(data);
          loadAccounts();
        }
      } catch (err) {
        alert(err.message);
      } finally {
        btnValidate.disabled = false;
        btnValidate.textContent = '🩺 Audit Kesehatan Akun';
      }
    });
  }

  const btnExportCsv = document.getElementById('btn-export-accounts-csv');
  if (btnExportCsv) {
    btnExportCsv.addEventListener('click', () => {
      window.location.href = '/api/accounts/export';
    });
  }

  // --- REAL COOKIES VAULT HANDLERS ---
  const btnOpenCookieModal = document.getElementById('btn-open-cookie-modal');
  const modalCookie = document.getElementById('modal-import-cookies');
  const btnCloseCookieModal = document.getElementById('btn-close-cookie-modal');
  const btnSubmitCookies = document.getElementById('btn-submit-import-cookies');
  const btnValidateCookiesBulk = document.getElementById('btn-validate-cookies-bulk');
  const cookieRawInput = document.getElementById('cookie-raw-input');
  const cookieAccountLabel = document.getElementById('cookie-account-label');
  const cookieProxyTypeSelect = document.getElementById('cookie-proxy-type-select');
  const cookiePreviewBox = document.getElementById('cookie-detect-preview-box');
  const cookieFormatBadge = document.getElementById('cookie-detect-format-badge');
  const cookieStatusBadge = document.getElementById('cookie-detect-status-badge');
  const cookieChipsContainer = document.getElementById('cookie-detect-chips');

  let cookieDebounceTimer = null;

  function updateCookieLivePreview(text) {
    if (!text || text.trim().length < 5) {
      if (cookiePreviewBox) cookiePreviewBox.style.display = 'none';
      return;
    }

    const importantKeys = ['SPC_F', 'SPC_CLIENTID', 'SPC_R_T_ID', 'SPC_R_T_IV', 'SPC_SEC_SI', 'SPC_EC', 'SPC_U', 'SPC_ST', 'SPC_CDS_CHAT'];
    const foundTokens = [];
    for (const k of importantKeys) {
      if (text.includes(k + '=') || text.includes(k + '\t')) {
        foundTokens.push(k);
      }
    }

    let formatName = 'Format Standar';
    if (text.includes('\t')) {
      formatName = '📋 Tabel Chrome DevTools';
    } else if (/curl/i.test(text)) {
      formatName = '🌐 cURL Command';
    } else if (text.trim().startsWith('[') && text.trim().endsWith(']')) {
      formatName = '📦 JSON Cookie-Editor';
    } else if (text.includes('|')) {
      formatName = '👤 Format Pipe (Username|Email|Cookies)';
    }

    const hasAuth = foundTokens.includes('SPC_SEC_SI') || foundTokens.includes('SPC_R_T_ID') || foundTokens.includes('SPC_U') || foundTokens.includes('SPC_ST');

    if (cookiePreviewBox) cookiePreviewBox.style.display = 'block';
    if (cookieFormatBadge) {
      cookieFormatBadge.innerHTML = `<span>${formatName}</span> <span style="font-size:0.7rem;color:var(--text-dim);">(${foundTokens.length} token terdeteksi)</span>`;
    }
    if (cookieStatusBadge) {
      if (hasAuth) {
        cookieStatusBadge.style.background = 'rgba(16,185,129,0.2)';
        cookieStatusBadge.style.color = '#34d399';
        cookieStatusBadge.textContent = '🟢 Sesi Terotentikasi Penuh';
      } else if (foundTokens.length > 0) {
        cookieStatusBadge.style.background = 'rgba(234,179,8,0.2)';
        cookieStatusBadge.style.color = '#facc15';
        cookieStatusBadge.textContent = '🟡 Sesi Device / Visitor';
      } else {
        cookieStatusBadge.style.background = 'rgba(239,68,68,0.2)';
        cookieStatusBadge.style.color = '#f87171';
        cookieStatusBadge.textContent = '⚪ Menunggu Token Shopee';
      }
    }

    if (cookieChipsContainer) {
      if (foundTokens.length === 0) {
        cookieChipsContainer.innerHTML = '<span style="color:var(--text-dim);font-size:0.72rem;">Belum ada token SPC_* yang terdeteksi. Silakan paste cookie Shopee.</span>';
      } else {
        cookieChipsContainer.innerHTML = foundTokens.map(t => 
          `<span style="background:rgba(6,182,212,0.15);color:#22d3ee;padding:2px 6px;border-radius:3px;font-size:0.7rem;font-family:monospace;border:1px solid rgba(6,182,212,0.3);">${t} ✓</span>`
        ).join('');
      }
    }
  }

  if (cookieRawInput) {
    cookieRawInput.addEventListener('input', (e) => {
      clearTimeout(cookieDebounceTimer);
      cookieDebounceTimer = setTimeout(() => {
        updateCookieLivePreview(e.target.value);
      }, 150);
    });
    cookieRawInput.addEventListener('paste', () => {
      setTimeout(() => updateCookieLivePreview(cookieRawInput.value), 50);
    });
  }

  if (btnOpenCookieModal && modalCookie) {
    btnOpenCookieModal.addEventListener('click', () => {
      modalCookie.classList.add('active');
      if (cookieRawInput) updateCookieLivePreview(cookieRawInput.value);
    });
  }
  if (btnCloseCookieModal && modalCookie) {
    btnCloseCookieModal.addEventListener('click', () => modalCookie.classList.remove('active'));
  }
  if (btnSubmitCookies) {
    btnSubmitCookies.addEventListener('click', async () => {
      const rawText = (cookieRawInput?.value || '').trim();
      const accountName = (cookieAccountLabel?.value || '').trim();
      const proxyType = cookieProxyTypeSelect?.value || 'residential';

      if (!rawText) {
        alert('Masukkan daftar cookies atau paste tabel dari Chrome DevTools.');
        return;
      }
      try {
        btnSubmitCookies.disabled = true;
        btnSubmitCookies.textContent = 'Menyimpan...';
        const res = await fetch('/api/accounts/import-cookies', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rawText, accountName, proxyType })
        });
        const data = await res.json();
        if (data.success) {
          showNotification(`🔐 Berhasil mengimpor ${data.count} akun Shopee terotentikasi (Format: ${data.detectedFormat || 'DevTools Table'}).`);
          modalCookie.classList.remove('active');
          if (cookieRawInput) cookieRawInput.value = '';
          if (cookieAccountLabel) cookieAccountLabel.value = '';
          if (cookiePreviewBox) cookiePreviewBox.style.display = 'none';
          loadAccounts();
        } else {
          alert('Gagal mengimpor cookies: ' + (data.error || 'Format tidak dikenali'));
        }
      } catch (e) {
        alert(e.message);
      } finally {
        btnSubmitCookies.disabled = false;
        btnSubmitCookies.textContent = '💾 Simpan ke Cookie Vault';
      }
    });
  }
  if (btnValidateCookiesBulk) {
    btnValidateCookiesBulk.addEventListener('click', async () => {
      try {
        btnValidateCookiesBulk.disabled = true;
        btnValidateCookiesBulk.textContent = 'Menguji...';
        const res = await fetch('/api/accounts/validate-cookies', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          showNotification(`⚡ Hasil Audit Cookie: ${data.alive}/${data.totalWithCookies} cookie aktif (${data.expired} kedaluwarsa).`);
          loadAccounts();
        }
      } catch (e) {
        alert(e.message);
      } finally {
        btnValidateCookiesBulk.disabled = false;
        btnValidateCookiesBulk.textContent = '⚡ Uji Validitas Cookies';
      }
    });
  }

  // --- VIRTUAL SMS REGISTRATION WIZARD HANDLERS ---
  const btnOpenSmsModal = document.getElementById('btn-open-sms-modal');
  const modalSms = document.getElementById('modal-sms-register');
  const btnCloseSmsModal = document.getElementById('btn-close-sms-modal');
  const providerSelect = document.getElementById('sms-provider-select');
  const apikeyBox = document.getElementById('sms-apikey-box');
  const btnSaveSmsConfig = document.getElementById('btn-save-sms-config');
  const btnStartSms = document.getElementById('btn-start-sms-register');
  const btnCheckOtp = document.getElementById('btn-check-sms-otp');
  const btnCancelSms = document.getElementById('btn-cancel-sms-register');
  const btnFinishSms = document.getElementById('btn-finish-sms-register');

  let activeActivationId = null;
  let activePhone = null;
  let activeIdentity = null;
  let lastRegisteredAccountId = null;
  let smsPollInterval = null;
  let countdownTimer = null;
  let countdownSeconds = 120;

  function resetSmsWizard() {
    if (smsPollInterval) clearInterval(smsPollInterval);
    if (countdownTimer) clearInterval(countdownTimer);
    activeActivationId = null;
    activePhone = null;
    activeIdentity = null;
    lastRegisteredAccountId = null;

    const cookieInput = document.getElementById('sms-step3-cookie-input');
    if (cookieInput) cookieInput.value = '';
    const feedback = document.getElementById('sms-bind-cookie-feedback');
    if (feedback) { feedback.style.display = 'none'; feedback.textContent = ''; }

    const s1 = document.getElementById('sms-step-1-container');
    const s2 = document.getElementById('sms-step-2-container');
    const s3 = document.getElementById('sms-step-3-container');
    if (s1) s1.style.display = 'block';
    if (s2) s2.style.display = 'none';
    if (s3) s3.style.display = 'none';

    const p1 = document.getElementById('sms-step-pill-1');
    const p2 = document.getElementById('sms-step-pill-2');
    const p3 = document.getElementById('sms-step-pill-3');
    if (p1) p1.className = 'status-pill status-healthy';
    if (p2) p2.className = 'status-pill';
    if (p3) p3.className = 'status-pill';
    const otpBox = document.getElementById('sms-otp-display-box');
    if (otpBox) otpBox.style.display = 'none';
    const copyOtpBtn = document.getElementById('btn-copy-sms-otp');
    if (copyOtpBtn) copyOtpBtn.style.display = 'none';
  }

  async function loadSmsGatewayStatus() {
    try {
      const res = await fetch('/api/accounts/sms-gateway/config');
      const data = await res.json();
      if (data.success) {
        if (providerSelect) providerSelect.value = data.config.provider || 'simulator';
        if (apikeyBox) apikeyBox.style.display = (data.config.provider !== 'simulator') ? 'block' : 'none';
        if (data.config.apiKey) {
          const keyInput = document.getElementById('sms-apikey-input');
          if (keyInput) keyInput.value = data.config.apiKey;
        }
        const balEl = document.getElementById('sms-balance-badge');
        if (balEl && data.balance) {
          balEl.textContent = `${data.balance.balance} ${data.balance.currency} (${data.config.provider === 'simulator' ? 'Simulator Gratis' : 'Live Gateway'})`;
        }
      }
    } catch (e) {}
  }

  if (btnOpenSmsModal && modalSms) {
    btnOpenSmsModal.addEventListener('click', () => {
      modalSms.classList.add('active');
      resetSmsWizard();
      loadSmsGatewayStatus();
    });
  }
  if (btnCloseSmsModal && modalSms) {
    btnCloseSmsModal.addEventListener('click', () => {
      modalSms.classList.remove('active');
      resetSmsWizard();
    });
  }

  if (providerSelect) {
    providerSelect.addEventListener('change', () => {
      if (apikeyBox) apikeyBox.style.display = (providerSelect.value !== 'simulator') ? 'block' : 'none';
    });
  }

  if (btnSaveSmsConfig) {
    btnSaveSmsConfig.addEventListener('click', async () => {
      const provider = providerSelect.value;
      const apiKey = (document.getElementById('sms-apikey-input')?.value || '').trim();
      try {
        const res = await fetch('/api/accounts/sms-gateway/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider, apiKey })
        });
        const data = await res.json();
        if (data.success) {
          showNotification('⚙️ Konfigurasi provider SMS berhasil disimpan.');
          loadSmsGatewayStatus();
        }
      } catch (e) {
        alert(e.message);
      }
    });
  }

  if (btnStartSms) {
    btnStartSms.addEventListener('click', async () => {
      const gender = document.getElementById('sms-gender-select')?.value || 'random';
      const city = (document.getElementById('sms-city-input')?.value || '').trim();

      try {
        btnStartSms.disabled = true;
        btnStartSms.textContent = 'Memesan Nomor (+62)...';

        const res = await fetch('/api/accounts/register-pipeline/init', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ gender, city })
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Gagal memesan nomor telepon');

        activeActivationId = data.activationId;
        activePhone = data.phone;
        activeIdentity = data.identity;

        // Beralih ke Step 2
        document.getElementById('sms-step-1-container').style.display = 'none';
        document.getElementById('sms-step-2-container').style.display = 'block';
        document.getElementById('sms-step-pill-1').className = 'status-pill';
        document.getElementById('sms-step-pill-2').className = 'status-pill status-healthy';

        document.getElementById('sms-allocated-phone').textContent = data.formattedPhone || `+${data.phone}`;
        document.getElementById('sms-target-username').textContent = `@${data.identity.username} (${data.identity.fullName})`;
        document.getElementById('sms-status-headline').textContent = 'Menunggu SMS OTP Masuk dari Shopee...';
        document.getElementById('sms-status-detail').textContent = 'Sistem sedang memantau inbox SMS secara real-time...';

        // Countdown timer
        countdownSeconds = data.expiresInSec || 120;
        const countdownEl = document.getElementById('sms-countdown-timer');
        if (countdownTimer) clearInterval(countdownTimer);
        countdownTimer = setInterval(() => {
          countdownSeconds--;
          if (countdownEl) countdownEl.textContent = `${countdownSeconds} dtk`;
          if (countdownSeconds <= 0) {
            clearInterval(countdownTimer);
            if (smsPollInterval) clearInterval(smsPollInterval);
            document.getElementById('sms-status-headline').textContent = 'Waktu Tunggu Habis (Timeout)';
            document.getElementById('sms-status-detail').textContent = 'SMS tidak kunjung masuk. Silakan batalkan atau coba pesan nomor baru.';
          }
        }, 1000);

        // Auto polling interval
        if (smsPollInterval) clearInterval(smsPollInterval);
        smsPollInterval = setInterval(async () => {
          await pollSmsOtp();
        }, 2200);

      } catch (err) {
        alert(err.message);
      } finally {
        btnStartSms.disabled = false;
        btnStartSms.textContent = '⚡ Dapatkan Nomor Indonesia (+62) & Mulai Registrasi';
      }
    });
  }

  async function pollSmsOtp() {
    if (!activeActivationId) return;
    try {
      const res = await fetch('/api/accounts/sms-gateway/check-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activationId: activeActivationId })
      });
      const data = await res.json();
      if (data.success && data.status === 'RECEIVED' && data.otp) {
        // Stop timers
        if (smsPollInterval) clearInterval(smsPollInterval);
        if (countdownTimer) clearInterval(countdownTimer);

        document.getElementById('sms-status-headline').textContent = '✅ SMS OTP Berhasil Diterima!';
        document.getElementById('sms-status-detail').textContent = `Kode: ${data.otp} • Menyelesaikan pendaftaran & pembuatan sesi Shopee...`;
        const otpBox = document.getElementById('sms-otp-display-box');
        if (otpBox) {
          otpBox.style.display = 'block';
          otpBox.textContent = data.otp;
        }
        const copyOtpBtn = document.getElementById('btn-copy-sms-otp');
        if (copyOtpBtn) {
          copyOtpBtn.style.display = 'inline-block';
        }

        // Complete registration
        setTimeout(async () => {
          try {
            const compRes = await fetch('/api/accounts/register-pipeline/complete', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                activationId: activeActivationId,
                otp: data.otp,
                phone: activePhone,
                identity: activeIdentity
              })
            });
            const compData = await compRes.json();
            if (compData.success) {
              lastRegisteredAccountId = compData.account.id;
              document.getElementById('sms-step-2-container').style.display = 'none';
              document.getElementById('sms-step-3-container').style.display = 'block';
              document.getElementById('sms-step-pill-2').className = 'status-pill';
              document.getElementById('sms-step-pill-3').className = 'status-pill status-healthy';

              const hasCookie = compData.account.cookies && compData.account.status === 'ready';
              document.getElementById('sms-success-summary').innerHTML = `
                Akun resmi <strong>@${escapeHtml(compData.account.username)}</strong> (${escapeHtml(compData.account.name)})<br>
                Nomor: <strong>${escapeHtml(compData.account.phoneNumber)}</strong> • Email: <strong>${escapeHtml(compData.account.email)}</strong><br>
                Status: ${hasCookie 
                  ? '<span style="color:#10b981;font-weight:700;">🔐 Terotentikasi (Cookie Aktif)</span>' 
                  : '<span style="color:#fbbf24;font-weight:700;">🟡 Menunggu Pengikatan Cookie Browser</span>'}
              `;
              loadAccounts();
            }
          } catch (e) {
            alert('Gagal menyelesaikan registrasi: ' + e.message);
          }
        }, 1200);
      }
    } catch (e) {}
  }

  // Handler: Ikat Cookie Asli pada Step 3 Pendaftaran SMS
  const btnBindCookieStep3 = document.getElementById('btn-bind-cookie-step3');
  if (btnBindCookieStep3) {
    btnBindCookieStep3.addEventListener('click', async () => {
      const cookieInput = document.getElementById('sms-step3-cookie-input');
      const feedback = document.getElementById('sms-bind-cookie-feedback');
      const cookieVal = cookieInput ? cookieInput.value.trim() : '';

      if (!cookieVal) {
        if (feedback) {
          feedback.style.display = 'block';
          feedback.style.color = '#ef4444';
          feedback.textContent = 'Silakan tempel cookie dari browser terlebih dahulu.';
        }
        return;
      }

      if (!lastRegisteredAccountId) {
        alert('ID akun tidak ditemukan. Silakan gunakan tombol Bind Cookie di tabel akun.');
        return;
      }

      btnBindCookieStep3.disabled = true;
      btnBindCookieStep3.textContent = 'Mengikat Cookie...';
      try {
        const res = await fetch(`/api/accounts/${lastRegisteredAccountId}/bind-cookies`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cookies: cookieVal })
        });
        const data = await res.json();
        if (data.success) {
          if (feedback) {
            feedback.style.display = 'block';
            feedback.style.color = '#10b981';
            feedback.textContent = '✅ Cookie otentik berhasil diikat! Akun kini berstatus Siap Pakai.';
          }
          document.getElementById('sms-success-summary').innerHTML += `<br><span style="color:#10b981;font-weight:700;">✅ Cookie Berhasil Diikat</span>`;
          loadAccounts();
        } else {
          if (feedback) {
            feedback.style.display = 'block';
            feedback.style.color = '#ef4444';
            feedback.textContent = `❌ ${data.error || 'Gagal mengikat cookie'}`;
          }
        }
      } catch (err) {
        if (feedback) {
          feedback.style.display = 'block';
          feedback.style.color = '#ef4444';
          feedback.textContent = `❌ Error: ${err.message}`;
        }
      } finally {
        btnBindCookieStep3.disabled = false;
        btnBindCookieStep3.textContent = '🔐 Ikat Cookie & Aktifkan Akun';
      }
    });
  }

  // Modal Quick Bind Cookie Handlers
  const modalBindCookie = document.getElementById('modal-bind-cookie');
  const btnCloseBindModal = document.getElementById('btn-close-bind-cookie-modal');
  const btnCancelBind = document.getElementById('btn-cancel-bind-cookie');
  const btnSubmitBind = document.getElementById('btn-submit-bind-cookie');

  window.openBindCookieModal = function(accountId, accountName) {
    const idInput = document.getElementById('modal-bind-account-id');
    const descEl = document.getElementById('modal-bind-account-desc');
    const cookieInput = document.getElementById('modal-bind-cookie-textarea');
    const feedback = document.getElementById('modal-bind-cookie-feedback');

    if (idInput) idInput.value = accountId;
    if (descEl) descEl.textContent = `Mengikat kredensial sesi autentik ke akun: ${accountName || accountId}`;
    if (cookieInput) cookieInput.value = '';
    if (feedback) {
      feedback.style.display = 'none';
      feedback.textContent = '';
    }
    if (modalBindCookie) modalBindCookie.classList.add('active');
  };

  if (btnCloseBindModal && modalBindCookie) {
    btnCloseBindModal.addEventListener('click', () => modalBindCookie.classList.remove('active'));
  }
  if (btnCancelBind && modalBindCookie) {
    btnCancelBind.addEventListener('click', () => modalBindCookie.classList.remove('active'));
  }
  if (btnSubmitBind) {
    btnSubmitBind.addEventListener('click', async () => {
      const accountId = document.getElementById('modal-bind-account-id')?.value;
      const cookieVal = document.getElementById('modal-bind-cookie-textarea')?.value?.trim();
      const feedback = document.getElementById('modal-bind-cookie-feedback');

      if (!accountId) return;
      if (!cookieVal) {
        if (feedback) {
          feedback.style.display = 'block';
          feedback.style.background = 'rgba(239,68,68,0.15)';
          feedback.style.color = '#f87171';
          feedback.textContent = 'String cookie tidak boleh kosong.';
        }
        return;
      }

      btnSubmitBind.disabled = true;
      btnSubmitBind.textContent = 'Menyimpan...';

      try {
        const res = await fetch(`/api/accounts/${encodeURIComponent(accountId)}/bind-cookies`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cookies: cookieVal })
        });
        const data = await res.json();
        if (data.success) {
          showNotification(`Cookie berhasil diikat ke akun @${data.account?.username || accountId}.`);
          modalBindCookie?.classList.remove('active');
          loadAccounts();
        } else {
          if (feedback) {
            feedback.style.display = 'block';
            feedback.style.background = 'rgba(239,68,68,0.15)';
            feedback.style.color = '#f87171';
            feedback.textContent = data.error || 'Gagal mengikat cookie.';
          }
        }
      } catch (e) {
        if (feedback) {
          feedback.style.display = 'block';
          feedback.style.background = 'rgba(239,68,68,0.15)';
          feedback.style.color = '#f87171';
          feedback.textContent = e.message;
        }
      } finally {
        btnSubmitBind.disabled = false;
        btnSubmitBind.textContent = '💾 Simpan & Ikat Cookie';
      }
    });
  }

  if (btnCheckOtp) {
    btnCheckOtp.addEventListener('click', async () => {
      await pollSmsOtp();
    });
  }

  function copyToClipboardRobust(text, btnEl, successLabel = '✅ Tersalin!', originalHtml = '') {
    if (!text) return;
    const prevHtml = originalHtml || (btnEl ? btnEl.innerHTML : '');
    const triggerSuccess = () => {
      if (btnEl) {
        btnEl.innerHTML = successLabel;
        setTimeout(() => { btnEl.innerHTML = prevHtml; }, 2000);
      }
    };

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(triggerSuccess).catch(() => fallbackCopy());
    } else {
      fallbackCopy();
    }

    function fallbackCopy() {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        ta.style.top = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (ok) triggerSuccess();
      } catch (err) {
        triggerSuccess();
      }
    }
  }

  // Action: Salin Nomor Telepon yang dialokasikan
  const btnCopySmsPhone = document.getElementById('btn-copy-sms-phone');
  if (btnCopySmsPhone) {
    btnCopySmsPhone.addEventListener('click', () => {
      const phoneText = activePhone 
        ? (String(activePhone).startsWith('+') ? String(activePhone) : `+${activePhone}`) 
        : (document.getElementById('sms-allocated-phone')?.textContent?.trim() || '');
      copyToClipboardRobust(phoneText, btnCopySmsPhone, '<span>✅</span> Tersalin!', '<span>📋</span> Salin Nomor HP');
    });
  }

  // Action: Salin Kode OTP yang diterima
  const btnCopySmsOtp = document.getElementById('btn-copy-sms-otp');
  if (btnCopySmsOtp) {
    btnCopySmsOtp.addEventListener('click', () => {
      const otpVal = document.getElementById('sms-otp-display-box')?.textContent?.trim();
      if (otpVal && otpVal !== '------') {
        copyToClipboardRobust(otpVal, btnCopySmsOtp, '✅ OTP Tersalin!', '📋 Salin OTP');
      }
    });
  }

  // Action: Salin Skrip Ekstraktor Cookie 1-Klik untuk Console DevTools
  document.querySelectorAll('.btn-copy-extractor').forEach(btn => {
    btn.addEventListener('click', () => {
      const script = "copy(document.cookie.split('; ').filter(x=>x.startsWith('SPC_')||x.startsWith('shopee_')).join('; ') + ';')";
      copyToClipboardRobust(script, btn, '✅ Skrip Tersalin!', '📋 Salin Skrip Ekstraktor');
      if (typeof showNotification === 'function') {
        showNotification('Skrip Ekstraktor tersalin! Buka tab Shopee > F12 Console > Paste > Enter, lalu tempel hasilnya di sini.');
      }
    });
  });

  if (btnCancelSms) {
    btnCancelSms.addEventListener('click', async () => {
      if (!confirm('Batalkan pesanan nomor ini?')) return;
      try {
        if (activeActivationId) {
          await fetch('/api/accounts/sms-gateway/cancel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ activationId: activeActivationId })
          });
        }
        showNotification('Nomor virtual dibatalkan.');
        resetSmsWizard();
      } catch (e) {
        alert(e.message);
      }
    });
  }

  if (btnFinishSms) {
    btnFinishSms.addEventListener('click', () => {
      modalSms.classList.remove('active');
      resetSmsWizard();
      loadAccounts();
    });
  }

  // Setup live search, multi-criteria filters, and pagination for accounts
  setupAccountsFilterListeners();
}

function updateAccountHealthUI(data) {
  const scoreText = document.getElementById('account-health-score-text');
  const summaryText = document.getElementById('account-health-summary-text');
  const detailsBadge = document.getElementById('account-health-details-badge');

  if (scoreText) {
    const score = data.averageHealthScore !== undefined ? data.averageHealthScore : 100;
    scoreText.textContent = `${score}% (${score >= 80 ? 'Optimal' : (score >= 50 ? 'Cukup' : 'Perlu Tindakan')})`;
    scoreText.style.color = score >= 80 ? '#10b981' : (score >= 50 ? '#f59e0b' : '#ef4444');
  }
  if (summaryText) {
    summaryText.textContent = `${data.valid || 0} akun beridentitas lengkap & sehat. ${data.warning || 0} akun perlu perbaikan profil.`;
  }
  if (detailsBadge) {
    detailsBadge.textContent = `${data.valid || 0} Sehat • ${data.warning || 0} Peringatan`;
    detailsBadge.style.background = (data.warning || 0) > 0 ? 'rgba(245,158,11,0.15)' : 'rgba(16,185,129,0.12)';
    detailsBadge.style.color = (data.warning || 0) > 0 ? '#fbbf24' : '#34d399';
  }
}

// =========================================================================
// SKELETON LOADING & ADVANCED TABLE CONTROLS (ACCOUNTS)
// =========================================================================
let allAccountsData = [];
const accountsTableState = {
  search: '',
  type: 'all',
  status: 'all',
  cookie: 'all',
  page: 1,
  pageSize: 25
};

function renderAccountsSkeleton(count = 6) {
  const tbody = document.getElementById('accounts-tbody');
  if (!tbody) return;
  let html = '';
  for (let i = 0; i < count; i++) {
    html += `
      <tr class="skeleton-row">
        <td>
          <div class="user-cell">
            <div class="skeleton-avatar skeleton-shimmer"></div>
            <div style="flex:1;">
              <div class="skeleton-text skeleton-shimmer" style="width:130px;"></div>
              <div class="skeleton-text tiny skeleton-shimmer" style="width:90px;"></div>
            </div>
          </div>
        </td>
        <td><div class="skeleton-badge skeleton-shimmer" style="width:75px;"></div></td>
        <td>
          <div class="skeleton-text skeleton-shimmer" style="width:120px;"></div>
          <div class="skeleton-text tiny skeleton-shimmer" style="width:80px;"></div>
        </td>
        <td><div class="skeleton-text skeleton-shimmer" style="width:140px;"></div></td>
        <td><div class="skeleton-badge skeleton-shimmer" style="width:85px;"></div></td>
        <td><div class="skeleton-badge skeleton-shimmer" style="width:110px;"></div></td>
        <td><div class="skeleton-text short skeleton-shimmer" style="width:40px;"></div></td>
        <td><div class="skeleton-btn skeleton-shimmer"></div></td>
      </tr>
    `;
  }
  tbody.innerHTML = html;
}

async function loadAccounts() {
  const tbody = document.getElementById('accounts-tbody');
  const countBadge = document.getElementById('accounts-total-badge');
  const availBadge = document.getElementById('accounts-available-badge');
  const busyBadge = document.getElementById('accounts-busy-badge');
  if (!tbody) return;

  if (allAccountsData.length === 0) {
    renderAccountsSkeleton(6);
  }

  try {
    const res = await fetch('/api/accounts');
    const data = await res.json();
    if (data.success) {
      allAccountsData = data.accounts || [];
      const total = data.total || allAccountsData.length;
      const available = data.summary ? data.summary.available : allAccountsData.filter(a => !a.isBusy && a.status !== 'suspended').length;
      const busy = data.summary ? data.summary.inUse : allAccountsData.filter(a => a.isBusy).length;

      if (countBadge) countBadge.textContent = `${total} Akun`;
      if (availBadge) availBadge.textContent = `🟢 ${available} Siap Pakai`;
      if (busyBadge) busyBadge.textContent = `🔵 ${busy} Menonton`;

      // Perbarui ringkasan kesehatan akun dengan data riil dari backend
      if (data.health) {
        updateAccountHealthUI(data.health);
      }

      currentAvailableAccounts = available;
      totalAccountsCount = total;

      applyAccountsFilterAndRender();
    }
  } catch (e) {
    console.error('Gagal memuat akun:', e);
  }
}

function applyAccountsFilterAndRender() {
  const tbody = document.getElementById('accounts-tbody');
  const filteredCountEl = document.getElementById('accounts-filtered-count');
  const rawCountEl = document.getElementById('accounts-raw-count');
  if (!tbody) return;

  if (rawCountEl) rawCountEl.textContent = allAccountsData.length;

  const query = accountsTableState.search.toLowerCase().trim();
  const filtered = allAccountsData.filter(acc => {
    // 1. Search Query
    if (query) {
      const name = (acc.name || '').toLowerCase();
      const username = (acc.username || '').toLowerCase();
      const phone = (acc.phoneNumber || '').toLowerCase();
      const email = (acc.email || '').toLowerCase();
      const city = (acc.city || '').toLowerCase();
      const bio = (acc.bio || '').toLowerCase();
      const proxyIp = acc.assignedProxy ? `${acc.assignedProxy.ip}:${acc.assignedProxy.port}`.toLowerCase() : '';
      
      const match = name.includes(query) || 
                    username.includes(query) || 
                    phone.includes(query) || 
                    email.includes(query) || 
                    city.includes(query) || 
                    bio.includes(query) || 
                    proxyIp.includes(query);
      if (!match) return false;
    }

    // 2. Type Filter
    if (accountsTableState.type !== 'all') {
      if (accountsTableState.type === 'persona') {
        if (acc.accountType && acc.accountType !== 'persona') return false;
      } else if (acc.accountType !== accountsTableState.type) {
        return false;
      }
    }

    // 3. Status Filter
    if (accountsTableState.status !== 'all') {
      if (accountsTableState.status === 'suspended' && acc.status !== 'suspended') return false;
      if (accountsTableState.status === 'busy' && (!acc.isBusy || acc.status === 'suspended')) return false;
      if (accountsTableState.status === 'ready' && (acc.isBusy || acc.status === 'suspended')) return false;
    }

    // 4. Cookie Filter
    if (accountsTableState.cookie !== 'all') {
      if (accountsTableState.cookie === 'alive' && (!acc.cookies || acc.cookieStatus !== 'alive')) return false;
      if (accountsTableState.cookie === 'expired' && (!acc.cookies || acc.cookieStatus === 'alive')) return false;
      if (accountsTableState.cookie === 'no_cookie' && acc.cookies) return false;
    }

    return true;
  });

  if (filteredCountEl) filteredCountEl.textContent = filtered.length;

  // Pagination calculation
  const totalItems = filtered.length;
  const pageSize = accountsTableState.pageSize === 'all' ? totalItems : parseInt(accountsTableState.pageSize, 10);
  const totalPages = pageSize > 0 ? Math.ceil(totalItems / pageSize) || 1 : 1;
  
  if (accountsTableState.page > totalPages) accountsTableState.page = totalPages;
  if (accountsTableState.page < 1) accountsTableState.page = 1;

  const startIndex = (accountsTableState.page - 1) * pageSize;
  const endIndex = accountsTableState.pageSize === 'all' ? totalItems : startIndex + pageSize;
  const pagedItems = filtered.slice(startIndex, endIndex);

  renderAccountsRows(pagedItems, filtered.length);
  renderAccountsPagination(totalItems, totalPages, startIndex, endIndex);
}

function renderAccountsRows(items, totalFiltered) {
  const tbody = document.getElementById('accounts-tbody');
  if (!tbody) return;

  if (allAccountsData.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--text-dim);padding:35px;">Belum ada akun. Klik tombol 'Generate Persona', 'Import Real Cookies', atau 'Registrasi via SMS' di atas.</td></tr>`;
    return;
  }

  if (totalFiltered === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--text-dim);padding:35px;">🔍 Tidak ada akun yang cocok dengan kriteria pencarian/filter.</td></tr>`;
    return;
  }

  const fragment = document.createDocumentFragment();

  items.forEach(acc => {
    const tr = document.createElement('tr');
    const fallbackAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(acc.name || 'User')}&background=ee4d2d&color=fff`;
    const avatarSrc = acc.avatar || fallbackAvatar;

    // Type badge
    let typeBadge = `<span style="background:rgba(148,163,184,0.12);color:var(--text-muted);padding:3px 8px;border-radius:4px;font-size:0.72rem;font-weight:600;">👤 Persona</span>`;
    if (acc.accountType === 'real_authenticated') {
      typeBadge = `<span style="background:rgba(6,182,212,0.15);color:#22d3ee;padding:3px 8px;border-radius:4px;font-size:0.72rem;font-weight:700;">🔐 Real Cookie</span>`;
    } else if (acc.accountType === 'real_registered') {
      typeBadge = `
        <span style="background:rgba(16,185,129,0.15);color:#34d399;padding:3px 8px;border-radius:4px;font-size:0.72rem;font-weight:700;">📱 Real SMS</span>
        <div style="font-size:0.7rem;color:var(--text-dim);font-family:'JetBrains Mono',monospace;margin-top:2px;">${escapeHtml(acc.phoneNumber || '')}</div>
      `;
    }

    // Status badge
    let statusBadge = '';
    if (acc.status === 'suspended') {
      statusBadge = `<span style="background:rgba(244,63,94,0.15);color:#fb7185;padding:3px 8px;border-radius:4px;font-size:0.75rem;font-weight:600;">🔴 Terblokir</span>`;
    } else if (acc.status === 'pending_cookie_import') {
      statusBadge = `<span style="background:rgba(245,158,11,0.15);color:#fbbf24;padding:3px 8px;border-radius:4px;font-size:0.75rem;font-weight:600;">🟡 Menunggu Cookie</span>`;
    } else if (acc.isBusy) {
      statusBadge = `<span style="background:rgba(59,130,246,0.15);color:#60a5fa;padding:3px 8px;border-radius:4px;font-size:0.75rem;font-weight:600;display:inline-flex;align-items:center;gap:4px;">
        <span class="pulse-dot" style="background:#60a5fa;box-shadow:0 0 8px #60a5fa;width:6px;height:6px;"></span> Menonton [${escapeHtml(acc.busyInCampaign || 'Live')}]
      </span>`;
    } else {
      statusBadge = `<span style="background:rgba(16,185,129,0.15);color:#34d399;padding:3px 8px;border-radius:4px;font-size:0.75rem;font-weight:600;display:inline-flex;align-items:center;gap:4px;">
        🟢 Siap Pakai
      </span>`;
    }

    let cookieIndicator = '';
    if (acc.cookies) {
      if (acc.cookieStatus === 'alive') {
        cookieIndicator = `<div style="font-size:0.68rem;color:#34d399;margin-top:3px;font-weight:600;">● Sesi Cookie Aktif</div>`;
      } else {
        cookieIndicator = `<div style="font-size:0.68rem;color:#f43f5e;margin-top:3px;font-weight:600;">● Sesi Cookie Expired</div>`;
      }
    }

    // Sticky Assigned Proxy
    let proxyBadge = `<span style="font-size:0.72rem;color:var(--text-dim);">Auto (Pool)</span>`;
    if (acc.assignedProxy) {
      const prxProto = (acc.assignedProxy.protocol || 'http').toUpperCase();
      const prxType = (acc.assignedProxy.type || 'datacenter').toLowerCase();
      let typeColor = '#60a5fa';
      if (prxType === 'residential') typeColor = '#34d399';
      if (prxType === 'mobile') typeColor = '#f59e0b';
      if (prxType === 'rotating') typeColor = '#a855f7';

      proxyBadge = `
        <div style="display:inline-flex;flex-direction:column;gap:2px;">
          <span style="background:rgba(255,255,255,0.06);color:var(--text-main);padding:2px 6px;border-radius:4px;font-size:0.72rem;font-family:'JetBrains Mono',monospace;font-weight:600;">
            🌐 ${escapeHtml(acc.assignedProxy.ip)}:${acc.assignedProxy.port}
          </span>
          <span style="font-size:0.68rem;color:${typeColor};font-weight:600;">
            [${prxProto} • ${prxType.toUpperCase()}]
          </span>
        </div>
      `;
    }

    tr.innerHTML = `
      <td>
        <div class="user-cell">
          <img src="${avatarSrc}" class="user-avatar" alt="${acc.name || 'User'}" onerror="this.src='${fallbackAvatar}'" />
          <div>
            <div class="user-name-title">${escapeHtml(acc.name || 'Pengguna Shopee')}</div>
            <div class="user-subtext">@${escapeHtml(acc.username || '')} • ${acc.gender === 'male' ? 'Laki-laki' : 'Perempuan'}</div>
          </div>
        </div>
      </td>
      <td>
        ${typeBadge}
      </td>
      <td>
        <div>${escapeHtml(acc.email || '-')}</div>
        <div class="user-subtext">Kota: ${escapeHtml(acc.city || 'Indonesia')}</div>
      </td>
      <td>
        <div style="max-width:200px;font-size:0.78rem;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          "${escapeHtml(acc.bio || '-')}"
        </div>
      </td>
      <td>
        ${statusBadge}
        ${cookieIndicator}
      </td>
      <td>
        ${proxyBadge}
      </td>
      <td>
        <strong style="color:#ff8c6d;">${acc.totalLiveWatched || 0}x</strong>
      </td>
      <td>
        <div style="display:flex;gap:4px;align-items:center;">
          ${(!acc.cookies || acc.status === 'pending_cookie_import') ? `
            <button class="btn btn-secondary" style="padding:5px 8px;font-size:0.72rem;color:#10b981;" onclick="openBindCookieModal('${acc.id}', '${escapeHtml(acc.name || acc.username)}')" title="Ikat cookie otentik dari browser">
              📋 Bind Cookie
            </button>
          ` : ''}
          ${acc.cookies ? `
            <button class="btn btn-secondary" style="padding:5px 8px;font-size:0.72rem;color:#06b6d4;" onclick="validateSingleCookie('${acc.id}')" title="Uji validitas cookie sesi">
              ⚡ Uji
            </button>
          ` : ''}
          <button class="btn btn-secondary" style="padding:5px 8px;font-size:0.72rem;color:#f43f5e;" onclick="deleteAccount('${acc.id}')">
            Hapus
          </button>
        </div>
      </td>
    `;
    fragment.appendChild(tr);
  });

  tbody.innerHTML = '';
  tbody.appendChild(fragment);
}

function renderAccountsPagination(totalItems, totalPages, startIndex, endIndex) {
  const infoEl = document.getElementById('accounts-pagination-info');
  const actionsEl = document.getElementById('accounts-pagination-actions');
  if (!infoEl || !actionsEl) return;

  if (totalItems === 0) {
    infoEl.textContent = 'Tidak ada data akun';
    actionsEl.innerHTML = '';
    return;
  }

  const showingStart = totalItems > 0 ? startIndex + 1 : 0;
  const showingEnd = Math.min(endIndex, totalItems);
  infoEl.innerHTML = `Menampilkan <strong>${showingStart}–${showingEnd}</strong> dari <strong>${totalItems}</strong> akun (Hal <strong>${accountsTableState.page}</strong>/${totalPages})`;

  let html = '';
  html += `<button type="button" class="pagination-btn" ${accountsTableState.page <= 1 ? 'disabled' : ''} onclick="changeAccountsPage(${accountsTableState.page - 1})">◀ Prev</button>`;

  const maxButtons = 5;
  let startPage = Math.max(1, accountsTableState.page - Math.floor(maxButtons / 2));
  let endPage = Math.min(totalPages, startPage + maxButtons - 1);
  if (endPage - startPage + 1 < maxButtons) {
    startPage = Math.max(1, endPage - maxButtons + 1);
  }

  if (startPage > 1) {
    html += `<button type="button" class="pagination-btn" onclick="changeAccountsPage(1)">1</button>`;
    if (startPage > 2) html += `<span style="color:var(--text-dim);padding:0 2px;">...</span>`;
  }

  for (let p = startPage; p <= endPage; p++) {
    html += `<button type="button" class="pagination-btn ${p === accountsTableState.page ? 'active' : ''}" onclick="changeAccountsPage(${p})">${p}</button>`;
  }

  if (endPage < totalPages) {
    if (endPage < totalPages - 1) html += `<span style="color:var(--text-dim);padding:0 2px;">...</span>`;
    html += `<button type="button" class="pagination-btn" onclick="changeAccountsPage(${totalPages})">${totalPages}</button>`;
  }

  html += `<button type="button" class="pagination-btn" ${accountsTableState.page >= totalPages ? 'disabled' : ''} onclick="changeAccountsPage(${accountsTableState.page + 1})">Next ▶</button>`;

  actionsEl.innerHTML = html;
}

window.changeAccountsPage = function(newPage) {
  accountsTableState.page = newPage;
  applyAccountsFilterAndRender();
};

function setupAccountsFilterListeners() {
  const searchInput = document.getElementById('accounts-search-input');
  const filterType = document.getElementById('accounts-filter-type');
  const filterStatus = document.getElementById('accounts-filter-status');
  const filterCookie = document.getElementById('accounts-filter-cookie');
  const pageSizeSelect = document.getElementById('accounts-page-size');
  const btnReset = document.getElementById('accounts-btn-reset-filter');

  let debounceTimer = null;
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        accountsTableState.search = e.target.value;
        accountsTableState.page = 1;
        applyAccountsFilterAndRender();
      }, 150);
    });
  }

  if (filterType) {
    filterType.addEventListener('change', (e) => {
      accountsTableState.type = e.target.value;
      accountsTableState.page = 1;
      applyAccountsFilterAndRender();
    });
  }

  if (filterStatus) {
    filterStatus.addEventListener('change', (e) => {
      accountsTableState.status = e.target.value;
      accountsTableState.page = 1;
      applyAccountsFilterAndRender();
    });
  }

  if (filterCookie) {
    filterCookie.addEventListener('change', (e) => {
      accountsTableState.cookie = e.target.value;
      accountsTableState.page = 1;
      applyAccountsFilterAndRender();
    });
  }

  if (pageSizeSelect) {
    pageSizeSelect.addEventListener('change', (e) => {
      accountsTableState.pageSize = e.target.value;
      accountsTableState.page = 1;
      applyAccountsFilterAndRender();
    });
  }

  if (btnReset) {
    btnReset.addEventListener('click', () => {
      if (searchInput) searchInput.value = '';
      if (filterType) filterType.value = 'all';
      if (filterStatus) filterStatus.value = 'all';
      if (filterCookie) filterCookie.value = 'all';
      if (pageSizeSelect) pageSizeSelect.value = '25';

      accountsTableState.search = '';
      accountsTableState.type = 'all';
      accountsTableState.status = 'all';
      accountsTableState.cookie = 'all';
      accountsTableState.page = 1;
      accountsTableState.pageSize = 25;

      applyAccountsFilterAndRender();
    });
  }
}

window.validateSingleCookie = async function(id) {
  try {
    const res = await fetch(`/api/accounts/${id}/validate-cookie`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showNotification(`🔐 Status Cookie Akun: ${data.status === 'alive' ? 'AKTIF (Sesi Valid)' : 'KEDALUWARSA'}`);
      loadAccounts();
    } else {
      alert(data.error || 'Gagal memvalidasi');
    }
  } catch (e) {
    alert(e.message);
  }
};

window.deleteAccount = async function(id) {
  if (!confirm('Hapus akun ini?')) return;
  try {
    const res = await fetch(`/api/accounts/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      loadAccounts();
    }
  } catch (e) {}
};

// =========================================================================
// PROXY HANDLERS
// =========================================================================
function setupProxyHandlers() {
  const btnOpenModal = document.getElementById('btn-open-proxy-modal');
  const modal = document.getElementById('modal-import-proxy');
  const btnCloseModal = document.getElementById('btn-close-proxy-modal');
  const btnSubmit = document.getElementById('btn-submit-proxy-import');
  const btnTest = document.getElementById('btn-test-all-proxies');

  // Gateway elements
  const tabBtnGateway = document.getElementById('tab-btn-proxy-gateway');
  const tabBtnManual = document.getElementById('tab-btn-proxy-manual');
  const sectionGateway = document.getElementById('proxy-gateway-form-section');
  const sectionManual = document.getElementById('proxy-manual-form-section');
  const gwProviderSelect = document.getElementById('gw-provider-select');
  const gwProtocolSelect = document.getElementById('gw-protocol-select');
  const gwHostInput = document.getElementById('gw-host-input');
  const gwPortInput = document.getElementById('gw-port-input');
  const gwUserInput = document.getElementById('gw-user-input');
  const gwPassInput = document.getElementById('gw-pass-input');
  const gwProbeBox = document.getElementById('gw-probe-result-box');
  const btnSubmitGateway = document.getElementById('btn-submit-gateway');
  const btnProbeGateway = document.getElementById('btn-probe-gateway');

  // Tab switching
  if (tabBtnGateway && tabBtnManual) {
    tabBtnGateway.addEventListener('click', () => {
      tabBtnGateway.className = 'btn btn-primary';
      tabBtnManual.className = 'btn btn-secondary';
      if (sectionGateway) sectionGateway.style.display = 'block';
      if (sectionManual) sectionManual.style.display = 'none';
    });
    tabBtnManual.addEventListener('click', () => {
      tabBtnManual.className = 'btn btn-primary';
      tabBtnGateway.className = 'btn btn-secondary';
      if (sectionManual) sectionManual.style.display = 'block';
      if (sectionGateway) sectionGateway.style.display = 'none';
    });
  }

  // Provider template helper
  const providerTemplates = {
    smartproxy: { host: 'gate.smartproxy.com', port: 7000, protocol: 'http' },
    oxylabs: { host: 'pr.oxylabs.io', port: 7777, protocol: 'http' },
    brightdata: { host: 'brd.superproxy.io', port: 22225, protocol: 'http' },
    webshare: { host: 'p.webshare.io', port: 80, protocol: 'http' }
  };

  if (gwProviderSelect) {
    gwProviderSelect.addEventListener('change', (e) => {
      const tpl = providerTemplates[e.target.value];
      if (tpl) {
        if (gwHostInput) gwHostInput.value = tpl.host;
        if (gwPortInput) gwPortInput.value = tpl.port;
        if (gwProtocolSelect) gwProtocolSelect.value = tpl.protocol;
      }
    });
  }

  async function loadExistingGateway() {
    try {
      const res = await fetch('/api/proxies/gateway');
      const data = await res.json();
      if (data.success && data.gateway) {
        if (gwHostInput && !gwHostInput.value) gwHostInput.value = data.gateway.ip;
        if (gwPortInput && !gwPortInput.value) gwPortInput.value = data.gateway.port;
        if (gwProtocolSelect) gwProtocolSelect.value = data.gateway.protocol || 'http';
        if (gwUserInput && !gwUserInput.value) gwUserInput.value = data.gateway.username || '';
        if (gwProviderSelect && data.gateway.provider) gwProviderSelect.value = data.gateway.provider;
      }
    } catch (e) {}
  }

  if (btnOpenModal && modal) {
    btnOpenModal.addEventListener('click', () => {
      modal.classList.add('active');
      loadExistingGateway();
    });
  }
  if (btnCloseModal && modal) {
    btnCloseModal.addEventListener('click', () => modal.classList.remove('active'));
  }

  // Probe Gateway Button
  if (btnProbeGateway) {
    btnProbeGateway.addEventListener('click', async () => {
      const host = (gwHostInput?.value || '').trim();
      const port = parseInt(gwPortInput?.value, 10);
      if (!host || isNaN(port)) {
        alert('Masukkan Host dan Port gateway terlebih dahulu.');
        return;
      }
      try {
        btnProbeGateway.disabled = true;
        btnProbeGateway.textContent = '⏳ Menguji...';
        if (gwProbeBox) {
          gwProbeBox.style.display = 'block';
          gwProbeBox.style.background = 'rgba(6,182,212,0.1)';
          gwProbeBox.style.color = '#22d3ee';
          gwProbeBox.textContent = 'Menghubungkan ke gateway proxy...';
        }

        const res = await fetch('/api/proxies/probe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            host,
            port,
            protocol: gwProtocolSelect?.value || 'http',
            username: gwUserInput?.value || '',
            password: gwPassInput?.value || ''
          })
        });
        const data = await res.json();
        if (data.success) {
          if (gwProbeBox) {
            gwProbeBox.style.background = 'rgba(16,185,129,0.15)';
            gwProbeBox.style.color = '#34d399';
            gwProbeBox.innerHTML = `✅ <strong>Terhubung!</strong> Latensi: ${data.latency || 45}ms. Gateway siap digunakan.`;
          }
        } else {
          if (gwProbeBox) {
            gwProbeBox.style.background = 'rgba(239,68,68,0.15)';
            gwProbeBox.style.color = '#f87171';
            gwProbeBox.innerHTML = `⚠️ <strong>Gagal:</strong> ${data.error || 'Connection timed out'}. Periksa host, port, dan kredensial.`;
          }
        }
      } catch (e) {
        if (gwProbeBox) {
          gwProbeBox.style.display = 'block';
          gwProbeBox.style.background = 'rgba(239,68,68,0.15)';
          gwProbeBox.style.color = '#f87171';
          gwProbeBox.textContent = 'Error: ' + e.message;
        }
      } finally {
        btnProbeGateway.disabled = false;
        btnProbeGateway.textContent = '⚡ Uji Koneksi';
      }
    });
  }

  // Submit Gateway Button
  if (btnSubmitGateway) {
    btnSubmitGateway.addEventListener('click', async () => {
      const host = (gwHostInput?.value || '').trim();
      const port = parseInt(gwPortInput?.value, 10);
      if (!host || isNaN(port)) {
        alert('Masukkan Host dan Port gateway.');
        return;
      }
      try {
        btnSubmitGateway.disabled = true;
        btnSubmitGateway.textContent = 'Menyimpan...';

        const res = await fetch('/api/proxies/gateway', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            host,
            port,
            protocol: gwProtocolSelect?.value || 'http',
            username: gwUserInput?.value || '',
            password: gwPassInput?.value || '',
            provider: gwProviderSelect?.value || 'custom'
          })
        });
        const data = await res.json();
        if (data.success) {
          showNotification(`🌟 Residential Rotating Gateway aktif: ${data.proxy.ip}:${data.proxy.port}`);
          modal.classList.remove('active');
          loadProxies();
        } else {
          alert('Gagal menyimpan gateway: ' + (data.error || 'Error'));
        }
      } catch (e) {
        alert(e.message);
      } finally {
        btnSubmitGateway.disabled = false;
        btnSubmitGateway.textContent = '💾 Pasang Residential Gateway';
      }
    });
  }

  // Manual list submit
  if (btnSubmit) {
    btnSubmit.addEventListener('click', async () => {
      const rawText = document.getElementById('proxy-textarea-input').value;
      if (!rawText.trim()) return;

      try {
        btnSubmit.disabled = true;
        const defaultProtocol = document.getElementById('proxy-default-protocol')?.value || 'http';
        const defaultType = document.getElementById('proxy-default-type')?.value || 'datacenter';

        const res = await fetch('/api/proxies/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rawText, defaultProtocol, defaultType })
        });
        const data = await res.json();
        if (data.success) {
          showNotification(`🌐 Berhasil mengimpor ${data.addedCount} proxy IP.`);
          modal.classList.remove('active');
          document.getElementById('proxy-textarea-input').value = '';
          loadProxies();
        }
      } catch (e) {
        alert(e.message);
      } finally {
        btnSubmit.disabled = false;
      }
    });
  }

  if (btnTest) {
    btnTest.addEventListener('click', async () => {
      try {
        btnTest.disabled = true;
        btnTest.textContent = '⏳ Menguji Latensi...';
        const res = await fetch('/api/proxies/test', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          showNotification(`✅ Uji Proxy Selesai: ${data.alive}/${data.total} aktif.`);
          loadProxies();
        }
      } catch (e) {
        alert(e.message);
      } finally {
        btnTest.disabled = false;
        btnTest.textContent = '⚡ Uji Semua Proxy';
      }
    });
  }

  const btnPurge = document.getElementById('btn-purge-dead-proxies');
  if (btnPurge) {
    btnPurge.addEventListener('click', async () => {
      if (!confirm('Hapus seluruh proxy yang mati/timeout dari database?')) return;
      try {
        btnPurge.disabled = true;
        btnPurge.textContent = '⏳ Membersihkan...';
        const res = await fetch('/api/proxies/purge-dead', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          showNotification(`🗑️ Berhasil menghapus ${data.purgedCount} proxy mati. Sisa ${data.remainingAlive} proxy hidup.`);
          loadProxies();
        }
      } catch (err) {
        alert(err.message);
      } finally {
        btnPurge.disabled = false;
        btnPurge.textContent = '🗑️ Bersihkan Proxy Mati';
      }
    });
  }

  // Setup live search, multi-criteria filters, and pagination for proxies
  setupProxiesFilterListeners();
}

// =========================================================================
// SKELETON LOADING & ADVANCED TABLE CONTROLS (PROXIES)
// =========================================================================
let allProxiesData = [];
const proxiesTableState = {
  search: '',
  protocol: 'all',
  type: 'all',
  status: 'all',
  page: 1,
  pageSize: 25
};

function renderProxiesSkeleton(count = 6) {
  const tbody = document.getElementById('proxy-tbody');
  if (!tbody) return;
  let html = '';
  for (let i = 0; i < count; i++) {
    html += `
      <tr class="skeleton-row">
        <td><div class="skeleton-text skeleton-shimmer" style="width:130px;"></div></td>
        <td><div class="skeleton-badge skeleton-shimmer" style="width:65px;"></div></td>
        <td><div class="skeleton-badge skeleton-shimmer" style="width:90px;"></div></td>
        <td><div class="skeleton-text skeleton-shimmer" style="width:110px;"></div></td>
        <td><div class="skeleton-text short skeleton-shimmer" style="width:55px;"></div></td>
        <td><div class="skeleton-badge skeleton-shimmer" style="width:70px;"></div></td>
        <td><div class="skeleton-text short skeleton-shimmer" style="width:80px;"></div></td>
        <td><div class="skeleton-btn skeleton-shimmer"></div></td>
      </tr>
    `;
  }
  tbody.innerHTML = html;
}

async function loadProxies() {
  const tbody = document.getElementById('proxy-tbody');
  const countBadge = document.getElementById('proxy-total-badge');
  const healthBadge = document.getElementById('proxy-health-badge');
  if (!tbody) return;

  if (allProxiesData.length === 0) {
    renderProxiesSkeleton(6);
  }

  try {
    const res = await fetch('/api/proxies');
    const data = await res.json();
    if (data.success) {
      allProxiesData = data.proxies || [];
      if (countBadge) countBadge.textContent = `${data.alive} Aktif / ${data.total} Total`;
      
      const ratio = data.total > 0 ? Math.round((data.alive / data.total) * 100) : 100;
      if (healthBadge) {
        healthBadge.textContent = `⚡ Rasio Sehat: ${ratio}%`;
        healthBadge.style.color = ratio >= 70 ? '#34d399' : (ratio >= 40 ? '#fbbf24' : '#fb7185');
        healthBadge.style.background = ratio >= 70 ? 'rgba(16,185,129,0.15)' : (ratio >= 40 ? 'rgba(245,158,11,0.15)' : 'rgba(244,63,94,0.15)');
      }

      applyProxiesFilterAndRender();
    }
  } catch (e) {
    console.error('Gagal memuat proxy:', e);
  }
}

function applyProxiesFilterAndRender() {
  const tbody = document.getElementById('proxy-tbody');
  const filteredCountEl = document.getElementById('proxy-filtered-count');
  const rawCountEl = document.getElementById('proxy-raw-count');
  if (!tbody) return;

  if (rawCountEl) rawCountEl.textContent = allProxiesData.length;

  const query = proxiesTableState.search.toLowerCase().trim();
  const filtered = allProxiesData.filter(prx => {
    // 1. Search Query
    if (query) {
      const ip = (prx.ip || '').toLowerCase();
      const port = (prx.port ? String(prx.port) : '').toLowerCase();
      const city = (prx.city || '').toLowerCase();
      const country = (prx.country || '').toLowerCase();
      const user = (prx.username || '').toLowerCase();
      const match = ip.includes(query) || port.includes(query) || city.includes(query) || country.includes(query) || user.includes(query);
      if (!match) return false;
    }

    // 2. Protocol Filter
    if (proxiesTableState.protocol !== 'all') {
      const proto = (prx.protocol || 'http').toLowerCase();
      if (proto !== proxiesTableState.protocol) return false;
    }

    // 3. Type Filter
    if (proxiesTableState.type !== 'all') {
      const pType = (prx.type || 'datacenter').toLowerCase();
      if (pType !== proxiesTableState.type) return false;
    }

    // 4. Status Filter
    if (proxiesTableState.status !== 'all') {
      if (proxiesTableState.status === 'alive' && prx.status !== 'alive') return false;
      if (proxiesTableState.status === 'dead' && prx.status !== 'dead') return false;
      if (proxiesTableState.status === 'untested' && prx.status !== 'untested') return false;
    }

    return true;
  });

  if (filteredCountEl) filteredCountEl.textContent = filtered.length;

  // Pagination calculation
  const totalItems = filtered.length;
  const pageSize = proxiesTableState.pageSize === 'all' ? totalItems : parseInt(proxiesTableState.pageSize, 10);
  const totalPages = pageSize > 0 ? Math.ceil(totalItems / pageSize) || 1 : 1;
  
  if (proxiesTableState.page > totalPages) proxiesTableState.page = totalPages;
  if (proxiesTableState.page < 1) proxiesTableState.page = 1;

  const startIndex = (proxiesTableState.page - 1) * pageSize;
  const endIndex = proxiesTableState.pageSize === 'all' ? totalItems : startIndex + pageSize;
  const pagedItems = filtered.slice(startIndex, endIndex);

  renderProxiesRows(pagedItems, filtered.length);
  renderProxiesPagination(totalItems, totalPages, startIndex, endIndex);
}

function renderProxiesRows(items, totalFiltered) {
  const tbody = document.getElementById('proxy-tbody');
  if (!tbody) return;

  if (allProxiesData.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--text-dim);padding:30px;">Belum ada proxy di database. Klik 'Import Proxy' untuk menambahkan.</td></tr>`;
    return;
  }

  if (totalFiltered === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--text-dim);padding:35px;">🔍 Tidak ada proxy yang cocok dengan kriteria pencarian/filter.</td></tr>`;
    return;
  }

  const fragment = document.createDocumentFragment();

  items.forEach(prx => {
    const tr = document.createElement('tr');
    const isAlive = prx.status === 'alive';
    const latencyColor = isAlive 
      ? (prx.latency < 60 ? '#10b981' : '#f59e0b') 
      : '#f43f5e';

    // Protocol Badge
    const proto = (prx.protocol || 'http').toLowerCase();
    let protoBadge = `<span style="background:rgba(59,130,246,0.15);color:#60a5fa;padding:2px 7px;border-radius:4px;font-size:0.72rem;font-weight:700;">HTTP</span>`;
    if (proto === 'https') {
      protoBadge = `<span style="background:rgba(16,185,129,0.15);color:#34d399;padding:2px 7px;border-radius:4px;font-size:0.72rem;font-weight:700;">HTTPS</span>`;
    } else if (proto === 'socks5') {
      protoBadge = `<span style="background:rgba(168,85,247,0.15);color:#c084fc;padding:2px 7px;border-radius:4px;font-size:0.72rem;font-weight:700;">SOCKS5</span>`;
    } else if (proto === 'socks4') {
      protoBadge = `<span style="background:rgba(245,158,11,0.15);color:#fbbf24;padding:2px 7px;border-radius:4px;font-size:0.72rem;font-weight:700;">SOCKS4</span>`;
    }

    // Type Badge
    const pType = (prx.type || 'datacenter').toLowerCase();
    let typeBadge = `<span style="background:rgba(148,163,184,0.12);color:var(--text-muted);padding:2px 7px;border-radius:4px;font-size:0.72rem;font-weight:600;">🏢 Datacenter</span>`;
    if (pType === 'residential') {
      typeBadge = `<span style="background:rgba(16,185,129,0.15);color:#34d399;padding:2px 7px;border-radius:4px;font-size:0.72rem;font-weight:600;">🏠 Residential</span>`;
    } else if (pType === 'mobile') {
      typeBadge = `<span style="background:rgba(245,158,11,0.15);color:#fbbf24;padding:2px 7px;border-radius:4px;font-size:0.72rem;font-weight:600;">📱 Mobile</span>`;
    } else if (pType === 'rotating') {
      typeBadge = `<span style="background:rgba(236,72,153,0.15);color:#f472b6;padding:2px 7px;border-radius:4px;font-size:0.72rem;font-weight:600;">🔄 Rotating</span>`;
    }

    tr.innerHTML = `
      <td><strong>${escapeHtml(prx.ip)}</strong>:${prx.port}</td>
      <td>${protoBadge}</td>
      <td>${typeBadge}</td>
      <td>${escapeHtml(prx.city || 'Indonesia')} (${prx.country || 'ID'})</td>
      <td>
        <span style="color:${latencyColor};font-weight:700;">${isAlive ? prx.latency + ' ms' : 'Offline'}</span>
      </td>
      <td>
        <span style="background:${isAlive ? 'rgba(16,185,129,0.15)' : 'rgba(244,63,94,0.15)'};color:${isAlive ? '#34d399' : '#fb7185'};padding:3px 8px;border-radius:4px;font-size:0.75rem;font-weight:600;">
          ${isAlive ? 'ALIVE' : 'DEAD'}
        </span>
      </td>
      <td>${prx.username ? 'Ya (User/Pass)' : 'IP Whitelist'}</td>
      <td>
        <div style="display:flex;gap:4px;align-items:center;">
          <button class="btn btn-secondary" style="padding:5px 8px;font-size:0.72rem;color:#38bdf8;" onclick="testSingleProxy('${prx.id}', this)" title="Uji latensi soket riil">
            ⚡ Uji
          </button>
          <button class="btn btn-secondary" style="padding:5px 8px;font-size:0.72rem;color:#f43f5e;" onclick="deleteProxy('${prx.id}')">
            Hapus
          </button>
        </div>
      </td>
    `;
    fragment.appendChild(tr);
  });

  tbody.innerHTML = '';
  tbody.appendChild(fragment);
}

function renderProxiesPagination(totalItems, totalPages, startIndex, endIndex) {
  const infoEl = document.getElementById('proxy-pagination-info');
  const actionsEl = document.getElementById('proxy-pagination-actions');
  if (!infoEl || !actionsEl) return;

  if (totalItems === 0) {
    infoEl.textContent = 'Tidak ada data proxy';
    actionsEl.innerHTML = '';
    return;
  }

  const showingStart = totalItems > 0 ? startIndex + 1 : 0;
  const showingEnd = Math.min(endIndex, totalItems);
  infoEl.innerHTML = `Menampilkan <strong>${showingStart}–${showingEnd}</strong> dari <strong>${totalItems}</strong> proxy (Hal <strong>${proxiesTableState.page}</strong>/${totalPages})`;

  let html = '';
  html += `<button type="button" class="pagination-btn" ${proxiesTableState.page <= 1 ? 'disabled' : ''} onclick="changeProxiesPage(${proxiesTableState.page - 1})">◀ Prev</button>`;

  const maxButtons = 5;
  let startPage = Math.max(1, proxiesTableState.page - Math.floor(maxButtons / 2));
  let endPage = Math.min(totalPages, startPage + maxButtons - 1);
  if (endPage - startPage + 1 < maxButtons) {
    startPage = Math.max(1, endPage - maxButtons + 1);
  }

  if (startPage > 1) {
    html += `<button type="button" class="pagination-btn" onclick="changeProxiesPage(1)">1</button>`;
    if (startPage > 2) html += `<span style="color:var(--text-dim);padding:0 2px;">...</span>`;
  }

  for (let p = startPage; p <= endPage; p++) {
    html += `<button type="button" class="pagination-btn ${p === proxiesTableState.page ? 'active' : ''}" onclick="changeProxiesPage(${p})">${p}</button>`;
  }

  if (endPage < totalPages) {
    if (endPage < totalPages - 1) html += `<span style="color:var(--text-dim);padding:0 2px;">...</span>`;
    html += `<button type="button" class="pagination-btn" onclick="changeProxiesPage(${totalPages})">${totalPages}</button>`;
  }

  html += `<button type="button" class="pagination-btn" ${proxiesTableState.page >= totalPages ? 'disabled' : ''} onclick="changeProxiesPage(${proxiesTableState.page + 1})">Next ▶</button>`;

  actionsEl.innerHTML = html;
}

window.changeProxiesPage = function(newPage) {
  proxiesTableState.page = newPage;
  applyProxiesFilterAndRender();
};

function setupProxiesFilterListeners() {
  const searchInput = document.getElementById('proxy-search-input');
  const filterProtocol = document.getElementById('proxy-filter-protocol');
  const filterType = document.getElementById('proxy-filter-type');
  const filterStatus = document.getElementById('proxy-filter-status');
  const pageSizeSelect = document.getElementById('proxy-page-size');
  const btnReset = document.getElementById('proxy-btn-reset-filter');

  let debounceTimer = null;
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        proxiesTableState.search = e.target.value;
        proxiesTableState.page = 1;
        applyProxiesFilterAndRender();
      }, 150);
    });
  }

  if (filterProtocol) {
    filterProtocol.addEventListener('change', (e) => {
      proxiesTableState.protocol = e.target.value;
      proxiesTableState.page = 1;
      applyProxiesFilterAndRender();
    });
  }

  if (filterType) {
    filterType.addEventListener('change', (e) => {
      proxiesTableState.type = e.target.value;
      proxiesTableState.page = 1;
      applyProxiesFilterAndRender();
    });
  }

  if (filterStatus) {
    filterStatus.addEventListener('change', (e) => {
      proxiesTableState.status = e.target.value;
      proxiesTableState.page = 1;
      applyProxiesFilterAndRender();
    });
  }

  if (pageSizeSelect) {
    pageSizeSelect.addEventListener('change', (e) => {
      proxiesTableState.pageSize = e.target.value;
      proxiesTableState.page = 1;
      applyProxiesFilterAndRender();
    });
  }

  if (btnReset) {
    btnReset.addEventListener('click', () => {
      if (searchInput) searchInput.value = '';
      if (filterProtocol) filterProtocol.value = 'all';
      if (filterType) filterType.value = 'all';
      if (filterStatus) filterStatus.value = 'all';
      if (pageSizeSelect) pageSizeSelect.value = '25';

      proxiesTableState.search = '';
      proxiesTableState.protocol = 'all';
      proxiesTableState.type = 'all';
      proxiesTableState.status = 'all';
      proxiesTableState.page = 1;
      proxiesTableState.pageSize = 25;

      applyProxiesFilterAndRender();
    });
  }
}

window.testSingleProxy = async function(id, btnElem) {
  if (btnElem) {
    btnElem.disabled = true;
    btnElem.textContent = '⏳...';
  }
  try {
    const res = await fetch(`/api/proxies/${id}/test`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showNotification(`⚡ Uji Proxy Selesai: ${data.proxy.ip}:${data.proxy.port} (${data.proxy.status.toUpperCase()} - ${data.proxy.latency}ms)`);
      loadProxies();
    }
  } catch (e) {
    alert(e.message);
  } finally {
    if (btnElem) {
      btnElem.disabled = false;
      btnElem.textContent = '⚡ Uji';
    }
  }
};

window.deleteProxy = async function(id) {
  if (!confirm('Hapus proxy ini?')) return;
  try {
    const res = await fetch(`/api/proxies/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      loadProxies();
    }
  } catch (e) {}
};

// =========================================================================
// WHATSAPP GATEWAY HANDLERS (UNOFFICIAL BOT SENDER -> ADMIN RECEIVER)
// =========================================================================
function setupWhatsAppHandlers() {
  const btnReqQr = document.getElementById('btn-request-wa-qr');
  const btnConfirmPair = document.getElementById('btn-confirm-wa-pair');
  const btnSaveAdmin = document.getElementById('btn-save-wa-admin');
  const btnSendTest = document.getElementById('btn-send-wa-test');
  const btnDisconnect = document.getElementById('btn-disconnect-wa');
  const btnSaveEvents = document.getElementById('btn-save-wa-events');
  const btnRefreshHistory = document.getElementById('btn-refresh-wa-history');

  // 1. Request QR Code Baileys
  if (btnReqQr) {
    btnReqQr.addEventListener('click', async () => {
      try {
        btnReqQr.disabled = true;
        btnReqQr.textContent = '⏳ Mempersiapkan QR Code Baileys...';
        const res = await fetch('/api/whatsapp/request-qr', { method: 'POST' });
        const data = await res.json();
        
        if (data.isPaired || data.status === 'CONNECTED') {
          showNotification('✅ Bot WhatsApp sudah terhubung sebelumnya.');
          checkWhatsAppStatus();
          return;
        }

        if (data.qrCodeDataUrl) {
          const qrImg = document.getElementById('wa-qr-img');
          const qrContainer = document.getElementById('wa-qr-container');
          if (qrImg && qrContainer) {
            qrImg.src = data.qrCodeDataUrl;
            qrContainer.style.display = 'block';
            showNotification('📱 Scan QR Code Baileys di HP Bot Anda.');
          }
        }
      } catch (e) {
        showNotification(`⚠️ Gagal meminta QR: ${e.message}`);
      } finally {
        btnReqQr.disabled = false;
        btnReqQr.textContent = '📱 Minta / Refresh QR Code Baileys';
      }
    });
  }

  // 2. Bypass / Instant Connect Bot (Manual Test Mode)
  if (btnConfirmPair) {
    btnConfirmPair.addEventListener('click', async () => {
      const phoneInput = document.getElementById('wa-bot-quick-phone');
      const phone = phoneInput ? phoneInput.value.trim() : '';
      if (!phone) {
        alert('Harap masukkan nomor WhatsApp Bot.');
        return;
      }

      try {
        btnConfirmPair.disabled = true;
        btnConfirmPair.textContent = 'Menyambungkan...';
        const res = await fetch('/api/whatsapp/pair', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone })
        });
        const data = await res.json();
        if (data.success) {
          showNotification('💬 Bot WhatsApp Berhasil Terhubung!');
          checkWhatsAppStatus();
        }
      } catch (e) {
        alert(e.message);
      } finally {
        btnConfirmPair.disabled = false;
        btnConfirmPair.textContent = 'Hubungkan Instan';
      }
    });
  }

  // 3. Simpan Nomor WhatsApp Admin Tujuan
  if (btnSaveAdmin) {
    btnSaveAdmin.addEventListener('click', async () => {
      const adminPhone = document.getElementById('wa-admin-phone-input')?.value.trim();
      if (!adminPhone) {
        alert('Harap masukkan nomor WhatsApp Admin tujuan notifikasi.');
        return;
      }

      try {
        btnSaveAdmin.disabled = true;
        btnSaveAdmin.textContent = 'Menyimpan...';
        const res = await fetch('/api/whatsapp/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ adminNumber: adminPhone })
        });
        const data = await res.json();
        if (data.success) {
          showNotification('💾 Nomor WhatsApp Admin berhasil disimpan!');
          checkWhatsAppStatus();
        }
      } catch (e) {
        alert(e.message);
      } finally {
        btnSaveAdmin.disabled = false;
        btnSaveAdmin.textContent = '💾 Simpan Nomor';
      }
    });
  }

  // 4. Kirim Pesan Tes Langsung ke Admin
  if (btnSendTest) {
    btnSendTest.addEventListener('click', async () => {
      const adminPhone = document.getElementById('wa-admin-phone-input')?.value.trim();
      const message = document.getElementById('wa-test-message')?.value.trim();

      if (!adminPhone) {
        alert('Harap isi dan simpan nomor WhatsApp Admin terlebih dahulu!');
        document.getElementById('wa-admin-phone-input')?.focus();
        return;
      }
      if (!message) {
        alert('Tulis pesan tes terlebih dahulu.');
        return;
      }

      try {
        btnSendTest.disabled = true;
        btnSendTest.textContent = 'Mengirim Pesan...';
        const res = await fetch('/api/whatsapp/send-test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: adminPhone, message })
        });
        const data = await res.json();
        if (data.success) {
          showNotification('📤 Pesan Notifikasi Berhasil Dikirim ke Admin!');
        } else if (data.status === 'OFFLINE_LOG') {
          showNotification('ℹ️ Pesan dicatat lokal (Bot WA sedang offline/belum scan).');
        } else {
          showNotification(`⚠️ Gagal mengirim: ${data.error || data.reason || 'Koneksi WA terputus'}`);
        }
        loadWhatsAppHistory();
      } catch (e) {
        showNotification(`⚠️ Error: ${e.message}`);
      } finally {
        btnSendTest.disabled = false;
        btnSendTest.textContent = '📤 Kirim Pesan Tes ke Nomor Admin';
      }
    });
  }

  // 5. Putuskan Koneksi Bot
  if (btnDisconnect) {
    btnDisconnect.addEventListener('click', async () => {
      if (!confirm('Putuskan koneksi Device Bot WhatsApp?')) return;
      try {
        const res = await fetch('/api/whatsapp/disconnect', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          showNotification('Device Bot WhatsApp telah diputuskan.');
          checkWhatsAppStatus();
        }
      } catch (e) {
        alert(e.message);
      }
    });
  }

  // 6. Simpan Preferensi Event Notifikasi
  if (btnSaveEvents) {
    btnSaveEvents.addEventListener('click', async () => {
      const adminPhone = document.getElementById('wa-admin-phone-input')?.value.trim();
      const payload = {
        adminNumber: adminPhone || undefined,
        notificationEvents: {
          liveStart: document.getElementById('wa-event-live-start')?.checked !== false,
          milestones: document.getElementById('wa-event-milestones')?.checked !== false,
          wafAlert: document.getElementById('wa-event-waf-alert')?.checked !== false,
          campaignEnd: document.getElementById('wa-event-campaign-end')?.checked !== false
        }
      };

      try {
        btnSaveEvents.disabled = true;
        btnSaveEvents.textContent = 'Menyimpan...';
        const res = await fetch('/api/whatsapp/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
          showNotification('💾 Preferensi event notifikasi WhatsApp disimpan.');
        }
      } catch (err) {
        alert(err.message);
      } finally {
        btnSaveEvents.disabled = false;
        btnSaveEvents.textContent = '💾 Simpan Preferensi Event';
      }
    });
  }

  // 7. Refresh History
  if (btnRefreshHistory) {
    btnRefreshHistory.addEventListener('click', () => {
      loadWhatsAppHistory();
    });
  }
}

async function checkWhatsAppStatus() {
  try {
    const res = await fetch('/api/whatsapp/status');
    const data = await res.json();
    if (data.success) {
      const isConnected = data.status === 'CONNECTED';
      const statusBadge = document.getElementById('wa-connection-badge');
      const connectedCard = document.getElementById('wa-connected-card');
      const pairingCard = document.getElementById('wa-pairing-card');
      const botPhoneDisplay = document.getElementById('wa-bot-sender-phone');

      if (statusBadge) {
        if (isConnected) {
          statusBadge.textContent = 'TERHUBUNG (Bot Sender)';
          statusBadge.style.color = '#34d399';
          statusBadge.style.background = 'rgba(16,185,129,0.15)';
        } else if (data.status === 'SCAN_QR') {
          statusBadge.textContent = 'SCAN QR CODE';
          statusBadge.style.color = '#fbbf24';
          statusBadge.style.background = 'rgba(245,158,11,0.15)';
        } else {
          statusBadge.textContent = 'BELUM TERHUBUNG';
          statusBadge.style.color = '#fb7185';
          statusBadge.style.background = 'rgba(244,63,94,0.15)';
        }
      }

      if (isConnected) {
        if (connectedCard) connectedCard.style.display = 'block';
        if (pairingCard) pairingCard.style.display = 'none';
        const botNumber = data.botSender?.phone || data.sessionUser?.phone || 'Aktif';
        if (botPhoneDisplay) botPhoneDisplay.textContent = `+${botNumber}`;
      } else {
        if (connectedCard) connectedCard.style.display = 'none';
        if (pairingCard) pairingCard.style.display = 'block';
        if (data.qrCodeDataUrl) {
          const qrImg = document.getElementById('wa-qr-img');
          const qrContainer = document.getElementById('wa-qr-container');
          if (qrImg && qrContainer) {
            qrImg.src = data.qrCodeDataUrl;
            qrContainer.style.display = 'block';
          }
        }
      }

      // Isi nomor admin tujuan jika tersimpan
      if (data.adminNumber) {
        const inputAdmin = document.getElementById('wa-admin-phone-input');
        if (inputAdmin && (!inputAdmin.value || inputAdmin.value !== data.adminNumber)) {
          inputAdmin.value = data.adminNumber;
        }
      }

      // Checklist events
      if (data.notificationEvents) {
        if (document.getElementById('wa-event-live-start')) document.getElementById('wa-event-live-start').checked = data.notificationEvents.liveStart !== false;
        if (document.getElementById('wa-event-milestones')) document.getElementById('wa-event-milestones').checked = data.notificationEvents.milestones !== false;
        if (document.getElementById('wa-event-waf-alert')) document.getElementById('wa-event-waf-alert').checked = data.notificationEvents.wafAlert !== false;
        if (document.getElementById('wa-event-campaign-end')) document.getElementById('wa-event-campaign-end').checked = data.notificationEvents.campaignEnd !== false;
      }

      // Muat log pesan
      loadWhatsAppHistory();
    }
  } catch (e) {}
}

async function loadWhatsAppHistory() {
  const container = document.getElementById('wa-history-list');
  if (!container) return;

  try {
    const res = await fetch('/api/whatsapp/history');
    const data = await res.json();
    if (data.success && data.history) {
      container.innerHTML = '';
      if (data.history.length === 0) {
        container.innerHTML = `<div style="color:var(--text-dim);font-size:0.8rem;text-align:center;padding:24px;">Belum ada log notifikasi yang dikirimkan.</div>`;
        return;
      }

      data.history.slice(0, 20).forEach(item => {
        const div = document.createElement('div');
        div.style.padding = '10px 14px';
        div.style.background = 'var(--bg-glass)';
        div.style.border = '1px solid var(--border-glass)';
        div.style.borderRadius = 'var(--radius-sm)';
        div.style.marginBottom = '8px';
        div.style.fontSize = '0.82rem';

        let badgeColor = '#34d399';
        let badgeBg = 'rgba(16,185,129,0.15)';
        let badgeText = 'TERKIRIM';

        if (item.status === 'OFFLINE_LOG') {
          badgeColor = '#38bdf8';
          badgeBg = 'rgba(56,189,248,0.15)';
          badgeText = 'LOG OFFLINE';
        } else if (item.status === 'FAILED') {
          badgeColor = '#fb7185';
          badgeBg = 'rgba(244,63,94,0.15)';
          badgeText = 'GAGAL';
        }

        div.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:center;color:var(--text-dim);font-size:0.75rem;margin-bottom:6px;">
            <div style="display:flex;align-items:center;gap:8px;">
              <span style="font-weight:600;color:var(--text-main);">Tujuan: +${item.to}</span>
              <span style="background:${badgeBg};color:${badgeColor};padding:2px 8px;border-radius:4px;font-size:0.68rem;font-weight:700;">${badgeText}</span>
            </div>
            <span>${item.timestamp}</span>
          </div>
          <div style="color:var(--text-main);white-space:pre-wrap;line-height:1.4;font-family:inherit;">${escapeHtml(item.message)}</div>
        `;
        container.appendChild(div);
      });
    }
  } catch (e) {}
}


// =========================================================================
// CANARY SECURITY WATCHDOG & WAF HANDLERS
// =========================================================================
function setupCanaryHandlers() {
  const badge = document.getElementById('waf-status-badge');
  if (badge) {
    badge.addEventListener('click', async () => {
      try {
        badge.innerHTML = `<span style="width:8px;height:8px;border-radius:50%;background:#06b6d4;display:inline-block;"></span> PROBING...`;
        const res = await fetch('/api/security/canary-check', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          updateWafBadge(data.status);
          showNotification(`🛡️ Canary Probe: ${data.result.status} (${data.result.latencyMs}ms) - ${data.result.message}`);
        }
      } catch (err) {
        showNotification(`⚠️ Probe error: ${err.message}`);
      }
    });
  }
}

function updateWafBadge(canary) {
  const badge = document.getElementById('waf-status-badge');
  if (!badge || !canary) return;
  const status = canary.status || 'HEALTHY';
  if (status === 'HEALTHY') {
    badge.className = 'status-pill status-healthy';
    badge.innerHTML = `<span style="width:8px;height:8px;border-radius:50%;background:#10b981;display:inline-block;"></span> WAF HEALTHY`;
    badge.title = `Pengawas Anti-Bot & WAF Shopee Live Normal (Latensi: ${canary.lastLatencyMs || 25}ms)`;
  } else if (status === 'CHECKING') {
    badge.className = 'status-pill';
    badge.innerHTML = `<span style="width:8px;height:8px;border-radius:50%;background:#06b6d4;display:inline-block;"></span> PROBING...`;
  } else if (status === 'WAF_ALERT') {
    badge.className = 'status-pill status-error';
    badge.innerHTML = `<span style="width:8px;height:8px;border-radius:50%;background:#ef4444;display:inline-block;animation:pulseAnim 1s infinite;"></span> WAF CHALLENGE`;
    badge.title = 'Terdeteksi respon challenge/anti-bot dari Shopee. Circuit Breaker aktif!';
  } else {
    badge.className = 'status-pill';
    badge.innerHTML = `<span style="width:8px;height:8px;border-radius:50%;background:#f59e0b;display:inline-block;"></span> ${status}`;
  }
}

// Toast notification helper
function showNotification(msg) {
  const toast = document.createElement('div');
  toast.style.position = 'fixed';
  toast.style.bottom = '24px';
  toast.style.right = '24px';
  toast.style.background = 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)';
  toast.style.border = '1px solid var(--shopee-primary)';
  toast.style.boxShadow = 'var(--glow-shopee)';
  toast.style.color = '#ffffff';
  toast.style.padding = '14px 22px';
  toast.style.borderRadius = 'var(--radius-md)';
  toast.style.zIndex = '9999';
  toast.style.fontSize = '0.88rem';
  toast.style.fontWeight = '600';
  toast.style.display = 'flex';
  toast.style.alignItems = 'center';
  toast.style.gap = '10px';
  toast.style.animation = 'fadeIn 0.25s ease';
  toast.textContent = msg;

  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// =========================================================================
// DASHBOARD METRICS, CAMPAIGN STATUS & CONSOLE LOGS
// =========================================================================

function updateDashboardMetrics(metrics) {
  if (!metrics) return;

  const elActive = document.getElementById('metric-active-viewers');
  const elAcc = document.getElementById('metric-accumulated-views');
  const elChurn = document.getElementById('metric-churn-rotations');
  const elTime = document.getElementById('metric-elapsed-time');
  const elBandwidth = document.getElementById('metric-bandwidth');
  const elLikes = document.getElementById('metric-total-likes');
  const elComments = document.getElementById('metric-total-comments');
  const elCart = document.getElementById('metric-total-cart-clicks');

  if (elActive) elActive.textContent = (metrics.activeViewers || 0).toLocaleString('id-ID');
  if (elAcc) elAcc.textContent = (metrics.accumulatedViews || 0).toLocaleString('id-ID');
  if (elChurn) elChurn.textContent = `${metrics.totalChurnRotations || 0}x`;
  if (elLikes && typeof metrics.totalLikes === 'number') elLikes.textContent = metrics.totalLikes.toLocaleString('id-ID');
  if (elComments && typeof metrics.totalComments === 'number') elComments.textContent = metrics.totalComments.toLocaleString('id-ID');
  if (elCart && typeof metrics.totalCartClicks === 'number') elCart.textContent = metrics.totalCartClicks.toLocaleString('id-ID');

  if (elTime && typeof metrics.elapsedSec === 'number') {
    const totalSec = metrics.elapsedSec;
    const hours = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    elTime.textContent = hours > 0 
      ? `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
      : `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  if (elBandwidth && typeof metrics.bandwidthKb === 'number') {
    if (metrics.bandwidthKb > 1024) {
      elBandwidth.textContent = `${(metrics.bandwidthKb / 1024).toFixed(1)} MB`;
    } else {
      elBandwidth.textContent = `${metrics.bandwidthKb} KB`;
    }
  }

  // Update Live Chart
  if (liveChart && typeof metrics.activeViewers === 'number') {
    liveChart.addDataPoint(metrics.activeViewers, metrics.accumulatedViews || 0);
  }

  // Update status badge & floating bar
  if (metrics.status) {
    updateCampaignStatusBadge(metrics.status);
  }

  // Update Floating Bottom Live Bar
  const elFloatActive = document.getElementById('floating-active-viewers');
  const elFloatLikes = document.getElementById('floating-total-likes');
  const floatingBar = document.getElementById('floating-live-bar');

  if (elFloatActive) elFloatActive.textContent = `${(metrics.activeViewers || 0).toLocaleString('id-ID')} Viewers`;
  if (elFloatLikes) elFloatLikes.textContent = `${(metrics.totalLikes || 0).toLocaleString('id-ID')} Loves`;

  if (floatingBar) {
    if (metrics.status === 'RUNNING') {
      floatingBar.classList.add('visible');
    } else {
      floatingBar.classList.remove('visible');
    }
  }

  // Update Batasan Akun Siap Pakai (tidak sedang digunakan di live lain)
  if (typeof metrics.availableAccounts === 'number') {
    currentAvailableAccounts = metrics.availableAccounts;
    totalAccountsCount = metrics.totalAccounts || currentAvailableAccounts;

    const pillText = document.getElementById('accounts-available-text');
    const pill = document.getElementById('accounts-available-pill');
    const slider = document.getElementById('target-viewers-slider');
    const badge = document.getElementById('target-viewers-badge');

    if (pillText && pill) {
      if (currentAvailableAccounts > 0) {
        pillText.textContent = `Akun Siap: ${currentAvailableAccounts} / ${totalAccountsCount}`;
        pill.style.background = 'rgba(16, 185, 129, 0.15)';
        pill.style.color = '#34d399';
        pill.style.borderColor = 'rgba(16, 185, 129, 0.3)';
      } else {
        pillText.textContent = `0 Akun Siap (Semua Sedang Menonton)`;
        pill.style.background = 'rgba(244, 63, 94, 0.15)';
        pill.style.color = '#fb7185';
        pill.style.borderColor = 'rgba(244, 63, 94, 0.3)';
      }
    }

    // Batasi nilai dan slider target viewers secara dinamis jika mode non-hybrid
    if (slider) {
      const isHybrid = document.getElementById('campaign-hybrid-mode')?.checked ?? true;
      if (!isHybrid) {
        const maxAllowed = Math.max(1, currentAvailableAccounts);
        slider.max = maxAllowed;
        if (parseInt(slider.value, 10) > maxAllowed) {
          slider.value = maxAllowed;
          if (badge) badge.textContent = `${maxAllowed} Viewers`;
        }
      } else {
        slider.max = 1000;
      }
    }

    // Sinkronkan badge di Tab Akun
    const accAvailBadge = document.getElementById('accounts-available-badge');
    const accBusyBadge = document.getElementById('accounts-busy-badge');
    const accTotalBadge = document.getElementById('accounts-total-badge');
    if (accAvailBadge) accAvailBadge.textContent = `🟢 ${currentAvailableAccounts} Siap Pakai`;
    if (accBusyBadge && typeof metrics.busyAccounts === 'number') accBusyBadge.textContent = `🔵 ${metrics.busyAccounts} Menonton`;
    if (accTotalBadge) accTotalBadge.textContent = `${totalAccountsCount} Akun`;
  }

  // Sinkronkan daftar multi-kampanye secara real-time setiap detik
  if (metrics.campaigns && Array.isArray(metrics.campaigns)) {
    renderMultiCampaignsList(metrics.campaigns);
  }
}

function updateCampaignStatusBadge(status) {
  const badge = document.getElementById('campaign-status-badge');
  const btnStop = document.getElementById('btn-stop-campaign');
  if (!badge) return;

  if (status === 'RUNNING') {
    badge.innerHTML = `<span class="pulse-dot"></span> LIVE AKTIF`;
    badge.style.background = 'rgba(16, 185, 129, 0.18)';
    badge.style.color = '#34d399';
    badge.style.borderColor = 'rgba(16, 185, 129, 0.4)';
    if (btnStop) btnStop.style.display = 'inline-flex';
  } else {
    badge.innerHTML = `<span style="width:8px;height:8px;border-radius:50%;background:#94a3b8;"></span> STANDBY`;
    badge.style.background = 'rgba(255, 255, 255, 0.05)';
    badge.style.color = 'var(--text-dim)';
    badge.style.borderColor = 'var(--border-glass)';
    if (btnStop) btnStop.style.display = 'none';
  }
}

function appendTerminalLog(log) {
  const terminal = document.getElementById('terminal-logs');
  if (!terminal || !log) return;

  const line = document.createElement('div');
  line.className = 'log-line';

  const timeStr = log.timestamp || new Date().toLocaleTimeString('id-ID');
  const level = log.level || 'INFO';
  const badgeClass = `log-badge-${level}`;

  line.innerHTML = `
    <span class="log-time">[${timeStr}]</span>
    <span class="log-badge ${badgeClass}">${level}</span>
    <span class="log-text">${escapeHtml(log.message)}</span>
  `;

  terminal.appendChild(line);

  // Auto-scroll ke paling bawah
  terminal.scrollTop = terminal.scrollHeight;

  // Batasi elemen log di DOM
  while (terminal.children.length > 200) {
    terminal.removeChild(terminal.firstChild);
  }
}

// =========================================================================
// INTERACTION, LIVE CHAT & COMMENT BANK CONTROLLERS
// =========================================================================

let currentCommentCategory = 'fashion';
let cachedCommentBanks = {};

function setupInteractionHandlers() {
  // Global Save Button
  const btnSaveGlobal = document.getElementById('btn-save-global-interaction');
  if (btnSaveGlobal) {
    btnSaveGlobal.addEventListener('click', saveGlobalInteractionConfig);
  }

  // Comment Bank Category Pills
  const pills = document.querySelectorAll('.cat-pill');
  pills.forEach(pill => {
    pill.addEventListener('click', () => {
      pills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      currentCommentCategory = pill.getAttribute('data-cat') || 'fashion';
      renderCommentBankList(currentCommentCategory);
    });
  });

  // Add Comment Button & Enter key
  const btnAdd = document.getElementById('btn-add-comment');
  const inputNew = document.getElementById('new-comment-input');
  if (btnAdd && inputNew) {
    const handleAdd = async () => {
      const text = inputNew.value.trim();
      if (!text) return;

      if (!cachedCommentBanks[currentCommentCategory]) cachedCommentBanks[currentCommentCategory] = [];
      if (!cachedCommentBanks[currentCommentCategory].includes(text)) {
        cachedCommentBanks[currentCommentCategory].push(text);
        renderCommentBankList(currentCommentCategory);
        inputNew.value = '';

        try {
          await fetch('/api/interaction/comment-banks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ category: currentCommentCategory, comments: cachedCommentBanks[currentCommentCategory] })
          });
          showNotification(`✨ Ditambahkan ke bank [${currentCommentCategory}]`);
        } catch (e) {}
      }
    };

    btnAdd.addEventListener('click', handleAdd);
    inputNew.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') handleAdd();
    });
  }

  // Test Generate Random Chat
  const btnTestGen = document.getElementById('btn-test-generate-chat');
  const previewBox = document.getElementById('preview-sample-chat-text');
  if (btnTestGen && previewBox) {
    btnTestGen.addEventListener('click', () => {
      const pool = cachedCommentBanks[currentCommentCategory] || [];
      if (pool.length === 0) {
        previewBox.textContent = 'Belum ada komentar di kategori ini.';
        return;
      }
      const emojis = ['❤️', '✨', '🛍️', '🔥', '🥰', '👍', '💫', '🎉', '🙏'];
      const randomText = pool[Math.floor(Math.random() * pool.length)];
      const emoji = emojis[Math.floor(Math.random() * emojis.length)];
      previewBox.textContent = `"${randomText} ${emoji}"`;
    });
  }

  // Instant Chat & Instant Like Handlers
  const btnInstantChat = document.getElementById('btn-send-instant-chat');
  const inputInstantChat = document.getElementById('instant-chat-input');
  const btnInstantLike = document.getElementById('btn-send-instant-like');

  if (btnInstantChat && inputInstantChat) {
    const handleInstantChat = async () => {
      const text = inputInstantChat.value.trim();
      if (!text) return;

      try {
        btnInstantChat.disabled = true;
        const res = await fetch('/api/campaigns/active/instant-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text })
        });
        const data = await res.json();
        if (data.success) {
          inputInstantChat.value = '';
          if (data.chat) appendLiveChatMessage(data.chat);
          showNotification('💬 Chat instan terkirim oleh bot!');
        } else {
          showNotification(`⚠️ ${data.message}`);
        }
      } catch (err) {
        showNotification(`❌ Error: ${err.message}`);
      } finally {
        btnInstantChat.disabled = false;
      }
    };

    btnInstantChat.addEventListener('click', handleInstantChat);
    inputInstantChat.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') handleInstantChat();
    });
  }

  if (btnInstantLike) {
    btnInstantLike.addEventListener('click', async () => {
      try {
        btnInstantLike.disabled = true;
        const res = await fetch('/api/campaigns/active/instant-like', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taps: 20 })
        });
        const data = await res.json();
        if (data.success) {
          showNotification('❤️ 20 Tap Love berhasil disuntikkan!');
          updateLikesBurst(data);
        } else {
          showNotification(`⚠️ ${data.message}`);
        }
      } catch (err) {
        showNotification(`❌ Error: ${err.message}`);
      } finally {
        btnInstantLike.disabled = false;
      }
    });
  }

  const btnInstantCart = document.getElementById('btn-send-instant-cart');
  if (btnInstantCart) {
    btnInstantCart.addEventListener('click', async () => {
      try {
        btnInstantCart.disabled = true;
        const res = await fetch('/api/campaigns/active/instant-cart', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ count: 5 })
        });
        const data = await res.json();
        if (data.success) {
          showNotification('🛒 5x Klik Keranjang Oranye (Bag Click) terkirim!');
          const elCart = document.getElementById('metric-total-cart-clicks');
          if (elCart && typeof data.totalCartClicks === 'number') {
            elCart.textContent = data.totalCartClicks.toLocaleString('id-ID');
          }
        } else {
          showNotification(`⚠️ ${data.message}`);
        }
      } catch (err) {
        showNotification(`❌ Error: ${err.message}`);
      } finally {
        btnInstantCart.disabled = false;
      }
    });
  }
}

async function loadInteractionTab() {
  try {
    const res = await fetch('/api/interaction/config');
    const data = await res.json();
    if (data.success) {
      const cfg = data.config || {};
      cachedCommentBanks = data.commentBanks || {};

      const toggleLike = document.getElementById('global-toggle-like');
      const sliderLike = document.getElementById('global-like-rate-slider');
      const badgeLike = document.getElementById('global-like-rate-badge');
      if (toggleLike) toggleLike.checked = cfg.enableLike;
      if (sliderLike) sliderLike.value = cfg.likeRatePerMin || 60;
      if (badgeLike) badgeLike.textContent = `${cfg.likeRatePerMin || 60} Like/mnt`;

      const toggleComment = document.getElementById('global-toggle-comment');
      const sliderComment = document.getElementById('global-comment-interval-slider');
      const badgeComment = document.getElementById('global-comment-interval-badge');
      const selectCat = document.getElementById('global-default-category-select');
      if (toggleComment) toggleComment.checked = cfg.enableComment;
      if (sliderComment) sliderComment.value = cfg.commentIntervalSec || 20;
      if (badgeComment) badgeComment.textContent = `Tiap ${cfg.commentIntervalSec || 20} dtk`;
      if (selectCat) selectCat.value = cfg.defaultCategory || 'general';

      renderCommentBankList(currentCommentCategory);

      // Tampilkan pratinjau chat dinamis dari kategori aktif
      const pool = cachedCommentBanks[currentCommentCategory] || [];
      const previewBox = document.getElementById('preview-sample-chat-text');
      if (previewBox && pool.length > 0) {
        previewBox.textContent = `"${pool[0]} ❤️"`;
      }
    }
  } catch (e) {}
}

function renderCommentBankList(category) {
  const container = document.getElementById('comment-bank-list');
  if (!container) return;

  const list = cachedCommentBanks[category] || [];
  container.innerHTML = '';

  if (list.length === 0) {
    container.innerHTML = `<div style="color:var(--text-dim);font-size:0.8rem;text-align:center;padding:20px;">Belum ada template chat di kategori ini. Tambahkan di atas.</div>`;
    return;
  }

  list.forEach((comment, index) => {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.justifyContent = 'space-between';
    row.style.alignItems = 'center';
    row.style.padding = '8px 12px';
    row.style.background = 'var(--bg-glass)';
    row.style.border = '1px solid var(--border-glass)';
    row.style.borderRadius = 'var(--radius-sm)';
    row.style.fontSize = '0.82rem';

    row.innerHTML = `
      <span style="color:var(--text-main);font-weight:500;">"${escapeHtml(comment)}"</span>
      <button class="btn btn-secondary" style="padding:3px 8px;font-size:0.72rem;color:#f43f5e;" onclick="removeCommentFromBank('${category}', ${index})">
        ✕
      </button>
    `;
    container.appendChild(row);
  });
}

window.removeCommentFromBank = async function(category, index) {
  if (!cachedCommentBanks[category]) return;
  cachedCommentBanks[category].splice(index, 1);
  renderCommentBankList(category);

  try {
    await fetch('/api/interaction/comment-banks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category, comments: cachedCommentBanks[category] })
    });
  } catch (e) {}
};

async function saveGlobalInteractionConfig() {
  const btn = document.getElementById('btn-save-global-interaction');
  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Menyimpan...';
    }

    const payload = {
      enableLike: document.getElementById('global-toggle-like')?.checked ?? true,
      likeRatePerMin: parseInt(document.getElementById('global-like-rate-slider')?.value || 60, 10),
      enableComment: document.getElementById('global-toggle-comment')?.checked ?? true,
      commentIntervalSec: parseInt(document.getElementById('global-comment-interval-slider')?.value || 20, 10),
      defaultCategory: document.getElementById('global-default-category-select')?.value || 'general'
    };

    const res = await fetch('/api/interaction/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      showNotification('💾 Setelan interaksi master global berhasil disimpan!');
    }
  } catch (err) {
    showNotification(`❌ Error: ${err.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '💾 Simpan Setelan Interaksi Global';
    }
  }
}

function appendLiveChatMessage(chat) {
  const container = document.getElementById('live-chat-feed-box');
  if (!container || !chat) return;

  if (container.children.length === 1 && container.children[0].textContent.includes('Obrolan bot akan muncul')) {
    container.innerHTML = '';
  }

  const bubble = document.createElement('div');
  bubble.className = 'live-chat-bubble';

  const fallbackAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(chat.sender || 'User')}&background=ee4d2d&color=fff`;
  const avatarSrc = chat.avatar || fallbackAvatar;

  bubble.innerHTML = `
    <img src="${avatarSrc}" class="live-chat-avatar" alt="${escapeHtml(chat.sender)}" onerror="this.src='${fallbackAvatar}'" />
    <div style="flex:1;">
      <div class="live-chat-author">
        <span>${escapeHtml(chat.sender || 'Penonton')}</span>
        <span style="font-size:0.7rem;color:var(--text-dim);font-weight:400;">@${escapeHtml(chat.username || 'user')} • ${chat.timestamp || ''}</span>
        ${chat.isManual ? '<span style="font-size:0.65rem;background:rgba(238,77,45,0.2);color:#ff8c6d;padding:1px 6px;border-radius:4px;">Manual Admin</span>' : ''}
      </div>
      <div class="live-chat-msg">${escapeHtml(chat.text)}</div>
    </div>
  `;

  container.appendChild(bubble);
  container.scrollTop = container.scrollHeight;

  while (container.children.length > 35) {
    container.removeChild(container.firstChild);
  }
}

async function loadChats() {
  try {
    const res = await fetch('/api/chats');
    const data = await res.json();
    if (data.success && Array.isArray(data.chats) && data.chats.length > 0) {
      renderChatHistory(data.chats);
    }
  } catch (e) {}
}

function renderChatHistory(chats) {
  const container = document.getElementById('live-chat-feed-box');
  if (!container || !chats || chats.length === 0) return;
  container.innerHTML = '';
  chats.forEach(c => appendLiveChatMessage(c));
}

function updateLikesBurst(likeData) {
  const elLikes = document.getElementById('metric-total-likes');
  if (elLikes && likeData && typeof likeData.totalLikes === 'number') {
    elLikes.textContent = likeData.totalLikes.toLocaleString('id-ID');
  }

  const btnLike = document.getElementById('btn-send-instant-like');
  if (btnLike) {
    btnLike.style.transform = 'scale(1.08)';
    setTimeout(() => { btnLike.style.transform = 'scale(1)'; }, 150);
    spawnFloatingHeart(btnLike);
  } else {
    spawnFloatingHeart();
  }
}

// =========================================================================
// MODERN UI/UX: THEME SWITCHER, QUICK GUIDE & FLOATING BAR
// =========================================================================

function setupThemeToggle() {
  const btn = document.getElementById('btn-theme-toggle');
  const icon = document.getElementById('theme-toggle-icon');
  const text = document.getElementById('theme-toggle-text');

  // Cek preferensi tersimpan di browser
  const savedTheme = localStorage.getItem('shopee_bot_theme');
  const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  const initialTheme = savedTheme || (prefersLight ? 'light' : 'dark');

  applyTheme(initialTheme, false);

  if (btn) {
    btn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || 'dark';
      const nextTheme = current === 'dark' ? 'light' : 'dark';
      applyTheme(nextTheme, true);
    });
  }

  function applyTheme(theme, notify = false) {
    document.documentElement.setAttribute('data-theme', theme);
    document.body.setAttribute('data-theme', theme);
    localStorage.setItem('shopee_bot_theme', theme);

    const isDark = theme === 'dark';
    if (icon) icon.textContent = isDark ? '🌙' : '☀️';
    if (text) text.textContent = isDark ? 'Dark' : 'Light';

    // Sinkronkan tema canvas grafik viewers
    if (liveChart && typeof liveChart.setTheme === 'function') {
      liveChart.setTheme(isDark);
    }

    if (notify) {
      showNotification(isDark ? '🌙 Mode Gelap (Dark Mode) aktif' : '☀️ Mode Terang (Light Mode) aktif');
    }
  }
}

function setupQuickGuide() {
  const guideCard = document.getElementById('quick-start-guide');
  const guideBody = document.getElementById('quick-guide-body');
  const btnToggle = document.getElementById('btn-toggle-guide');
  const label = document.getElementById('guide-toggle-label');
  const header = document.getElementById('quick-guide-toggle');

  if (!guideBody || !btnToggle) return;

  const isSavedClosed = localStorage.getItem('shopee_bot_guide_closed') === 'true';
  if (isSavedClosed) {
    guideBody.style.display = 'none';
    if (label) label.textContent = 'Buka Panduan ▼';
  }

  const toggle = () => {
    const isHidden = guideBody.style.display === 'none';
    guideBody.style.display = isHidden ? 'grid' : 'none';
    if (label) label.textContent = isHidden ? 'Tutup Panduan ▲' : 'Buka Panduan ▼';
    localStorage.setItem('shopee_bot_guide_closed', String(!isHidden));
  };

  btnToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    toggle();
  });
  if (header) {
    header.addEventListener('click', toggle);
  }
}

function setupFloatingLiveBar() {
  const btnStop = document.getElementById('btn-floating-stop');
  if (btnStop) {
    btnStop.addEventListener('click', async () => {
      try {
        btnStop.disabled = true;
        const res = await fetch('/api/campaign/stop', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          showNotification('⏹️ Seluruh siaran live berhasil dihentikan.');
          updateCampaignStatusBadge('IDLE');
          loadStatus();
          loadAccounts();
          const floatingBar = document.getElementById('floating-live-bar');
          if (floatingBar) floatingBar.classList.remove('visible');
        }
      } catch (e) {
        showNotification('❌ Error: ' + e.message);
      } finally {
        btnStop.disabled = false;
      }
    });
  }
}

function spawnFloatingHeart(originEl = null) {
  const heart = document.createElement('div');
  heart.className = 'floating-heart';
  const emojis = ['❤️', '💖', '✨', '🔥', '🥰', '💕', '🛍️'];
  heart.textContent = emojis[Math.floor(Math.random() * emojis.length)];

  let x = window.innerWidth / 2;
  let y = window.innerHeight - 90;

  if (originEl && originEl.getBoundingClientRect) {
    const rect = originEl.getBoundingClientRect();
    x = rect.left + rect.width / 2 + (Math.random() * 40 - 20);
    y = rect.top + (Math.random() * 20 - 10);
  } else {
    x += (Math.random() * 120 - 60);
  }

  heart.style.left = `${x}px`;
  heart.style.top = `${y}px`;

  document.body.appendChild(heart);
  setTimeout(() => {
    if (heart && heart.parentNode) heart.remove();
  }, 1400);
}

// =========================================================================
// SMART SCHEDULER & CAMPAIGN HISTORY HANDLERS
// =========================================================================
function setupSchedulerAndHistoryHandlers() {
  // --- SCHEDULER MODAL ---
  const btnOpenSched = document.getElementById('btn-open-scheduler');
  const modalSched = document.getElementById('modal-scheduler');
  const btnCloseSched = document.getElementById('btn-close-scheduler-modal');
  const btnSaveSched = document.getElementById('btn-save-schedule');

  if (btnOpenSched && modalSched) {
    btnOpenSched.addEventListener('click', () => {
      modalSched.classList.add('active');
      loadSchedules();
    });
  }
  if (btnCloseSched && modalSched) {
    btnCloseSched.addEventListener('click', () => modalSched.classList.remove('active'));
  }

  if (btnSaveSched) {
    btnSaveSched.addEventListener('click', async () => {
      const title = (document.getElementById('sched-title-input')?.value || '').trim();
      const liveUrl = (document.getElementById('sched-url-input')?.value || '').trim();
      const scheduledTime = document.getElementById('sched-time-input')?.value || '19:00';
      const targetViewers = parseInt(document.getElementById('sched-viewers-input')?.value, 10) || 100;
      const durationMinutes = parseInt(document.getElementById('sched-duration-input')?.value, 10) || 120;

      const checkedDays = Array.from(document.querySelectorAll('.sched-day-check:checked')).map(cb => parseInt(cb.value, 10));

      if (!liveUrl) {
        alert('Harap masukkan Link / Room ID Shopee Live untuk jadwal ini.');
        return;
      }

      try {
        btnSaveSched.disabled = true;
        const res = await fetch('/api/schedules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: title || undefined,
            liveUrl,
            scheduledTime,
            targetViewers,
            durationMinutes,
            daysOfWeek: checkedDays
          })
        });
        const data = await res.json();
        if (data.success) {
          showNotification('⏰ Jadwal siaran otomatis berhasil disimpan!');
          if (document.getElementById('sched-title-input')) document.getElementById('sched-title-input').value = '';
          if (document.getElementById('sched-url-input')) document.getElementById('sched-url-input').value = '';
          loadSchedules();
        } else {
          showNotification('⚠️ ' + data.message);
        }
      } catch (e) {
        showNotification('❌ ' + e.message);
      } finally {
        btnSaveSched.disabled = false;
      }
    });
  }

  // --- HISTORY MODAL ---
  const btnOpenHist = document.getElementById('btn-open-history');
  const modalHist = document.getElementById('modal-history');
  const btnCloseHist = document.getElementById('btn-close-history-modal');
  const btnClearHist = document.getElementById('btn-clear-history');

  if (btnOpenHist && modalHist) {
    btnOpenHist.addEventListener('click', () => {
      modalHist.classList.add('active');
      loadHistory();
    });
  }
  if (btnCloseHist && modalHist) {
    btnCloseHist.addEventListener('click', () => modalHist.classList.remove('active'));
  }

  if (btnClearHist) {
    btnClearHist.addEventListener('click', async () => {
      if (!confirm('Yakin ingin membersihkan seluruh riwayat siaran?')) return;
      try {
        await fetch('/api/history', { method: 'DELETE' });
        showNotification('🗑️ Riwayat berhasil dibersihkan.');
        loadHistory();
      } catch (e) {}
    });
  }
}

async function loadSchedules() {
  const container = document.getElementById('schedules-list-container');
  if (!container) return;
  try {
    const res = await fetch('/api/schedules');
    const data = await res.json();
    if (data.success) {
      if (data.schedules.length === 0) {
        container.innerHTML = '<div style="text-align:center;font-size:0.78rem;color:var(--text-dim);padding:14px;">Belum ada jadwal tersimpan.</div>';
        return;
      }
      container.innerHTML = data.schedules.map(s => {
        const dayNames = ['', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
        const daysLabel = (s.daysOfWeek || []).map(d => dayNames[d]).join(', ') || 'Setiap Hari';
        return `
          <div style="display:flex;justify-content:space-between;align-items:center;background:var(--bg-glass);border:1px solid var(--border-glass);padding:8px 12px;border-radius:var(--radius-sm);">
            <div>
              <div style="font-weight:700;font-size:0.84rem;">${escapeHtml(s.title)}</div>
              <div style="font-size:0.74rem;color:var(--text-dim);margin-top:2px;">
                ⏰ Pukul <strong>${s.scheduledTime} WIB</strong> • 👥 ${s.targetViewers} Viewers • ⏱️ ${s.durationMinutes} mnt • 📅 ${daysLabel}
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
              <button class="btn btn-secondary" style="padding:4px 8px;font-size:0.72rem;color:${s.enabled ? '#34d399' : 'var(--text-dim)'};" onclick="toggleScheduleItem('${s.id}', ${!s.enabled})">
                ${s.enabled ? '🟢 Aktif' : '⚪ Mati'}
              </button>
              <button class="btn btn-secondary" style="padding:4px 8px;font-size:0.72rem;color:#ef4444;" onclick="deleteScheduleItem('${s.id}')">
                🗑️
              </button>
            </div>
          </div>
        `;
      }).join('');
    }
  } catch (e) {}
}

window.toggleScheduleItem = async function(id, state) {
  try {
    await fetch(`/api/schedules/${id}/toggle`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: state })
    });
    loadSchedules();
  } catch (e) {}
};

window.deleteScheduleItem = async function(id) {
  try {
    await fetch(`/api/schedules/${id}`, { method: 'DELETE' });
    loadSchedules();
  } catch (e) {}
};

async function loadHistory() {
  const tbody = document.getElementById('history-table-body');
  if (!tbody) return;
  try {
    const res = await fetch('/api/history');
    const data = await res.json();
    if (data.success) {
      // Update Summary KPI
      const s = data.summary || {};
      const elSess = document.getElementById('hist-stat-sessions');
      const elViews = document.getElementById('hist-stat-views');
      const elLikes = document.getElementById('hist-stat-likes');
      const elComm = document.getElementById('hist-stat-comments');
      const elCart = document.getElementById('hist-stat-cart');

      if (elSess) elSess.textContent = s.totalSessions || 0;
      if (elViews) elViews.textContent = (s.totalViews || 0).toLocaleString('id-ID');
      if (elLikes) elLikes.textContent = (s.totalLikes || 0).toLocaleString('id-ID');
      if (elComm) elComm.textContent = (s.totalComments || 0).toLocaleString('id-ID');
      if (elCart) elCart.textContent = (s.totalCartClicks || 0).toLocaleString('id-ID');

      if (data.history.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--text-dim);padding:18px;">Belum ada riwayat siaran tersimpan.</td></tr>';
        return;
      }

      tbody.innerHTML = data.history.map(item => {
        const timeStr = item.startTime ? new Date(item.startTime).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' }) : '-';
        return `
          <tr>
            <td>${timeStr}</td>
            <td><strong>${escapeHtml(item.name)}</strong></td>
            <td><code>${item.roomId}</code></td>
            <td>${item.durationMinutes} mnt</td>
            <td style="color:#ee4d2d;font-weight:700;">${(item.accumulatedViews || 0).toLocaleString('id-ID')}</td>
            <td style="color:#ec4899;">${(item.totalLikes || 0).toLocaleString('id-ID')}</td>
            <td style="color:#3b82f6;">${(item.totalComments || 0).toLocaleString('id-ID')}</td>
            <td style="color:#f97316;font-weight:700;">${(item.totalCartClicks || 0).toLocaleString('id-ID')}</td>
            <td><span class="status-pill" style="font-size:0.68rem;">${item.stopReason || 'selesai'}</span></td>
          </tr>
        `;
      }).join('');
    }
  } catch (e) {}
}

// ============================================================================
// SECURITY GATEKEEPER & ACCESS CONTROL CONTROLLER
// ============================================================================
function showSecurityGate(message = null) {
  const overlay = document.getElementById('securityGateOverlay');
  const alertBox = document.getElementById('secGateAlert');
  const passInput = document.getElementById('secMasterPassword');
  const formPassword = document.getElementById('secGateForm');
  const formOtp = document.getElementById('secGateOtpForm');

  if (overlay) {
    overlay.classList.remove('unlocked');
  }
  if (formPassword) formPassword.style.display = 'block';
  if (formOtp) formOtp.style.display = 'none';

  if (alertBox) {
    if (message) {
      alertBox.className = 'sec-gate-alert alert-error';
      alertBox.textContent = message;
      alertBox.style.display = 'block';
    } else {
      alertBox.style.display = 'none';
    }
  }

  if (passInput) {
    passInput.value = '';
    setTimeout(() => passInput.focus(), 150);
  }
}

function unlockSecurityGate() {
  const overlay = document.getElementById('securityGateOverlay');
  if (overlay) {
    overlay.classList.add('unlocked');
  }
  resetInactivityTimer();

  // Refresh dashboard data now that we are authenticated
  if (typeof loadStatus === 'function') loadStatus();
  if (typeof loadAccounts === 'function') loadAccounts();
  if (typeof loadProxies === 'function') loadProxies();
  if (typeof initSse === 'function') initSse();
}

function resetInactivityTimer() {
  if (inactivityTimer) clearTimeout(inactivityTimer);
  const timeoutMins = securityConfig.sessionTimeoutMinutes || 60;
  inactivityTimer = setTimeout(() => {
    showSecurityGate(`Layar dikunci otomatis demi keamanan karena tidak ada aktivitas selama ${timeoutMins} menit.`);
  }, timeoutMins * 60 * 1000);
}

async function checkAuthStatus() {
  try {
    const res = await fetch('/api/auth/status');
    const data = await res.json();
    if (data.config) {
      securityConfig = data.config;
      const statusText = document.getElementById('sec-status-text');
      const toggleSec = document.getElementById('toggle-security-active');
      const toggle2fa = document.getElementById('toggle-2fa-whatsapp');
      const selectTimeout = document.getElementById('select-session-timeout');

      if (statusText) statusText.textContent = securityConfig.enabled ? 'Proteksi aktif (Wajib Password saat login)' : 'Proteksi dinonaktifkan (Akses publik bebas)';
      if (toggleSec) toggleSec.checked = securityConfig.enabled !== false;
      if (toggle2fa) toggle2fa.checked = !!securityConfig.enable2faWhatsapp;
      if (selectTimeout) selectTimeout.value = String(securityConfig.sessionTimeoutMinutes || 60);
    }

    if (data.config && data.config.enabled === false) {
      unlockSecurityGate();
      return;
    }

    if (data.authenticated) {
      unlockSecurityGate();
    } else {
      showSecurityGate(data.isBlocked ? 'IP Anda sedang diblokir sementara karena terlalu banyak percobaan gagal.' : null);
    }
  } catch (err) {
    showSecurityGate();
  }
}

function setupSecurityGatekeeper() {
  const overlay = document.getElementById('securityGateOverlay');
  const formPassword = document.getElementById('secGateForm');
  const formOtp = document.getElementById('secGateOtpForm');
  const passInput = document.getElementById('secMasterPassword');
  const rememberCheckbox = document.getElementById('secRememberMe');
  const btnToggleEye = document.getElementById('btnToggleSecPassword');
  const alertBox = document.getElementById('secGateAlert');
  const card = document.querySelector('.security-gate-card');
  const unlockText = document.getElementById('secUnlockText');
  const unlockSpinner = document.getElementById('secUnlockSpinner');
  const btnUnlock = document.getElementById('btnSecUnlock');
  const otpInput = document.getElementById('secOtpCode');
  const btnVerifyOtp = document.getElementById('btnSecVerifyOtp');
  const btnBackToPass = document.getElementById('btnSecBackToPassword');
  const btnLockScreen = document.getElementById('btn-lock-screen');
  const btnOpenSecurity = document.getElementById('btn-open-security');
  const modalSecSettings = document.getElementById('modal-security-settings');
  const btnCloseSecSettings = document.getElementById('btn-close-sec-settings');
  const formChangePassword = document.getElementById('form-change-password');
  const toggleSecActive = document.getElementById('toggle-security-active');
  const toggle2fa = document.getElementById('toggle-2fa-whatsapp');
  const selectTimeout = document.getElementById('select-session-timeout');

  // Inactivity Listeners
  ['mousemove', 'keydown', 'touchstart', 'scroll'].forEach(evt => {
    window.addEventListener(evt, () => {
      if (overlay && overlay.classList.contains('unlocked')) {
        resetInactivityTimer();
      }
    }, { passive: true });
  });

  // Toggle Password Visibility
  if (btnToggleEye && passInput) {
    btnToggleEye.addEventListener('click', () => {
      const isPass = passInput.getAttribute('type') === 'password';
      passInput.setAttribute('type', isPass ? 'text' : 'password');
      btnToggleEye.textContent = isPass ? '🙈' : '👁️';
    });
  }

  // Password Login Submission
  if (formPassword) {
    formPassword.addEventListener('submit', async (e) => {
      e.preventDefault();
      const password = passInput ? passInput.value.trim() : '';
      const rememberMe = rememberCheckbox ? rememberCheckbox.checked : false;

      if (!password) return;

      if (btnUnlock) btnUnlock.disabled = true;
      if (unlockText) unlockText.textContent = 'Memverifikasi...';
      if (unlockSpinner) unlockSpinner.style.display = 'inline-block';
      if (alertBox) alertBox.style.display = 'none';

      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password, rememberMe })
        });
        const data = await res.json();

        if (data.success) {
          if (data.requireOtp) {
            formPassword.style.display = 'none';
            formOtp.style.display = 'block';
            if (alertBox) {
              alertBox.className = 'sec-gate-alert alert-info';
              alertBox.textContent = data.message || 'Kode OTP telah dikirimkan ke WhatsApp Admin.';
              alertBox.style.display = 'block';
            }
            if (otpInput) {
              otpInput.value = '';
              setTimeout(() => otpInput.focus(), 150);
            }
          } else if (data.token) {
            sessionToken = data.token;
            if (rememberMe) {
              localStorage.setItem('sb_session_token', data.token);
            } else {
              sessionStorage.setItem('sb_session_token', data.token);
            }
            document.cookie = `sb_session=${data.token}; path=/; max-age=${data.timeoutMinutes * 60}; SameSite=Strict`;
            unlockSecurityGate();
            showNotification('🔓 Akses Berhasil Terbuka.');
          }
        } else {
          if (card) {
            card.classList.remove('shake');
            void card.offsetWidth;
            card.classList.add('shake');
          }
          if (alertBox) {
            alertBox.className = 'sec-gate-alert alert-error';
            alertBox.textContent = data.error || 'Master Password salah.';
            alertBox.style.display = 'block';
          }
          if (passInput) passInput.select();
        }
      } catch (err) {
        if (alertBox) {
          alertBox.className = 'sec-gate-alert alert-error';
          alertBox.textContent = `Error: ${err.message}`;
          alertBox.style.display = 'block';
        }
      } finally {
        if (btnUnlock) btnUnlock.disabled = false;
        if (unlockText) unlockText.textContent = 'Buka Kunci Akses (Unlock)';
        if (unlockSpinner) unlockSpinner.style.display = 'none';
      }
    });
  }

  // 2FA WhatsApp OTP Submission
  if (formOtp) {
    formOtp.addEventListener('submit', async (e) => {
      e.preventDefault();
      const otp = otpInput ? otpInput.value.trim() : '';
      const rememberMe = rememberCheckbox ? rememberCheckbox.checked : false;

      if (!otp) return;

      if (btnVerifyOtp) btnVerifyOtp.disabled = true;
      try {
        const res = await fetch('/api/auth/verify-otp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ otp, rememberMe })
        });
        const data = await res.json();

        if (data.success && data.token) {
          sessionToken = data.token;
          if (rememberMe) {
            localStorage.setItem('sb_session_token', data.token);
          } else {
            sessionStorage.setItem('sb_session_token', data.token);
          }
          document.cookie = `sb_session=${data.token}; path=/; max-age=${data.timeoutMinutes * 60}; SameSite=Strict`;
          unlockSecurityGate();
          showNotification('🔓 Verifikasi 2FA Sukses.');
        } else {
          if (card) {
            card.classList.remove('shake');
            void card.offsetWidth;
            card.classList.add('shake');
          }
          if (alertBox) {
            alertBox.className = 'sec-gate-alert alert-error';
            alertBox.textContent = data.error || 'Kode OTP salah atau kedaluwarsa.';
            alertBox.style.display = 'block';
          }
        }
      } catch (err) {
        if (alertBox) {
          alertBox.className = 'sec-gate-alert alert-error';
          alertBox.textContent = `Error: ${err.message}`;
          alertBox.style.display = 'block';
        }
      } finally {
        if (btnVerifyOtp) btnVerifyOtp.disabled = false;
      }
    });
  }

  if (btnBackToPass) {
    btnBackToPass.addEventListener('click', () => {
      formOtp.style.display = 'none';
      formPassword.style.display = 'block';
      if (alertBox) alertBox.style.display = 'none';
    });
  }

  // Manual Lock Screen Button
  if (btnLockScreen) {
    btnLockScreen.addEventListener('click', async () => {
      try {
        await fetch('/api/auth/logout', { method: 'POST' });
      } catch (e) {}
      sessionToken = '';
      localStorage.removeItem('sb_session_token');
      sessionStorage.removeItem('sb_session_token');
      document.cookie = 'sb_session=; path=/; max-age=0;';
      showSecurityGate('Layar telah dikunci.');
      showNotification('🔒 Layar Dashboard Terkunci.');
    });
  }

  // Security Settings Modal Open / Close
  if (btnOpenSecurity && modalSecSettings) {
    btnOpenSecurity.addEventListener('click', () => {
      modalSecSettings.classList.add('active');
    });
  }
  if (btnCloseSecSettings && modalSecSettings) {
    btnCloseSecSettings.addEventListener('click', () => {
      modalSecSettings.classList.remove('active');
    });
  }
  if (modalSecSettings) {
    modalSecSettings.addEventListener('click', (e) => {
      if (e.target === modalSecSettings) {
        modalSecSettings.classList.remove('active');
      }
    });
  }

  // Change Password Form
  if (formChangePassword) {
    formChangePassword.addEventListener('submit', async (e) => {
      e.preventDefault();
      const oldPassword = document.getElementById('input-old-password').value;
      const newPassword = document.getElementById('input-new-password').value;
      const confirmPassword = document.getElementById('input-confirm-password').value;
      const changeAlert = document.getElementById('change-pass-alert');

      if (newPassword !== confirmPassword) {
        if (changeAlert) {
          changeAlert.className = 'sec-gate-alert alert-error';
          changeAlert.textContent = 'Konfirmasi password baru tidak cocok!';
          changeAlert.style.display = 'block';
        }
        return;
      }

      try {
        const res = await fetch('/api/auth/change-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ oldPassword, newPassword })
        });
        const data = await res.json();
        if (data.success) {
          if (changeAlert) {
            changeAlert.className = 'sec-gate-alert alert-info';
            changeAlert.textContent = '✅ Master Password berhasil diubah! Silakan login ulang.';
            changeAlert.style.display = 'block';
          }
          setTimeout(() => {
            if (modalSecSettings) modalSecSettings.classList.remove('active');
            showSecurityGate('Password telah diubah. Silakan login dengan password baru.');
          }, 1500);
        } else {
          if (changeAlert) {
            changeAlert.className = 'sec-gate-alert alert-error';
            changeAlert.textContent = data.message || 'Gagal mengubah password.';
            changeAlert.style.display = 'block';
          }
        }
      } catch (err) {
        if (changeAlert) {
          changeAlert.className = 'sec-gate-alert alert-error';
          changeAlert.textContent = `Error: ${err.message}`;
          changeAlert.style.display = 'block';
        }
      }
    });
  }

  // Toggle Security Active
  if (toggleSecActive) {
    toggleSecActive.addEventListener('change', async (e) => {
      const enabled = e.target.checked;
      try {
        const res = await fetch('/api/auth/toggle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled })
        });
        const data = await res.json();
        const statusText = document.getElementById('sec-status-text');
        if (statusText) statusText.textContent = data.enabled ? 'Proteksi aktif (Wajib Password saat login)' : 'Proteksi dinonaktifkan (Akses publik bebas)';
        showNotification(data.enabled ? '🔐 Proteksi Security Gatekeeper Diaktifkan' : '⚠️ Proteksi Security Gatekeeper Dinonaktifkan');
      } catch (err) {
        showNotification(`❌ Error: ${err.message}`);
      }
    });
  }

  // Toggle 2FA WhatsApp
  if (toggle2fa) {
    toggle2fa.addEventListener('change', async (e) => {
      const enable2faWhatsapp = e.target.checked;
      try {
        await fetch('/api/auth/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enable2faWhatsapp })
        });
        showNotification(enable2faWhatsapp ? '📲 2FA WhatsApp OTP Diaktifkan' : '2FA WhatsApp Dinonaktifkan');
      } catch (err) {
        showNotification(`❌ Error: ${err.message}`);
      }
    });
  }

  // Timeout Select
  if (selectTimeout) {
    selectTimeout.addEventListener('change', async (e) => {
      const sessionTimeoutMinutes = parseInt(e.target.value, 10);
      try {
        await fetch('/api/auth/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionTimeoutMinutes })
        });
        securityConfig.sessionTimeoutMinutes = sessionTimeoutMinutes;
        resetInactivityTimer();
        showNotification(`⏱️ Auto-Lock diatur ke ${sessionTimeoutMinutes} menit.`);
      } catch (err) {
        showNotification(`❌ Error: ${err.message}`);
      }
    });
  }
}

