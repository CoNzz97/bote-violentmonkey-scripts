// ==UserScript==
// @name         Cytube Usercount Trend Tracker
// @namespace    cytube.usercount.trend
// @version      1.2
// @description  Track connected user trends and visualize session occupancy
// @match        https://om3tcw.com/r/*
// @require      https://conzz97.github.io/bote-violentmonkey-scripts/lib/usercount-trend/utils.js
// @grant        GM_addStyle
// @grant        GM_getResourceText
// @grant        GM_getValue
// @grant        GM_setValue
// @resource     usercountTrendPanelHtml https://conzz97.github.io/bote-violentmonkey-scripts/assets/usercount-trend/panel.html
// @resource     usercountTrendStyles https://conzz97.github.io/bote-violentmonkey-scripts/assets/usercount-trend/styles.css
// ==/UserScript==

(function() {
  'use strict';

  const TOGGLE_ID = 'usercount-trend-toggle';
  const PANEL_ID = 'cytube-tools-usercount-trend-panel';
  const PANEL_CLASS = 'cytube-tools-usercount-trend-panel';
  const RETRY_DELAY_MS = 500;
  const MAX_RETRIES = 120;
  const SAMPLE_CAP = 3600;

  const STORAGE_KEYS = {
    settings: 'cytube:usercount-trend:settings',
    samples: 'cytube:usercount-trend:samples'
  };

  const DEFAULT_SETTINGS = {
    enabled: true,
    sampleIntervalMs: 10000,
    windowMinutes: 15,
    paused: false
  };

  const UI_IDS = {
    enabled: 'cytube-tools-usercount-trend-enabled',
    interval: 'cytube-tools-usercount-trend-interval',
    window: 'cytube-tools-usercount-trend-window',
    paused: 'cytube-tools-usercount-trend-paused',
    sampleNow: 'cytube-tools-usercount-trend-sample-now',
    clear: 'cytube-tools-usercount-trend-clear',
    export: 'cytube-tools-usercount-trend-export',
    stats: 'cytube-tools-usercount-trend-stats',
    chart: 'cytube-tools-usercount-trend-chart'
  };

  const RESOURCE_NAMES = {
    panelHtml: 'usercountTrendPanelHtml',
    styles: 'usercountTrendStyles'
  };

  const FALLBACK_PANEL_HTML = `
    <div class="cytube-tools-usercount-trend-head"><strong>Usercount Trend Tracker</strong></div>
    <div class="cytube-tools-usercount-trend-empty">
      Resource load failed. Check script @resource URLs for panel.html/styles.css.
    </div>
  `;

  const usercountTrendUtils = window.CytubeUsercountTrendUtils;
  if (!usercountTrendUtils) {
    return;
  }

  const state = {
    settings: loadSettings(),
    samples: loadSamples(),
    panelVisible: false,
    sampleTimer: null,
    usercountObserver: null,
    waitingForUsercount: false,
    ui: {
      button: null,
      panel: null
    }
  };

  function safeGetValue(key, fallback) {
    try {
      const value = GM_getValue(key, fallback);
      return value === undefined ? fallback : value;
    } catch (err) {
      return fallback;
    }
  }

  function safeSetValue(key, value) {
    try {
      GM_setValue(key, value);
    } catch (err) {
      // Keep runtime stable on storage failures.
    }
  }

  function safeGetResourceText(name, fallback = '') {
    try {
      if (typeof GM_getResourceText !== 'function') {
        return fallback;
      }
      const text = GM_getResourceText(name);
      if (typeof text === 'string' && text.trim()) {
        return text;
      }
    } catch (err) {
      // Keep script stable on resource load failures.
    }
    return fallback;
  }

  function parseStoredObject(raw) {
    return usercountTrendUtils.parseStoredObject(raw);
  }

  function parseStoredArray(raw) {
    return usercountTrendUtils.parseStoredArray(raw);
  }

  function parseBoolean(value, fallback) {
    return usercountTrendUtils.parseBoolean(value, fallback);
  }

  function clampNumber(value, min, max, fallback) {
    return usercountTrendUtils.clampNumber(value, min, max, fallback);
  }

  function loadSettings() {
    const raw = parseStoredObject(safeGetValue(STORAGE_KEYS.settings, {}));
    return {
      enabled: parseBoolean(raw.enabled, DEFAULT_SETTINGS.enabled),
      sampleIntervalMs: clampNumber(raw.sampleIntervalMs, 5000, 60000, DEFAULT_SETTINGS.sampleIntervalMs),
      windowMinutes: clampNumber(raw.windowMinutes, 5, 120, DEFAULT_SETTINGS.windowMinutes),
      paused: parseBoolean(raw.paused, DEFAULT_SETTINGS.paused)
    };
  }

  function loadSamples() {
    const parsed = parseStoredArray(safeGetValue(STORAGE_KEYS.samples, []));
    const clean = [];
    parsed.forEach((sample) => {
      const ts = Number(sample?.ts);
      const count = Number(sample?.count);
      if (!Number.isFinite(ts) || ts <= 0 || !Number.isFinite(count) || count < 0) {
        return;
      }
      clean.push({ ts, count: Math.round(count) });
    });
    clean.sort((a, b) => a.ts - b.ts);
    if (clean.length > SAMPLE_CAP) {
      return clean.slice(clean.length - SAMPLE_CAP);
    }
    return clean;
  }

  function persistSettings() {
    safeSetValue(STORAGE_KEYS.settings, JSON.stringify(state.settings));
  }

  function persistSamples() {
    safeSetValue(STORAGE_KEYS.samples, JSON.stringify(state.samples));
  }

  function waitForEl(selector, attempt = 0) {
    const node = document.querySelector(selector);
    if (node) {
      return Promise.resolve(node);
    }
    if (attempt >= MAX_RETRIES) {
      return Promise.resolve(null);
    }
    return new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
      .then(() => waitForEl(selector, attempt + 1));
  }

  function openToolsTab() {
    if (typeof window.jQuery !== 'undefined') {
      window.jQuery('a[href="#toolsTab"]').tab('show');
    }
  }

  async function ensureToolsUi() {
    const buttonHost = await waitForEl('#tools-button-container');
    const panelHost = await waitForEl('#tools-content-area');
    if (!buttonHost || !panelHost) {
      return null;
    }

    let button = document.getElementById(TOGGLE_ID);
    if (!button) {
      button = document.createElement('button');
      button.id = TOGGLE_ID;
      button.className = 'btn btn-sm btn-default';
      button.textContent = 'User Trend';
      button.title = 'Toggle Usercount Trend Tracker';
      buttonHost.appendChild(button);
    }

    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
      panel = document.createElement('div');
      panel.id = PANEL_ID;
      panel.className = PANEL_CLASS;
      panel.style.display = 'none';
      panelHost.appendChild(panel);
    }

    state.ui.button = button;
    state.ui.panel = panel;
    return { button, panel };
  }

  function extractConnectedUsersFromElement(userCountEl) {
    return usercountTrendUtils.extractConnectedUsersFromElement(userCountEl);
  }

  function getConnectedUsers() {
    const value = extractConnectedUsersFromElement(document.getElementById('usercount'));
    return Number.isFinite(value) ? value : null;
  }

  function addSample(count, ts = Date.now()) {
    if (!Number.isFinite(count) || count < 0 || !Number.isFinite(ts)) {
      return false;
    }

    const rounded = Math.round(count);
    const last = state.samples[state.samples.length - 1];
    if (last && last.ts === ts && last.count === rounded) {
      return false;
    }

    state.samples.push({ ts, count: rounded });
    if (state.samples.length > SAMPLE_CAP) {
      state.samples.splice(0, state.samples.length - SAMPLE_CAP);
    }

    persistSamples();
    return true;
  }

  function sampleNow() {
    const connected = getConnectedUsers();
    if (!Number.isFinite(connected)) {
      return;
    }
    if (addSample(connected)) {
      renderStatsAndChart();
    }
  }

  function stopSampleTimer() {
    if (!state.sampleTimer) {
      return;
    }
    clearInterval(state.sampleTimer);
    state.sampleTimer = null;
  }

  function startSampleTimer() {
    stopSampleTimer();
    state.sampleTimer = setInterval(() => {
      if (!state.settings.enabled || state.settings.paused) {
        return;
      }
      sampleNow();
    }, state.settings.sampleIntervalMs);
  }

  function stopUsercountObserver() {
    if (!state.usercountObserver) {
      return;
    }
    state.usercountObserver.disconnect();
    state.usercountObserver = null;
  }

  function startUsercountObserver() {
    if (state.usercountObserver) {
      return true;
    }
    const usercountEl = document.getElementById('usercount');
    if (!usercountEl) {
      return false;
    }

    state.usercountObserver = new MutationObserver(() => {
      if (!state.settings.enabled || state.settings.paused) {
        return;
      }
      const now = Date.now();
      const last = state.samples[state.samples.length - 1];
      if (last && now - last.ts < 1000) {
        return;
      }
      sampleNow();
    });
    state.usercountObserver.observe(usercountEl, { childList: true, characterData: true, subtree: true });
    return true;
  }

  function syncUsercountObserver() {
    if (!state.settings.enabled) {
      stopUsercountObserver();
      return;
    }

    if (startUsercountObserver()) {
      return;
    }
    if (state.waitingForUsercount) {
      return;
    }
    state.waitingForUsercount = true;
    waitForEl('#usercount').then(() => {
      state.waitingForUsercount = false;
      if (state.settings.enabled) {
        startUsercountObserver();
      }
    });
  }

  function syncTrackingState() {
    if (!state.settings.enabled) {
      stopSampleTimer();
      stopUsercountObserver();
      renderStatsAndChart();
      return;
    }

    if (!state.settings.paused) {
      sampleNow();
    }
    startSampleTimer();
    syncUsercountObserver();
    renderStatsAndChart();
  }

  function getWindowSamples() {
    const minutes = state.settings.windowMinutes;
    const cutoff = Date.now() - (minutes * 60 * 1000);
    const inWindow = state.samples.filter((sample) => sample.ts >= cutoff);
    if (inWindow.length) {
      return inWindow;
    }
    return state.samples.length ? [state.samples[state.samples.length - 1]] : [];
  }

  function computeStats(samples) {
    return usercountTrendUtils.computeStats(samples);
  }

  function formatSigned(value) {
    return usercountTrendUtils.formatSigned(value);
  }

  function drawChart(samples) {
    const canvas = document.getElementById(UI_IDS.chart);
    if (!(canvas instanceof HTMLCanvasElement)) {
      return;
    }

    const width = Math.max(240, canvas.clientWidth || 240);
    const height = 120;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#171717';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = '#2f2f2f';
    ctx.strokeRect(0.5, 0.5, width - 1, height - 1);

    if (samples.length < 2) {
      ctx.fillStyle = '#9aa0a6';
      ctx.font = '12px sans-serif';
      ctx.fillText(samples.length ? 'Need more samples for trend line.' : 'No samples yet.', 10, 18);
      return;
    }

    let min = Infinity;
    let max = -Infinity;
    samples.forEach((sample) => {
      if (sample.count < min) {
        min = sample.count;
      }
      if (sample.count > max) {
        max = sample.count;
      }
    });
    if (min === max) {
      min -= 1;
      max += 1;
    }

    const xMin = samples[0].ts;
    const xMax = samples[samples.length - 1].ts;
    const xRange = Math.max(1, xMax - xMin);
    const yRange = max - min;
    const padX = 10;
    const padY = 10;
    const usableW = width - (padX * 2);
    const usableH = height - (padY * 2);

    ctx.strokeStyle = '#4ea1ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    samples.forEach((sample, idx) => {
      const x = padX + (((sample.ts - xMin) / xRange) * usableW);
      const y = height - padY - (((sample.count - min) / yRange) * usableH);
      if (idx === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();

    const last = samples[samples.length - 1];
    const lastX = padX + (((last.ts - xMin) / xRange) * usableW);
    const lastY = height - padY - (((last.count - min) / yRange) * usableH);
    ctx.fillStyle = '#ffd166';
    ctx.beginPath();
    ctx.arc(lastX, lastY, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  function renderStatsAndChart() {
    const statsEl = document.getElementById(UI_IDS.stats);
    if (!statsEl) {
      return;
    }

    const windowSamples = getWindowSamples();
    const stats = computeStats(windowSamples);
    if (!stats) {
      statsEl.textContent = `No samples yet. Sampling every ${state.settings.sampleIntervalMs / 1000}s when enabled.`;
      drawChart([]);
      return;
    }

    const status = state.settings.enabled
      ? (state.settings.paused ? 'Paused' : 'Running')
      : 'Disabled';

    statsEl.textContent = [
      `Status: ${status}`,
      `Current: ${stats.current}`,
      `Min: ${stats.min}`,
      `Max: ${stats.max}`,
      `Avg: ${(Math.round(stats.average * 100) / 100)}`,
      `Delta(prev): ${formatSigned(stats.deltaPrev)}`,
      `Delta(avg): ${formatSigned(stats.deltaAvg)}`,
      `Samples: ${windowSamples.length}/${state.samples.length}`
    ].join('  |  ');

    drawChart(windowSamples);
  }

  function clearSamples() {
    state.samples = [];
    persistSamples();
    renderStatsAndChart();
  }

  function exportSamples() {
    const payload = {
      exportedAt: new Date().toISOString(),
      settings: state.settings,
      samples: getWindowSamples()
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cytube-usercount-trend-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function fillFormFromSettings() {
    const enabledEl = document.getElementById(UI_IDS.enabled);
    const intervalEl = document.getElementById(UI_IDS.interval);
    const windowEl = document.getElementById(UI_IDS.window);
    const pausedEl = document.getElementById(UI_IDS.paused);

    if (enabledEl) {
      enabledEl.checked = state.settings.enabled;
    }
    if (intervalEl) {
      intervalEl.value = String(state.settings.sampleIntervalMs);
    }
    if (windowEl) {
      windowEl.value = String(state.settings.windowMinutes);
    }
    if (pausedEl) {
      pausedEl.checked = state.settings.paused;
    }
    renderStatsAndChart();
  }

  function bindUiEvents() {
    const enabledEl = document.getElementById(UI_IDS.enabled);
    const intervalEl = document.getElementById(UI_IDS.interval);
    const windowEl = document.getElementById(UI_IDS.window);
    const pausedEl = document.getElementById(UI_IDS.paused);
    const sampleNowEl = document.getElementById(UI_IDS.sampleNow);
    const clearEl = document.getElementById(UI_IDS.clear);
    const exportEl = document.getElementById(UI_IDS.export);

    if (enabledEl) {
      enabledEl.addEventListener('change', () => {
        state.settings.enabled = enabledEl.checked;
        persistSettings();
        syncTrackingState();
      });
    }

    if (intervalEl) {
      intervalEl.addEventListener('change', () => {
        const next = clampNumber(intervalEl.value, 5000, 60000, DEFAULT_SETTINGS.sampleIntervalMs);
        state.settings.sampleIntervalMs = next;
        intervalEl.value = String(next);
        persistSettings();
        syncTrackingState();
      });
    }

    if (windowEl) {
      windowEl.addEventListener('change', () => {
        const next = clampNumber(windowEl.value, 5, 120, DEFAULT_SETTINGS.windowMinutes);
        state.settings.windowMinutes = next;
        windowEl.value = String(next);
        persistSettings();
        renderStatsAndChart();
      });
    }

    if (pausedEl) {
      pausedEl.addEventListener('change', () => {
        state.settings.paused = pausedEl.checked;
        persistSettings();
        syncTrackingState();
      });
    }

    if (sampleNowEl) {
      sampleNowEl.addEventListener('click', sampleNow);
    }
    if (clearEl) {
      clearEl.addEventListener('click', clearSamples);
    }
    if (exportEl) {
      exportEl.addEventListener('click', exportSamples);
    }
  }

  function togglePanel() {
    if (!state.ui.button || !state.ui.panel) {
      return;
    }
    openToolsTab();
    state.panelVisible = !state.panelVisible;
    state.ui.panel.style.display = state.panelVisible ? 'block' : 'none';
    state.ui.button.classList.toggle('active', state.panelVisible);
    if (state.panelVisible) {
      renderStatsAndChart();
    }
  }

  function renderPanel() {
    if (!state.ui.panel) {
      return;
    }

    state.ui.panel.innerHTML = safeGetResourceText(RESOURCE_NAMES.panelHtml, FALLBACK_PANEL_HTML);

    bindUiEvents();
    fillFormFromSettings();
  }

  const resourceCss = safeGetResourceText(RESOURCE_NAMES.styles, '');
  if (resourceCss) {
    GM_addStyle(resourceCss);
  } else {
    GM_addStyle(`
      #${TOGGLE_ID}.active {
        background: #337ab7 !important;
        border-color: #2e6da4 !important;
        color: #fff !important;
      }
      .${PANEL_CLASS} {
        display: none;
      }
    `);
  }

  (async () => {
    const toolsUi = await ensureToolsUi();
    if (!toolsUi) {
      return;
    }

    persistSettings();
    persistSamples();
    renderPanel();
    toolsUi.button.addEventListener('click', togglePanel);
    toolsUi.button.classList.toggle('active', state.panelVisible);
    syncTrackingState();
  })();
})();
