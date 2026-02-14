// ==UserScript==
// @name         Cytube User Tags
// @namespace    cytube.user.tags
// @version      1.1
// @description  Local user tags and notes for chat and user list
// @match        https://om3tcw.com/r/*
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function() {
  'use strict';

  const TOGGLE_ID = 'user-tags-toggle';
  const PANEL_ID = 'cytube-tools-user-tags-panel';
  const PANEL_CLASS = 'cytube-tools-user-tags-panel';
  const INLINE_CLASS = 'cytube-tools-user-tags-inline';
  const CLICKABLE_CLASS = 'cytube-tools-user-tags-clickable';
  const RETRY_DELAY_MS = 500;
  const MAX_RETRIES = 120;
  const NOTE_MAX_LENGTH = 500;
  const PROCESSED_CHAT_ATTR = 'data-cytube-tools-user-tags-chat-processed';
  const PROCESSED_USER_ATTR = 'data-cytube-tools-user-tags-user-processed';

  const STORAGE_KEYS = {
    enabled: 'cytube:user-tags:enabled',
    data: 'cytube:user-tags:data'
  };

  const UI_IDS = {
    enabled: 'cytube-tools-user-tags-enabled',
    username: 'cytube-tools-user-tags-username',
    tags: 'cytube-tools-user-tags-tags',
    color: 'cytube-tools-user-tags-color',
    note: 'cytube-tools-user-tags-note',
    save: 'cytube-tools-user-tags-save',
    reset: 'cytube-tools-user-tags-reset',
    search: 'cytube-tools-user-tags-search',
    list: 'cytube-tools-user-tags-list',
    json: 'cytube-tools-user-tags-json',
    export: 'cytube-tools-user-tags-export',
    import: 'cytube-tools-user-tags-import'
  };

  const DEFAULT_COLOR = '#5bc0de';

  const state = {
    enabled: Boolean(safeGetValue(STORAGE_KEYS.enabled, true)),
    tagsData: loadTagsData(),
    panelVisible: false,
    searchTerm: '',
    chatObserver: null,
    userObserver: null,
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

  function normalizeUsername(name) {
    return String(name || '').trim().toLowerCase();
  }

  function normalizeColor(color, fallback = DEFAULT_COLOR) {
    const text = String(color || '').trim();
    const shortHex = /^#([0-9a-fA-F]{3})$/;
    const longHex = /^#([0-9a-fA-F]{6})$/;
    if (longHex.test(text)) {
      return text.toLowerCase();
    }
    const shortMatch = text.match(shortHex);
    if (shortMatch) {
      const [r, g, b] = shortMatch[1].split('');
      return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
    }
    return fallback;
  }

  function sanitizeTags(tags) {
    const clean = [];
    const seen = new Set();
    (Array.isArray(tags) ? tags : []).forEach((tag) => {
      const label = String(tag?.label || '').trim();
      if (!label) {
        return;
      }
      const key = label.toLowerCase();
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      clean.push({
        label,
        color: normalizeColor(tag?.color, DEFAULT_COLOR)
      });
    });
    return clean;
  }

  function sanitizeEntry(rawKey, rawEntry) {
    const displayName = String(rawEntry?.displayName || rawKey || '').trim();
    const normalized = normalizeUsername(displayName || rawKey);
    if (!normalized) {
      return null;
    }
    const tags = sanitizeTags(rawEntry?.tags);
    const note = String(rawEntry?.note || '').trim().slice(0, NOTE_MAX_LENGTH);
    if (!tags.length && !note) {
      return null;
    }
    return {
      key: normalized,
      value: {
        displayName: displayName || rawKey,
        tags,
        note,
        updatedAt: Number(rawEntry?.updatedAt) || Date.now()
      }
    };
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

  function loadTagsData() {
    const raw = safeGetValue(STORAGE_KEYS.data, {});
    const parsed = parseStoredObject(raw);
    const clean = {};
    Object.entries(parsed).forEach(([key, value]) => {
      const sanitized = sanitizeEntry(key, value);
      if (!sanitized) {
        return;
      }
      clean[sanitized.key] = sanitized.value;
    });
    return clean;
  }

  function persistTagsData() {
    safeSetValue(STORAGE_KEYS.data, JSON.stringify(state.tagsData));
  }

  function persistEnabled() {
    safeSetValue(STORAGE_KEYS.enabled, state.enabled);
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
      button.textContent = '🏷️';
      button.title = 'Toggle User Tags Panel';
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

  function parseTagsInput(raw, defaultColor) {
    const tokens = String(raw || '').split(/[\n,]/g);
    const tags = [];
    const seen = new Set();

    tokens.forEach((token) => {
      const trimmed = token.trim();
      if (!trimmed) {
        return;
      }

      let label = trimmed;
      let color = defaultColor;

      const pipeIndex = trimmed.indexOf('|');
      if (pipeIndex > -1) {
        label = trimmed.slice(0, pipeIndex).trim();
        color = normalizeColor(trimmed.slice(pipeIndex + 1).trim(), defaultColor);
      }

      if (!label) {
        return;
      }
      const key = label.toLowerCase();
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      tags.push({ label, color });
    });

    return tags;
  }

  function setEntry(username, tags, note) {
    const displayName = String(username || '').trim();
    const normalized = normalizeUsername(displayName);
    if (!normalized) {
      return;
    }

    const cleanTags = sanitizeTags(tags);
    const cleanNote = String(note || '').trim().slice(0, NOTE_MAX_LENGTH);

    if (!cleanTags.length && !cleanNote) {
      delete state.tagsData[normalized];
      return;
    }

    state.tagsData[normalized] = {
      displayName,
      tags: cleanTags,
      note: cleanNote,
      updatedAt: Date.now()
    };
  }

  function getEntry(username) {
    return state.tagsData[normalizeUsername(username)] || null;
  }

  function clearAllInlineBadges() {
    document.querySelectorAll(`.${INLINE_CLASS}`).forEach((node) => node.remove());
  }

  function createInlineContainer(entry) {
    const container = document.createElement('span');
    container.className = INLINE_CLASS;
    container.dataset.userTagsUser = entry.displayName;

    entry.tags.forEach((tag) => {
      const badge = document.createElement('span');
      badge.className = `cytube-tools-user-tags-badge ${CLICKABLE_CLASS}`;
      badge.dataset.userTagsUser = entry.displayName;
      badge.textContent = tag.label;
      badge.style.backgroundColor = normalizeColor(tag.color, DEFAULT_COLOR);
      container.appendChild(badge);
    });

    if (entry.note) {
      const note = document.createElement('span');
      note.className = `cytube-tools-user-tags-note ${CLICKABLE_CLASS}`;
      note.dataset.userTagsUser = entry.displayName;
      note.title = entry.note;
      note.textContent = '📝';
      container.appendChild(note);
    }

    return container;
  }

  function removeInlineFromRow(row) {
    row.querySelectorAll(`.${INLINE_CLASS}`).forEach((node) => node.remove());
  }

  function isInlineMutationNode(node) {
    return node instanceof HTMLElement && (node.classList.contains(INLINE_CLASS) || node.closest(`.${INLINE_CLASS}`));
  }

  function extractChatUsername(row) {
    const usernameEl = row.querySelector('strong.username');
    if (!usernameEl) {
      return '';
    }
    return usernameEl.textContent.replace(/:\s*$/, '').trim();
  }

  function renderChatRow(row) {
    if (!(row instanceof HTMLElement)) {
      return;
    }
    removeInlineFromRow(row);
    row.setAttribute(PROCESSED_CHAT_ATTR, '1');
    if (!state.enabled) {
      return;
    }

    const username = extractChatUsername(row);
    if (!username) {
      return;
    }
    const entry = getEntry(username);
    if (!entry) {
      return;
    }

    const usernameEl = row.querySelector('strong.username');
    if (!usernameEl) {
      return;
    }
    const container = createInlineContainer(entry);
    usernameEl.insertAdjacentElement('afterend', container);
  }

  function getUserListNameAndAnchor(row) {
    const spans = Array.from(row.children).filter((node) => node instanceof HTMLSpanElement);
    for (const span of spans) {
      if (span.querySelector('.glyphicon-time')) {
        continue;
      }
      const text = span.textContent.replace(/\s+/g, ' ').trim();
      if (!text) {
        continue;
      }
      return { username: text, anchor: span };
    }
    return null;
  }

  function renderUserListRow(row) {
    if (!(row instanceof HTMLElement)) {
      return;
    }
    removeInlineFromRow(row);
    row.setAttribute(PROCESSED_USER_ATTR, '1');
    if (!state.enabled) {
      return;
    }

    const data = getUserListNameAndAnchor(row);
    if (!data) {
      return;
    }
    const entry = getEntry(data.username);
    if (!entry) {
      return;
    }

    const container = createInlineContainer(entry);
    data.anchor.insertAdjacentElement('afterend', container);
  }

  function renderAllInline() {
    clearAllInlineBadges();
    if (!state.enabled) {
      return;
    }
    document.querySelectorAll('#messagebuffer > div').forEach((row) => renderChatRow(row));
    document.querySelectorAll('#userlist .userlist_item').forEach((row) => renderUserListRow(row));
  }

  function stopObservers() {
    if (state.chatObserver) {
      state.chatObserver.disconnect();
      state.chatObserver = null;
    }
    if (state.userObserver) {
      state.userObserver.disconnect();
      state.userObserver = null;
    }
  }

  function startChatObserver() {
    if (state.chatObserver) {
      return true;
    }
    const messageBuffer = document.querySelector('#messagebuffer');
    if (!messageBuffer) {
      return false;
    }
    state.chatObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) {
            return;
          }
          if (node.parentElement?.id !== 'messagebuffer') {
            return;
          }
          renderChatRow(node);
        });
      });
    });
    state.chatObserver.observe(messageBuffer, { childList: true });
    return true;
  }

  function startUserObserver() {
    if (state.userObserver) {
      return true;
    }
    const userList = document.querySelector('#userlist');
    if (!userList) {
      return false;
    }
    state.userObserver = new MutationObserver((mutations) => {
      const dirtyRows = new Set();
      mutations.forEach((mutation) => {
        const targetRow = mutation.target instanceof HTMLElement ? mutation.target.closest('.userlist_item') : null;
        const markRowIfRelevant = (node) => {
          if (isInlineMutationNode(node)) {
            return;
          }
          if (node instanceof HTMLElement) {
            if (node.classList.contains('userlist_item')) {
              dirtyRows.add(node);
              return;
            }
            const row = node.closest('.userlist_item');
            if (row) {
              dirtyRows.add(row);
            }
            return;
          }
          if (targetRow) {
            dirtyRows.add(targetRow);
          }
        };

        mutation.addedNodes.forEach(markRowIfRelevant);
        mutation.removedNodes.forEach(markRowIfRelevant);
      });
      dirtyRows.forEach((row) => renderUserListRow(row));
    });
    state.userObserver.observe(userList, { childList: true, subtree: true });
    return true;
  }

  function syncObservers() {
    if (!state.enabled) {
      stopObservers();
      clearAllInlineBadges();
      return;
    }

    const chatReady = startChatObserver();
    const userReady = startUserObserver();
    if (chatReady && userReady) {
      renderAllInline();
      return;
    }

    waitForEl('#messagebuffer').then(() => {
      if (state.enabled) {
        startChatObserver();
        renderAllInline();
      }
    });
    waitForEl('#userlist').then(() => {
      if (state.enabled) {
        startUserObserver();
        renderAllInline();
      }
    });
  }

  function fillForm(username = '') {
    const usernameInput = document.getElementById(UI_IDS.username);
    const tagsInput = document.getElementById(UI_IDS.tags);
    const colorInput = document.getElementById(UI_IDS.color);
    const noteInput = document.getElementById(UI_IDS.note);
    if (!usernameInput || !tagsInput || !colorInput || !noteInput) {
      return;
    }

    const entry = getEntry(username);
    if (!entry) {
      usernameInput.value = username;
      tagsInput.value = '';
      colorInput.value = DEFAULT_COLOR;
      noteInput.value = '';
      return;
    }

    usernameInput.value = entry.displayName;
    tagsInput.value = entry.tags.map((tag) => `${tag.label}|${normalizeColor(tag.color, DEFAULT_COLOR)}`).join(', ');
    colorInput.value = entry.tags[0] ? normalizeColor(entry.tags[0].color, DEFAULT_COLOR) : DEFAULT_COLOR;
    noteInput.value = entry.note || '';
  }

  function saveFromForm() {
    const usernameInput = document.getElementById(UI_IDS.username);
    const tagsInput = document.getElementById(UI_IDS.tags);
    const colorInput = document.getElementById(UI_IDS.color);
    const noteInput = document.getElementById(UI_IDS.note);
    if (!usernameInput || !tagsInput || !colorInput || !noteInput) {
      return;
    }

    const username = usernameInput.value.trim();
    if (!username) {
      return;
    }
    const tags = parseTagsInput(tagsInput.value, normalizeColor(colorInput.value, DEFAULT_COLOR));
    const note = noteInput.value.trim().slice(0, NOTE_MAX_LENGTH);
    setEntry(username, tags, note);
    persistTagsData();
    renderEntriesList();
    renderAllInline();
    fillForm(username);
  }

  function resetForm() {
    fillForm('');
  }

  function renderEntriesList() {
    const listEl = document.getElementById(UI_IDS.list);
    if (!listEl) {
      return;
    }

    listEl.replaceChildren();

    const entries = Object.values(state.tagsData)
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
      .filter((entry) => {
        if (!state.searchTerm) {
          return true;
        }
        const haystack = [
          entry.displayName,
          entry.note,
          ...entry.tags.map((tag) => tag.label)
        ].join(' ').toLowerCase();
        return haystack.includes(state.searchTerm);
      });

    if (!entries.length) {
      const empty = document.createElement('div');
      empty.className = 'cytube-tools-user-tags-empty';
      empty.textContent = 'No tagged users.';
      listEl.appendChild(empty);
      return;
    }

    entries.forEach((entry) => {
      const row = document.createElement('div');
      row.className = 'cytube-tools-user-tags-row';

      const header = document.createElement('div');
      header.className = 'cytube-tools-user-tags-row-header';

      const name = document.createElement('span');
      name.className = 'cytube-tools-user-tags-name';
      name.textContent = entry.displayName;

      const actions = document.createElement('div');
      actions.className = 'cytube-tools-user-tags-actions';

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'btn btn-xs btn-default';
      editBtn.textContent = 'Edit';
      editBtn.dataset.action = 'edit';
      editBtn.dataset.user = entry.displayName;

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'btn btn-xs btn-danger';
      deleteBtn.textContent = 'Delete';
      deleteBtn.dataset.action = 'delete';
      deleteBtn.dataset.user = entry.displayName;

      actions.appendChild(editBtn);
      actions.appendChild(deleteBtn);
      header.appendChild(name);
      header.appendChild(actions);

      const tagsWrap = document.createElement('div');
      tagsWrap.className = 'cytube-tools-user-tags-row-tags';
      entry.tags.forEach((tag) => {
        const tagNode = document.createElement('span');
        tagNode.className = 'cytube-tools-user-tags-row-tag';
        tagNode.textContent = tag.label;
        tagNode.style.backgroundColor = normalizeColor(tag.color, DEFAULT_COLOR);
        tagsWrap.appendChild(tagNode);
      });

      row.appendChild(header);
      row.appendChild(tagsWrap);

      if (entry.note) {
        const note = document.createElement('div');
        note.className = 'cytube-tools-user-tags-row-note';
        note.textContent = entry.note;
        row.appendChild(note);
      }

      listEl.appendChild(row);
    });
  }

  function exportDataToTextArea() {
    const area = document.getElementById(UI_IDS.json);
    if (!area) {
      return;
    }
    area.value = JSON.stringify(state.tagsData, null, 2);
  }

  function importDataFromTextArea() {
    const area = document.getElementById(UI_IDS.json);
    if (!area) {
      return;
    }
    const raw = area.value.trim();
    if (!raw) {
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      return;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return;
    }

    const clean = {};
    Object.entries(parsed).forEach(([key, value]) => {
      const sanitized = sanitizeEntry(key, value);
      if (!sanitized) {
        return;
      }
      clean[sanitized.key] = sanitized.value;
    });
    state.tagsData = clean;
    persistTagsData();
    renderEntriesList();
    renderAllInline();
  }

  function ensurePanelVisible() {
    if (!state.ui.panel || !state.ui.button) {
      return;
    }
    openToolsTab();
    state.panelVisible = true;
    state.ui.panel.style.display = 'block';
    state.ui.button.classList.add('active');
  }

  function handleInlineBadgeClick(event) {
    const clickable = event.target.closest(`.${CLICKABLE_CLASS}`);
    if (!clickable) {
      return;
    }
    const username = clickable.dataset.userTagsUser;
    if (!username) {
      return;
    }
    ensurePanelVisible();
    fillForm(username);
  }

  function bindPanelEvents() {
    const enabledInput = document.getElementById(UI_IDS.enabled);
    const saveBtn = document.getElementById(UI_IDS.save);
    const resetBtn = document.getElementById(UI_IDS.reset);
    const searchInput = document.getElementById(UI_IDS.search);
    const listEl = document.getElementById(UI_IDS.list);
    const exportBtn = document.getElementById(UI_IDS.export);
    const importBtn = document.getElementById(UI_IDS.import);

    if (enabledInput) {
      enabledInput.checked = state.enabled;
      enabledInput.addEventListener('change', () => {
        state.enabled = enabledInput.checked;
        persistEnabled();
        syncObservers();
      });
    }

    if (saveBtn) {
      saveBtn.addEventListener('click', saveFromForm);
    }
    if (resetBtn) {
      resetBtn.addEventListener('click', resetForm);
    }
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        state.searchTerm = searchInput.value.trim().toLowerCase();
        renderEntriesList();
      });
    }
    if (exportBtn) {
      exportBtn.addEventListener('click', exportDataToTextArea);
    }
    if (importBtn) {
      importBtn.addEventListener('click', importDataFromTextArea);
    }

    if (listEl) {
      listEl.addEventListener('click', (event) => {
        const actionBtn = event.target.closest('button[data-action][data-user]');
        if (!actionBtn) {
          return;
        }
        const action = actionBtn.dataset.action;
        const username = actionBtn.dataset.user;
        if (!username) {
          return;
        }
        if (action === 'edit') {
          fillForm(username);
          return;
        }
        if (action === 'delete') {
          delete state.tagsData[normalizeUsername(username)];
          persistTagsData();
          renderEntriesList();
          renderAllInline();
          const currentUser = document.getElementById(UI_IDS.username)?.value.trim();
          if (normalizeUsername(currentUser) === normalizeUsername(username)) {
            resetForm();
          }
        }
      });
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
    state.ui.panel.innerHTML = `
      <div class="cytube-tools-user-tags-head"><strong>User Tags</strong></div>
      <label class="cytube-tools-user-tags-line">
        <input type="checkbox" id="${UI_IDS.enabled}">
        Enable inline tags
      </label>

      <div class="cytube-tools-user-tags-form">
        <input id="${UI_IDS.username}" class="form-control" type="text" placeholder="Username">
        <input id="${UI_IDS.tags}" class="form-control" type="text" placeholder="Tags (example: TL|#4caf50, clipper|#ff9800)">
        <label class="cytube-tools-user-tags-line">
          Default tag color
          <input id="${UI_IDS.color}" type="color" value="${DEFAULT_COLOR}">
        </label>
        <textarea id="${UI_IDS.note}" class="form-control" rows="2" placeholder="Optional note"></textarea>
        <div class="cytube-tools-user-tags-actions">
          <button type="button" class="btn btn-sm btn-primary" id="${UI_IDS.save}">Save</button>
          <button type="button" class="btn btn-sm btn-default" id="${UI_IDS.reset}">Clear Form</button>
        </div>
      </div>

      <input id="${UI_IDS.search}" class="form-control cytube-tools-user-tags-search" type="text" placeholder="Search users/tags/notes">
      <div id="${UI_IDS.list}" class="cytube-tools-user-tags-list"></div>

      <div class="cytube-tools-user-tags-subhead"><strong>Import / Export</strong></div>
      <textarea id="${UI_IDS.json}" class="form-control" rows="4" placeholder="JSON data"></textarea>
      <div class="cytube-tools-user-tags-actions">
        <button type="button" class="btn btn-sm btn-default" id="${UI_IDS.export}">Export</button>
        <button type="button" class="btn btn-sm btn-default" id="${UI_IDS.import}">Import</button>
      </div>
    `;
    bindPanelEvents();
    resetForm();
    renderEntriesList();
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
    .cytube-tools-user-tags-head {
      margin-bottom: 8px;
      font-size: 14px;
    }
    .cytube-tools-user-tags-subhead {
      margin: 10px 0 6px;
      font-size: 13px;
    }
    .cytube-tools-user-tags-line {
      display: block;
      margin-bottom: 8px;
      font-weight: normal;
    }
    .cytube-tools-user-tags-form {
      display: grid;
      gap: 6px;
      margin-bottom: 10px;
    }
    .cytube-tools-user-tags-actions {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      margin-top: 2px;
      margin-bottom: 8px;
    }
    .cytube-tools-user-tags-search {
      margin-bottom: 8px;
    }
    .cytube-tools-user-tags-list {
      max-height: 280px;
      overflow-y: auto;
      border: 1px solid #2d2d2d;
      border-radius: 4px;
      background: #171717;
      padding: 6px;
    }
    .cytube-tools-user-tags-row {
      border-bottom: 1px solid #2d2d2d;
      padding: 6px 0;
    }
    .cytube-tools-user-tags-row:last-child {
      border-bottom: none;
    }
    .cytube-tools-user-tags-row-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      margin-bottom: 4px;
    }
    .cytube-tools-user-tags-name {
      font-weight: 700;
      color: #f1f3f4;
    }
    .cytube-tools-user-tags-actions {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }
    .cytube-tools-user-tags-row-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    .cytube-tools-user-tags-row-tag {
      padding: 1px 6px;
      border-radius: 12px;
      font-size: 11px;
      color: #111;
      font-weight: 700;
    }
    .cytube-tools-user-tags-row-note {
      margin-top: 4px;
      color: #c6cad1;
      font-size: 12px;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .cytube-tools-user-tags-empty {
      color: #8a8a8a;
      font-style: italic;
    }
    .${INLINE_CLASS} {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-left: 6px;
      vertical-align: middle;
      flex-wrap: wrap;
    }
    .cytube-tools-user-tags-badge {
      padding: 1px 6px;
      border-radius: 12px;
      font-size: 10px;
      font-weight: 700;
      color: #111;
      cursor: pointer;
    }
    .cytube-tools-user-tags-note {
      cursor: pointer;
      font-size: 12px;
      line-height: 1;
      color: #ffd166;
    }
  `);

  (async () => {
    const toolsUi = await ensureToolsUi();
    if (!toolsUi) {
      return;
    }
    renderPanel();
    toolsUi.button.addEventListener('click', togglePanel);
    document.addEventListener('click', handleInlineBadgeClick);
    syncObservers();
  })();
})();
