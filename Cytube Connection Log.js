// ==UserScript==
// @name         Cytube Connection Log
// @namespace    cytube.connection.log
// @version      1.2
// @description  Live join/leave timeline based on user list changes
// @match        https://om3tcw.com/r/*
// @require      https://conzz97.github.io/bote-violentmonkey-scripts/lib/connection-log/utils.js
// @grant        GM_addStyle
// @grant        GM_getResourceText
// @grant        GM_getValue
// @grant        GM_setValue
// @resource     connectionLogPanelHtml https://conzz97.github.io/bote-violentmonkey-scripts/assets/connection-log/panel.html
// @resource     connectionLogStyles https://conzz97.github.io/bote-violentmonkey-scripts/assets/connection-log/styles.css
// ==/UserScript==

(function() {
  'use strict';

  const TOGGLE_ID = 'connection-log-toggle';
  const PANEL_ID = 'cytube-tools-connection-log-panel';
  const PANEL_CLASS = 'cytube-tools-connection-log-panel';
  const RETRY_DELAY_MS = 500;
  const MAX_RETRIES = 120;
  const ENTRY_LIMIT = 500;
  const PROCESS_DEBOUNCE_MS = 120;

  const STORAGE_KEYS = {
    enabled: 'cytube:connection-log:enabled',
    entries: 'cytube:connection-log:entries',
    settings: 'cytube:connection-log:settings'
  };

  const DEFAULT_SETTINGS = {
    enabled: false,
    filter: 'all',
    search: '',
    dedupeMs: 2500
  };

  const UI_IDS = {
    enabled: 'cytube-tools-connection-log-enabled',
    dedupeMs: 'cytube-tools-connection-log-dedupe',
    search: 'cytube-tools-connection-log-search',
    filterAll: 'cytube-tools-connection-log-filter-all',
    filterJoin: 'cytube-tools-connection-log-filter-join',
    filterLeave: 'cytube-tools-connection-log-filter-leave',
    counters: 'cytube-tools-connection-log-counters',
    clear: 'cytube-tools-connection-log-clear',
    export: 'cytube-tools-connection-log-export',
    timeline: 'cytube-tools-connection-log-timeline'
  };

  const RESOURCE_NAMES = {
    panelHtml: 'connectionLogPanelHtml',
    styles: 'connectionLogStyles'
  };

  const FALLBACK_PANEL_HTML = `
    <div class="cytube-tools-connection-log-head"><strong>Connection Log</strong></div>
    <div class="cytube-tools-connection-log-empty">
      Resource load failed. Check script @resource URLs for panel.html/styles.css.
    </div>
  `;

  const connectionLogUtils = window.CytubeConnectionLogUtils;
  if (!connectionLogUtils) {
    return;
  }

  const initialEntries = loadEntries();

  const state = {
    settings: loadSettings(),
    entries: initialEntries,
    panelVisible: false,
    observer: null,
    usercountObserver: null,
    processTimer: null,
    waitingForUserlist: false,
    waitingForUsercount: false,
    presenceMap: new Map(),
    connectedUsersCount: null,
    recentEventTimes: Object.create(null),
    uniqueUsers: new Set(initialEntries.map((entry) => entry.userKey)),
    peakUsers: 0,
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
      // Ignore storage failures to keep the script stable.
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
    return connectionLogUtils.parseStoredObject(raw);
  }

  function parseStoredArray(raw) {
    return connectionLogUtils.parseStoredArray(raw);
  }

  function normalizeUsername(value) {
    return connectionLogUtils.normalizeUsername(value);
  }

  function clampNumber(value, min, max, fallback) {
    return connectionLogUtils.clampNumber(value, min, max, fallback);
  }

  function parseBoolean(value, fallback) {
    return connectionLogUtils.parseBoolean(value, fallback);
  }

  function sanitizeFilter(value) {
    return connectionLogUtils.sanitizeFilter(value);
  }

  function formatTimestamp(ts) {
    return connectionLogUtils.formatTimestamp(ts);
  }

  function sanitizeEntry(raw) {
    return connectionLogUtils.sanitizeEntry(raw);
  }

  function loadEntries() {
    const raw = safeGetValue(STORAGE_KEYS.entries, []);
    const parsed = parseStoredArray(raw);
    const clean = [];

    parsed.forEach((entry) => {
      const sanitized = sanitizeEntry(entry);
      if (sanitized) {
        clean.push(sanitized);
      }
    });

    clean.sort((a, b) => b.ts - a.ts);
    if (clean.length > ENTRY_LIMIT) {
      clean.length = ENTRY_LIMIT;
    }
    return clean;
  }

  function loadSettings() {
    const rawSettings = parseStoredObject(safeGetValue(STORAGE_KEYS.settings, {}));
    const legacyEnabled = safeGetValue(STORAGE_KEYS.enabled, DEFAULT_SETTINGS.enabled);
    const hasEnabledInSettings = Object.prototype.hasOwnProperty.call(rawSettings, 'enabled');
    const enabledValue = hasEnabledInSettings ? rawSettings.enabled : legacyEnabled;

    return {
      enabled: parseBoolean(enabledValue, DEFAULT_SETTINGS.enabled),
      filter: sanitizeFilter(rawSettings.filter),
      search: String(rawSettings.search || '').slice(0, 80),
      dedupeMs: clampNumber(rawSettings.dedupeMs, 0, 30000, DEFAULT_SETTINGS.dedupeMs)
    };
  }

  function persistSettings() {
    const payload = {
      enabled: Boolean(state.settings.enabled),
      filter: state.settings.filter,
      search: state.settings.search,
      dedupeMs: state.settings.dedupeMs
    };

    safeSetValue(STORAGE_KEYS.enabled, payload.enabled);
    safeSetValue(STORAGE_KEYS.settings, JSON.stringify(payload));
  }

  function persistEntries() {
    safeSetValue(STORAGE_KEYS.entries, JSON.stringify(state.entries));
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
      button.textContent = 'Conn Log';
      button.title = 'Toggle Connection Log Panel';
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

  function clearProcessTimer() {
    if (!state.processTimer) {
      return;
    }
    clearTimeout(state.processTimer);
    state.processTimer = null;
  }

  function stopObserver() {
    clearProcessTimer();
    if (!state.observer) {
      return;
    }
    state.observer.disconnect();
    state.observer = null;
  }

  function stopUsercountObserver() {
    if (!state.usercountObserver) {
      return;
    }
    state.usercountObserver.disconnect();
    state.usercountObserver = null;
  }

  function updateSessionMetricsFromMap(map) {
    if (!(map instanceof Map)) {
      return;
    }
    if (map.size > state.peakUsers) {
      state.peakUsers = map.size;
    }
    map.forEach((info) => {
      state.uniqueUsers.add(info.userKey);
    });
  }

  function getRoleLabel(row, nameSpan) {
    return connectionLogUtils.getRoleLabel(row, nameSpan);
  }

  function extractUserInfoFromRow(row) {
    return connectionLogUtils.extractUserInfoFromRow(row);
  }

  function snapshotUserMap() {
    return connectionLogUtils.snapshotUserMap();
  }

  function diffPresenceMaps(previousMap, nextMap) {
    return connectionLogUtils.diffPresenceMaps(previousMap, nextMap);
  }

  function nodeIsUserRow(node) {
    return connectionLogUtils.nodeIsUserRow(node);
  }

  function mutationAffectsRoster(mutation) {
    return connectionLogUtils.mutationAffectsRoster(mutation);
  }

  function pruneRecentEventTimes(now) {
    const retention = Math.max(10000, state.settings.dedupeMs * 4);
    const cutoff = now - retention;
    Object.keys(state.recentEventTimes).forEach((key) => {
      if (state.recentEventTimes[key] < cutoff) {
        delete state.recentEventTimes[key];
      }
    });
  }

  function shouldLogEvent(event) {
    const now = Date.now();
    pruneRecentEventTimes(now);

    if (state.settings.dedupeMs <= 0) {
      return true;
    }

    const key = `${event.type}:${event.userKey}`;
    const lastTs = state.recentEventTimes[key] || 0;
    if (now - lastTs < state.settings.dedupeMs) {
      return false;
    }
    state.recentEventTimes[key] = now;
    return true;
  }

  function pushEvents(events) {
    if (!Array.isArray(events) || !events.length) {
      return;
    }

    let changed = false;
    events.forEach((event) => {
      if (!shouldLogEvent(event)) {
        return;
      }

      const ts = Date.now();
      const entry = sanitizeEntry({
        id: `${ts}-${event.type}-${event.userKey}-${Math.random().toString(36).slice(2, 9)}`,
        ts,
        timeLabel: formatTimestamp(ts),
        type: event.type,
        username: event.username,
        userKey: event.userKey,
        role: event.role || 'user'
      });

      if (!entry) {
        return;
      }

      state.entries.unshift(entry);
      state.uniqueUsers.add(entry.userKey);
      changed = true;
    });

    if (!changed) {
      return;
    }

    if (state.entries.length > ENTRY_LIMIT) {
      state.entries.length = ENTRY_LIMIT;
    }

    persistEntries();
    renderCounters();
    renderTimeline();
  }

  function processUserlistChanges() {
    const nextMap = snapshotUserMap();
    const events = diffPresenceMaps(state.presenceMap, nextMap);
    state.presenceMap = nextMap;
    updateSessionMetricsFromMap(nextMap);
    pushEvents(events);
    renderCounters();
  }

  function scheduleUserlistProcessing() {
    if (state.processTimer) {
      return;
    }
    state.processTimer = setTimeout(() => {
      state.processTimer = null;
      processUserlistChanges();
    }, PROCESS_DEBOUNCE_MS);
  }

  function startObserver() {
    if (state.observer) {
      return true;
    }

    const userList = document.querySelector('#userlist');
    if (!userList) {
      return false;
    }

    state.presenceMap = snapshotUserMap();
    updateSessionMetricsFromMap(state.presenceMap);
    renderCounters();

    state.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutationAffectsRoster(mutation)) {
          scheduleUserlistProcessing();
          return;
        }
      }
    });

    state.observer.observe(userList, { childList: true, subtree: true });
    return true;
  }

  function syncObserverState() {
    if (!state.settings.enabled) {
      stopObserver();
      return;
    }

    if (startObserver()) {
      return;
    }

    if (state.waitingForUserlist) {
      return;
    }
    state.waitingForUserlist = true;

    waitForEl('#userlist').then(() => {
      state.waitingForUserlist = false;
      if (state.settings.enabled) {
        startObserver();
      }
    });
  }

  function getCounts(entries) {
    return connectionLogUtils.getCounts(entries);
  }

  function extractConnectedUsersFromElement(userCountEl) {
    return connectionLogUtils.extractConnectedUsersFromElement(userCountEl);
  }

  function refreshConnectedUsersCount() {
    const parsed = extractConnectedUsersFromElement(document.getElementById('usercount'));
    if (Number.isFinite(parsed)) {
      state.connectedUsersCount = parsed;
      if (parsed > state.peakUsers) {
        state.peakUsers = parsed;
      }
      return true;
    }
    state.connectedUsersCount = null;
    return false;
  }

  function startUsercountObserver() {
    if (state.usercountObserver) {
      return true;
    }

    const userCountEl = document.getElementById('usercount');
    if (!userCountEl) {
      return false;
    }

    refreshConnectedUsersCount();
    state.usercountObserver = new MutationObserver(() => {
      const previous = state.connectedUsersCount;
      refreshConnectedUsersCount();
      if (state.connectedUsersCount !== previous) {
        renderCounters();
      }
    });
    state.usercountObserver.observe(userCountEl, { childList: true, characterData: true, subtree: true });
    return true;
  }

  function syncUsercountObserver() {
    if (startUsercountObserver()) {
      return;
    }

    if (state.waitingForUsercount) {
      return;
    }
    state.waitingForUsercount = true;

    waitForEl('#usercount').then(() => {
      state.waitingForUsercount = false;
      if (startUsercountObserver()) {
        renderCounters();
      }
    });
  }

  function renderCounters() {
    const countersEl = document.getElementById(UI_IDS.counters);
    if (!countersEl) {
      return;
    }

    syncUsercountObserver();
    refreshConnectedUsersCount();

    const counts = getCounts(state.entries);
    const listedUsers = state.presenceMap.size;
    const connectedUsers = state.connectedUsersCount;
    const currentUsers = Number.isFinite(connectedUsers) ? connectedUsers : listedUsers;
    if (currentUsers > state.peakUsers) {
      state.peakUsers = currentUsers;
    }

    countersEl.textContent = [
      `Joins: ${counts.joins}`,
      `Leaves: ${counts.leaves}`,
      `Net: ${counts.net >= 0 ? `+${counts.net}` : counts.net}`,
      `Current: ${currentUsers}`,
      `Listed: ${listedUsers}`,
      `Peak: ${state.peakUsers}`,
      `Unique: ${state.uniqueUsers.size}`
    ].join('  |  ');
  }

  function getFilteredEntries() {
    const filter = state.settings.filter;
    const search = normalizeUsername(state.settings.search);

    return state.entries.filter((entry) => {
      if (filter !== 'all' && entry.type !== filter) {
        return false;
      }
      if (!search) {
        return true;
      }
      return normalizeUsername(entry.username).includes(search);
    });
  }

  function renderTimeline() {
    const timelineEl = document.getElementById(UI_IDS.timeline);
    if (!timelineEl) {
      return;
    }

    timelineEl.replaceChildren();
    const visibleEntries = getFilteredEntries();

    if (!visibleEntries.length) {
      const empty = document.createElement('div');
      empty.className = 'cytube-tools-connection-log-empty';
      empty.textContent = 'No events in current view.';
      timelineEl.appendChild(empty);
      return;
    }

    visibleEntries.forEach((entry) => {
      const row = document.createElement('div');
      row.className = `cytube-tools-connection-log-row cytube-tools-connection-log-row-${entry.type}`;

      const topLine = document.createElement('div');
      topLine.className = 'cytube-tools-connection-log-top';

      const time = document.createElement('span');
      time.className = 'cytube-tools-connection-log-time';
      time.textContent = entry.timeLabel;

      const summary = document.createElement('span');
      summary.className = 'cytube-tools-connection-log-summary';
      summary.textContent = `${entry.type === 'join' ? 'JOIN' : 'LEAVE'} ${entry.username}`;

      topLine.appendChild(time);
      topLine.appendChild(summary);

      const meta = document.createElement('div');
      meta.className = 'cytube-tools-connection-log-meta';
      meta.textContent = `Role: ${entry.role}`;

      row.appendChild(topLine);
      row.appendChild(meta);
      timelineEl.appendChild(row);
    });
  }

  function updateFilterButtonStates() {
    const allBtn = document.getElementById(UI_IDS.filterAll);
    const joinBtn = document.getElementById(UI_IDS.filterJoin);
    const leaveBtn = document.getElementById(UI_IDS.filterLeave);
    if (!allBtn || !joinBtn || !leaveBtn) {
      return;
    }

    allBtn.classList.toggle('active', state.settings.filter === 'all');
    joinBtn.classList.toggle('active', state.settings.filter === 'join');
    leaveBtn.classList.toggle('active', state.settings.filter === 'leave');
  }

  function fillFormFromSettings() {
    const enabledEl = document.getElementById(UI_IDS.enabled);
    const dedupeEl = document.getElementById(UI_IDS.dedupeMs);
    const searchEl = document.getElementById(UI_IDS.search);

    if (enabledEl) {
      enabledEl.checked = state.settings.enabled;
    }
    if (dedupeEl) {
      dedupeEl.value = String(state.settings.dedupeMs);
    }
    if (searchEl) {
      searchEl.value = state.settings.search;
    }

    updateFilterButtonStates();
    renderCounters();
    renderTimeline();
  }

  function clearEntries() {
    state.entries = [];
    persistEntries();
    renderCounters();
    renderTimeline();
  }

  function downloadTextFile(filename, text, mimeType) {
    const blob = new Blob([text], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function exportEntries() {
    const entries = getFilteredEntries();
    const payload = {
      exportedAt: new Date().toISOString(),
      filter: state.settings.filter,
      search: state.settings.search,
      count: entries.length,
      entries
    };

    const filenameStamp = new Date().toISOString().replace(/[:.]/g, '-');
    downloadTextFile(
      `cytube-connection-log-${filenameStamp}.json`,
      JSON.stringify(payload, null, 2),
      'application/json;charset=utf-8'
    );
  }

  function bindUiEvents() {
    const enabledEl = document.getElementById(UI_IDS.enabled);
    const dedupeEl = document.getElementById(UI_IDS.dedupeMs);
    const searchEl = document.getElementById(UI_IDS.search);
    const allBtn = document.getElementById(UI_IDS.filterAll);
    const joinBtn = document.getElementById(UI_IDS.filterJoin);
    const leaveBtn = document.getElementById(UI_IDS.filterLeave);
    const clearBtn = document.getElementById(UI_IDS.clear);
    const exportBtn = document.getElementById(UI_IDS.export);

    if (enabledEl) {
      enabledEl.addEventListener('change', () => {
        state.settings.enabled = enabledEl.checked;
        persistSettings();
        syncObserverState();
      });
    }

    if (dedupeEl) {
      const handleDedupeChange = () => {
        const value = clampNumber(dedupeEl.value, 0, 30000, DEFAULT_SETTINGS.dedupeMs);
        state.settings.dedupeMs = value;
        dedupeEl.value = String(value);
        persistSettings();
      };
      dedupeEl.addEventListener('change', handleDedupeChange);
      dedupeEl.addEventListener('blur', handleDedupeChange);
    }

    if (searchEl) {
      searchEl.addEventListener('input', () => {
        state.settings.search = String(searchEl.value || '').slice(0, 80);
        persistSettings();
        renderTimeline();
      });
    }

    if (allBtn) {
      allBtn.addEventListener('click', () => {
        state.settings.filter = 'all';
        persistSettings();
        updateFilterButtonStates();
        renderTimeline();
      });
    }
    if (joinBtn) {
      joinBtn.addEventListener('click', () => {
        state.settings.filter = 'join';
        persistSettings();
        updateFilterButtonStates();
        renderTimeline();
      });
    }
    if (leaveBtn) {
      leaveBtn.addEventListener('click', () => {
        state.settings.filter = 'leave';
        persistSettings();
        updateFilterButtonStates();
        renderTimeline();
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', clearEntries);
    }
    if (exportBtn) {
      exportBtn.addEventListener('click', exportEntries);
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

    stopUsercountObserver();
    persistSettings();
    persistEntries();
    renderPanel();
    toolsUi.button.addEventListener('click', togglePanel);
    toolsUi.button.classList.toggle('active', state.panelVisible);
    syncUsercountObserver();
    syncObserverState();
  })();
})();
