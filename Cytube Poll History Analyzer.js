// ==UserScript==
// @name         Cytube Poll History Analyzer
// @namespace    cytube.poll.history.analyzer
// @version      1.0
// @description  Parse poll history, group name aliases, and track soft winners
// @match        https://om3tcw.com/r/*
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function() {
  'use strict';

  const TOGGLE_ID = 'poll-history-analyzer-toggle';
  const PANEL_ID = 'cytube-tools-poll-history-analyzer-panel';
  const PANEL_CLASS = 'cytube-tools-poll-history-analyzer-panel';
  const RETRY_DELAY_MS = 500;
  const MAX_RETRIES = 120;
  const RECORD_LIMIT = 1000;

  const STORAGE_KEYS = {
    settings: 'cytube:poll-history-analyzer:settings',
    records: 'cytube:poll-history-analyzer:records'
  };

  const DEFAULT_ALIAS_RULES = [
    'Elizabeth Rose Bloodflame: liz, erb, elizabeth',
    'Kiara: wawa, kiara'
  ].join('\n');

  const DEFAULT_SETTINGS = {
    enabled: false,
    search: '',
    winnerFilter: 'all',
    viewMode: 'grouped',
    softWinnerDelaySec: 120,
    aliasRulesText: DEFAULT_ALIAS_RULES
  };

  const UI_IDS = {
    enabled: 'cytube-tools-poll-history-analyzer-enabled',
    search: 'cytube-tools-poll-history-analyzer-search',
    winnerFilter: 'cytube-tools-poll-history-analyzer-winner-filter',
    viewMode: 'cytube-tools-poll-history-analyzer-view-mode',
    softDelay: 'cytube-tools-poll-history-analyzer-soft-delay',
    aliasRules: 'cytube-tools-poll-history-analyzer-alias-rules',
    saveAliases: 'cytube-tools-poll-history-analyzer-save-aliases',
    openPolls: 'cytube-tools-poll-history-analyzer-open-polls',
    rescan: 'cytube-tools-poll-history-analyzer-rescan',
    markSoft: 'cytube-tools-poll-history-analyzer-mark-soft',
    clear: 'cytube-tools-poll-history-analyzer-clear',
    export: 'cytube-tools-poll-history-analyzer-export',
    stats: 'cytube-tools-poll-history-analyzer-stats',
    list: 'cytube-tools-poll-history-analyzer-list'
  };

  const TAG_PATTERNS = [
    { key: 'karaoke', rx: /\b(karaoke|singing|song|uta|歌枠)\b/i },
    { key: 'watchalong', rx: /\b(watchalong|watch\s*along)\b/i },
    { key: 'vrchat', rx: /\b(vrchat|vr\s*chat)\b/i },
    { key: 'pov', rx: /\b(pov)\b/i },
    { key: 'sf6', rx: /\b(sf6|street\s*fighter\s*6)\b/i },
    { key: 'live', rx: /\b(live)\b/i },
    { key: 'zatsu', rx: /\b(zatsu|chatting|talk)\b/i },
    { key: 'gaming', rx: /\b(game|gaming|playthrough|stream)\b/i }
  ];

  const loadedRecords = loadRecords();

  const state = {
    settings: loadSettings(),
    records: loadedRecords,
    recordHashes: new Set(loadedRecords.map((record) => record.hash)),
    aliasData: parseAliasRules(loadSettings().aliasRulesText),
    panelVisible: false,
    historyObserver: null,
    activePollObserver: null,
    waitingForPollHistory: false,
    waitingForPollWrap: false,
    scanTimer: null,
    activeCheckTimer: null,
    softWinnerTimer: null,
    activePollSignature: '',
    activePollFirstSeenTs: 0,
    completedSoftSignatures: new Set(),
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
      // Keep script stable on storage failures.
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

  function clampNumber(value, min, max, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, parsed));
  }

  function sanitizeWinnerFilter(value) {
    if (value === 'official' || value === 'soft' || value === 'none') {
      return value;
    }
    return 'all';
  }

  function sanitizeViewMode(value) {
    return value === 'raw' ? 'raw' : 'grouped';
  }

  function normalizeText(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function simpleHash(text) {
    let hash = 0;
    const source = String(text || '');
    for (let i = 0; i < source.length; i += 1) {
      hash = ((hash << 5) - hash) + source.charCodeAt(i);
      hash |= 0;
    }
    return `h${Math.abs(hash)}`;
  }

  function titleCase(text) {
    return String(text || '')
      .split(' ')
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  function parseAliasRules(rawText) {
    const aliasToCanonicalKey = new Map();
    const canonicalKeyToDisplay = new Map();
    const aliases = [];

    String(rawText || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => {
        const separatorIdx = line.indexOf(':');
        if (separatorIdx < 1) {
          return;
        }
        const canonicalDisplay = line.slice(0, separatorIdx).trim();
        if (!canonicalDisplay) {
          return;
        }
        const canonicalKey = normalizeText(canonicalDisplay);
        if (!canonicalKey) {
          return;
        }
        canonicalKeyToDisplay.set(canonicalKey, canonicalDisplay);

        const aliasList = line
          .slice(separatorIdx + 1)
          .split(',')
          .map((part) => part.trim())
          .filter(Boolean);

        const allAliases = [canonicalDisplay, ...aliasList];
        allAliases.forEach((aliasRaw) => {
          const aliasKey = normalizeText(aliasRaw);
          if (!aliasKey) {
            return;
          }
          aliasToCanonicalKey.set(aliasKey, canonicalKey);
          aliases.push(aliasKey);
        });
      });

    aliases.sort((a, b) => b.length - a.length);
    return { aliasToCanonicalKey, canonicalKeyToDisplay, orderedAliases: aliases };
  }

  function extractTags(rawLabel) {
    const text = String(rawLabel || '');
    const tags = [];
    TAG_PATTERNS.forEach((entry) => {
      if (entry.rx.test(text)) {
        tags.push(entry.key);
      }
    });
    return tags;
  }

  function matchEntity(rawLabel) {
    const normalized = normalizeText(rawLabel);
    if (!normalized) {
      return null;
    }

    for (const alias of state.aliasData.orderedAliases) {
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rx = new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`, 'i');
      if (!rx.test(normalized)) {
        continue;
      }
      const canonicalKey = state.aliasData.aliasToCanonicalKey.get(alias);
      if (!canonicalKey) {
        continue;
      }
      return state.aliasData.canonicalKeyToDisplay.get(canonicalKey) || titleCase(canonicalKey);
    }

    return null;
  }

  function getGroupedKey(rawLabel) {
    const entity = matchEntity(rawLabel);
    if (entity) {
      return normalizeText(entity);
    }
    return normalizeText(rawLabel);
  }

  function extractVotesFromText(text) {
    const raw = String(text || '').replace(/\s+/g, ' ').trim();
    if (!raw) {
      return null;
    }

    const explicitVote = raw.match(/(\d+)\s*votes?\b/i);
    if (explicitVote) {
      return Number(explicitVote[1]);
    }

    const countInParens = raw.match(/\((\d+)\s*(?:votes?)?\)/i);
    if (countInParens) {
      return Number(countInParens[1]);
    }

    return null;
  }

  function extractOptionFromElement(optionEl) {
    if (!(optionEl instanceof HTMLElement)) {
      return null;
    }

    const rawText = optionEl.textContent.replace(/\s+/g, ' ').trim();
    if (!rawText || rawText.length > 180) {
      return null;
    }

    let votes = null;
    const voteNode = optionEl.querySelector('[class*="vote"], [class*="count"], .badge');
    if (voteNode) {
      const parsed = Number((voteNode.textContent || '').match(/\d+/)?.[0]);
      if (Number.isFinite(parsed)) {
        votes = parsed;
      }
    }

    if (!Number.isFinite(votes)) {
      votes = extractVotesFromText(rawText);
    }

    let label = rawText;
    if (Number.isFinite(votes)) {
      label = label
        .replace(new RegExp(`\\b${votes}\\b\\s*votes?\\b`, 'i'), '')
        .replace(new RegExp(`\\(\\s*${votes}\\s*(?:votes?)?\\s*\\)`, 'i'), '')
        .replace(/\s+/g, ' ')
        .trim();
    }
    if (!label) {
      label = rawText;
    }

    const canonicalKey = normalizeText(label);
    if (!canonicalKey) {
      return null;
    }

    const entity = matchEntity(label);
    return {
      rawLabel: label,
      votes: Number.isFinite(votes) ? votes : null,
      canonicalKey,
      entity,
      groupKey: entity ? normalizeText(entity) : canonicalKey,
      tags: extractTags(label),
      isWinner: optionEl.classList.contains('winner') || optionEl.classList.contains('text-success')
    };
  }

  function extractOptionsFromTextLines(text, title) {
    const titleNorm = normalizeText(title);
    const lines = String(text || '')
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean);

    const options = [];
    const seen = new Set();
    lines.forEach((line) => {
      const norm = normalizeText(line);
      if (!norm || norm === titleNorm) {
        return;
      }
      if (/^(winner|poll|created|votes?|results?)\b/i.test(line)) {
        return;
      }
      if (line.length > 180) {
        return;
      }

      const option = extractOptionFromElement({
        textContent: line,
        querySelector: () => null,
        classList: { contains: () => false }
      });
      if (!option) {
        return;
      }
      if (seen.has(option.canonicalKey)) {
        return;
      }
      seen.add(option.canonicalKey);
      options.push(option);
    });
    return options;
  }

  function extractTitle(node) {
    if (!(node instanceof HTMLElement)) {
      return '';
    }

    const candidates = [
      '.poll-title',
      '.panel-heading',
      'h3',
      'h4',
      'strong'
    ];
    for (const selector of candidates) {
      const el = node.querySelector(selector);
      if (!el) {
        continue;
      }
      const text = el.textContent.replace(/\s+/g, ' ').trim();
      if (text.length >= 3 && text.length <= 160) {
        return text;
      }
    }

    const firstLine = node.textContent.split('\n').map((line) => line.trim()).find(Boolean) || '';
    return firstLine.slice(0, 160);
  }

  function findWinnerByMarker(options, node) {
    const winnerOption = options.find((option) => option.isWinner);
    if (winnerOption) {
      return winnerOption.rawLabel;
    }

    if (node instanceof HTMLElement) {
      const winnerText = node.textContent.match(/winner\s*[:\-]\s*([^\n]+)/i)?.[1];
      if (winnerText) {
        return winnerText.replace(/\s+/g, ' ').trim();
      }
    }
    return null;
  }

  function createRecord(base) {
    const createdAt = Number(base.createdAt) || Date.now();
    const safeOptions = Array.isArray(base.options) ? base.options : [];
    const winnerOfficialRaw = String(base.winnerOfficialRaw || '').trim() || null;
    const winnerSoftRaw = String(base.winnerSoftRaw || '').trim() || null;
    const winnerMode = winnerOfficialRaw ? 'official' : (winnerSoftRaw ? 'soft' : 'none');

    const signature = [
      normalizeText(base.title),
      safeOptions.map((option) => option.canonicalKey).join('|'),
      normalizeText(winnerOfficialRaw || winnerSoftRaw || ''),
      base.source || 'history',
      normalizeText(base.signatureExtra || '')
    ].join('::');

    const hash = simpleHash(signature);
    const winnerOfficialGroup = winnerOfficialRaw ? getGroupedKey(winnerOfficialRaw) : null;
    const winnerSoftGroup = winnerSoftRaw ? getGroupedKey(winnerSoftRaw) : null;

    return {
      id: `${hash}-${createdAt}`,
      hash,
      source: base.source || 'history',
      createdAt,
      title: String(base.title || 'Untitled Poll').slice(0, 160),
      options: safeOptions,
      winnerMode,
      winnerOfficialRaw,
      winnerOfficialGroup,
      winnerSoftRaw,
      winnerSoftGroup,
      softTie: Boolean(base.softTie),
      rawSnippet: String(base.rawSnippet || '').slice(0, 500)
    };
  }

  function sanitizeOption(raw) {
    if (!raw || typeof raw !== 'object') {
      return null;
    }
    const rawLabel = String(raw.rawLabel || '').replace(/\s+/g, ' ').trim();
    const canonicalKey = normalizeText(raw.canonicalKey || rawLabel);
    if (!rawLabel || !canonicalKey) {
      return null;
    }
    return {
      rawLabel,
      votes: Number.isFinite(Number(raw.votes)) ? Number(raw.votes) : null,
      canonicalKey,
      entity: raw.entity ? String(raw.entity) : null,
      groupKey: normalizeText(raw.groupKey || canonicalKey),
      tags: Array.isArray(raw.tags) ? raw.tags.map((tag) => String(tag).trim()).filter(Boolean) : []
    };
  }

  function sanitizeRecord(raw) {
    if (!raw || typeof raw !== 'object') {
      return null;
    }
    const createdAt = Number(raw.createdAt);
    if (!Number.isFinite(createdAt) || createdAt <= 0) {
      return null;
    }
    const options = (Array.isArray(raw.options) ? raw.options : [])
      .map(sanitizeOption)
      .filter(Boolean);
    const title = String(raw.title || '').replace(/\s+/g, ' ').trim();
    if (!title) {
      return null;
    }

    const winnerOfficialRaw = raw.winnerOfficialRaw ? String(raw.winnerOfficialRaw).trim() : null;
    const winnerSoftRaw = raw.winnerSoftRaw ? String(raw.winnerSoftRaw).trim() : null;
    const winnerMode = winnerOfficialRaw ? 'official' : (winnerSoftRaw ? 'soft' : 'none');
    const hash = String(raw.hash || simpleHash(`${title}|${createdAt}`));

    return {
      id: String(raw.id || `${hash}-${createdAt}`),
      hash,
      source: String(raw.source || 'history'),
      createdAt,
      title: title.slice(0, 160),
      options,
      winnerMode,
      winnerOfficialRaw,
      winnerOfficialGroup: winnerOfficialRaw ? normalizeText(raw.winnerOfficialGroup || getGroupedKey(winnerOfficialRaw)) : null,
      winnerSoftRaw,
      winnerSoftGroup: winnerSoftRaw ? normalizeText(raw.winnerSoftGroup || getGroupedKey(winnerSoftRaw)) : null,
      softTie: Boolean(raw.softTie),
      rawSnippet: String(raw.rawSnippet || '').slice(0, 500)
    };
  }

  function loadSettings() {
    const raw = parseStoredObject(safeGetValue(STORAGE_KEYS.settings, {}));
    return {
      enabled: parseBoolean(raw.enabled, DEFAULT_SETTINGS.enabled),
      search: String(raw.search || '').slice(0, 120),
      winnerFilter: sanitizeWinnerFilter(raw.winnerFilter),
      viewMode: sanitizeViewMode(raw.viewMode),
      softWinnerDelaySec: clampNumber(raw.softWinnerDelaySec, 30, 600, DEFAULT_SETTINGS.softWinnerDelaySec),
      aliasRulesText: String(raw.aliasRulesText || DEFAULT_SETTINGS.aliasRulesText).slice(0, 8000)
    };
  }

  function loadRecords() {
    const parsed = parseStoredArray(safeGetValue(STORAGE_KEYS.records, []));
    const clean = [];
    parsed.forEach((record) => {
      const sanitized = sanitizeRecord(record);
      if (sanitized) {
        clean.push(sanitized);
      }
    });
    clean.sort((a, b) => b.createdAt - a.createdAt);
    if (clean.length > RECORD_LIMIT) {
      clean.length = RECORD_LIMIT;
    }
    return clean;
  }

  function persistSettings() {
    safeSetValue(STORAGE_KEYS.settings, JSON.stringify(state.settings));
  }

  function persistRecords() {
    safeSetValue(STORAGE_KEYS.records, JSON.stringify(state.records));
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

  function openPollsTab() {
    if (typeof window.jQuery !== 'undefined') {
      window.jQuery('a[href="#pollsTab"]').tab('show');
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
      button.textContent = 'Poll Analyzer';
      button.title = 'Toggle Poll History Analyzer';
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

  function addRecord(record) {
    const sanitized = sanitizeRecord(record);
    if (!sanitized) {
      return false;
    }
    if (state.recordHashes.has(sanitized.hash)) {
      return false;
    }

    state.records.unshift(sanitized);
    state.recordHashes.add(sanitized.hash);
    if (state.records.length > RECORD_LIMIT) {
      const removed = state.records.splice(RECORD_LIMIT);
      removed.forEach((entry) => state.recordHashes.delete(entry.hash));
    }

    persistRecords();
    renderStatsAndList();
    return true;
  }

  function parsePollNode(node, source = 'history') {
    if (!(node instanceof HTMLElement)) {
      return null;
    }

    const title = extractTitle(node);
    const optionElements = Array.from(
      node.querySelectorAll('.poll-option, .option, .poll-option-item, li, .poll_result, .result')
    );

    const options = [];
    const seen = new Set();
    optionElements.forEach((el) => {
      const parsed = extractOptionFromElement(el);
      if (!parsed) {
        return;
      }
      if (seen.has(parsed.canonicalKey)) {
        return;
      }
      seen.add(parsed.canonicalKey);
      options.push(parsed);
    });

    if (!options.length) {
      extractOptionsFromTextLines(node.textContent, title).forEach((parsed) => {
        if (seen.has(parsed.canonicalKey)) {
          return;
        }
        seen.add(parsed.canonicalKey);
        options.push(parsed);
      });
    }

    if (!title && !options.length) {
      return null;
    }

    const winnerOfficialRaw = findWinnerByMarker(options, node);
    const createdAt = Date.now();

    return createRecord({
      source,
      createdAt,
      title: title || 'Untitled Poll',
      options,
      winnerOfficialRaw,
      signatureExtra: normalizeText(node.textContent).slice(0, 400),
      rawSnippet: node.textContent.replace(/\s+/g, ' ').trim()
    });
  }

  function scanPollHistory(force = false) {
    const pollHistory = document.querySelector('#pollhistory');
    if (!pollHistory) {
      return;
    }

    const nodes = Array.from(pollHistory.children).filter((child) => child instanceof HTMLElement);
    nodes.forEach((node) => {
      if (!force && node.dataset.pollHistoryAnalyzerSeen === '1') {
        return;
      }
      const record = parsePollNode(node, 'history');
      if (record) {
        addRecord(record);
      }
      node.dataset.pollHistoryAnalyzerSeen = '1';
    });
  }

  function scheduleHistoryScan(force = false) {
    if (state.scanTimer) {
      return;
    }
    state.scanTimer = setTimeout(() => {
      state.scanTimer = null;
      scanPollHistory(force);
    }, 200);
  }

  function clearSoftWinnerTimer() {
    if (!state.softWinnerTimer) {
      return;
    }
    clearTimeout(state.softWinnerTimer);
    state.softWinnerTimer = null;
  }

  function parseActivePollSnapshot() {
    const pollWrap = document.querySelector('#pollwrap');
    if (!pollWrap) {
      return null;
    }

    const title = extractTitle(pollWrap);
    const options = Array.from(pollWrap.querySelectorAll('.poll-option, .option, li'))
      .map((node) => extractOptionFromElement(node))
      .filter(Boolean);

    if (!title || options.length < 2) {
      return null;
    }

    return {
      title,
      options,
      signature: `${normalizeText(title)}|${options.map((option) => option.canonicalKey).join('|')}`,
      rawSnippet: pollWrap.textContent.replace(/\s+/g, ' ').trim()
    };
  }

  function determineSoftWinner(options) {
    const voted = options.filter((option) => Number.isFinite(option.votes));
    if (!voted.length) {
      return { winner: null, tie: false };
    }

    let max = -1;
    voted.forEach((option) => {
      if (option.votes > max) {
        max = option.votes;
      }
    });
    const winners = voted.filter((option) => option.votes === max);
    if (!winners.length) {
      return { winner: null, tie: false };
    }
    if (winners.length === 1) {
      return { winner: winners[0].rawLabel, tie: false };
    }
    return { winner: winners.map((entry) => entry.rawLabel).join(' | '), tie: true };
  }

  function captureSoftWinner(reason = 'timer') {
    const snapshot = parseActivePollSnapshot();
    if (!snapshot) {
      return;
    }

    const expectedSignature = state.activePollSignature;
    if (!expectedSignature || snapshot.signature !== expectedSignature) {
      return;
    }

    const soft = determineSoftWinner(snapshot.options);
    const signatureKey = `${snapshot.signature}|${state.activePollFirstSeenTs}`;
    if (state.completedSoftSignatures.has(signatureKey)) {
      return;
    }

    const record = createRecord({
      source: 'active-soft',
      createdAt: Date.now(),
      title: snapshot.title,
      options: snapshot.options,
      winnerSoftRaw: soft.winner,
      softTie: soft.tie,
      signatureExtra: `${signatureKey}|${reason}`,
      rawSnippet: snapshot.rawSnippet
    });

    if (addRecord(record)) {
      state.completedSoftSignatures.add(signatureKey);
    }
  }

  function scheduleSoftWinner(snapshot) {
    clearSoftWinnerTimer();
    const delayMs = state.settings.softWinnerDelaySec * 1000;
    state.softWinnerTimer = setTimeout(() => captureSoftWinner('delay'), delayMs);
  }

  function checkActivePoll() {
    const snapshot = parseActivePollSnapshot();
    if (!snapshot) {
      state.activePollSignature = '';
      state.activePollFirstSeenTs = 0;
      clearSoftWinnerTimer();
      return;
    }

    if (snapshot.signature === state.activePollSignature) {
      return;
    }

    state.activePollSignature = snapshot.signature;
    state.activePollFirstSeenTs = Date.now();
    scheduleSoftWinner(snapshot);
  }

  function scheduleActivePollCheck() {
    if (state.activeCheckTimer) {
      return;
    }
    state.activeCheckTimer = setTimeout(() => {
      state.activeCheckTimer = null;
      checkActivePoll();
    }, 300);
  }

  function stopHistoryObserver() {
    if (!state.historyObserver) {
      return;
    }
    state.historyObserver.disconnect();
    state.historyObserver = null;
  }

  function startHistoryObserver() {
    if (state.historyObserver) {
      return true;
    }
    const pollHistory = document.querySelector('#pollhistory');
    if (!pollHistory) {
      return false;
    }

    state.historyObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type !== 'childList') {
          continue;
        }
        if (mutation.addedNodes.length || mutation.removedNodes.length) {
          scheduleHistoryScan(false);
          return;
        }
      }
    });
    state.historyObserver.observe(pollHistory, { childList: true, subtree: true });
    return true;
  }

  function stopActivePollObserver() {
    if (!state.activePollObserver) {
      return;
    }
    state.activePollObserver.disconnect();
    state.activePollObserver = null;
  }

  function startActivePollObserver() {
    if (state.activePollObserver) {
      return true;
    }
    const pollWrap = document.querySelector('#pollwrap');
    if (!pollWrap) {
      return false;
    }

    state.activePollObserver = new MutationObserver(() => {
      scheduleActivePollCheck();
    });
    state.activePollObserver.observe(pollWrap, { childList: true, characterData: true, subtree: true });
    return true;
  }

  function syncHistoryObserver() {
    if (!state.settings.enabled) {
      stopHistoryObserver();
      return;
    }
    if (startHistoryObserver()) {
      return;
    }
    if (state.waitingForPollHistory) {
      return;
    }
    state.waitingForPollHistory = true;
    waitForEl('#pollhistory').then(() => {
      state.waitingForPollHistory = false;
      if (state.settings.enabled) {
        startHistoryObserver();
        scheduleHistoryScan(true);
      }
    });
  }

  function syncActivePollObserver() {
    if (!state.settings.enabled) {
      stopActivePollObserver();
      clearSoftWinnerTimer();
      return;
    }
    if (startActivePollObserver()) {
      return;
    }
    if (state.waitingForPollWrap) {
      return;
    }
    state.waitingForPollWrap = true;
    waitForEl('#pollwrap').then(() => {
      state.waitingForPollWrap = false;
      if (state.settings.enabled) {
        startActivePollObserver();
        checkActivePoll();
      }
    });
  }

  function syncTrackingState() {
    if (!state.settings.enabled) {
      stopHistoryObserver();
      stopActivePollObserver();
      clearSoftWinnerTimer();
      return;
    }
    scheduleHistoryScan(true);
    checkActivePoll();
    syncHistoryObserver();
    syncActivePollObserver();
  }

  function getWinnerLabel(record) {
    if (record.winnerMode === 'official') {
      if (state.settings.viewMode === 'grouped') {
        return record.winnerOfficialGroup || normalizeText(record.winnerOfficialRaw || '');
      }
      return record.winnerOfficialRaw || '';
    }
    if (record.winnerMode === 'soft') {
      if (state.settings.viewMode === 'grouped') {
        return record.winnerSoftGroup || normalizeText(record.winnerSoftRaw || '');
      }
      return record.winnerSoftRaw || '';
    }
    return '';
  }

  function formatWinnerForDisplay(record) {
    if (record.winnerMode === 'official') {
      return record.winnerOfficialRaw || 'None';
    }
    if (record.winnerMode === 'soft') {
      return record.winnerSoftRaw || 'None';
    }
    return 'None';
  }

  function getFilteredRecords() {
    const search = normalizeText(state.settings.search);
    const winnerFilter = state.settings.winnerFilter;
    return state.records.filter((record) => {
      if (winnerFilter !== 'all' && record.winnerMode !== winnerFilter) {
        return false;
      }

      if (!search) {
        return true;
      }

      const haystack = [
        record.title,
        record.winnerOfficialRaw,
        record.winnerSoftRaw,
        ...record.options.map((option) => option.rawLabel),
        ...record.options.map((option) => option.entity || '')
      ].join(' ');
      return normalizeText(haystack).includes(search);
    });
  }

  function renderStatsAndList() {
    const statsEl = document.getElementById(UI_IDS.stats);
    const listEl = document.getElementById(UI_IDS.list);
    if (!statsEl || !listEl) {
      return;
    }

    const filtered = getFilteredRecords();
    const winnerCounts = new Map();
    const tagCounts = new Map();

    filtered.forEach((record) => {
      const winner = getWinnerLabel(record);
      if (winner) {
        winnerCounts.set(winner, (winnerCounts.get(winner) || 0) + 1);
      }
      record.options.forEach((option) => {
        option.tags.forEach((tag) => {
          tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
        });
      });
    });

    const topWinners = Array.from(winnerCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, count]) => `${state.settings.viewMode === 'grouped' ? titleCase(name) : name} (${count})`)
      .join(', ');

    const topTags = Array.from(tagCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([tag, count]) => `${tag} (${count})`)
      .join(', ');

    statsEl.textContent = [
      `Total records: ${state.records.length}`,
      `Filtered: ${filtered.length}`,
      `Top winners: ${topWinners || 'n/a'}`,
      `Top tags: ${topTags || 'n/a'}`
    ].join('  |  ');

    listEl.replaceChildren();
    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'cytube-tools-poll-history-analyzer-empty';
      empty.textContent = 'No polls match current filters.';
      listEl.appendChild(empty);
      return;
    }

    filtered.slice(0, 250).forEach((record) => {
      const row = document.createElement('div');
      row.className = `cytube-tools-poll-history-analyzer-row mode-${record.winnerMode}`;

      const head = document.createElement('div');
      head.className = 'cytube-tools-poll-history-analyzer-row-head';

      const time = document.createElement('span');
      time.className = 'cytube-tools-poll-history-analyzer-time';
      time.textContent = new Date(record.createdAt).toLocaleTimeString();

      const mode = document.createElement('span');
      mode.className = `cytube-tools-poll-history-analyzer-badge badge-${record.winnerMode}`;
      mode.textContent = record.winnerMode.toUpperCase();

      const title = document.createElement('span');
      title.className = 'cytube-tools-poll-history-analyzer-title';
      title.textContent = record.title;

      head.appendChild(time);
      head.appendChild(mode);
      head.appendChild(title);

      const winner = document.createElement('div');
      winner.className = 'cytube-tools-poll-history-analyzer-winner';
      winner.textContent = `Winner: ${formatWinnerForDisplay(record)}`;

      const options = document.createElement('div');
      options.className = 'cytube-tools-poll-history-analyzer-options';
      options.textContent = record.options.map((option) => option.rawLabel).join(' | ');

      row.appendChild(head);
      row.appendChild(winner);
      row.appendChild(options);
      listEl.appendChild(row);
    });
  }

  function clearRecords() {
    state.records = [];
    state.recordHashes = new Set();
    persistRecords();
    renderStatsAndList();
  }

  function exportRecords() {
    const payload = {
      exportedAt: new Date().toISOString(),
      settings: state.settings,
      records: getFilteredRecords()
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cytube-poll-history-analyzer-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function saveAliasesFromTextArea() {
    const aliasEl = document.getElementById(UI_IDS.aliasRules);
    if (!(aliasEl instanceof HTMLTextAreaElement)) {
      return;
    }
    state.settings.aliasRulesText = aliasEl.value.slice(0, 8000);
    state.aliasData = parseAliasRules(state.settings.aliasRulesText);
    persistSettings();

    state.records = state.records.map((record) => sanitizeRecord({
      ...record,
      winnerOfficialGroup: record.winnerOfficialRaw ? getGroupedKey(record.winnerOfficialRaw) : null,
      winnerSoftGroup: record.winnerSoftRaw ? getGroupedKey(record.winnerSoftRaw) : null,
      options: record.options.map((option) => ({
        ...option,
        entity: matchEntity(option.rawLabel),
        groupKey: getGroupedKey(option.rawLabel),
        tags: extractTags(option.rawLabel)
      }))
    })).filter(Boolean);

    state.recordHashes = new Set(state.records.map((record) => record.hash));
    persistRecords();
    renderStatsAndList();
  }

  function fillFormFromSettings() {
    const enabledEl = document.getElementById(UI_IDS.enabled);
    const searchEl = document.getElementById(UI_IDS.search);
    const winnerFilterEl = document.getElementById(UI_IDS.winnerFilter);
    const viewModeEl = document.getElementById(UI_IDS.viewMode);
    const softDelayEl = document.getElementById(UI_IDS.softDelay);
    const aliasEl = document.getElementById(UI_IDS.aliasRules);

    if (enabledEl) {
      enabledEl.checked = state.settings.enabled;
    }
    if (searchEl) {
      searchEl.value = state.settings.search;
    }
    if (winnerFilterEl) {
      winnerFilterEl.value = state.settings.winnerFilter;
    }
    if (viewModeEl) {
      viewModeEl.value = state.settings.viewMode;
    }
    if (softDelayEl) {
      softDelayEl.value = String(state.settings.softWinnerDelaySec);
    }
    if (aliasEl) {
      aliasEl.value = state.settings.aliasRulesText;
    }
    renderStatsAndList();
  }

  function bindUiEvents() {
    const enabledEl = document.getElementById(UI_IDS.enabled);
    const searchEl = document.getElementById(UI_IDS.search);
    const winnerFilterEl = document.getElementById(UI_IDS.winnerFilter);
    const viewModeEl = document.getElementById(UI_IDS.viewMode);
    const softDelayEl = document.getElementById(UI_IDS.softDelay);
    const saveAliasesEl = document.getElementById(UI_IDS.saveAliases);
    const openPollsEl = document.getElementById(UI_IDS.openPolls);
    const rescanEl = document.getElementById(UI_IDS.rescan);
    const markSoftEl = document.getElementById(UI_IDS.markSoft);
    const clearEl = document.getElementById(UI_IDS.clear);
    const exportEl = document.getElementById(UI_IDS.export);

    if (enabledEl) {
      enabledEl.addEventListener('change', () => {
        state.settings.enabled = enabledEl.checked;
        persistSettings();
        syncTrackingState();
      });
    }

    if (searchEl) {
      searchEl.addEventListener('input', () => {
        state.settings.search = searchEl.value.slice(0, 120);
        persistSettings();
        renderStatsAndList();
      });
    }

    if (winnerFilterEl) {
      winnerFilterEl.addEventListener('change', () => {
        state.settings.winnerFilter = sanitizeWinnerFilter(winnerFilterEl.value);
        persistSettings();
        renderStatsAndList();
      });
    }

    if (viewModeEl) {
      viewModeEl.addEventListener('change', () => {
        state.settings.viewMode = sanitizeViewMode(viewModeEl.value);
        persistSettings();
        renderStatsAndList();
      });
    }

    if (softDelayEl) {
      softDelayEl.addEventListener('change', () => {
        state.settings.softWinnerDelaySec = clampNumber(softDelayEl.value, 30, 600, DEFAULT_SETTINGS.softWinnerDelaySec);
        softDelayEl.value = String(state.settings.softWinnerDelaySec);
        persistSettings();
      });
    }

    if (saveAliasesEl) {
      saveAliasesEl.addEventListener('click', saveAliasesFromTextArea);
    }
    if (openPollsEl) {
      openPollsEl.addEventListener('click', openPollsTab);
    }
    if (rescanEl) {
      rescanEl.addEventListener('click', () => scheduleHistoryScan(true));
    }
    if (markSoftEl) {
      markSoftEl.addEventListener('click', () => captureSoftWinner('manual'));
    }
    if (clearEl) {
      clearEl.addEventListener('click', clearRecords);
    }
    if (exportEl) {
      exportEl.addEventListener('click', exportRecords);
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
    if (state.panelVisible) {
      renderStatsAndList();
    }
  }

  function renderPanel() {
    if (!state.ui.panel) {
      return;
    }

    state.ui.panel.innerHTML = `
      <div class="cytube-tools-poll-history-analyzer-head"><strong>Poll History Analyzer</strong></div>
      <label class="cytube-tools-poll-history-analyzer-line">
        <input type="checkbox" id="${UI_IDS.enabled}">
        Enable tracking
      </label>
      <div class="cytube-tools-poll-history-analyzer-controls">
        <input type="text" id="${UI_IDS.search}" class="form-control" placeholder="Search title/options/winner">
        <select id="${UI_IDS.winnerFilter}" class="form-control">
          <option value="all">All winner modes</option>
          <option value="official">Official winners</option>
          <option value="soft">Soft winners</option>
          <option value="none">No winner</option>
        </select>
        <select id="${UI_IDS.viewMode}" class="form-control">
          <option value="grouped">Grouped view</option>
          <option value="raw">Raw view</option>
        </select>
        <label class="cytube-tools-poll-history-analyzer-inline">
          Soft delay (sec)
          <input type="number" id="${UI_IDS.softDelay}" min="30" max="600" class="form-control">
        </label>
      </div>
      <label class="cytube-tools-poll-history-analyzer-block">
        Alias rules (Canonical: alias1, alias2)
        <textarea id="${UI_IDS.aliasRules}" class="form-control" rows="4"></textarea>
      </label>
      <div class="cytube-tools-poll-history-analyzer-actions">
        <button type="button" class="btn btn-sm btn-primary" id="${UI_IDS.saveAliases}">Save Aliases</button>
        <button type="button" class="btn btn-sm btn-default" id="${UI_IDS.openPolls}">Open Polls Tab</button>
        <button type="button" class="btn btn-sm btn-default" id="${UI_IDS.rescan}">Rescan History</button>
        <button type="button" class="btn btn-sm btn-default" id="${UI_IDS.markSoft}">Mark Soft Winner Now</button>
        <button type="button" class="btn btn-sm btn-danger" id="${UI_IDS.clear}">Clear</button>
        <button type="button" class="btn btn-sm btn-default" id="${UI_IDS.export}">Export JSON</button>
      </div>
      <div id="${UI_IDS.stats}" class="cytube-tools-poll-history-analyzer-stats"></div>
      <div id="${UI_IDS.list}" class="cytube-tools-poll-history-analyzer-list"></div>
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
    .cytube-tools-poll-history-analyzer-head {
      margin-bottom: 8px;
      font-size: 14px;
    }
    .cytube-tools-poll-history-analyzer-line {
      display: block;
      margin-bottom: 8px;
      font-weight: normal;
    }
    .cytube-tools-poll-history-analyzer-block {
      display: block;
      margin-bottom: 8px;
      font-weight: normal;
    }
    .cytube-tools-poll-history-analyzer-inline {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-weight: normal;
    }
    .cytube-tools-poll-history-analyzer-controls {
      display: grid;
      gap: 6px;
      grid-template-columns: minmax(180px, 1fr) auto auto auto;
      margin-bottom: 8px;
    }
    .cytube-tools-poll-history-analyzer-actions {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      margin-bottom: 8px;
    }
    .cytube-tools-poll-history-analyzer-stats {
      font-size: 12px;
      color: #cfd4db;
      margin-bottom: 8px;
      background: #171717;
      border: 1px solid #2d2d2d;
      border-radius: 4px;
      padding: 6px;
      word-break: break-word;
    }
    .cytube-tools-poll-history-analyzer-list {
      max-height: 340px;
      overflow-y: auto;
      background: #171717;
      border: 1px solid #2d2d2d;
      border-radius: 4px;
      padding: 6px;
    }
    .cytube-tools-poll-history-analyzer-row {
      border-bottom: 1px solid #2d2d2d;
      padding: 5px 0;
      font-size: 12px;
    }
    .cytube-tools-poll-history-analyzer-row:last-child {
      border-bottom: none;
    }
    .cytube-tools-poll-history-analyzer-row-head {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }
    .cytube-tools-poll-history-analyzer-time {
      color: #9aa0a6;
      min-width: 72px;
    }
    .cytube-tools-poll-history-analyzer-badge {
      font-size: 10px;
      border-radius: 10px;
      padding: 1px 6px;
      color: #111;
      font-weight: 700;
    }
    .badge-official { background: #58c475; }
    .badge-soft { background: #ffd166; }
    .badge-none { background: #8a8a8a; color: #111; }
    .cytube-tools-poll-history-analyzer-title {
      color: #edf0f3;
      font-weight: 600;
    }
    .cytube-tools-poll-history-analyzer-winner {
      margin-top: 2px;
      color: #d4d8df;
    }
    .cytube-tools-poll-history-analyzer-options {
      margin-top: 2px;
      color: #b5bcc4;
      word-break: break-word;
    }
    .cytube-tools-poll-history-analyzer-empty {
      color: #8a8a8a;
      font-style: italic;
    }
  `);

  (async () => {
    const toolsUi = await ensureToolsUi();
    if (!toolsUi) {
      return;
    }

    persistSettings();
    persistRecords();
    renderPanel();
    toolsUi.button.addEventListener('click', togglePanel);
    toolsUi.button.classList.toggle('active', state.panelVisible);
    syncTrackingState();
  })();
})();
