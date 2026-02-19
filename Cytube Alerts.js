// ==UserScript==
// @name         Cytube Alerts
// @namespace    cytube.alerts
// @version      1.1
// @description  Keyword and mention alerts for chat
// @match        https://om3tcw.com/r/*
// @require      https://conzz97.github.io/bote-violentmonkey-scripts/lib/alerts/utils.js
// @grant        GM_addStyle
// @grant        GM_getResourceText
// @grant        GM_getValue
// @grant        GM_setValue
// @resource     alertsPanelHtml https://conzz97.github.io/bote-violentmonkey-scripts/assets/alerts/panel.html
// @resource     alertsStyles https://conzz97.github.io/bote-violentmonkey-scripts/assets/alerts/styles.css
// ==/UserScript==

(function() {
  'use strict';

  const TOGGLE_ID = 'alerts-toggle';
  const PANEL_ID = 'cytube-tools-alerts-panel';
  const PANEL_CLASS = 'cytube-tools-alerts-panel';
  const RETRY_DELAY_MS = 500;
  const MAX_RETRIES = 120;
  const HISTORY_LIMIT = 200;
  const MESSAGE_SELECTOR = '#messagebuffer > div';
  const PROCESSED_ATTR = 'data-cytube-tools-alerts-processed';

  const STORAGE_KEYS = {
    enabled: 'cytube:alerts:enabled',
    keywords: 'cytube:alerts:keywords',
    mentions: 'cytube:alerts:mentions',
    cooldownMs: 'cytube:alerts:cooldownMs',
    soundEnabled: 'cytube:alerts:soundEnabled',
    desktopEnabled: 'cytube:alerts:desktopEnabled',
    inlineEnabled: 'cytube:alerts:inlineEnabled'
  };

  const DEFAULT_SETTINGS = {
    enabled: false,
    keywords: [],
    mentions: [],
    cooldownMs: 15000,
    soundEnabled: true,
    desktopEnabled: false,
    inlineEnabled: true
  };

  const UI_IDS = {
    enabled: 'cytube-tools-alerts-enabled',
    keywords: 'cytube-tools-alerts-keywords',
    mentions: 'cytube-tools-alerts-mentions',
    cooldown: 'cytube-tools-alerts-cooldown',
    sound: 'cytube-tools-alerts-sound',
    desktop: 'cytube-tools-alerts-desktop',
    inline: 'cytube-tools-alerts-inline',
    save: 'cytube-tools-alerts-save',
    test: 'cytube-tools-alerts-test',
    clearHistory: 'cytube-tools-alerts-clear',
    desktopPermission: 'cytube-tools-alerts-desktop-permission',
    history: 'cytube-tools-alerts-history'
  };

  const RESOURCE_NAMES = {
    panelHtml: 'alertsPanelHtml',
    styles: 'alertsStyles'
  };

  const FALLBACK_PANEL_HTML = `
    <div class="cytube-tools-alerts-head"><strong>Alerts</strong></div>
    <div class="cytube-tools-alerts-empty">
      Resource load failed. Check script @resource URLs for panel.html/styles.css.
    </div>
  `;

  const alertsUtils = window.CytubeAlertsUtils;
  if (!alertsUtils) {
    return;
  }

  const state = {
    settings: loadSettings(),
    panelVisible: false,
    history: [],
    observer: null,
    ruleCooldowns: Object.create(null),
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
      // Ignore storage failures to keep script stable.
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

  function parseStringArray(value, fallback) {
    return alertsUtils.parseStringArray(value, fallback);
  }

  function loadSettings() {
    return {
      enabled: Boolean(safeGetValue(STORAGE_KEYS.enabled, DEFAULT_SETTINGS.enabled)),
      keywords: parseStringArray(safeGetValue(STORAGE_KEYS.keywords, DEFAULT_SETTINGS.keywords), DEFAULT_SETTINGS.keywords),
      mentions: parseStringArray(safeGetValue(STORAGE_KEYS.mentions, DEFAULT_SETTINGS.mentions), DEFAULT_SETTINGS.mentions),
      cooldownMs: Number(safeGetValue(STORAGE_KEYS.cooldownMs, DEFAULT_SETTINGS.cooldownMs)) || DEFAULT_SETTINGS.cooldownMs,
      soundEnabled: Boolean(safeGetValue(STORAGE_KEYS.soundEnabled, DEFAULT_SETTINGS.soundEnabled)),
      desktopEnabled: Boolean(safeGetValue(STORAGE_KEYS.desktopEnabled, DEFAULT_SETTINGS.desktopEnabled)),
      inlineEnabled: Boolean(safeGetValue(STORAGE_KEYS.inlineEnabled, DEFAULT_SETTINGS.inlineEnabled))
    };
  }

  function persistSettings() {
    safeSetValue(STORAGE_KEYS.enabled, state.settings.enabled);
    safeSetValue(STORAGE_KEYS.keywords, state.settings.keywords);
    safeSetValue(STORAGE_KEYS.mentions, state.settings.mentions);
    safeSetValue(STORAGE_KEYS.cooldownMs, state.settings.cooldownMs);
    safeSetValue(STORAGE_KEYS.soundEnabled, state.settings.soundEnabled);
    safeSetValue(STORAGE_KEYS.desktopEnabled, state.settings.desktopEnabled);
    safeSetValue(STORAGE_KEYS.inlineEnabled, state.settings.inlineEnabled);
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
      button.textContent = '🔔';
      button.title = 'Toggle Alerts Panel';
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

  function parseListInput(raw) {
    return alertsUtils.parseListInput(raw);
  }

  function updateDesktopPermissionStatus() {
    const permissionEl = document.getElementById(UI_IDS.desktopPermission);
    if (!permissionEl) {
      return;
    }
    if (typeof Notification === 'undefined') {
      permissionEl.textContent = 'Desktop notifications are not supported in this browser.';
      return;
    }
    permissionEl.textContent = `Desktop permission: ${Notification.permission}`;
  }

  function fillFormFromSettings() {
    const enabledInput = document.getElementById(UI_IDS.enabled);
    const keywordsInput = document.getElementById(UI_IDS.keywords);
    const mentionsInput = document.getElementById(UI_IDS.mentions);
    const cooldownInput = document.getElementById(UI_IDS.cooldown);
    const soundInput = document.getElementById(UI_IDS.sound);
    const desktopInput = document.getElementById(UI_IDS.desktop);
    const inlineInput = document.getElementById(UI_IDS.inline);

    if (!enabledInput || !keywordsInput || !mentionsInput || !cooldownInput || !soundInput || !desktopInput || !inlineInput) {
      return;
    }

    enabledInput.checked = state.settings.enabled;
    keywordsInput.value = state.settings.keywords.join('\n');
    mentionsInput.value = state.settings.mentions.join('\n');
    cooldownInput.value = String(Math.max(1, Math.round(state.settings.cooldownMs / 1000)));
    soundInput.checked = state.settings.soundEnabled;
    desktopInput.checked = state.settings.desktopEnabled;
    inlineInput.checked = state.settings.inlineEnabled;

    updateDesktopPermissionStatus();
  }

  function applySettingsFromForm() {
    const enabledInput = document.getElementById(UI_IDS.enabled);
    const keywordsInput = document.getElementById(UI_IDS.keywords);
    const mentionsInput = document.getElementById(UI_IDS.mentions);
    const cooldownInput = document.getElementById(UI_IDS.cooldown);
    const soundInput = document.getElementById(UI_IDS.sound);
    const desktopInput = document.getElementById(UI_IDS.desktop);
    const inlineInput = document.getElementById(UI_IDS.inline);

    if (!enabledInput || !keywordsInput || !mentionsInput || !cooldownInput || !soundInput || !desktopInput || !inlineInput) {
      return;
    }

    const cooldownSeconds = Math.max(1, Number(cooldownInput.value) || 15);
    state.settings = {
      enabled: enabledInput.checked,
      keywords: parseListInput(keywordsInput.value),
      mentions: parseListInput(mentionsInput.value),
      cooldownMs: cooldownSeconds * 1000,
      soundEnabled: soundInput.checked,
      desktopEnabled: desktopInput.checked,
      inlineEnabled: inlineInput.checked
    };
    persistSettings();
    resetCooldowns();
    if (!state.settings.inlineEnabled) {
      clearInlineMarkers();
    }
    syncObserverState();
  }

  function clearInlineMarkers() {
    document.querySelectorAll('.cytube-tools-alerts-inline').forEach((node) => node.remove());
    document.querySelectorAll('.cytube-tools-alerts-row-hit').forEach((node) => node.classList.remove('cytube-tools-alerts-row-hit'));
  }

  function stopObserver() {
    if (!state.observer) {
      return;
    }
    state.observer.disconnect();
    state.observer = null;
  }

  function markExistingMessagesProcessed() {
    document.querySelectorAll(MESSAGE_SELECTOR).forEach((row) => {
      row.setAttribute(PROCESSED_ATTR, '1');
    });
  }

  function resetCooldowns() {
    state.ruleCooldowns = Object.create(null);
  }

  function syncObserverState() {
    if (!state.settings.enabled) {
      stopObserver();
      clearInlineMarkers();
      return;
    }
    if (startObserver()) {
      return;
    }
    waitForEl('#messagebuffer').then(() => {
      if (state.settings.enabled) {
        startObserver();
      }
    });
  }

  function startObserver() {
    if (state.observer) {
      return true;
    }

    const messageBuffer = document.querySelector('#messagebuffer');
    if (!messageBuffer) {
      return false;
    }

    markExistingMessagesProcessed();

    state.observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          handleAddedNode(node);
        });
      });
    });

    state.observer.observe(messageBuffer, { childList: true });
    return true;
  }

  function handleAddedNode(node) {
    if (!(node instanceof HTMLElement)) {
      return;
    }
    if (node.parentElement?.id !== 'messagebuffer') {
      return;
    }
    if (node.getAttribute(PROCESSED_ATTR) === '1') {
      return;
    }
    processMessageRow(node);
    node.setAttribute(PROCESSED_ATTR, '1');
  }

  function extractUsername(row) {
    const usernameEl = row.querySelector('strong.username');
    if (!usernameEl) {
      return '';
    }
    const username = usernameEl.textContent.replace(/:\s*$/, '').trim();
    return username;
  }

  function extractMessageText(row) {
    const clone = row.cloneNode(true);
    clone.querySelectorAll('.timestamp, strong.username, .cytube-tools-alerts-inline').forEach((node) => node.remove());
    const text = clone.textContent.replace(/\s+/g, ' ').trim();
    return text;
  }

  function escapeRegExp(text) {
    return alertsUtils.escapeRegExp(text);
  }

  function findMatches(text) {
    const matches = [];

    state.settings.keywords.forEach((keyword) => {
      const keywordText = keyword.trim();
      if (!keywordText) {
        return;
      }
      const keywordRegex = new RegExp(`(^|\\W)${escapeRegExp(keywordText)}(\\W|$)`, 'i');
      if (keywordRegex.test(text)) {
        matches.push({ type: 'keyword', value: keyword });
      }
    });

    state.settings.mentions.forEach((mention) => {
      const mentionText = mention.trim();
      if (!mentionText) {
        return;
      }
      const mentionRegex = new RegExp(`(^|\\W)${escapeRegExp(mentionText)}(\\W|$)`, 'i');
      if (mentionRegex.test(text)) {
        matches.push({ type: 'mention', value: mentionText });
      }
    });

    return matches;
  }

  function shouldTrigger(match) {
    const key = `${match.type}:${match.value.toLowerCase()}`;
    const now = Date.now();
    const last = state.ruleCooldowns[key] || 0;
    if (now - last < state.settings.cooldownMs) {
      return false;
    }
    state.ruleCooldowns[key] = now;
    return true;
  }

  function addInlineMarker(row, triggeredMatches) {
    if (!state.settings.inlineEnabled) {
      return;
    }
    row.classList.add('cytube-tools-alerts-row-hit');
    if (row.querySelector('.cytube-tools-alerts-inline')) {
      return;
    }

    const marker = document.createElement('span');
    marker.className = 'cytube-tools-alerts-inline';
    marker.textContent = `[ALERT: ${triggeredMatches.map((match) => match.value).join(', ')}]`;
    row.appendChild(marker);
  }

  function playAlertSound() {
    if (!state.settings.soundEnabled) {
      return;
    }
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
      return;
    }
    try {
      if (!state.audioContext) {
        state.audioContext = new AudioContextCtor();
      }
      if (state.audioContext.state === 'suspended') {
        state.audioContext.resume().catch(() => {});
      }

      const now = state.audioContext.currentTime;
      const oscillator = state.audioContext.createOscillator();
      const gain = state.audioContext.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(880, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.15, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
      oscillator.connect(gain);
      gain.connect(state.audioContext.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.2);
    } catch (err) {
      // Ignore audio errors.
    }
  }

  function sendDesktopNotification(username, text, triggeredMatches) {
    if (!state.settings.desktopEnabled || typeof Notification === 'undefined' || Notification.permission !== 'granted') {
      return;
    }
    const title = `Cytube Alert: ${triggeredMatches[0].value}`;
    const body = `${username || 'Unknown'}: ${text.slice(0, 180)}`;
    try {
      new Notification(title, { body });
    } catch (err) {
      // Ignore notification errors.
    }
  }

  function pushHistory(entry) {
    state.history.unshift(entry);
    if (state.history.length > HISTORY_LIMIT) {
      state.history.length = HISTORY_LIMIT;
    }
    renderHistory();
  }

  function renderHistory() {
    const historyEl = document.getElementById(UI_IDS.history);
    if (!historyEl) {
      return;
    }
    historyEl.replaceChildren();

    if (!state.history.length) {
      const empty = document.createElement('div');
      empty.className = 'cytube-tools-alerts-empty';
      empty.textContent = 'No alerts yet.';
      historyEl.appendChild(empty);
      return;
    }

    state.history.forEach((entry) => {
      const row = document.createElement('div');
      row.className = 'cytube-tools-alerts-history-row';

      const time = document.createElement('span');
      time.className = 'cytube-tools-alerts-history-time';
      time.textContent = entry.time;

      const summary = document.createElement('span');
      summary.className = 'cytube-tools-alerts-history-summary';
      summary.textContent = `${entry.type} "${entry.match}" · ${entry.username}`;

      const body = document.createElement('div');
      body.className = 'cytube-tools-alerts-history-body';
      body.textContent = entry.message;

      row.appendChild(time);
      row.appendChild(summary);
      row.appendChild(body);
      historyEl.appendChild(row);
    });
  }

  function processMessageRow(row) {
    const username = extractUsername(row);
    if (!username) {
      return;
    }
    const text = extractMessageText(row);
    if (!text) {
      return;
    }

    const matches = findMatches(text);
    if (!matches.length) {
      return;
    }

    const triggered = matches.filter(shouldTrigger);
    if (!triggered.length) {
      return;
    }

    addInlineMarker(row, triggered);
    playAlertSound();
    sendDesktopNotification(username, text, triggered);
    pushHistory({
      time: new Date().toLocaleTimeString(),
      type: triggered[0].type,
      match: triggered.map((match) => match.value).join(', '),
      username,
      message: text
    });
  }

  function requestDesktopPermission() {
    if (typeof Notification === 'undefined') {
      updateDesktopPermissionStatus();
      return;
    }
    Notification.requestPermission().finally(updateDesktopPermissionStatus);
  }

  function fireTestAlert() {
    const fakeMatch = { type: 'keyword', value: 'test' };
    addInlineMarker(document.createElement('div'), [fakeMatch]);
    playAlertSound();
    sendDesktopNotification('Alert Test', 'This is a test notification.', [fakeMatch]);
    pushHistory({
      time: new Date().toLocaleTimeString(),
      type: fakeMatch.type,
      match: fakeMatch.value,
      username: 'Alert Test',
      message: 'This is a local test alert.'
    });
  }

  function bindUiEvents() {
    const saveBtn = document.getElementById(UI_IDS.save);
    const testBtn = document.getElementById(UI_IDS.test);
    const clearBtn = document.getElementById(UI_IDS.clearHistory);
    const permissionBtn = document.getElementById(UI_IDS.desktopPermission);

    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        applySettingsFromForm();
      });
    }
    if (testBtn) {
      testBtn.addEventListener('click', fireTestAlert);
    }
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        state.history = [];
        renderHistory();
      });
    }
    if (permissionBtn) {
      permissionBtn.addEventListener('click', requestDesktopPermission);
    }
  }

  function togglePanel() {
    if (!state.ui.panel || !state.ui.button) {
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
    fillFormFromSettings();
    bindUiEvents();
    renderHistory();
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
    renderPanel();
    toolsUi.button.addEventListener('click', togglePanel);
    toolsUi.button.classList.toggle('active', state.panelVisible);
    syncObserverState();
  })();
})();
