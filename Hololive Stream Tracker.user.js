// ==UserScript==
// @name Hololive Stream Tracker
// @namespace holodex.tracker
// @version 2.7.0
// @description Shows streams
// @match https://om3tcw.com/r/*
// @grant GM_xmlhttpRequest
// @grant GM_addStyle
// @grant GM_setValue
// @grant GM_getValue
// @connect holodex.net
// ==/UserScript==

(function () {
  'use strict';

  // --- API Configuration ---
  let API_KEY = GM_getValue('holodex_api_key');
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

  const KEYWORD_REGEXES = KEYWORDS.map(kw => new RegExp(kw.replace(/[-_\\s]+/g, '[-_\\\\s]+'), 'i'));

  let currentStreams = [];
  let currentFilter = 'All';
  let showUpcomingOnly = false;

  // --- Helper Functions ---

  function checkApiKey() {
    if (!API_KEY) {
      const key = prompt('Please enter your Holodex API Key:\n(Found in Settings -> API Key on holodex.net)');
      if (key) {
        GM_setValue('holodex_api_key', key);
        API_KEY = key;
        return true;
      }
      return false;
    }
    return true;
  }

  function resetApiKey() {
    if (confirm('Do you want to reset your Holodex API Key?')) {
      GM_setValue('holodex_api_key', '');
      API_KEY = '';
      fetchUpcomingStreams();
    }
  }

  function isHololive(channel) {
    if (!channel) return false;
    const name = (channel.name || '').toLowerCase();
    const enName = (channel.english_name || '').toLowerCase();
    const org = (channel.org || '').toLowerCase();
    const suborg = (channel.suborg || '').toLowerCase();

    const isHolostars = /holostars/i.test(name + enName + org + suborg) || /ホロスターズ/i.test(name);
    if (isHolostars) return false;

    return (
      org.includes('hololive') || suborg.includes('hololive') ||
      name.includes('hololive') || enName.includes('hololive') ||
      /hololive[-_\\s]*(en|id|jp|english|indonesia|justice)/i.test(name + enName + org + suborg)
    );
  }

  function formatUKDate(dateString) {
    const d = new Date(dateString);
    return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()} - ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function formatTimeUntil(video) {
    const isLive = video.status === 'live' || video.start_actual;
    const now = new Date();

    if (isLive) {
      const start = new Date(video.start_actual || video.start_scheduled || video.available_at);
      const diffMs = Math.max(0, now - start); // Ensure no negative time

      const totalMinutes = Math.floor(diffMs / 60000);
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;

      // Format: [Live for HH:MM]
      return `[${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}]`;
    }

    const target = new Date(video.start_scheduled || video.available_at);
    let diffMs = target - now;
    if (diffMs < 0) return '[past]';
    const days = Math.floor(diffMs / 86400000);
    const hours = Math.floor((diffMs % 86400000) / 3600000);
    const minutes = Math.floor((diffMs % 3600000) / 60000);
    let parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (days > 0 || hours > 0) parts.push(`${hours}h`);
    parts.push(`${minutes.toString().padStart(2, '0')}m`);
    return `[${parts.join(' ')}]`;
  }

  function getStreamTag(video) {
    for (const kw of KEYWORDS) {
      const rx = KEYWORD_REGEXES[KEYWORDS.indexOf(kw)];
      if (rx.test(video.title || '') || rx.test(video.topic_id || '') || rx.test(video.description || '')) {
        return TAG_MAP[kw] || kw;
      }
    }
    return video.type === 'premiere' ? 'Premiere' : '';
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
        return isHololive(v.channel) && v.status !== 'past';
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
    const old = document.getElementById('holodex-overlay');
    if (old) old.remove();

    const box = document.createElement('div');
    box.id = 'holodex-overlay';

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

    controls.append(upcomingLabel, select, refreshBtn, resetBtn);
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

    document.getElementById('tools-content-area').appendChild(box);
  }

  function createToggleButton() {
    const container = document.getElementById('tools-button-container');
    if (!container) {
      setTimeout(createToggleButton, 500);
      return;
    }
    const btn = document.createElement('button');
    btn.id = 'holodex-toggle-btn';
    btn.textContent = '🎤';
    btn.classList.add('btn', 'btn-sm', 'btn-default');
    btn.style.marginLeft = '5px';

    btn.addEventListener('click', () => {
      const overlay = document.getElementById('holodex-overlay');
      if (overlay) {
        overlay.remove();
        btn.classList.remove('active');
      } else {
        btn.classList.add('active');
        if (typeof $ !== 'undefined') {
            $('#channelsettings').modal('show');
            $('a[href="#toolsTab"]').tab('show');
        }
        fetchUpcomingStreams();
      }
    });
    container.appendChild(btn);
  }

  GM_addStyle(`
    #holodex-overlay { background: rgba(20,20,20,0.95); color: #fff; border-radius: 10px; padding: 12px; font-family: sans-serif; font-size: 13px; margin-bottom: 10px; border: 1px solid #444; }
    #holodex-overlay h3 { margin: 0; font-size: 14px; color: #6c5ce7; }
    #holodex-overlay ul { margin: 8px 0 0 0; padding-left: 18px; max-height: 450px; overflow-y: auto; list-style-type: disc; }
    #holodex-overlay li { margin-bottom: 8px; border-bottom: 1px solid #333; padding-bottom: 4px; }
    #holodex-overlay a:hover { text-decoration: underline !important; color: #6c5ce7 !important; }
    #holodex-toggle-btn.active { background: #6c5ce7 !important; color: white; }
    #holodex-overlay select, #holodex-overlay button { background: #333; color: #fff; border: 1px solid #555; border-radius: 4px; padding: 2px 5px; cursor: pointer; }
    #upcoming-toggle { margin-right: 4px; }
  `);

  createToggleButton();
})();