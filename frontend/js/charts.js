/**
 * Shopee Live Real-time Chart Engine (Canvas-based, Zero-dependency)
 * Menampilkan grafik concurrent viewers vs akumulasi total views secara interaktif dan mulus.
 */

class LiveViewerChart {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.maxPoints = 40;
    this.labels = [];
    this.concurrentData = [];
    this.accumulatedData = [];

    this.isDark = true;

    // Inisialisasi data titik awal
    for (let i = 0; i < 20; i++) {
      this.labels.push('');
      this.concurrentData.push(0);
      this.accumulatedData.push(0);
    }

    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.render();
  }

  setTheme(isDark) {
    this.isDark = Boolean(isDark);
    this.render();
  }

  resize() {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width * (window.devicePixelRatio || 1);
    this.canvas.height = rect.height * (window.devicePixelRatio || 1);
    this.ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
    this.width = rect.width;
    this.height = rect.height;
    this.render();
  }

  addDataPoint(concurrent, accumulated) {
    const timeStr = new Date().toLocaleTimeString('id-ID', { hour12: false });
    this.labels.push(timeStr);
    this.concurrentData.push(Number(concurrent) || 0);
    this.accumulatedData.push(Number(accumulated) || 0);

    if (this.concurrentData.length > this.maxPoints) {
      this.labels.shift();
      this.concurrentData.shift();
      this.accumulatedData.shift();
    }

    this.render();
  }

  render() {
    if (!this.ctx || !this.width || !this.height) return;
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const padding = { top: 25, right: 30, bottom: 30, left: 45 };

    ctx.clearRect(0, 0, w, h);

    // Draw background subtle grid lines
    ctx.strokeStyle = this.isDark ? 'rgba(255, 255, 255, 0.07)' : 'rgba(0, 0, 0, 0.08)';
    ctx.lineWidth = 1;
    const gridRows = 4;
    for (let r = 0; r <= gridRows; r++) {
      const y = padding.top + (r / gridRows) * (h - padding.top - padding.bottom);
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(w - padding.right, y);
      ctx.stroke();
    }

    // Determine max value scale
    const maxConcurrent = Math.max(...this.concurrentData, 10);
    const maxVal = Math.ceil(maxConcurrent * 1.25);

    // Function to calculate XY coordinate
    const getX = (index) => {
      const count = this.concurrentData.length - 1;
      return padding.left + (index / count) * (w - padding.left - padding.right);
    };

    const getY = (val) => {
      const usableHeight = h - padding.top - padding.bottom;
      return h - padding.bottom - (val / maxVal) * usableHeight;
    };

    // Draw Y-Axis Labels
    ctx.fillStyle = this.isDark ? '#94a3b8' : '#475569';
    ctx.font = '10px Outfit, sans-serif';
    ctx.textAlign = 'right';
    for (let r = 0; r <= gridRows; r++) {
      const val = Math.round(maxVal - (r / gridRows) * maxVal);
      const y = padding.top + (r / gridRows) * (h - padding.top - padding.bottom);
      ctx.fillText(val.toString(), padding.left - 8, y + 3);
    }

    // Draw Area under Concurrent Viewers (Cyan Gradient)
    const areaGrad = ctx.createLinearGradient(0, padding.top, 0, h - padding.bottom);
    areaGrad.addColorStop(0, 'rgba(6, 182, 212, 0.25)');
    areaGrad.addColorStop(1, 'rgba(6, 182, 212, 0.0)');

    ctx.beginPath();
    this.concurrentData.forEach((val, idx) => {
      const x = getX(idx);
      const y = getY(val);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.lineTo(getX(this.concurrentData.length - 1), h - padding.bottom);
    ctx.lineTo(getX(0), h - padding.bottom);
    ctx.closePath();
    ctx.fillStyle = areaGrad;
    ctx.fill();

    // Draw Concurrent Viewers Line (Cyan)
    ctx.beginPath();
    ctx.strokeStyle = '#06b6d4';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    this.concurrentData.forEach((val, idx) => {
      const x = getX(idx);
      const y = getY(val);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Highlight last point Concurrent
    if (this.concurrentData.length > 0) {
      const lastIdx = this.concurrentData.length - 1;
      const lastVal = this.concurrentData[lastIdx];
      const lastX = getX(lastIdx);
      const lastY = getY(lastVal);

      ctx.beginPath();
      ctx.arc(lastX, lastY, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#06b6d4';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    }

    // Mini Legend at top right
    ctx.font = '10px Outfit, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillStyle = '#06b6d4';
    ctx.fillText('● Concurrent Live', w - padding.right, padding.top - 8);
  }
}

window.LiveViewerChart = LiveViewerChart;
