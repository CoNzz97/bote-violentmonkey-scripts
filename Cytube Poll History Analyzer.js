// ==UserScript==
// @name         Cytube Poll History Analyzer
// @namespace    cytube.poll.history.analyzer
// @version      2.0
// @description  Parse poll history, group name aliases, and track soft winners
// @match        https://om3tcw.com/r/*
// @require      https://conzz97.github.io/bote-violentmonkey-scripts/lib/poll-history-analyzer/storage-utils.js
// @require      https://conzz97.github.io/bote-violentmonkey-scripts/lib/poll-history-analyzer/text-utils.js
// @require      https://conzz97.github.io/bote-violentmonkey-scripts/lib/poll-history-analyzer/alias-engine.js
// @require      https://conzz97.github.io/bote-violentmonkey-scripts/lib/poll-history-analyzer/record-model.js
// @require      https://conzz97.github.io/bote-violentmonkey-scripts/lib/poll-history-analyzer/poll-parser.js
// @require      https://conzz97.github.io/bote-violentmonkey-scripts/lib/poll-history-analyzer/tracking-engine.js
// @require      https://conzz97.github.io/bote-violentmonkey-scripts/lib/poll-history-analyzer/winner-database.js
// @grant        GM_addStyle
// @grant        GM_getResourceText
// @grant        GM_getValue
// @grant        GM_setValue
// @resource     pollHistoryAnalyzerPanelHtml https://conzz97.github.io/bote-violentmonkey-scripts/assets/poll-history-analyzer/panel.html
// @resource     pollHistoryAnalyzerStyles https://conzz97.github.io/bote-violentmonkey-scripts/assets/poll-history-analyzer/styles.css
// ==/UserScript==

