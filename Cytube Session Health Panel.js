// ==UserScript==
// @name         Cytube Session Health Panel
// @namespace    cytube.session.health
// @version      1.0
// @description  Unified panel for session stability, churn, and anonymous ratio
// @match        https://om3tcw.com/r/*
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function() {
  'use strict';

  const TOGGLE_ID = 'session-health-toggle';
  const PANEL_ID = 'cytube-tools-session-health-panel';
  const PANEL_CLASS = 'cytube-tools-session-health-panel';
  const RETRY_DELAY_MS = 500;
  const MAX_RETRIES = 120;
  const USERCOUNT_SAMPLE_MS = 15000;
  const TIMELINE_LIMIT = 300;

  const STORAGE_KEYS = {
    settings: 'cytube:session-health:settings',
    timeline: 'cytube:session-health:timeline'
  };

  const DEFAULT_SETTINGS = {
    enabled: false,
    reconnectThreshold10m: 3,
    anonRatioThreshold: 0.35,
    jumpThreshold: 5,
    churnThreshold5m: 12,
    soundEnabled: false,
    alertCooldownSec: 60
  };

  const UI_IDS = {
    enabled: 'cytube-tools-session-health-enabled',
    reconnectThreshold: 'cytube-tools-session-health-reconnect-threshold',
    anonThreshold: 'cytube-tools-session-health-anon-threshold',
    jumpThreshold: 'cytube-tools-session-health-jump-threshold',
    churnThreshold: 'cytube-tools-session-health-churn-threshold',
    soundEnabled: 'cytube-tools-session-health-sound',
    alertCooldown: 'cytube-tools-session-health-alert-cooldown',
    score: 'cytube-tools-session-health-score',
    metrics: 'cytube-tools-session-health-metrics',
    clear: 'cytube-tools-session-health-clear',
    export: 'cytube-tools-session-health-export',
    timeline: 'cytube-tools-session-health-timeline'
  };

  const state = {
    settings: loadSettings(),
    panelVisible: false,
    usercountObserver: null,
    userlistObserver: null,
    messageObserver: null,
    usercountTimer: null,
    waitingForUsercount: false,
    waitingForUserlist: false,
    waitingForMessagebuffer: false,
    connectedCount: null,
    presenceMap: new Map(),
    usercountSamples: [],
    joinLeaveEvents: [],
    reconnectEvents: [],
    timeline: loadTimeline(),
    alertCooldowns: Object.create(null),
    audioContext: null,
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
      // Keep script stable on storage failure.
    }
  }

  function parseStoredObject(raw) {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
      } catch (err) {}
    }
    return {};
  }

  function parseStoredArray(raw) {
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch (err) {}
    }
    return [];
  }

  function parseBoolean(value, fallback) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
      const norm = value.trim().toLowerCase();
      if (norm === 'true' || norm === '1') return true;
      if (norm === 'false' || norm === '0') return false;
    }
    return fallback;
  }

  function clampNumber(value, min, max, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  }

  function loadSettings() {
    const raw = parseStoredObject(safeGetValue(STORAGE_KEYS.settings, {}));
    return {
      enabled: parseBoolean(raw.enabled, DEFAULT_SETTINGS.enabled),
      reconnectThreshold10m: clampNumber(raw.reconnectThreshold10m, 1, 20, DEFAULT_SETTINGS.reconnectThreshold10m),
      anonRatioThreshold: clampNumber(raw.anonRatioThreshold, 0, 1, DEFAULT_SETTINGS.anonRatioThreshold),
      jumpThreshold: clampNumber(raw.jumpThreshold, 1, 50, DEFAULT_SETTINGS.jumpThreshold),
      churnThreshold5m: clampNumber(raw.churnThreshold5m, 1, 200, DEFAULT_SETTINGS.churnThreshold5m),
      soundEnabled: parseBoolean(raw.soundEnabled, DEFAULT_SETTINGS.soundEnabled),
      alertCooldownSec: clampNumber(raw.alertCooldownSec, 5, 600, DEFAULT_SETTINGS.alertCooldownSec)
    };
  }

  function sanitizeTimelineEntry(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const ts = Number(raw.ts);
    if (!Number.isFinite(ts) || ts <= 0) return null;
    return {
      id: String(raw.id || `${ts}-${Math.random().toString(36).slice(2, 8)}`),
      ts,
      type: String(raw.type || 'info'),
      severity: String(raw.severity || 'info'),
      message: String(raw.message || '').slice(0, 240)
    };
  }

  function loadTimeline() {
    const parsed = parseStoredArray(safeGetValue(STORAGE_KEYS.timeline, []));
    const clean = parsed.map(sanitizeTimelineEntry).filter(Boolean);
    clean.sort((a, b) => b.ts - a.ts);
    if (clean.length > TIMELINE_LIMIT) clean.length = TIMELINE_LIMIT;
    return clean;
  }

  function persistSettings() {
    safeSetValue(STORAGE_KEYS.settings, JSON.stringify(state.settings));
  }

  function persistTimeline() {
    safeSetValue(STORAGE_KEYS.timeline, JSON.stringify(state.timeline));
  }

  function waitForEl(selector, attempt = 0) {
    const node = document.querySelector(selector);
    if (node) return Promise.resolve(node);
    if (attempt >= MAX_RETRIES) return Promise.resolve(null);
    return new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
      .then(() => waitForEl(selector, attempt + 1));
  }

  function openToolsTab() {
    if (typeof window.jQuery !== 'undefined') window.jQuery('a[href="#toolsTab"]').tab('show');
  }

  async function ensureToolsUi() {
    const buttonHost = await waitForEl('#tools-button-container');
    const panelHost = await waitForEl('#tools-content-area');
    if (!buttonHost || !panelHost) return null;

    let button = document.getElementById(TOGGLE_ID);
    if (!button) {
      button = document.createElement('button');
      button.id = TOGGLE_ID;
      button.className = 'btn btn-sm btn-default';
      button.textContent = 'Session Health';
      button.title = 'Toggle Session Health Panel';
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

  function normalizeUsername(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function parseConnectedCount() {
    const el = document.getElementById('usercount');
    if (!el) return null;
    const clone = el.cloneNode(true);
    if (clone instanceof HTMLElement) {
      clone.querySelectorAll('.profile-box').forEach((node) => node.remove());
    }
    const text = clone.textContent.replace(/\s+/g, ' ').trim();
    const match = text.match(/(\d+)\s*(?:connected\s*users?|users?\s*connected)/i) || text.match(/(\d+)/);
    return match ? Number(match[1]) : null;
  }

  function sampleConnectedCount(source = 'sample') {
    const count = parseConnectedCount();
    if (!Number.isFinite(count)) return;

    const now = Date.now();
    const previous = state.connectedCount;
    state.connectedCount = count;
    state.usercountSamples.push({ ts: now, count });
    if (state.usercountSamples.length > 1200) {
      state.usercountSamples.splice(0, state.usercountSamples.length - 1200);
    }

    if (Number.isFinite(previous)) {
      const delta = count - previous;
      if (Math.abs(delta) >= state.settings.jumpThreshold) {
        addTimeline('jump', `Connected users ${delta > 0 ? 'increased' : 'decreased'} by ${Math.abs(delta)} (${previous} -> ${count})`, 'warn');
      }
    }

    if (source !== 'silent') {
      refreshUi();
    }
  }

  function extractUserFromRow(row) {
    if (!(row instanceof HTMLElement)) return null;
    const spans = Array.from(row.children).filter((node) => node instanceof HTMLSpanElement);
    const nameSpan = spans.find((span) => {
      if (span.querySelector('.glyphicon-time')) return false;
      const text = span.textContent.replace(/\s+/g, ' ').trim();
      return Boolean(text);
    });
    const username = nameSpan ? nameSpan.textContent.replace(/\s+/g, ' ').trim() : '';
    const key = normalizeUsername(username);
    return key ? { key, username } : null;
  }

  function snapshotPresenceMap() {
    const map = new Map();
    document.querySelectorAll('#userlist .userlist_item').forEach((row) => {
      const user = extractUserFromRow(row);
      if (!user || map.has(user.key)) return;
      map.set(user.key, user);
    });
    return map;
  }

  function recordJoinLeave(type, username) {
    const ts = Date.now();
    state.joinLeaveEvents.push({ ts, type, username });
    if (state.joinLeaveEvents.length > 2000) {
      state.joinLeaveEvents.splice(0, state.joinLeaveEvents.length - 2000);
    }
  }

  function processUserlistChanges() {
    const next = snapshotPresenceMap();
    next.forEach((user, key) => {
      if (!state.presenceMap.has(key)) {
        recordJoinLeave('join', user.username);
      }
    });
    state.presenceMap.forEach((user, key) => {
      if (!next.has(key)) {
        recordJoinLeave('leave', user.username);
      }
    });
    state.presenceMap = next;
    refreshUi();
  }

  function isReconnectMessage(node) {
    if (!(node instanceof HTMLElement)) return false;
    if (node.classList.contains('server-msg-reconnect')) return true;
    const text = node.textContent.replace(/\s+/g, ' ').trim().toLowerCase();
    return text.includes('reconnect') || text.includes('connection to server');
  }

  function handleChatNode(node) {
    if (!isReconnectMessage(node)) return;
    const ts = Date.now();
    const msg = node.textContent.replace(/\s+/g, ' ').trim().slice(0, 180) || 'Reconnect event';
    state.reconnectEvents.push({ ts, message: msg });
    if (state.reconnectEvents.length > 500) {
      state.reconnectEvents.splice(0, state.reconnectEvents.length - 500);
    }
    addTimeline('reconnect', msg, 'critical');
    refreshUi();
  }

  function addTimeline(type, message, severity = 'info') {
    const entry = sanitizeTimelineEntry({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      ts: Date.now(),
      type,
      severity,
      message
    });
    if (!entry) return;
    state.timeline.unshift(entry);
    if (state.timeline.length > TIMELINE_LIMIT) {
      state.timeline.length = TIMELINE_LIMIT;
    }
    persistTimeline();
    maybeAlert(type, message, severity);
    renderTimeline();
  }

  function maybeAlert(type, message, severity) {
    const now = Date.now();
    const key = `${type}:${severity}`;
    const last = state.alertCooldowns[key] || 0;
    if (now - last < state.settings.alertCooldownSec * 1000) return;

    const metrics = computeMetrics();
    if (type === 'reconnect' && metrics.reconnect10m < state.settings.reconnectThreshold10m) return;
    if (type === 'jump' && metrics.volatility10m < state.settings.jumpThreshold) return;
    if (metrics.anonRatio < state.settings.anonRatioThreshold && metrics.churn5m < state.settings.churnThreshold5m) return;

    state.alertCooldowns[key] = now;
    if (state.settings.soundEnabled) playAlertSound();
  }

  function playAlertSound() {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;
    try {
      if (!state.audioContext) state.audioContext = new Ctor();
      if (state.audioContext.state === 'suspended') state.audioContext.resume().catch(() => {});
      const t = state.audioContext.currentTime;
      const osc = state.audioContext.createOscillator();
      const gain = state.audioContext.createGain();
      osc.frequency.setValueAtTime(660, t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      osc.connect(gain);
      gain.connect(state.audioContext.destination);
      osc.start(t);
      osc.stop(t + 0.21);
    } catch (err) {}
  }

  function pruneOldEvents() {
    const cutoff15m = Date.now() - (15 * 60 * 1000);
    state.joinLeaveEvents = state.joinLeaveEvents.filter((event) => event.ts >= cutoff15m);
    state.reconnectEvents = state.reconnectEvents.filter((event) => event.ts >= cutoff15m);
    state.usercountSamples = state.usercountSamples.filter((sample) => sample.ts >= cutoff15m);
  }

  function computeMetrics() {
    pruneOldEvents();

    const now = Date.now();
    const listed = state.presenceMap.size;
    const connected = Number.isFinite(state.connectedCount) ? state.connectedCount : listed;
    const anonymous = Math.max(0, connected - listed);
    const anonRatio = connected > 0 ? anonymous / connected : 0;

    const reconnect10m = state.reconnectEvents.filter((event) => event.ts >= now - (10 * 60 * 1000)).length;
    const churn5m = state.joinLeaveEvents.filter((event) => event.ts >= now - (5 * 60 * 1000)).length;
    const churn15m = state.joinLeaveEvents.length;

    let volatility10m = 0;
    const recentSamples = state.usercountSamples.filter((sample) => sample.ts >= now - (10 * 60 * 1000));
    if (recentSamples.length >= 2) {
      let sumDelta = 0;
      for (let i = 1; i < recentSamples.length; i += 1) {
        sumDelta += Math.abs(recentSamples[i].count - recentSamples[i - 1].count);
      }
      volatility10m = sumDelta / (recentSamples.length - 1);
    }

    const penaltyReconnect = Math.min(40, reconnect10m * 10);
    const penaltyChurn = Math.min(25, churn5m * 1.5);
    const penaltyAnon = anonRatio > state.settings.anonRatioThreshold
      ? Math.min(20, (anonRatio - state.settings.anonRatioThreshold) * 100)
      : 0;
    const penaltyVol = Math.min(20, volatility10m * 2);

    const score = Math.max(0, Math.min(100, 100 - penaltyReconnect - penaltyChurn - penaltyAnon - penaltyVol));
    const status = score >= 75 ? 'good' : (score >= 50 ? 'warning' : 'critical');

    return { connected, listed, anonymous, anonRatio, reconnect10m, churn5m, churn15m, volatility10m, score, status };
  }

  function refreshUi() {
    renderScoreAndMetrics();
    renderTimeline();
  }

  function renderScoreAndMetrics() {
    const scoreEl = document.getElementById(UI_IDS.score);
    const metricsEl = document.getElementById(UI_IDS.metrics);
    if (!scoreEl || !metricsEl) return;
    const m = computeMetrics();
    scoreEl.className = `cytube-tools-session-health-score status-${m.status}`;
    scoreEl.textContent = `Health Score: ${Math.round(m.score)} (${m.status.toUpperCase()})`;
    metricsEl.textContent = [
      `Connected: ${m.connected}`,
      `Listed: ${m.listed}`,
      `Anonymous: ${m.anonymous} (${Math.round(m.anonRatio * 100)}%)`,
      `Reconnects/10m: ${m.reconnect10m}`,
      `Churn/5m: ${m.churn5m}`,
      `Churn/15m: ${m.churn15m}`,
      `Volatility/10m: ${Math.round(m.volatility10m * 100) / 100}`
    ].join('  |  ');
  }

  function renderTimeline() {
    const listEl = document.getElementById(UI_IDS.timeline);
    if (!listEl) return;
    listEl.replaceChildren();
    if (!state.timeline.length) {
      const empty = document.createElement('div');
      empty.className = 'cytube-tools-session-health-empty';
      empty.textContent = 'No timeline events yet.';
      listEl.appendChild(empty);
      return;
    }
    state.timeline.forEach((entry) => {
      const row = document.createElement('div');
      row.className = `cytube-tools-session-health-row sev-${entry.severity}`;
      row.innerHTML = `
        <div class="cytube-tools-session-health-row-head">
          <span class="cytube-tools-session-health-time">${new Date(entry.ts).toLocaleTimeString()}</span>
          <span class="cytube-tools-session-health-type">${entry.type}</span>
        </div>
        <div class="cytube-tools-session-health-msg">${entry.message}</div>
      `;
      listEl.appendChild(row);
    });
  }

  function clearTimeline() {
    state.timeline = [];
    persistTimeline();
    renderTimeline();
  }

  function exportDiagnostics() {
    const payload = {
      exportedAt: new Date().toISOString(),
      settings: state.settings,
      metrics: computeMetrics(),
      timeline: state.timeline
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cytube-session-health-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function stopObservers() {
    if (state.usercountObserver) {
      state.usercountObserver.disconnect();
      state.usercountObserver = null;
    }
    if (state.userlistObserver) {
      state.userlistObserver.disconnect();
      state.userlistObserver = null;
    }
    if (state.messageObserver) {
      state.messageObserver.disconnect();
      state.messageObserver = null;
    }
    if (state.usercountTimer) {
      clearInterval(state.usercountTimer);
      state.usercountTimer = null;
    }
  }

  function startUsercountTracking() {
    if (!state.usercountObserver) {
      const el = document.getElementById('usercount');
      if (!el) return false;
      state.usercountObserver = new MutationObserver(() => sampleConnectedCount('mutation'));
      state.usercountObserver.observe(el, { childList: true, characterData: true, subtree: true });
    }
    if (!state.usercountTimer) {
      state.usercountTimer = setInterval(() => sampleConnectedCount('timer'), USERCOUNT_SAMPLE_MS);
    }
    sampleConnectedCount('startup');
    return true;
  }

  function startUserlistTracking() {
    if (state.userlistObserver) return true;
    const userlist = document.querySelector('#userlist');
    if (!userlist) return false;
    state.presenceMap = snapshotPresenceMap();
    state.userlistObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type !== 'childList') continue;
        if (mutation.addedNodes.length || mutation.removedNodes.length) {
          processUserlistChanges();
          return;
        }
      }
    });
    state.userlistObserver.observe(userlist, { childList: true, subtree: true });
    return true;
  }

  function startMessageTracking() {
    if (state.messageObserver) return true;
    const buffer = document.querySelector('#messagebuffer');
    if (!buffer) return false;
    state.messageObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => mutation.addedNodes.forEach((node) => handleChatNode(node)));
    });
    state.messageObserver.observe(buffer, { childList: true });
    return true;
  }

  function syncTrackingState() {
    if (!state.settings.enabled) {
      stopObservers();
      refreshUi();
      return;
    }

    if (!startUsercountTracking() && !state.waitingForUsercount) {
      state.waitingForUsercount = true;
      waitForEl('#usercount').then(() => {
        state.waitingForUsercount = false;
        if (state.settings.enabled) startUsercountTracking();
      });
    }

    if (!startUserlistTracking() && !state.waitingForUserlist) {
      state.waitingForUserlist = true;
      waitForEl('#userlist').then(() => {
        state.waitingForUserlist = false;
        if (state.settings.enabled) startUserlistTracking();
      });
    }

    if (!startMessageTracking() && !state.waitingForMessagebuffer) {
      state.waitingForMessagebuffer = true;
      waitForEl('#messagebuffer').then(() => {
        state.waitingForMessagebuffer = false;
        if (state.settings.enabled) startMessageTracking();
      });
    }

    refreshUi();
  }

  function fillFormFromSettings() {
    const enabledEl = document.getElementById(UI_IDS.enabled);
    const reconnectEl = document.getElementById(UI_IDS.reconnectThreshold);
    const anonEl = document.getElementById(UI_IDS.anonThreshold);
    const jumpEl = document.getElementById(UI_IDS.jumpThreshold);
    const churnEl = document.getElementById(UI_IDS.churnThreshold);
    const soundEl = document.getElementById(UI_IDS.soundEnabled);
    const cooldownEl = document.getElementById(UI_IDS.alertCooldown);

    if (enabledEl) enabledEl.checked = state.settings.enabled;
    if (reconnectEl) reconnectEl.value = String(state.settings.reconnectThreshold10m);
    if (anonEl) anonEl.value = String(state.settings.anonRatioThreshold);
    if (jumpEl) jumpEl.value = String(state.settings.jumpThreshold);
    if (churnEl) churnEl.value = String(state.settings.churnThreshold5m);
    if (soundEl) soundEl.checked = state.settings.soundEnabled;
    if (cooldownEl) cooldownEl.value = String(state.settings.alertCooldownSec);
    refreshUi();
  }

  function bindUiEvents() {
    const enabledEl = document.getElementById(UI_IDS.enabled);
    const reconnectEl = document.getElementById(UI_IDS.reconnectThreshold);
    const anonEl = document.getElementById(UI_IDS.anonThreshold);
    const jumpEl = document.getElementById(UI_IDS.jumpThreshold);
    const churnEl = document.getElementById(UI_IDS.churnThreshold);
    const soundEl = document.getElementById(UI_IDS.soundEnabled);
    const cooldownEl = document.getElementById(UI_IDS.alertCooldown);
    const clearEl = document.getElementById(UI_IDS.clear);
    const exportEl = document.getElementById(UI_IDS.export);

    const saveThresholds = () => {
      state.settings.reconnectThreshold10m = clampNumber(reconnectEl?.value, 1, 20, DEFAULT_SETTINGS.reconnectThreshold10m);
      state.settings.anonRatioThreshold = clampNumber(anonEl?.value, 0, 1, DEFAULT_SETTINGS.anonRatioThreshold);
      state.settings.jumpThreshold = clampNumber(jumpEl?.value, 1, 50, DEFAULT_SETTINGS.jumpThreshold);
      state.settings.churnThreshold5m = clampNumber(churnEl?.value, 1, 200, DEFAULT_SETTINGS.churnThreshold5m);
      state.settings.soundEnabled = Boolean(soundEl?.checked);
      state.settings.alertCooldownSec = clampNumber(cooldownEl?.value, 5, 600, DEFAULT_SETTINGS.alertCooldownSec);
      persistSettings();
      refreshUi();
    };

    if (enabledEl) {
      enabledEl.addEventListener('change', () => {
        state.settings.enabled = enabledEl.checked;
        persistSettings();
        syncTrackingState();
      });
    }
    [reconnectEl, anonEl, jumpEl, churnEl, soundEl, cooldownEl].forEach((el) => {
      if (!el) return;
      el.addEventListener('change', saveThresholds);
      el.addEventListener('blur', saveThresholds);
    });
    if (clearEl) clearEl.addEventListener('click', clearTimeline);
    if (exportEl) exportEl.addEventListener('click', exportDiagnostics);
  }

  function togglePanel() {
    if (!state.ui.panel || !state.ui.button) return;
    openToolsTab();
    state.panelVisible = !state.panelVisible;
    state.ui.panel.style.display = state.panelVisible ? 'block' : 'none';
    state.ui.button.classList.toggle('active', state.panelVisible);
    if (state.panelVisible) refreshUi();
  }

  function renderPanel() {
    if (!state.ui.panel) return;
    state.ui.panel.innerHTML = `
      <div class="cytube-tools-session-health-head"><strong>Session Health Panel</strong></div>
      <label class="cytube-tools-session-health-line">
        <input type="checkbox" id="${UI_IDS.enabled}">
        Enable tracking
      </label>
      <div class="cytube-tools-session-health-grid">
        <label class="cytube-tools-session-health-inline">Reconnect threshold (10m)
          <input type="number" id="${UI_IDS.reconnectThreshold}" min="1" max="20" class="form-control">
        </label>
        <label class="cytube-tools-session-health-inline">Anonymous ratio threshold (0-1)
          <input type="number" id="${UI_IDS.anonThreshold}" min="0" max="1" step="0.01" class="form-control">
        </label>
        <label class="cytube-tools-session-health-inline">Jump threshold
          <input type="number" id="${UI_IDS.jumpThreshold}" min="1" max="50" class="form-control">
        </label>
        <label class="cytube-tools-session-health-inline">Churn threshold (5m)
          <input type="number" id="${UI_IDS.churnThreshold}" min="1" max="200" class="form-control">
        </label>
        <label class="cytube-tools-session-health-inline">Alert cooldown (sec)
          <input type="number" id="${UI_IDS.alertCooldown}" min="5" max="600" class="form-control">
        </label>
      </div>
      <label class="cytube-tools-session-health-line">
        <input type="checkbox" id="${UI_IDS.soundEnabled}">
        Sound alerts
      </label>
      <div id="${UI_IDS.score}" class="cytube-tools-session-health-score">Health Score: --</div>
      <div id="${UI_IDS.metrics}" class="cytube-tools-session-health-metrics"></div>
      <div class="cytube-tools-session-health-actions">
        <button type="button" class="btn btn-sm btn-danger" id="${UI_IDS.clear}">Clear Timeline</button>
        <button type="button" class="btn btn-sm btn-default" id="${UI_IDS.export}">Export JSON</button>
      </div>
      <div id="${UI_IDS.timeline}" class="cytube-tools-session-health-timeline"></div>
    `;
    bindUiEvents();
    fillFormFromSettings();
  }

  GM_addStyle(`
    #${TOGGLE_ID}.active { background:#337ab7 !important; border-color:#2e6da4 !important; color:#fff !important; }
    .${PANEL_CLASS} { display:none; padding:10px; background:#1f1f1f; border:1px solid #333; border-radius:6px; color:#ddd; margin-bottom:10px; }
    .cytube-tools-session-health-head { margin-bottom:8px; font-size:14px; }
    .cytube-tools-session-health-line { display:block; margin-bottom:8px; font-weight:normal; }
    .cytube-tools-session-health-grid { display:grid; gap:6px; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); margin-bottom:8px; }
    .cytube-tools-session-health-inline { display:grid; gap:4px; font-weight:normal; font-size:12px; }
    .cytube-tools-session-health-score { margin:8px 0; padding:8px; border-radius:4px; font-weight:700; text-align:center; }
    .cytube-tools-session-health-score.status-good { background:#23422a; color:#b8f7c6; }
    .cytube-tools-session-health-score.status-warning { background:#4a3c1f; color:#ffe2a8; }
    .cytube-tools-session-health-score.status-critical { background:#4a2424; color:#ffd1d1; }
    .cytube-tools-session-health-metrics { font-size:12px; color:#cfd4db; margin-bottom:8px; background:#171717; border:1px solid #2d2d2d; border-radius:4px; padding:6px; word-break:break-word; }
    .cytube-tools-session-health-actions { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:8px; }
    .cytube-tools-session-health-timeline { max-height:300px; overflow-y:auto; background:#171717; border:1px solid #2d2d2d; border-radius:4px; padding:6px; }
    .cytube-tools-session-health-row { border-bottom:1px solid #2d2d2d; padding:4px 0; font-size:12px; }
    .cytube-tools-session-health-row:last-child { border-bottom:none; }
    .cytube-tools-session-health-row.sev-warn { box-shadow: inset 2px 0 0 #ffd166; padding-left:6px; }
    .cytube-tools-session-health-row.sev-critical { box-shadow: inset 2px 0 0 #ff7a7a; padding-left:6px; }
    .cytube-tools-session-health-row-head { display:flex; gap:8px; align-items:center; }
    .cytube-tools-session-health-time { color:#9aa0a6; min-width:72px; }
    .cytube-tools-session-health-type { color:#edf0f3; font-weight:600; }
    .cytube-tools-session-health-msg { color:#c3c7cd; margin-top:2px; word-break:break-word; }
    .cytube-tools-session-health-empty { color:#8a8a8a; font-style:italic; }
  `);

  (async () => {
    const toolsUi = await ensureToolsUi();
    if (!toolsUi) return;
    persistSettings();
    persistTimeline();
    renderPanel();
    toolsUi.button.addEventListener('click', togglePanel);
    toolsUi.button.classList.toggle('active', state.panelVisible);
    syncTrackingState();
  })();
})();
