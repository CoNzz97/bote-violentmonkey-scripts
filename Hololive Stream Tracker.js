// ==UserScript==
// @name Hololive Stream Tracker
// @namespace holodex.tracker
// @version 2.9.0
// @description Shows streams
// @match https://om3tcw.com/r/*
// @require https://conzz97.github.io/bote-violentmonkey-scripts/lib/hololive-stream-tracker/utils.js
// @grant GM_xmlhttpRequest
// @grant GM_addStyle
// @grant GM_getResourceText
// @grant GM_setValue
// @grant GM_getValue
// @resource hololiveStreamTrackerStyles https://conzz97.github.io/bote-violentmonkey-scripts/assets/hololive-stream-tracker/styles.css
// @connect holodex.net
// ==/UserScript==

(function () {
  'use strict';

  // --- API Configuration ---
  const STORAGE_KEYS = {
    apiKey: 'holodex_api_key',
    includeMales: 'holodex_include_males'
  };
  const IDS = {
    overlay: 'holodex-overlay',
    toggleButton: 'holodex-toggle-btn'
  };
  const RETRY_DELAY_MS = 500;
  const MAX_RETRIES = 120;
  const RESOURCE_NAMES = {
    styles: 'hololiveStreamTrackerStyles'
  };

  const hololiveUtils = window.CytubeHololiveStreamTrackerUtils;
  if (!hololiveUtils) {
    return;
  }

  let API_KEY = GM_getValue(STORAGE_KEYS.apiKey);
  const API_BASE = 'https://holodex.net/api/v2';
  const MAX_UPCOMING = 75;

  const KEYWORDS = [
    '3D', 'karaoke', 'concert', 'ホロフェス', '歌枠',
    'Music_Cover', 'Birthday', 'Holofes', 'Original_Song', 'premiere',
    'Watchalong', 'Singing', 'Outfit Reveal',
    '生誕祭', '誕生日', '新衣装', 'Outfit', 'Watch-A-Long'
  ];

  const TAG_MAP = {
    '歌枠': 'Karaoke', 'ホロフェス': 'Holofes', '生誕祭': 'Birthday',
    '誕生日': 'Birthday', '新衣装': 'Outfit Reveal', 'Outfit': 'Outfit Reveal',
    '3D': '3D', 'karaoke': 'Karaoke', 'concert': 'Concert',
    'Music_Cover': 'Music Cover', 'Holofes': 'Holofes',
    'Original_Song': 'Original Song', 'premiere': 'Premiere',
    'Watchalong': 'Watchalong', 'Singing': 'Singing',
    'Outfit Reveal': 'Outfit Reveal', 'Watch-A-Long': 'Watchalong'
  };

  const FILTER_OPTIONS = [
    'All',
    ...['Karaoke', '3D', 'Watchalong', 'Birthday', 'Outfit Reveal', 'Premiere', 'Concert', 'Original Song', 'Music Cover', 'Holofes', 'Singing'].sort()
  ];

  const KEYWORD_REGEXES = hololiveUtils.buildKeywordRegexes(KEYWORDS);

  let currentStreams = [];
  let currentFilter = 'All';
  let showUpcomingOnly = false;
  let includeMales = hololiveUtils.parseBoolean(GM_getValue(STORAGE_KEYS.includeMales, false), false);

  // --- Helper Functions ---

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

  function checkApiKey() {
    if (!API_KEY) {
      const key = prompt('Please enter your Holodex API Key:\n(Found in Settings -> API Key on holodex.net)');
      if (key) {
        GM_setValue(STORAGE_KEYS.apiKey, key);
        API_KEY = key;
        return true;
      }
      return false;
    }
    return true;
  }

  function resetApiKey() {
    if (confirm('Do you want to reset your Holodex API Key?')) {
      GM_setValue(STORAGE_KEYS.apiKey, '');
      API_KEY = '';
      fetchUpcomingStreams();
    }
  }

  function isHololive(channel, allowHolostars = false) {
    return hololiveUtils.isHololive(channel, allowHolostars);
  }

  function formatUKDate(dateString) {
    return hololiveUtils.formatUKDate(dateString);
  }

  function formatTimeUntil(video) {
    return hololiveUtils.formatTimeUntil(video);
  }

  function getStreamTag(video) {
    return hololiveUtils.getStreamTag(video, KEYWORDS, KEYWORD_REGEXES, TAG_MAP);
  }

  // --- Core Logic ---

  function fetchUpcomingStreams() {
    if (!checkApiKey()) return;

    const nowStr = new Date().toISOString().split('T')[0] + 'T00:00:00Z';
    const urls = [
      `${API_BASE}/live?org=Hololive&limit=${MAX_UPCOMING}&sort=available_at&max_upcoming_hours=336`,
      `${API_BASE}/videos?status=upcoming&org=Hololive&limit=${MAX_UPCOMING}&sort=available_at&max_upcoming_hours=336&from=${nowStr}`
    ];

    Promise.all(urls.map(url => new Promise((resolve) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        headers: { 'X-APIKEY': API_KEY },
        onload: res => {
          try {
            const json = JSON.parse(res.responseText);
            resolve(Array.isArray(json) ? json : (json.data || []));
          } catch (e) { resolve([]); }
        },
        onerror: () => resolve([])
      });
    }))).then(results => {
      const combined = [...results[0], ...results[1]];
      const seen = new Set();

      const matches = combined.filter(v => {
        if (seen.has(v.id)) return false;
        seen.add(v.id);
        return isHololive(v.channel, includeMales) && v.status !== 'past';
      });

      // Sort: Live first, then by scheduled time
      matches.sort((a, b) => {
        const aLive = a.status === 'live' || a.start_actual;
        const bLive = b.status === 'live' || b.start_actual;
        if (aLive && !bLive) return -1;
        if (!aLive && bLive) return 1;
        return new Date(a.start_scheduled || a.available_at) - new Date(b.start_scheduled || b.available_at);
      });

      currentStreams = matches;
      renderOverlay();
    });
  }

  function renderOverlay() {
    const old = document.getElementById(IDS.overlay);
    if (old) old.remove();

    const box = document.createElement('div');
    box.id = IDS.overlay;

    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.marginBottom = '8px';

    let filteredStreams = currentStreams;
    if (currentFilter !== 'All') {
        filteredStreams = filteredStreams.filter(s => getStreamTag(s) === currentFilter);
    }
    if (showUpcomingOnly) {
        filteredStreams = filteredStreams.filter(s => s.status !== 'live' && !s.start_actual);
    }

    const title = document.createElement('h3');
    title.textContent = `Hololive Schedule (${filteredStreams.length})`;

    const controls = document.createElement('div');
    controls.style.display = 'flex';
    controls.style.alignItems = 'center';

    const includeMalesLabel = document.createElement('label');
    includeMalesLabel.style.fontSize = '11px';
    includeMalesLabel.style.marginRight = '8px';
    includeMalesLabel.style.cursor = 'pointer';
    includeMalesLabel.innerHTML = `<input type="checkbox" id="include-males-toggle" ${includeMales ? 'checked' : ''} style="vertical-align: middle;"> Include Males`;
    includeMalesLabel.querySelector('input').addEventListener('change', (e) => {
        includeMales = e.target.checked;
        GM_setValue(STORAGE_KEYS.includeMales, includeMales);
        fetchUpcomingStreams();
    });

    const upcomingLabel = document.createElement('label');
    upcomingLabel.style.fontSize = '11px';
    upcomingLabel.style.marginRight = '8px';
    upcomingLabel.style.cursor = 'pointer';
    upcomingLabel.innerHTML = `<input type="checkbox" id="upcoming-toggle" ${showUpcomingOnly ? 'checked' : ''} style="vertical-align: middle;"> Upcoming Only`;
    upcomingLabel.querySelector('input').addEventListener('change', (e) => {
        showUpcomingOnly = e.target.checked;
        renderOverlay();
    });

    const select = document.createElement('select');
    FILTER_OPTIONS.forEach(opt => {
      const option = document.createElement('option');
      option.value = opt;
      option.textContent = opt;
      select.appendChild(option);
    });
    select.value = currentFilter;
    select.addEventListener('change', (e) => {
      currentFilter = e.target.value;
      renderOverlay();
    });

    const refreshBtn = document.createElement('button');
    refreshBtn.textContent = '↻';
    refreshBtn.style.marginLeft = '5px';
    refreshBtn.addEventListener('click', fetchUpcomingStreams);

    const resetBtn = document.createElement('button');
    resetBtn.textContent = '🔑';
    resetBtn.style.marginLeft = '5px';
    resetBtn.addEventListener('click', resetApiKey);

    controls.append(includeMalesLabel, upcomingLabel, select, refreshBtn, resetBtn);
    header.append(title, controls);
    box.appendChild(header);

    if (filteredStreams.length) {
      const ul = document.createElement('ul');
      filteredStreams.forEach(v => {
        const time = v.start_scheduled || v.available_at;
        const tag = getStreamTag(v);
        const tagHTML = tag ? `<span style="color:#ff6b6b;font-weight:bold;margin-right:6px;">[${tag}]</span>` : '';
        const isLive = v.status === 'live' || v.start_actual;

        const li = document.createElement('li');
        li.innerHTML = `<a href="https://holodex.net/watch/${v.id}" target="_blank" style="color:#fff;text-decoration:none;">
          [${formatUKDate(time)}] <span style="color:${isLive ? '#ff4757' : '#a0e7a0'}; font-weight:${isLive ? 'bold' : 'normal'};">${formatTimeUntil(v)}</span>
          <b>${v.channel.name}</b> — ${tagHTML}${v.title}
        </a>`;
        ul.appendChild(li);
      });
      box.appendChild(ul);
    } else {
      const p = document.createElement('p');
      p.textContent = 'No matching streams.';
      box.appendChild(p);
    }

    const contentArea = document.getElementById('tools-content-area');
    if (!contentArea) {
      return;
    }
    contentArea.appendChild(box);
  }

  async function createToggleButton() {
    const container = await waitForEl('#tools-button-container');
    if (!container) {
      return;
    }
    if (document.getElementById(IDS.toggleButton)) {
      return;
    }
    const btn = document.createElement('button');
    btn.id = IDS.toggleButton;
    btn.textContent = '🎤';
    btn.classList.add('btn', 'btn-sm', 'btn-default');
    btn.style.marginLeft = '5px';

    btn.addEventListener('click', () => {
      const overlay = document.getElementById(IDS.overlay);
      if (overlay) {
        overlay.remove();
        btn.classList.remove('active');
      } else {
        btn.classList.add('active');
        openToolsTab();
        fetchUpcomingStreams();
      }
    });
    container.appendChild(btn);
  }

  const resourceCss = safeGetResourceText(RESOURCE_NAMES.styles, '');
  if (resourceCss) {
    GM_addStyle(resourceCss);
  } else {
    GM_addStyle(`
      #holodex-overlay { background: rgba(20,20,20,0.95); color: #fff; border-radius: 10px; padding: 12px; font-family: sans-serif; font-size: 13px; margin-bottom: 10px; border: 1px solid #444; }
      #holodex-overlay h3 { margin: 0; font-size: 14px; color: #6c5ce7; }
      #holodex-overlay ul { margin: 8px 0 0 0; padding-left: 18px; max-height: 450px; overflow-y: auto; list-style-type: disc; }
      #holodex-overlay li { margin-bottom: 8px; border-bottom: 1px solid #333; padding-bottom: 4px; }
      #holodex-overlay a:hover { text-decoration: underline !important; color: #6c5ce7 !important; }
      #holodex-toggle-btn.active { background: #6c5ce7 !important; color: white; }
      #holodex-overlay select, #holodex-overlay button { background: #333; color: #fff; border: 1px solid #555; border-radius: 4px; padding: 2px 5px; cursor: pointer; }
      #include-males-toggle, #upcoming-toggle { margin-right: 4px; }
    `);
  }

  createToggleButton();
})();
