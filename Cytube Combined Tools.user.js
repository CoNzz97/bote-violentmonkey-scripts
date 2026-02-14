```javascript
// ==UserScript==
// @name         Cytube Combined Tools
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Combined: Tools Tab, Emote Logger, Tweet & Media Preview, World Clock, Hololive Tracker
// @author       You + Grok
// @match        https://om3tcw.com/*
// @grant        GM_download
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @connect      holodex.net
// ==/UserScript==

(function() {
    'use strict';

    // Cytube Tools Tab code
    const init = () => {
        const tabList = document.querySelector('ul.nav.nav-tabs[role="tablist"]');
        if (!tabList) {
            setTimeout(init, 500);
            return;
        }

        if (document.querySelector('a[href="#toolsTab"]')) return;

        const newLi = document.createElement('li');
        newLi.setAttribute('role', 'presentation');
        const newA = document.createElement('a');
        newA.setAttribute('role', 'tab');
        newA.setAttribute('data-toggle', 'tab');
        newA.setAttribute('href', '#toolsTab');
        newA.textContent = 'Tools';
        newLi.appendChild(newA);
        tabList.appendChild(newLi);

        let tabContent = tabList.nextElementSibling;
        if (!tabContent || !tabContent.classList.contains('tab-content')) {
            tabContent = document.createElement('div');
            tabContent.classList.add('tab-content');
            tabList.parentNode.insertBefore(tabContent, tabList.nextSibling);
        }

        const newPane = document.createElement('div');
        newPane.setAttribute('role', 'tabpanel');
        newPane.classList.add('tab-pane');
        newPane.id = 'toolsTab';

        const buttonContainer = document.createElement('div');
        buttonContainer.id = 'tools-button-container';
        buttonContainer.style.padding = '10px';
        buttonContainer.style.display = 'flex';
        buttonContainer.style.flexWrap = 'wrap';
        buttonContainer.style.gap = '5px';
        newPane.appendChild(buttonContainer);

        const contentArea = document.createElement('div');
        contentArea.id = 'tools-content-area';
        contentArea.style.padding = '10px';
        contentArea.style.background = '#252525';
        contentArea.style.borderRadius = '4px';
        contentArea.style.overflowY = 'auto';
        contentArea.style.maxHeight = '400px';
        newPane.appendChild(contentArea);

        tabContent.appendChild(newPane);

        GM_addStyle(`
            #toolsTab {
                background: #1a1a1a;
                color: #ddd;
                min-height: 200px;
            }
            #tools-button-container button {
                margin: 0 !important;
            }
        `);
    };

    if (document.readyState === 'complete') {
        init();
    } else {
        window.addEventListener('load', init);
    }

    // Emote Logger code
    const CONFIG = {
        LOG_FILE_NAME: 'cytube_chatlog.txt',
        EMOTE_LOG_BASE_NAME: 'Cytube Emote Stats',
        MAX_MESSAGES_IN_MEMORY: 250,
        MAX_PREVIEW_MESSAGES: 250,
        CHAT_CONTAINER_SELECTOR: '#messagebuffer',
        MESSAGE_SELECTOR: '[class*="chat-msg-"]',
        IGNORE_CLASSES: ['server-msg', 'poll-notify'],
        AUTO_SAVE_INTERVAL: 30000,
        MAX_EMOTE_STATS: 10000,
        AUTO_REFRESH_STATS: 5000,
        ENABLE_PERFORMANCE_LOGGING: false,
        DEFAULT_DISPLAY_LIMITS: {
            globalStats: 2000,
            userStats: 100,
            topEmotesPerUser: 10,
            previewMessages: 250
        }
    };

    const perf = { operations: {} };

    function safeGMOperation(operation, defaultValue) {
        try { return operation(); } catch (e) { console.error('[Cytube Logger] Storage error:', e); return defaultValue; }
    }

    function logPerformance(operation, startTime) {
        if (!CONFIG.ENABLE_PERFORMANCE_LOGGING) return;
        const duration = Date.now() - startTime;
        if (!perf.operations[operation]) perf.operations[operation] = { count: 0, totalTime: 0, maxTime: 0 };
        perf.operations[operation].count++;
        perf.operations[operation].totalTime += duration;
        perf.operations[operation].maxTime = Math.max(perf.operations[operation].maxTime, duration);
    }

    const rawEmoteStats = safeGMOperation(() => GM_getValue('emoteStats', '{}'), '{}');
    const migratedStats = {};
    try {
        for (const [emote, data] of Object.entries(JSON.parse(rawEmoteStats))) {
            migratedStats[emote] = typeof data === 'number' ? { count: data, src: '' } : data;
        }
    } catch (e) { console.error('Error migrating emote stats:', e); }

    const rawUserEmoteStats = safeGMOperation(() => GM_getValue('userEmoteStats', '{}'), '{}');
    const rawDisplayLimits = safeGMOperation(() => GM_getValue('displayLimits', null), null);

    let state = {
        messages: safeGMOperation(() => JSON.parse(GM_getValue('chatMessages', '[]')), []),
        emoteStats: migratedStats,
        userEmoteStats: safeGMOperation(() => JSON.parse(rawUserEmoteStats), {}),
        previewWindow: null,
        statsWindow: null,
        settingsWindow: null,
        menuDiv: null,
        isPreviewVisible: false,
        isStatsVisible: false,
        isSettingsVisible: false,
        observer: null,
        saveInterval: null,
        statsRefreshInterval: null,
        lastSavedMessages: '',
        lastSavedStats: '',
        lastSavedUserStats: '',
        currentStatsTab: 'global',
        searchTerm: '',
        displayLimits: rawDisplayLimits ? JSON.parse(rawDisplayLimits) : CONFIG.DEFAULT_DISPLAY_LIMITS
    };

    const domCache = {
        chatContainer: null,
        previewContent: null,
        statsContent: null
    };

    function getUKTimestamp() {
        const now = new Date();
        const options = { timeZone: 'Europe/London', hour12: false };
        const time = now.toLocaleTimeString('en-GB', options).split(':');
        return `[${time[0].padStart(2, '0')}:${time[1]}:${time[2].split(' ')[0].padStart(2, '0')}]`;
    }

    const STATS_STYLES = `
        #cytube-logger-menu { background:#252525; padding:10px; border-radius:8px; margin-bottom:15px; display:none; }
        #cytube-logger-menu button { margin:0 5px 5px 0; }
        #cytube-chat-preview, #cytube-stats-preview, #cytube-logger-settings {
            background:#1a1a1a; border:1px solid #333; border-radius:8px; margin-bottom:15px;
            display:none; flex-direction:column; color:#ddd; font-family:Arial,sans-serif; max-height:500px; overflow:hidden;
        }
        .logger-header { padding:12px; background:#252525; border-bottom:1px solid #383838; display:flex; justify-content:space-between; align-items:center; }
        .logger-close { cursor:pointer; font-size:18px; }
        .logger-content { flex:1; overflow-y:auto; padding:12px; }
        .stats-tabs { display:flex; background:#2a2a2a; border-bottom:1px solid #383838; }
        .stats-tab { flex:1; padding:10px; text-align:center; cursor:pointer; border-bottom:2px solid transparent; }
        .stats-tab.active { border-bottom-color:#9C27B0; background:#333; color:#fff; }
        .stats-search { padding:8px 12px; background:#252525; border-bottom:1px solid #383838; }
        .stats-search input { width:100%; padding:6px; background:#2a2a2a; border:1px solid #383838; border-radius:4px; color:#ddd; }
        .cytube-stats-emote-row { display:flex; align-items:center; gap:8px; margin-bottom:6px; padding:6px; background:#2a2a2a; border-radius:4px; }
        .cytube-stats-emote-img { width:50px; height:50px; object-fit:contain; flex-shrink:0; }
        .user-stats-row { margin-bottom:12px; padding:8px; background:#2a2a2a; border-radius:4px; }
        .user-stats-header { font-weight:bold; margin-bottom:6px; }
        .user-top-emotes { display:flex; flex-wrap:wrap; gap:8px; }
        .user-emote-item { display:flex; align-items:center; gap:4px; font-size:13px; }
        .user-emote-img { width:32px; height:32px; }
        .no-stats-message { color:#888; font-style:italic; text-align:center; padding:20px; }
        #cytube-logger-toggle.active { background:#6c5ce7 !important; color:white !important; }
    `;

    function openToolsTab() {
        $('#channelsettings').modal('show');
        $('a[href="#toolsTab"]').tab('show');
    }

    function toggleMenu() {
        openToolsTab();
        if (state.menuDiv) {
            const visible = state.menuDiv.style.display === 'block';
            state.menuDiv.style.display = visible ? 'none' : 'block';
            document.getElementById('cytube-logger-toggle')?.classList.toggle('active', !visible);
        }
    }

    function createPreviewWindow() {
        if (state.previewWindow) return;
        state.previewWindow = document.createElement('div');
        state.previewWindow.id = 'cytube-chat-preview';
        state.previewWindow.innerHTML = `
            <div class="logger-header">
                <span>Chat Log Preview</span>
                <span class="logger-close" onclick="document.getElementById('cytube-chat-preview').style.display='none'; state.isPreviewVisible=false;">×</span>
            </div>
            <div class="logger-content" id="cytube-chat-preview-content"></div>
        `;
        document.getElementById('tools-content-area').appendChild(state.previewWindow);
        domCache.previewContent = document.getElementById('cytube-chat-preview-content');
    }

    function createStatsWindow() {
        if (state.statsWindow) return;
        state.statsWindow = document.createElement('div');
        state.statsWindow.id = 'cytube-stats-preview';
        state.statsWindow.innerHTML = `
            <div class="logger-header">
                <span>Emote Statistics</span>
                <span class="logger-close" onclick="document.getElementById('cytube-stats-preview').style.display='none'; state.isStatsVisible=false; if(state.statsRefreshInterval) clearInterval(state.statsRefreshInterval);">×</span>
            </div>
            <div class="stats-tabs">
                <div class="stats-tab active" data-tab="global">Global</div>
                <div class="stats-tab" data-tab="user">Per User</div>
            </div>
            <div class="stats-search"><input type="text" placeholder="Search emotes/users..." id="stats-search-input"></div>
            <div class="logger-content" id="cytube-stats-preview-content"></div>
        `;
        document.getElementById('tools-content-area').appendChild(state.statsWindow);
        domCache.statsContent = document.getElementById('cytube-stats-preview-content');

        state.statsWindow.querySelectorAll('.stats-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                state.statsWindow.querySelectorAll('.stats-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                state.currentStatsTab = tab.dataset.tab;
                updateStatsPreview();
            });
        });

        document.getElementById('stats-search-input').addEventListener('input', e => {
            state.searchTerm = e.target.value.toLowerCase();
            updateStatsPreview();
        });
    }

    function createSettingsWindow() {
        if (state.settingsWindow) return;
        state.settingsWindow = document.createElement('div');
        state.settingsWindow.id = 'cytube-logger-settings';
        state.settingsWindow.innerHTML = `
            <div class="logger-header">
                <span>Logger Settings</span>
                <span class="logger-close" onclick="document.getElementById('cytube-logger-settings').style.display='none'; state.isSettingsVisible=false;">×</span>
            </div>
            <div class="logger-content">
                <div style="margin-bottom:10px;"><strong>Display Limits</strong></div>
                <label>Global stats shown: <input id="global-stats-limit" type="number" value="${state.displayLimits.globalStats}" style="width:80px;"></label><br>
                <label>User stats shown: <input id="user-stats-limit" type="number" value="${state.displayLimits.userStats}" style="width:80px;"></label><br>
                <label>Top emotes per user: <input id="top-emotes-limit" type="number" value="${state.displayLimits.topEmotesPerUser}" style="width:80px;"></label><br>
                <label>Preview messages: <input id="preview-messages-limit" type="number" value="${state.displayLimits.previewMessages}" style="width:80px;"></label><br>
                <button id="save-settings-btn" style="margin-top:10px;">Save</button>
            </div>
        `;
        document.getElementById('tools-content-area').appendChild(state.settingsWindow);

        document.getElementById('save-settings-btn').addEventListener('click', saveSettings);
    }

    function togglePreview() {
        openToolsTab();
        createPreviewWindow();
        state.previewWindow.style.display = state.isPreviewVisible ? 'none' : 'flex';
        state.isPreviewVisible = !state.isPreviewVisible;
        if (state.isPreviewVisible) updatePreview();
    }

    function toggleStats() {
        openToolsTab();
        createStatsWindow();
        state.statsWindow.style.display = state.isStatsVisible ? 'none' : 'flex';
        state.isStatsVisible = !state.isStatsVisible;
        if (state.isStatsVisible) {
            updateStatsPreview();
            state.statsRefreshInterval = setInterval(updateStatsPreview, CONFIG.AUTO_REFRESH_STATS);
        } else if (state.statsRefreshInterval) {
            clearInterval(state.statsRefreshInterval);
        }
    }

    function toggleSettings() {
        openToolsTab();
        createSettingsWindow();
        state.settingsWindow.style.display = state.isSettingsVisible ? 'none' : 'flex';
        state.isSettingsVisible = !state.isSettingsVisible;
    }

    function updatePreview() {
        if (!domCache.previewContent) return;
        domCache.previewContent.innerHTML = state.messages.slice(-state.displayLimits.previewMessages).join('<br>');
        domCache.previewContent.scrollTop = domCache.previewContent.scrollHeight;
    }

    function updateGlobalStatsPreview() {
        domCache.statsContent.innerHTML = '';
        let emotes = Object.entries(state.emoteStats).sort((a, b) => b[1].count - a[1].count);
        if (state.searchTerm) emotes = emotes.filter(([n]) => n.toLowerCase().includes(state.searchTerm));
        emotes = emotes.slice(0, state.displayLimits.globalStats);
        if (emotes.length === 0) {
            domCache.statsContent.innerHTML = `<div class="no-stats-message">No emotes found${state.searchTerm ? ` matching "${state.searchTerm}"` : ''}</div>`;
            return;
        }
        emotes.forEach(([name, data]) => {
            const src = data.src || 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSIjNjY2NjY2Ij48cGF0aCBkPSJNMCAwaDI0djI0SDBWMHoiIGZpbGw9Im5vbmUiLz48cGF0aCBkPSJNMTkgM0g1Yy0xLjEgMC0yIC45LTIgMnYxNGMwIDEuMS45IDIgMiAyaDE0YzEuMSAwIDItLjkgMi0yVjVjMC0xLjEtLjktMi0yLTJ6bS0uMjkgMTUuNDdsLTUuODMtNS44M0w5Ljg4IDE2Ljc2IDYuNyAxMy41OCA1LjI5IDE1bDQuNTkgNC41OSA4LjQ3LTguNDcgMS40MiAxLjQxTDE4LjcxIDE4LjQ3eiIvPjwvc3ZnPg==';
            const row = document.createElement('div');
            row.className = 'cytube-stats-emote-row';
            row.innerHTML = `<img class="cytube-stats-emote-img" src="$$ {src}" alt=" $${name}">
                <div class="cytube-stats-emote-info">
                    <span class="cytube-stats-emote-name">${name}</span>
                    <span class="cytube-stats-emote-count">${data.count} uses</span>
                </div>`;
            domCache.statsContent.appendChild(row);
        });
    }

    function updateUserStatsPreview() {
        domCache.statsContent.innerHTML = '';
        let users = Object.entries(state.userEmoteStats)
            .filter(([, emotes]) => Object.keys(emotes).length > 0)
            .sort(([a], [b]) => a.localeCompare(b));
        if (state.searchTerm) users = users.filter(([u]) => u.toLowerCase().includes(state.searchTerm));
        users = users.slice(0, state.displayLimits.userStats);
        if (users.length === 0) {
            domCache.statsContent.innerHTML = `<div class="no-stats-message">No users found${state.searchTerm ? ` matching "${state.searchTerm}"` : ''}</div>`;
            return;
        }
        users.forEach(([username, emotes]) => {
            const total = Object.values(emotes).reduce((s, e) => s + e.count, 0);
            const top = Object.entries(emotes).sort((a, b) => b[1].count - a[1].count).slice(0, state.displayLimits.topEmotesPerUser);
            const row = document.createElement('div');
            row.className = 'user-stats-row';
            row.innerHTML = `<div class="user-stats-header"><span class="user-stats-username">$$ {username}</span> <span class="user-stats-total">( $${total} total)</span></div>
                <div class="user-top-emotes">
                    ${top.map(([n, d]) => {
                        const src = d.src || 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSIjNjY2NjY2Ij48cGF0aCBkPSJNMCAwaDI0djI0SDBWMHoiIGZpbGw9Im5vbmUiLz48cGF0aCBkPSJNMTkgM0g1Yy0xLjEgMC0yIC45LTIgMnYxNGMwIDEuMS45IDIgMiAyaDE0YzEuMSAwIDItLjkgMi0yVjVjMC0xLjEtLjktMi0yLTJ6bS0uMjkgMTUuNDdsLTUuODMtNS44M0w5Ljg4IDE2Ljc2IDYuNyAxMy41OCA1LjI5IDE1bDQuNTkgNC41OSA4LjQ3LTguNDcgMS40MiAxLjQxTDE4LjcxIDE4LjQ3eiIvPjwvc3ZnPg==';
                        return `<div class="user-emote-item"><img class="user-emote-img" src="${src}" alt="${n}"><span class="user-emote-name">${n}</span> <span class="user-emote-count">${d.count}</span></div>`;
                    }).join('')}
                </div>`;
            domCache.statsContent.appendChild(row);
        });
    }

    function updateStatsPreview() {
        if (!domCache.statsContent) return;
        if (state.currentStatsTab === 'global') updateGlobalStatsPreview();
        else updateUserStatsPreview();
    }

    function saveSettings() {
        state.displayLimits = {
            globalStats: parseInt(document.getElementById('global-stats-limit').value) || CONFIG.DEFAULT_DISPLAY_LIMITS.globalStats,
            userStats: parseInt(document.getElementById('user-stats-limit').value) || CONFIG.DEFAULT_DISPLAY_LIMITS.userStats,
            topEmotesPerUser: parseInt(document.getElementById('top-emotes-limit').value) || CONFIG.DEFAULT_DISPLAY_LIMITS.topEmotesPerUser,
            previewMessages: parseInt(document.getElementById('preview-messages-limit').value) || CONFIG.DEFAULT_DISPLAY_LIMITS.previewMessages
        };
        safeGMOperation(() => GM_setValue('displayLimits', JSON.stringify(state.displayLimits)));
        if (state.isPreviewVisible) updatePreview();
        if (state.isStatsVisible) updateStatsPreview();
        alert('Settings saved!');
    }

    function saveSilently() {
        const msg = JSON.stringify(state.messages);
        const estats = JSON.stringify(state.emoteStats);
        const ustats = JSON.stringify(state.userEmoteStats);
        if (msg !== state.lastSavedMessages || estats !== state.lastSavedStats || ustats !== state.lastSavedUserStats) {
            safeGMOperation(() => {
                GM_setValue('chatMessages', msg);
                GM_setValue('emoteStats', estats);
                GM_setValue('userEmoteStats', ustats);
            });
            state.lastSavedMessages = msg;
            state.lastSavedStats = estats;
            state.lastSavedUserStats = ustats;
        }
    }

    function getFormattedDate(date) {
        const d = String(date.getDate()).padStart(2, '0');
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const y = date.getFullYear();
        return `${d}_${m}_${y}`;
    }

    function exportEmoteStats() {
        const last = safeGMOperation(() => GM_getValue('lastEmoteExportDate', null), null);
        const now = getFormattedDate(new Date());
        let content = '';
        if (state.currentStatsTab === 'global') {
            content = Object.entries(state.emoteStats)
                .sort((a, b) => b[1].count - a[1].count)
                .map(([e, d]) => `${e}: ${d.count} uses`).join('\n');
        } else {
            content = Object.entries(state.userEmoteStats)
                .filter(([, e]) => Object.keys(e).length > 0)
                .sort((a, b) => Object.values(b[1]).reduce((s, x) => s + x.count, 0) - Object.values(a[1]).reduce((s, x) => s + x.count, 0))
                .map(([u, e]) => {
                    const total = Object.values(e).reduce((s, x) => s + x.count, 0);
                    const top = Object.entries(e).sort((a, b) => b[1].count - a[1].count).slice(0, state.displayLimits.topEmotesPerUser)
                        .map(([n, d]) => `${n}: ${d.count}`).join(', ');
                    return `${u} (${total} total): ${top}`;
                }).join('\n');
        }
        const name = last ? `${CONFIG.EMOTE_LOG_BASE_NAME} ${last} - ${now}.txt` : `${CONFIG.EMOTE_LOG_BASE_NAME} ${now}.txt`;
        safeGMOperation(() => {
            GM_setValue('lastEmoteExportDate', now);
            GM_download({ url: 'data:text/plain;charset=utf-8,' + encodeURIComponent(content), name, saveAs: true });
        });
    }

    function createUI() {
        GM_addStyle(STATS_STYLES);
        const check = setInterval(() => {
            const btnContainer = document.getElementById('tools-button-container');
            const contentArea = document.getElementById('tools-content-area');
            if (!btnContainer || !contentArea) return;
            clearInterval(check);
            if (document.getElementById('cytube-logger-toggle')) return;

            const toggle = document.createElement('button');
            toggle.id = 'cytube-logger-toggle';
            toggle.className = 'btn btn-sm btn-default';
            toggle.textContent = '📊 Emote Tracker';
            toggle.title = 'Toggle Emote Tracker Menu';
            toggle.addEventListener('click', toggleMenu);
            btnContainer.appendChild(toggle);

            state.menuDiv = document.createElement('div');
            state.menuDiv.id = 'cytube-logger-menu';
            state.menuDiv.innerHTML = `
                <button class="btn btn-sm btn-default" id="logger-preview-btn">Preview Log</button>
                <button class="btn btn-sm btn-default" id="logger-stats-btn">Emote Stats</button>
                <button class="btn btn-sm btn-default" id="logger-export-btn">Export Stats</button>
                <button class="btn btn-sm btn-default" id="logger-settings-btn">Settings</button>
                <button class="btn btn-sm btn-danger" id="logger-clear-btn">Clear Data</button>
            `;
            contentArea.appendChild(state.menuDiv);

            document.getElementById('logger-preview-btn').onclick = togglePreview;
            document.getElementById('logger-stats-btn').onclick = toggleStats;
            document.getElementById('logger-export-btn').onclick = exportEmoteStats;
            document.getElementById('logger-settings-btn').onclick = toggleSettings;
            document.getElementById('logger-clear-btn').onclick = () => {
                if (confirm('Clear all logged data?')) {
                    state.messages = []; state.emoteStats = {}; state.userEmoteStats = {};
                    saveSilently();
                    alert('Data cleared!');
                }
            };
        }, 500);
    }

    function scanMessagesOnce() {
        const start = Date.now();
        const messages = domCache.chatContainer.querySelectorAll(CONFIG.MESSAGE_SELECTOR);
        for (const msg of messages) {
            if (CONFIG.IGNORE_CLASSES.some(c => msg.classList.contains(c))) continue;
            const p = processMessage(msg);
            if (p) handleProcessedMessage(msg, p);
        }
        logPerformance('scanMessagesOnce', start);
    }

    function processMessage(node) {
        const username = node.querySelector('.username')?.textContent.trim().replace(':', '');
        const content = node.querySelector('.message')?.textContent.trim();
        const timestamp = getUKTimestamp();
        const emotes = Array.from(node.querySelectorAll('img.emote')).map(img => ({ name: img.alt, src: img.src }));
        return { username, content, timestamp, emotes };
    }

    function handleProcessedMessage(node, { username, content, timestamp, emotes }) {
        state.messages.push(`${timestamp} ${username}: ${content}`);
        if (state.messages.length > CONFIG.MAX_MESSAGES_IN_MEMORY) state.messages.shift();
        emotes.forEach(({ name, src }) => {
            if (!state.emoteStats[name]) state.emoteStats[name] = { count: 0, src };
            state.emoteStats[name].count++;
            if (Object.keys(state.emoteStats).length > CONFIG.MAX_EMOTE_STATS) {
                const min = Object.entries(state.emoteStats).reduce((min, curr) => curr[1].count < min[1].count ? curr : min);
                delete state.emoteStats[min[0]];
            }
            if (username) {
                if (!state.userEmoteStats[username]) state.userEmoteStats[username] = {};
                if (!state.userEmoteStats[username][name]) state.userEmoteStats[username][name] = { count: 0, src };
                state.userEmoteStats[username][name].count++;
            }
        });
    }

    function initialize() {
        createUI();
        domCache.chatContainer = document.querySelector(CONFIG.CHAT_CONTAINER_SELECTOR);
        if (domCache.chatContainer) {
            scanMessagesOnce();
            state.observer = new MutationObserver(muts => {
                for (const mut of muts) {
                    for (const node of mut.addedNodes) {
                        if (!(node instanceof HTMLElement)) continue;
                        if (!node.matches(CONFIG.MESSAGE_SELECTOR)) continue;
                        if (CONFIG.IGNORE_CLASSES.some(c => node.classList.contains(c))) continue;
                        const p = processMessage(node);
                        if (p) handleProcessedMessage(node, p);
                    }
                }
            });
            state.observer.observe(domCache.chatContainer, { childList: true });
        }
        state.saveInterval = setInterval(saveSilently, CONFIG.AUTO_SAVE_INTERVAL);
        window.addEventListener('beforeunload', saveSilently);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }

    // Tweet Embed code
    const tweetRegex = /https:\/\/(x|twitter)\.com\/.*?\/status\/(\d+)/i;
    const mediaRegex = /\.(jpe?g|png|gif|webp|mp4|webm|mov)(\?.*)?$/i;

    let tweetPreviewActive = localStorage.getItem("tweetPreviewEnabled") !== "false";
    let tweetInfoCache = {};

    function createMainToggle() {
        const appendButton = () => {
            const container = document.getElementById('tools-button-container');
            if (!container) {
                setTimeout(appendButton, 500);
                return;
            }

            if (document.getElementById('tweet-main-toggle')) return;

            const btn = document.createElement('button');
            btn.id = 'tweet-main-toggle';
            btn.className = 'btn btn-sm btn-default';
            btn.textContent = '🐦';
            btn.title = 'Toggle Tweet & Media Previews';
            btn.style.marginLeft = '5px';
            if (tweetPreviewActive) btn.classList.add('active');

            btn.onclick = () => {
                tweetPreviewActive = !tweetPreviewActive;
                localStorage.setItem("tweetPreviewEnabled", tweetPreviewActive);
                btn.classList.toggle('active', tweetPreviewActive);
                if (!tweetPreviewActive) {
                    document.querySelectorAll('#tweet-inline-preview, .tweet-preview-toggle, .media-preview-toggle')
                        .forEach(el => el.remove());
                } else {
                    document.querySelectorAll("a[href*='twitter.com'], a[href*='x.com'], a[href$$ ='.jpg'], a[href $$='.jpeg'], a[href$$ ='.png'], a[href $$='.gif'], a[href$$ ='.webp'], a[href $$='.mp4'], a[href$$ ='.webm'], a[href $$='.mov']")
                        .forEach(addPreviewIfTweetOrMedia);
                }
            };

            container.appendChild(btn);
        };

        appendButton();
    }

    function getTweetId(url) {
        const m = tweetRegex.exec(url);
        return m ? m[2] : null;
    }

    async function fetchTweetInfo(tweetUrl) {
        const id = getTweetId(tweetUrl);
        if (!id || tweetInfoCache[id]) return tweetInfoCache[id] || null;
        try {
            const res = await fetch(`https://unable-diet-least-attorneys.trycloudflare.com/api/v1/statuses/${id}`);
            if (!res.ok) throw 0;
            const data = await res.json();
            tweetInfoCache[id] = data;
            return data;
        } catch (e) {
            console.error("Tweet fetch failed:", e);
            return null;
        }
    }

    function buildEmbed(info) {
        const div = document.createElement('div');
        div.innerHTML = `
            <div id="tweet-content">
                <div id="tweet-user">
                    <div id="tweet-avatar"><img src="${info.account.avatar}" width="40" height="40" style="border-radius:50%;"></div>
                    <div id="tweet-user-id">
                        <span id="tweet-user-name">${info.account.display_name}</span>
                        <span id="tweet-user-handle">@${info.account.acct}</span>
                    </div>
                </div>
                <div id="tweet-text">${info.content}</div>
                <div id="tweet-image"></div>
            </div>`;
        const container = div.querySelector('#tweet-image');
        info.media_attachments.forEach(att => {
            const w = document.createElement('div');
            w.className = 'tweet-img-preview';
            if (att.type === 'video')
                w.innerHTML = `<video controls src="${att.url}" poster="${att.preview_url}" style="border-radius:6px;"></video>`;
            else
                w.innerHTML = `<a href="${att.preview_url}" target="_blank"><img src="${att.preview_url}" style="border-radius:6px;"></a>`;
            container.appendChild(w);
        });
        return div.firstElementChild;
    }

    function addPreviewIfTweetOrMedia(a) {
        const href = a.href;
        const msg = a.closest('div[id^="msg-"]') || a.parentElement.parentElement;
        if (!msg || msg.querySelector('.tweet-preview-toggle, .media-preview-toggle')) return;

        if (tweetRegex.test(href)) addTweetPreview(a, msg);
        else if (mediaRegex.test(href)) addMediaPreview(a, msg);
    }

    function addTweetPreview(a, msg) {
        const btn = createPreviewToggle('tweet-preview-toggle');
        a.parentNode.appendChild(btn);
        let preview = null;
        btn.onclick = async () => {
            if (preview?.isConnected) { preview.remove(); preview = null; btn.textContent = '👁️'; return; }
            preview = createPreviewContainer();
            msg.appendChild(preview);
            const info = await fetchTweetInfo(a.href);
            const embed = preview.querySelector('#tweet-embed');
            if (info) {
                embed.style.display = '';
                preview.querySelector('.tweet-loader').remove();
                embed.appendChild(buildEmbed(info));
            } else {
                preview.innerHTML = '<div style="color:#ff6b6b;padding:6px;font-size:13px;">Failed to load tweet</div>';
            }
            btn.textContent = "👁️";
        };
    }

    function addMediaPreview(a, msg) {
        const btn = createPreviewToggle('media-preview-toggle');
        a.parentNode.appendChild(btn);
        let preview = null;
        btn.onclick = () => {
            if (preview?.isConnected) { preview.remove(); preview = null; btn.textContent = '👁️'; return; }
            preview = createPreviewContainer();
            const embed = preview.querySelector('#tweet-embed');
            embed.style.display = 'block';
            const url = a.href;
            const isVideo = /\.(mp4|webm|mov)$/i.test(url);
            embed.innerHTML = isVideo
                ? `<video controls style="max-width:100%;border-radius:6px;"><source src="${url}"></video>`
                : `<a href="${url}" target="_blank"><img src="${url}" style="max-width:100%;border-radius:6px;" loading="lazy"></a>`;
            preview.querySelector('.tweet-loader').remove();
            msg.appendChild(preview);
            btn.textContent = "👁️";
        };
    }

    function createPreviewToggle(className) {
        const btn = document.createElement('button');
        btn.className = className;
        btn.textContent = '👁️';
        btn.title = 'Show preview';
        btn.style.cssText = 'margin-left:6px;background:transparent;border:none;cursor:pointer;font-size:11px;opacity:0.8;padding:1px 5px;border-radius:3px;';
        btn.onmouseover = () => btn.style.opacity = '1';
        btn.onmouseout  = () => btn.style.opacity = '0.8';
        return btn;
    }

    function createPreviewContainer() {
        const div = document.createElement('div');
        div.id = 'tweet-inline-preview';
        div.innerHTML = `<div class="tweet-loader" style="width:60px;height:12px;background:radial-gradient(circle closest-side,#fff 90%,#0000) 0/calc(100%/3) 100% space;animation:tweetanim 1s steps(4) infinite;margin:6px 0;"></div><div id="tweet-embed" style="display:none"></div>`;
        return div;
    }

    function makeDialog() {
        if (document.getElementById('tweet-dialog')) return;
        const d = document.createElement('dialog');
        d.id = 'tweet-dialog';
        d.innerHTML = `<div class="tweet-loader" style="width:60px;height:12px;background:radial-gradient(circle closest-side,#fff 90%,#0000) 0/calc(100%/3) 100% space;animation:tweetanim 1s steps(4) infinite;margin:6px 0;"></div><div id="tweet-embed"></div>`;
        d.onclick = e => e.target === d && d.close();
        document.body.appendChild(d);
    }

    GM_addStyle(`
        @keyframes tweetanim {to{clip-path:inset(0 -34% 0 0)}}
        #tweet-main-toggle.active {background:#337ab7 !important; border-color:#2e6da4 !important;}
        #tweet-dialog, #tweet-inline-preview {background:#000;color:#fff;border:1px solid #2f3336;border-radius:8px;max-width:520px;font-family:system-ui;box-shadow:0 4px 20px rgba(0,0,0,0.6);margin:0;padding:0;}
        #tweet-inline-preview {max-width:300px;align-self:flex-start;margin-top:4px;}
        #tweet-content {display:flex;flex-direction:column;padding:6px 8px;gap:0;}
        #tweet-user {display:flex;gap:8px;align-items:center;margin-bottom:4px;}
        #tweet-user-name {font-weight:bold;font-size:14px;}
        #tweet-user-handle {color:#71767b;font-size:13px;}
        #tweet-text {font-size:14px;white-space:pre-wrap;word-break:break-word;margin:0 0 6px 0;}
        #tweet-image {display:grid;grid-template-columns:1fr 1fr;gap:3px;}
        #tweet-image > div {overflow:hidden;border-radius:6px;background:#111;}
        #tweet-image img,#tweet-image video {max-width:100%;display:block;border-radius:6px;}
        #tweet-image :nth-child(1):nth-last-child(1){grid-column:span 2;}
    `);

    (async () => {
        while (typeof waitForFunc === 'undefined') await new Promise(r => setTimeout(r, 200));
        await waitForFunc("MESSAGE_PROCESSOR");
        makeDialog();
        createMainToggle();
        document.querySelectorAll("a[href*='twitter.com'], a[href*='x.com'], a[href$$ ='.jpg'], a[href $$='.jpeg'], a[href$$ ='.png'], a[href $$='.gif'], a[href$$ ='.webp'], a[href $$='.mp4'], a[href$$ ='.webm'], a[href $$='.mov']")
            .forEach(addPreviewIfTweetOrMedia);
        MESSAGE_PROCESSOR.addTap($msg => {
            if (tweetPreviewActive) $msg.find("a").each((_, el) => addPreviewIfTweetOrMedia(el));
        });
    })();

    // World Clock code (renamed state to clockState)
    const TIMEZONES = {
        'UK': 0,
        'Japan': 9,
        'America': -5
    };

    let clockState = {
        button: null,
        clockLi: null,
        isVisible: GM_getValue('worldClockVisible', false),
        updateInterval: null
    };

    function calculateTimes() {
        const now = new Date();
        const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
        const times = {};
        for (const [region, offset] of Object.entries(TIMEZONES)) {
            const regionTime = new Date(utc + (offset * 3600000));
            const hours = String(regionTime.getHours()).padStart(2, '0');
            const minutes = String(regionTime.getMinutes()).padStart(2, '0');
            times[region] = `${hours}:${minutes}`;
        }
        return times;
    }

    function updateClockDisplay() {
        if (!clockState.clockLi) return;
        const times = calculateTimes();
        clockState.clockLi.innerHTML = `
            <a href="javascript:void(0)" style="white-space: nowrap;">
                UK: ${times.UK} · JP: ${times.Japan} · EastUS: ${times.America}
            </a>
        `;
    }

    function createToggleButton() {
        const checkInterval = setInterval(() => {
            const toolsContainer = document.getElementById('tools-button-container');
            if (!toolsContainer) return;
            clearInterval(checkInterval);

            if (document.getElementById('world-clock-btn')) return;

            clockState.button = document.createElement('button');
            clockState.button.id = 'world-clock-btn';
            clockState.button.textContent = '🕐';
            clockState.button.title = 'Toggle World Clock in Navbar';
            clockState.button.classList.add('btn', 'btn-sm', 'btn-default');
            clockState.button.style.marginLeft = '5px';

            if (clockState.isVisible) clockState.button.classList.add('active');

            toolsContainer.appendChild(clockState.button);

            clockState.button.addEventListener('click', () => {
                clockState.isVisible = !clockState.isVisible;
                GM_setValue('worldClockVisible', clockState.isVisible);

                if (clockState.isVisible) {
                    createClockLi();
                    clockState.clockLi.style.display = 'list-item';
                    updateClockDisplay();
                    clockState.updateInterval = setInterval(updateClockDisplay, 30000);
                    clockState.button.classList.add('active');
                } else {
                    if (clockState.clockLi) clockState.clockLi.style.display = 'none';
                    if (clockState.updateInterval) clearInterval(clockState.updateInterval);
                    clockState.button.classList.remove('active');
                }
            });

            const style = document.createElement('style');
            style.textContent = `
                #world-clock-btn.active {
                    background: #6c5ce7 !important;
                    color: white !important;
                }
                #world-clock-btn:hover {
                    background: #5a4dcc !important;
                    color: white !important;
                }
                #world-clock-li {
                    display: none;
                }
            `;
            document.head.appendChild(style);
        }, 100);
    }

    function createClockLi() {
        if (clockState.clockLi) return;

        const checkInterval = setInterval(() => {
            const navUl = document.querySelector('ul.nav.navbar-nav');
            const motdLi = navUl?.querySelector('a#togglemotd')?.parentElement;
            if (!navUl || !motdLi) return;
            clearInterval(checkInterval);

            clockState.clockLi = document.createElement('li');
            clockState.clockLi.id = 'world-clock-li';
            clockState.clockLi.style.display = 'none';

            motdLi.after(clockState.clockLi);
        }, 100);
    }

    createToggleButton();
    createClockLi();

    if (clockState.isVisible) {
        const restore = setInterval(() => {
            if (clockState.clockLi) {
                clearInterval(restore);
                clockState.clockLi.style.display = 'list-item';
                updateClockDisplay();
                clockState.updateInterval = setInterval(updateClockDisplay, 30000);
            }
        }, 100);
    }

    // Hololive Tracker code
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

    function formatTimeUntil(dateString) {
        const now = new Date();
        const target = new Date(dateString);
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
            const currentNow = new Date();

            const matches = combined.filter(v => {
                if (seen.has(v.id)) return false;
                seen.add(v.id);
                const scheduled = new Date(v.start_scheduled || v.available_at);
                return isHololive(v.channel) && !v.start_actual && scheduled > currentNow;
            });

            matches.sort((a, b) => new Date(a.start_scheduled || a.available_at) - new Date(b.start_scheduled || b.available_at));
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

        const filteredStreams = currentFilter === 'All' ? currentStreams : currentStreams.filter(s => getStreamTag(s) === currentFilter);
        const title = document.createElement('h3');
        title.textContent = `Hololive Schedule (${filteredStreams.length})`;

        const controls = document.createElement('div');

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
        refreshBtn.title = 'Refresh Schedule';
        refreshBtn.style.marginLeft = '5px';
        refreshBtn.addEventListener('click', fetchUpcomingStreams);

        const resetBtn = document.createElement('button');
        resetBtn.textContent = '🔑';
        resetBtn.title = 'Reset API Key';
        resetBtn.style.marginLeft = '5px';
        resetBtn.addEventListener('click', resetApiKey);

        controls.append(select, refreshBtn, resetBtn);
        header.append(title, controls);
        box.appendChild(header);

        if (filteredStreams.length) {
            const ul = document.createElement('ul');
            filteredStreams.forEach(v => {
                const time = v.start_scheduled || v.available_at;
                const tag = getStreamTag(v);
                const tagHTML = tag ? `<span style="color:#ff6b6b;font-weight:bold;margin-right:6px;">[${tag}]</span>` : '';

                const li = document.createElement('li');
                li.innerHTML = `<a href="https://holodex.net/watch/${v.id}" target="_blank" style="color:#fff;text-decoration:none;">
                  [$$ {formatUKDate(time)}] <span style="color:#a0e7a0;"> $${formatTimeUntil(time)}</span>
                  <b>${v.channel.name}</b> — $$ {tagHTML} $${v.title}
                </a>`;
                ul.appendChild(li);
            });
            box.appendChild(ul);
        } else {
            const p = document.createElement('p');
            p.textContent = 'No upcoming streams found.';
            box.appendChild(p);
        }

        document.getElementById('tools-content-area').appendChild(box);
    }

    function createToggleButtonHololive() {
        const container = document.getElementById('tools-button-container');
        if (!container) {
            setTimeout(createToggleButtonHololive, 500);
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
        #holodex-overlay button:hover { background: #444; }
    `);

    createToggleButtonHololive();

})();