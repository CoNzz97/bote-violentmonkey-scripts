// ==UserScript==
// @name         Cytube Connection Log
// @namespace    cytube.connection.log
// @version      1.1
// @description  Live join/leave timeline based on user list changes
// @match        https://om3tcw.com/r/*
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
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

  function parseStoredObject(raw) {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      return raw;
    }
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed;
        }
      } catch (err) {
        return {};
      }
    }
    return {};
  }

  function parseStoredArray(raw) {
    if (Array.isArray(raw)) {
      return raw;
    }
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch (err) {
        return [];
      }
    }
    return [];
  }

  function normalizeUsername(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function clampNumber(value, min, max, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, parsed));
  }

  function parseBoolean(value, fallback) {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'number') {
      return value !== 0;
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true' || normalized === '1') {
        return true;
      }
      if (normalized === 'false' || normalized === '0') {
        return false;
      }
    }
    return fallback;
  }

  function sanitizeFilter(value) {
    if (value === 'join' || value === 'leave') {
      return value;
    }
    return 'all';
  }

  function formatTimestamp(ts) {
    try {
      return new Date(ts).toLocaleTimeString();
    } catch (err) {
      return '';
    }
  }

  function sanitizeEntry(raw) {
    if (!raw || typeof raw !== 'object') {
      return null;
    }

    const type = raw.type === 'join' || raw.type === 'leave' ? raw.type : '';
    if (!type) {
      return null;
    }

    const username = String(raw.username || '').replace(/\s+/g, ' ').trim();
    const userKey = normalizeUsername(raw.userKey || username);
    if (!username || !userKey) {
      return null;
    }

    const ts = Number(raw.ts);
    if (!Number.isFinite(ts) || ts <= 0) {
      return null;
    }

    const role = String(raw.role || 'user').replace(/\s+/g, ' ').trim() || 'user';
    const id = String(raw.id || `${ts}-${type}-${userKey}`);
    const timeLabel = String(raw.timeLabel || formatTimestamp(ts));

    return { id, ts, timeLabel, type, username, userKey, role };
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
    const classText = `${row.className || ''} ${nameSpan ? nameSpan.className : ''}`;
    const labels = [];

    if (/\buserlist_owner\b/i.test(classText)) {
      labels.push('owner');
    } else if (/\buserlist_admin\b/i.test(classText)) {
      labels.push('admin');
    } else if (/\buserlist_op\b/i.test(classText)) {
      labels.push('op');
    } else if (/\buserlist_guest\b/i.test(classText)) {
      labels.push('guest');
    }

    if (/\buserlist_afk\b/i.test(classText)) {
      labels.push('afk');
    }

    return labels.length ? labels.join(', ') : 'user';
  }

  function extractUserInfoFromRow(row) {
    if (!(row instanceof HTMLElement)) {
      return null;
    }

    const spans = Array.from(row.children).filter((node) => node instanceof HTMLSpanElement);
    let nameSpan = spans.find((span) => {
      const classText = span.className || '';
      return /\buserlist_(owner|admin|op|guest)\b/i.test(classText);
    }) || null;

    if (!nameSpan) {
      nameSpan = spans.find((span) => {
        if (span.querySelector('.glyphicon-time')) {
          return false;
        }
        const text = span.textContent.replace(/\s+/g, ' ').trim();
        return Boolean(text);
      }) || null;
    }

    let username = nameSpan ? nameSpan.textContent.replace(/\s+/g, ' ').trim() : '';
    if (!username && row.id && row.id.startsWith('useritem-')) {
      username = row.id.slice('useritem-'.length).trim();
    }

    const userKey = normalizeUsername(username);
    if (!userKey) {
      return null;
    }

    return {
      username,
      userKey,
      role: getRoleLabel(row, nameSpan)
    };
  }

  function snapshotUserMap() {
    const map = new Map();
    document.querySelectorAll('#userlist .userlist_item').forEach((row) => {
      const info = extractUserInfoFromRow(row);
      if (!info || map.has(info.userKey)) {
        return;
      }
      map.set(info.userKey, info);
    });
    return map;
  }

  function diffPresenceMaps(previousMap, nextMap) {
    const events = [];

    nextMap.forEach((info, userKey) => {
      if (!previousMap.has(userKey)) {
        events.push({ type: 'join', ...info });
      }
    });

    previousMap.forEach((info, userKey) => {
      if (!nextMap.has(userKey)) {
        events.push({ type: 'leave', ...info });
      }
    });

    return events;
  }

  function nodeIsUserRow(node) {
    if (!(node instanceof HTMLElement)) {
      return false;
    }
    if (node.classList.contains('userlist_item')) {
      return true;
    }
    if (node.id && node.id.startsWith('useritem-')) {
      return true;
    }
    return false;
  }

  function mutationAffectsRoster(mutation) {
    if (!mutation || mutation.type !== 'childList') {
      return false;
    }

    for (const node of mutation.addedNodes) {
      if (nodeIsUserRow(node)) {
        return true;
      }
    }

    for (const node of mutation.removedNodes) {
      if (nodeIsUserRow(node)) {
        return true;
      }
    }

    const target = mutation.target instanceof HTMLElement ? mutation.target : null;
    return Boolean(target && target.id === 'userlist' && (mutation.addedNodes.length || mutation.removedNodes.length));
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
    let joins = 0;
    let leaves = 0;
    entries.forEach((entry) => {
      if (entry.type === 'join') {
        joins += 1;
      } else if (entry.type === 'leave') {
        leaves += 1;
      }
    });
    return { joins, leaves, net: joins - leaves };
  }

  function extractConnectedUsersFromElement(userCountEl) {
    if (!(userCountEl instanceof HTMLElement)) {
      return null;
    }

    const clone = userCountEl.cloneNode(true);
    if (clone instanceof HTMLElement) {
      clone.querySelectorAll('.profile-box').forEach((node) => node.remove());
    }

    const text = clone.textContent.replace(/\s+/g, ' ').trim();
    if (!text) {
      return null;
    }

    const connectedMatch = text.match(/(\d+)\s*(?:connected\s*users?|users?\s*connected)/i);
    if (connectedMatch) {
      return Number(connectedMatch[1]);
    }

    const firstNumberMatch = text.match(/(\d+)/);
    return firstNumberMatch ? Number(firstNumberMatch[1]) : null;
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

    state.ui.panel.innerHTML = `
      <div class="cytube-tools-connection-log-head"><strong>Connection Log</strong></div>
      <label class="cytube-tools-connection-log-line">
        <input type="checkbox" id="${UI_IDS.enabled}">
        Enable logging
      </label>
      <label class="cytube-tools-connection-log-line">
        Dedupe window (ms)
        <input type="number" id="${UI_IDS.dedupeMs}" class="form-control cytube-tools-connection-log-number" min="0" max="30000">
      </label>
      <input type="text" id="${UI_IDS.search}" class="form-control cytube-tools-connection-log-search" placeholder="Search username">
      <div class="cytube-tools-connection-log-filters">
        <button type="button" class="btn btn-xs btn-default" id="${UI_IDS.filterAll}">All</button>
        <button type="button" class="btn btn-xs btn-default" id="${UI_IDS.filterJoin}">Joins</button>
        <button type="button" class="btn btn-xs btn-default" id="${UI_IDS.filterLeave}">Leaves</button>
      </div>
      <div id="${UI_IDS.counters}" class="cytube-tools-connection-log-counters"></div>
      <div class="cytube-tools-connection-log-actions">
        <button type="button" class="btn btn-sm btn-danger" id="${UI_IDS.clear}">Clear</button>
        <button type="button" class="btn btn-sm btn-default" id="${UI_IDS.export}">Export JSON</button>
      </div>
      <div id="${UI_IDS.timeline}" class="cytube-tools-connection-log-timeline"></div>
    `;

    bindUiEvents();
    fillFormFromSettings();
  }

  GM_addStyle(`
    #${TOGGLE_ID}.active {
      background: #337ab7 !important;
      border-color: #2e6da4 !important;
      color: #fff !important;
    }
    .${PANEL_CLASS} {
      display: none;
      padding: 10px;
      background: #1f1f1f;
      border: 1px solid #333;
      border-radius: 6px;
      color: #ddd;
      margin-bottom: 10px;
    }
    .cytube-tools-connection-log-head {
      margin-bottom: 8px;
      font-size: 14px;
    }
    .cytube-tools-connection-log-line {
      display: block;
      margin-bottom: 8px;
      font-weight: normal;
    }
    .cytube-tools-connection-log-number {
      width: 130px;
      display: inline-block;
      margin-left: 8px;
    }
    .cytube-tools-connection-log-search {
      margin-bottom: 8px;
    }
    .cytube-tools-connection-log-filters {
      display: flex;
      gap: 6px;
      margin-bottom: 8px;
      flex-wrap: wrap;
    }
    .cytube-tools-connection-log-filters .btn.active {
      background: #2e6da4;
      border-color: #255b88;
      color: #fff;
    }
    .cytube-tools-connection-log-counters {
      font-size: 12px;
      color: #cfd4db;
      margin-bottom: 8px;
      background: #171717;
      border: 1px solid #2d2d2d;
      border-radius: 4px;
      padding: 6px;
      word-break: break-word;
    }
    .cytube-tools-connection-log-actions {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      margin-bottom: 8px;
    }
    .cytube-tools-connection-log-timeline {
      max-height: 320px;
      overflow-y: auto;
      background: #171717;
      border: 1px solid #2d2d2d;
      border-radius: 4px;
      padding: 6px;
    }
    .cytube-tools-connection-log-row {
      border-bottom: 1px solid #2d2d2d;
      padding: 5px 0;
      font-size: 12px;
    }
    .cytube-tools-connection-log-row:last-child {
      border-bottom: none;
    }
    .cytube-tools-connection-log-row-join {
      box-shadow: inset 2px 0 0 #45c46b;
      padding-left: 6px;
    }
    .cytube-tools-connection-log-row-leave {
      box-shadow: inset 2px 0 0 #de6b6b;
      padding-left: 6px;
    }
    .cytube-tools-connection-log-top {
      display: flex;
      align-items: baseline;
      gap: 8px;
      flex-wrap: wrap;
    }
    .cytube-tools-connection-log-time {
      color: #9aa0a6;
      min-width: 72px;
    }
    .cytube-tools-connection-log-summary {
      color: #edf0f3;
      font-weight: 600;
    }
    .cytube-tools-connection-log-meta {
      color: #b5bcc4;
      margin-top: 2px;
    }
    .cytube-tools-connection-log-empty {
      color: #8a8a8a;
      font-style: italic;
    }
  `);

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