(function() {
  'use strict';

  const TOGGLE_ID = 'poll-history-analyzer-toggle';
  const PANEL_ID = 'cytube-tools-poll-history-analyzer-panel';
  const PANEL_CLASS = 'cytube-tools-poll-history-analyzer-panel';
  const RETRY_DELAY_MS = 500;
  const MAX_RETRIES = 120;
  const RECORD_LIMIT = 1000;
  const HASH_BUCKET_MS = 6 * 60 * 60 * 1000;

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
    aliasRulesText: DEFAULT_ALIAS_RULES,
    winnerOverrides: {}
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
    winnerDb: 'cytube-tools-poll-history-analyzer-winnerdb',
    list: 'cytube-tools-poll-history-analyzer-list'
  };

  const RESOURCE_NAMES = {
    panelHtml: 'pollHistoryAnalyzerPanelHtml',
    styles: 'pollHistoryAnalyzerStyles'
  };

  const FALLBACK_PANEL_HTML = `
    <div class="cytube-tools-poll-history-analyzer-head"><strong>Poll History Analyzer</strong></div>
    <div class="cytube-tools-poll-history-analyzer-empty">
      Resource load failed. Check script @resource URLs for panel.html/styles.css.
    </div>
  `;

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

  const storageUtils = window.CytubePollHistoryAnalyzerStorageUtils;
  const textUtils = window.CytubePollHistoryAnalyzerTextUtils;
  const aliasEngineFactory = window.CytubePollHistoryAnalyzerAliasEngine;
  const recordModelFactory = window.CytubePollHistoryAnalyzerRecordModel;
  const pollParserFactory = window.CytubePollHistoryAnalyzerPollParser;
  const trackingEngineFactory = window.CytubePollHistoryAnalyzerTrackingEngine;
  const winnerDatabaseFactory = window.CytubePollHistoryAnalyzerWinnerDatabase;

  if (!storageUtils || !textUtils || !aliasEngineFactory || !recordModelFactory || !pollParserFactory || !trackingEngineFactory || !winnerDatabaseFactory) {
    return;
  }

  const {
    safeGetValue,
    safeSetValue,
    parseStoredObject,
    parseStoredArray,
    parseBoolean,
    clampNumber,
    sanitizeWinnerFilter,
    sanitizeViewMode
  } = storageUtils;

  const {
    normalizeText,
    simpleHash,
    extractPollClockToken,
    normalizeTitleForHash,
    titleCase
  } = textUtils;

  const parseWinnerOverrides = (raw) => storageUtils.parseWinnerOverrides(raw, normalizeText);

  let runtimeSettings = DEFAULT_SETTINGS;
  let runtimeAliasData = {
    aliasToCanonicalKey: new Map(),
    canonicalKeyToDisplay: new Map(),
    orderedAliases: []
  };

  const aliasEngine = aliasEngineFactory.create({
    normalizeText,
    titleCase,
    getRuntimeAliasData: () => runtimeAliasData,
    getRuntimeSettings: () => runtimeSettings
  });

  const {
    parseAliasRules,
    parseAliasRuleEntries,
    serializeAliasRuleEntries,
    matchEntity,
    getGroupedKey,
    getWinnerOverrideLabel,
    getWinnerGroupLabel,
    getWinnerGroupKey,
    resolveWinnerGroupForDatabase
  } = aliasEngine;

  runtimeAliasData = parseAliasRules(DEFAULT_SETTINGS.aliasRulesText);

  const recordModel = recordModelFactory.create({
    normalizeText,
    simpleHash,
    extractPollClockToken,
    normalizeTitleForHash,
    getWinnerGroupKey: (rawWinner) => getWinnerGroupKey(rawWinner),
    hashBucketMs: HASH_BUCKET_MS
  });

  const pollParser = pollParserFactory.create({
    normalizeText,
    matchEntity: (rawLabel) => matchEntity(rawLabel),
    extractTags: (rawLabel) => extractTags(rawLabel),
    createRecord: (base) => createRecord(base)
  });

  const {
    extractVotesFromText,
    stripVotePrefixFromLabel,
    parsePollNode,
    parseActivePollSnapshot
  } = pollParser;

  const winnerDatabaseEngine = winnerDatabaseFactory.create({
    normalizeText,
    getWinnerRaw: (record) => recordModel.getWinnerRaw(record),
    resolveWinnerGroupForDatabase: (rawWinner) => resolveWinnerGroupForDatabase(rawWinner),
    parseAliasRuleEntries: (rawText) => parseAliasRuleEntries(rawText),
    serializeAliasRuleEntries: (entryMap) => serializeAliasRuleEntries(entryMap),
    maxAliasRulesLength: 8000
  });

  const initialSettings = loadSettings();
  runtimeSettings = initialSettings;
  runtimeAliasData = parseAliasRules(initialSettings.aliasRulesText);
  const loadedRecords = loadRecords();

  const state = {
    settings: initialSettings,
    records: loadedRecords,
    recordHashes: new Set(loadedRecords.map((record) => record.hash)),
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
    openWinnerGroups: new Set(),
    ui: {
      button: null,
      panel: null
    }
  };

  const trackingEngine = trackingEngineFactory.create({
    state,
    parsePollNode: (node, source) => parsePollNode(node, source),
    parseActivePollSnapshot: () => parseActivePollSnapshot(),
    addRecord: (record) => addRecord(record),
    createRecord: (base) => createRecord(base),
    extractVotesFromText: (text) => extractVotesFromText(text),
    stripVotePrefixFromLabel: (rawLabel, votes) => stripVotePrefixFromLabel(rawLabel, votes),
    buildActivePollSignature: (snapshot, referenceTs) => buildActivePollSignature(snapshot, referenceTs),
    waitForEl: (selector, attempt = 0) => waitForEl(selector, attempt),
    pollHistorySelector: '#pollhistory',
    pollWrapSelector: '#pollwrap'
  });

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

  function buildRecordHashInput(base, createdAt, options) {
    return recordModel.buildRecordHashInput(base, createdAt, options);
  }

  function winnerModeRank(mode) {
    return recordModel.winnerModeRank(mode);
  }

  function shouldPreferRecord(candidate, existing) {
    return recordModel.shouldPreferRecord(candidate, existing);
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

  function getWinnerRaw(record) {
    return recordModel.getWinnerRaw(record);
  }

  function createRecord(base) {
    return recordModel.createRecord(base);
  }

  function sanitizeOption(raw) {
    return recordModel.sanitizeOption(raw);
  }

  function sanitizeRecord(raw) {
    return recordModel.sanitizeRecord(raw);
  }

  function loadSettings() {
    const raw = parseStoredObject(safeGetValue(STORAGE_KEYS.settings, {}));
    return {
      enabled: parseBoolean(raw.enabled, DEFAULT_SETTINGS.enabled),
      search: String(raw.search || '').slice(0, 120),
      winnerFilter: sanitizeWinnerFilter(raw.winnerFilter),
      viewMode: sanitizeViewMode(raw.viewMode),
      softWinnerDelaySec: clampNumber(raw.softWinnerDelaySec, 30, 600, DEFAULT_SETTINGS.softWinnerDelaySec),
      aliasRulesText: String(raw.aliasRulesText || DEFAULT_SETTINGS.aliasRulesText).slice(0, 8000),
      winnerOverrides: parseWinnerOverrides(raw.winnerOverrides)
    };
  }

  function loadRecords() {
    const parsed = parseStoredArray(safeGetValue(STORAGE_KEYS.records, []));
    const deduped = new Map();
    parsed.forEach((record) => {
      const sanitized = sanitizeRecord(record);
      if (sanitized) {
        const existing = deduped.get(sanitized.hash);
        if (!existing) {
          deduped.set(sanitized.hash, sanitized);
          return;
        }
        if (!shouldPreferRecord(sanitized, existing)) {
          return;
        }

        const upgraded = sanitizeRecord({
          ...existing,
          ...sanitized,
          createdAt: Math.min(existing.createdAt, sanitized.createdAt),
          hash: existing.hash
        });
        if (!upgraded) {
          return;
        }
        upgraded.hash = existing.hash;
        upgraded.id = `${existing.hash}-${upgraded.createdAt}`;
        deduped.set(existing.hash, upgraded);
      }
    });
    const clean = Array.from(deduped.values());
    clean.sort((a, b) => b.createdAt - a.createdAt);
    if (clean.length > RECORD_LIMIT) {
      clean.length = RECORD_LIMIT;
    }
    return clean;
  }

  function persistSettings() {
    runtimeSettings = state.settings;
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
      const existingIndex = state.records.findIndex((entry) => entry.hash === sanitized.hash);
      if (existingIndex < 0) {
        return false;
      }
      const existing = state.records[existingIndex];
      if (!shouldPreferRecord(sanitized, existing)) {
        return false;
      }

      const upgraded = sanitizeRecord({
        ...existing,
        ...sanitized,
        createdAt: Math.min(existing.createdAt, sanitized.createdAt),
        hash: existing.hash
      });
      if (!upgraded) {
        return false;
      }
      upgraded.hash = existing.hash;
      upgraded.id = `${existing.hash}-${upgraded.createdAt}`;
      state.records[existingIndex] = upgraded;
      persistRecords();
      renderStatsAndList();
      return true;
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

  function buildActivePollSignature(snapshot, referenceTs) {
    return recordModel.buildActivePollSignature(snapshot, referenceTs);
  }

  function scanPollHistory(force = false) {
    trackingEngine.scanPollHistory(force);
  }

  function scheduleHistoryScan(force = false) {
    trackingEngine.scheduleHistoryScan(force);
  }

  function clearSoftWinnerTimer() {
    trackingEngine.clearSoftWinnerTimer();
  }

  function getOptionVote(option) {
    return trackingEngine.getOptionVote(option);
  }

  function determineSoftWinner(options) {
    return trackingEngine.determineSoftWinner(options);
  }

  function findLatestNoWinnerRecord() {
    return trackingEngine.findLatestNoWinnerRecord();
  }

  function captureSoftWinnerFromRecord(record, reason = 'manual-history') {
    return trackingEngine.captureSoftWinnerFromRecord(record, reason);
  }

  function captureSoftWinner(reason = 'timer') {
    trackingEngine.captureSoftWinner(reason);
  }

  function scheduleSoftWinner(snapshot) {
    trackingEngine.scheduleSoftWinner(snapshot);
  }

  function checkActivePoll() {
    trackingEngine.checkActivePoll();
  }

  function scheduleActivePollCheck() {
    trackingEngine.scheduleActivePollCheck();
  }

  function stopHistoryObserver() {
    trackingEngine.stopHistoryObserver();
  }

  function startHistoryObserver() {
    return trackingEngine.startHistoryObserver();
  }

  function stopActivePollObserver() {
    trackingEngine.stopActivePollObserver();
  }

  function startActivePollObserver() {
    return trackingEngine.startActivePollObserver();
  }

  function syncHistoryObserver() {
    trackingEngine.syncHistoryObserver();
  }

  function syncActivePollObserver() {
    trackingEngine.syncActivePollObserver();
  }

  function syncTrackingState() {
    trackingEngine.syncTrackingState();
  }

  function getWinnerLabel(record) {
    if (record.winnerMode === 'official') {
      if (state.settings.viewMode === 'grouped') {
        return getWinnerGroupKey(record.winnerOfficialRaw || '');
      }
      return record.winnerOfficialRaw || '';
    }
    if (record.winnerMode === 'soft') {
      if (state.settings.viewMode === 'grouped') {
        return getWinnerGroupKey(record.winnerSoftRaw || '');
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
        getWinnerGroupLabel(getWinnerRaw(record)),
        ...record.options.map((option) => option.rawLabel),
        ...record.options.map((option) => option.entity || '')
      ].join(' ');
      return normalizeText(haystack).includes(search);
    });
  }

  function buildWinnerDatabase(records) {
    return winnerDatabaseEngine.buildWinnerDatabase(records, state.settings.aliasRulesText);
  }

  function rebuildRecordsFromAliasData() {
    state.records = state.records.map((record) => sanitizeRecord({
      ...record,
      winnerOfficialGroup: record.winnerOfficialRaw ? getWinnerGroupKey(record.winnerOfficialRaw) : null,
      winnerSoftGroup: record.winnerSoftRaw ? getWinnerGroupKey(record.winnerSoftRaw) : null,
      options: record.options.map((option) => ({
        ...option,
        entity: matchEntity(option.rawLabel),
        groupKey: getGroupedKey(option.rawLabel),
        tags: extractTags(option.rawLabel)
      }))
    })).filter(Boolean);

    state.recordHashes = new Set(state.records.map((record) => record.hash));
    persistRecords();
  }

  function buildAliasInputValueForEntry(entry, aliasEntries) {
    return winnerDatabaseEngine.buildAliasInputValueForEntry(entry, aliasEntries);
  }

  function saveWinnerGroupAliases(entry, nextMainName, aliasCsv) {
    const nextState = winnerDatabaseEngine.applyWinnerGroupAliases({
      entry,
      nextMainName,
      aliasCsv,
      aliasRulesText: state.settings.aliasRulesText,
      winnerOverrides: state.settings.winnerOverrides
    });
    if (!nextState) {
      return;
    }

    state.settings.aliasRulesText = nextState.aliasRulesText;
    state.settings.winnerOverrides = nextState.winnerOverrides;
    runtimeAliasData = parseAliasRules(state.settings.aliasRulesText);
    persistSettings();
    rebuildRecordsFromAliasData();
    syncAliasRulesTextarea();
    renderStatsAndList();
  }

  function resetWinnerGroupAliases(entry) {
    const nextState = winnerDatabaseEngine.resetWinnerGroupAliasesData({
      entry,
      aliasRulesText: state.settings.aliasRulesText,
      winnerOverrides: state.settings.winnerOverrides
    });
    if (!nextState) {
      return;
    }

    state.settings.aliasRulesText = nextState.aliasRulesText;
    state.settings.winnerOverrides = nextState.winnerOverrides;
    runtimeAliasData = parseAliasRules(state.settings.aliasRulesText);
    persistSettings();
    rebuildRecordsFromAliasData();
    syncAliasRulesTextarea();
    renderStatsAndList();
  }

  function renderWinnerDatabase(winnerDbEl, winnerDb) {
    winnerDbEl.replaceChildren();
    if (!winnerDb.length) {
      const empty = document.createElement('div');
      empty.className = 'cytube-tools-poll-history-analyzer-empty';
      empty.textContent = 'No winner entries in current filters.';
      winnerDbEl.appendChild(empty);
      return;
    }

    const aliasEntries = parseAliasRuleEntries(state.settings.aliasRulesText);
    winnerDb.slice(0, 120).forEach((entry) => {
      const details = document.createElement('details');
      details.className = 'cytube-tools-poll-history-analyzer-winner-entry';
      details.open = state.openWinnerGroups.has(entry.key);
      details.addEventListener('toggle', () => {
        if (details.open) {
          state.openWinnerGroups.add(entry.key);
        } else {
          state.openWinnerGroups.delete(entry.key);
        }
      });

      const summary = document.createElement('summary');
      summary.className = 'cytube-tools-poll-history-analyzer-winner-summary';
      const unknownLabel = !entry.known
        ? `Unknown: ${entry.rawWinners[0] || 'Unmapped Winner'}`
        : entry.label;
      summary.textContent = `${unknownLabel} (${entry.count})`;
      details.appendChild(summary);

      const controls = document.createElement('div');
      controls.className = 'cytube-tools-poll-history-analyzer-winner-controls';

      const mainInput = document.createElement('input');
      mainInput.type = 'text';
      mainInput.className = 'form-control';
      mainInput.value = entry.known ? entry.label : '';
      mainInput.placeholder = 'Main name';

      const aliasInput = document.createElement('input');
      aliasInput.type = 'text';
      aliasInput.className = 'form-control';
      aliasInput.value = buildAliasInputValueForEntry(entry, aliasEntries);
      aliasInput.placeholder = 'Aliases: a, b, c';

      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'btn btn-xs btn-primary';
      saveBtn.textContent = 'Save Name + Aliases';
      saveBtn.addEventListener('click', () => saveWinnerGroupAliases(entry, mainInput.value, aliasInput.value));

      const resetBtn = document.createElement('button');
      resetBtn.type = 'button';
      resetBtn.className = 'btn btn-xs btn-default';
      resetBtn.textContent = 'Reset';
      resetBtn.addEventListener('click', () => resetWinnerGroupAliases(entry));

      controls.appendChild(mainInput);
      controls.appendChild(aliasInput);
      controls.appendChild(saveBtn);
      controls.appendChild(resetBtn);
      details.appendChild(controls);

      const variants = document.createElement('div');
      variants.className = 'cytube-tools-poll-history-analyzer-winner-variants';
      variants.textContent = `Variants: ${entry.rawWinners.join(' | ')}`;
      details.appendChild(variants);

      const polls = document.createElement('div');
      polls.className = 'cytube-tools-poll-history-analyzer-winner-polls';
      const pollRows = entry.polls.slice(0, 150);
      if (!pollRows.length) {
        const emptyPolls = document.createElement('div');
        emptyPolls.className = 'cytube-tools-poll-history-analyzer-empty';
        emptyPolls.textContent = 'No polls in current filters yet.';
        polls.appendChild(emptyPolls);
      }
      pollRows.forEach((poll) => {
        const row = document.createElement('div');
        row.className = 'cytube-tools-poll-history-analyzer-winner-poll-row';

        const meta = document.createElement('div');
        meta.className = 'cytube-tools-poll-history-analyzer-winner-poll-meta';
        meta.textContent = `${new Date(poll.createdAt).toLocaleString()} | ${poll.winnerMode.toUpperCase()} | ${poll.source}`;

        const title = document.createElement('div');
        title.className = 'cytube-tools-poll-history-analyzer-winner-poll-title';
        title.textContent = poll.title;

        const options = document.createElement('div');
        options.className = 'cytube-tools-poll-history-analyzer-winner-poll-options';
        options.textContent = poll.options.join(' | ');

        row.appendChild(meta);
        row.appendChild(title);
        row.appendChild(options);
        polls.appendChild(row);
      });
      details.appendChild(polls);
      winnerDbEl.appendChild(details);
    });
  }

  function renderRecordList(listEl, filtered) {
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
      time.textContent = new Date(record.createdAt).toLocaleString();

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

  function renderStatsAndList() {
    const statsEl = document.getElementById(UI_IDS.stats);
    const winnerDbEl = document.getElementById(UI_IDS.winnerDb);
    const listEl = document.getElementById(UI_IDS.list);
    if (!statsEl || !winnerDbEl || !listEl) {
      return;
    }

    const filtered = getFilteredRecords();
    const winnerCounts = new Map();
    const tagCounts = new Map();
    const winnerDb = buildWinnerDatabase(filtered);
    winnerDb.forEach((entry) => {
      if (entry.count <= 0) {
        return;
      }
      winnerCounts.set(entry.label, (winnerCounts.get(entry.label) || 0) + entry.count);
    });

    filtered.forEach((record) => {
      record.options.forEach((option) => {
        option.tags.forEach((tag) => {
          tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
        });
      });
    });

    const topWinners = Array.from(winnerCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, count]) => `${name} (${count})`)
      .join(', ');

    const topTags = Array.from(tagCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([tag, count]) => `${tag} (${count})`)
      .join(', ');

    statsEl.textContent = [
      `Total records: ${state.records.length}`,
      `Filtered: ${filtered.length}`,
      `Winner groups: ${winnerDb.length}`,
      `Top winners: ${topWinners || 'n/a'}`,
      `Top tags: ${topTags || 'n/a'}`
    ].join('  |  ');

    renderWinnerDatabase(winnerDbEl, winnerDb);
    renderRecordList(listEl, filtered);
  }

  function clearRecords() {
    state.records = [];
    state.recordHashes = new Set();
    state.openWinnerGroups.clear();
    persistRecords();
    renderStatsAndList();
  }

  function exportRecords() {
    const filtered = getFilteredRecords();
    const payload = {
      exportedAt: new Date().toISOString(),
      settings: state.settings,
      records: filtered,
      winnerDatabase: buildWinnerDatabase(filtered).map((entry) => ({
        key: entry.key,
        label: entry.label,
        count: entry.count,
        rawWinners: entry.rawWinners,
        polls: entry.polls
      }))
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
    runtimeAliasData = parseAliasRules(state.settings.aliasRulesText);
    persistSettings();
    rebuildRecordsFromAliasData();
    renderStatsAndList();
  }

  function syncAliasRulesTextarea() {
    const aliasEl = document.getElementById(UI_IDS.aliasRules);
    if (!(aliasEl instanceof HTMLTextAreaElement)) {
      return;
    }
    aliasEl.value = state.settings.aliasRulesText;
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
    persistRecords();
    renderPanel();
    toolsUi.button.addEventListener('click', togglePanel);
    toolsUi.button.classList.toggle('active', state.panelVisible);
    syncTrackingState();
  })();
})();
