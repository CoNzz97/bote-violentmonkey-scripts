// ==UserScript==
// @name         Cytube Emote Global & User tracker+ (Tools Tab Integration)
// @namespace    http://tampermonkey.net/
// @version      7.8
// @description  Optimized chat logger with global emote counter and UK date formatting, fully integrated into Tools tab
// @author       You + Grok
// @match        https://om3tcw.com/*
// @grant        GM_download
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        unsafeWindow
// ==/UserScript==

(function() {
    'use strict';

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

    // Load saved data
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

        // Tab switching
        state.statsWindow.querySelectorAll('.stats-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                state.statsWindow.querySelectorAll('.stats-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                state.currentStatsTab = tab.dataset.tab;
                updateStatsPreview();
            });
        });

        // Search
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
                <label>Preview messages: <input id="preview-messages-limit" type="number" value="${state.displayLimits.previewMessages}" style="width:80px;"></label><br><br>
                <button class="btn btn-sm btn-primary" id="logger-save-settings">Save Settings</button>
            </div>
        `;
        document.getElementById('tools-content-area').appendChild(state.settingsWindow);
        document.getElementById('logger-save-settings').addEventListener('click', saveSettings);
    }

    function togglePreview() {
        openToolsTab();
        state.isPreviewVisible = !state.isPreviewVisible;
        createPreviewWindow();
        state.previewWindow.style.display = state.isPreviewVisible ? 'flex' : 'none';
        if (state.isPreviewVisible) updatePreview();
    }

    function toggleStats() {
        openToolsTab();
        state.isStatsVisible = !state.isStatsVisible;
        createStatsWindow();
        state.statsWindow.style.display = state.isStatsVisible ? 'flex' : 'none';
        if (state.isStatsVisible) {
            updateStatsPreview();
            if (state.statsRefreshInterval) clearInterval(state.statsRefreshInterval);
            state.statsRefreshInterval = setInterval(updateStatsPreview, CONFIG.AUTO_REFRESH_STATS);
        } else if (state.statsRefreshInterval) {
            clearInterval(state.statsRefreshInterval);
            state.statsRefreshInterval = null;
        }
    }

    function toggleSettings() {
        openToolsTab();
        state.isSettingsVisible = !state.isSettingsVisible;
        createSettingsWindow();
        state.settingsWindow.style.display = state.isSettingsVisible ? 'flex' : 'none';
    }

    // Your existing processMessage, handleProcessedMessage, scanMessagesOnce, updatePreview, updateStatsPreview (global + user), saveSettings, saveSilently, exportEmoteStats, getFormattedDate

    function processMessage(element) {
        if (element.hasAttribute('data-logger-processed')) return null;
        const emoteNodes = element.querySelectorAll('.channel-emote');
        const emotes = Array.from(emoteNodes).map(node => ({
            title: node.title || ':emote:',
            src: node.src || ''
        }));
        const fragment = document.createDocumentFragment();
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, null, false);
        while (walker.nextNode()) {
            const node = walker.currentNode;
            if (node.nodeType === Node.TEXT_NODE) {
                if (!node.parentElement.classList.contains('timestamp') && !node.parentElement.classList.contains('username')) {
                    fragment.appendChild(document.createTextNode(node.textContent));
                }
            } else if (node.classList.contains('channel-emote')) {
                fragment.appendChild(document.createTextNode(node.title || ':emote:'));
            }
        }
        const text = fragment.textContent.replace(/\s+/g, ' ').trim();
        element.setAttribute('data-logger-processed', 'true');
        return { text, emotes };
    }

    function handleProcessedMessage(msg, processed) {
        const startTime = Date.now();
        processed.emotes.forEach(emote => {
            if (!state.emoteStats[emote.title]) state.emoteStats[emote.title] = { count: 0, src: emote.src };
            state.emoteStats[emote.title].count++;
            if (!state.emoteStats[emote.title].src && emote.src) state.emoteStats[emote.title].src = emote.src;

            const username = Array.from(msg.classList).find(c => c.startsWith('chat-msg-'))?.replace('chat-msg-', '') || 'Anonymous';
            if (!state.userEmoteStats[username]) state.userEmoteStats[username] = {};
            if (!state.userEmoteStats[username][emote.title]) state.userEmoteStats[username][emote.title] = { count: 0, src: emote.src };
            state.userEmoteStats[username][emote.title].count++;
            if (!state.userEmoteStats[username][emote.title].src && emote.src) state.userEmoteStats[username][emote.title].src = emote.src;
        });

        const username = Array.from(msg.classList).find(c => c.startsWith('chat-msg-'))?.replace('chat-msg-', '') || 'Anonymous';
        state.messages.push({
            id: msg.id || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            timestamp: getUKTimestamp(),
            username,
            content: processed.text,
            rawHTML: msg.outerHTML
        });
        if (state.messages.length > CONFIG.MAX_MESSAGES_IN_MEMORY) {
            state.messages = state.messages.slice(-CONFIG.MAX_MESSAGES_IN_MEMORY);
        }
        if (state.isPreviewVisible) updatePreview();
        if (state.isStatsVisible) updateStatsPreview();
        logPerformance('handleProcessedMessage', startTime);
    }

    function scanMessagesOnce() {
        const startTime = Date.now();
        const messages = Array.from(domCache.chatContainer.querySelectorAll(CONFIG.MESSAGE_SELECTOR))
            .filter(msg => !msg.hasAttribute('data-logger-processed') && !CONFIG.IGNORE_CLASSES.some(c => msg.classList.contains(c)));
        messages.forEach(msg => {
            const processed = processMessage(msg);
            if (processed) handleProcessedMessage(msg, processed);
        });
        logPerformance('scanMessagesOnce', startTime);
    }

    function updatePreview() {
        const startTime = Date.now();
        if (!domCache.previewContent) return;
        const messagesToShow = state.messages.slice(-state.displayLimits.previewMessages);
        let html = '';
        for (const msg of messagesToShow) {
            const timeMatch = msg.timestamp.match(/\[.*?(\d{2}:\d{2}:\d{2})\]/);
            const time = timeMatch ? timeMatch[1] : msg.timestamp;
            html += `<div class="cytube-logger-message">
                <span class="cytube-logger-timestamp">[${time}]</span>
                <span class="cytube-logger-username">${msg.username}:</span>
                <span class="cytube-logger-content">${msg.content}</span>
            </div>`;
        }
        domCache.previewContent.innerHTML = html;
        domCache.previewContent.scrollTop = domCache.previewContent.scrollHeight;
        logPerformance('updatePreview', startTime);
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
            row.innerHTML = `<img class="cytube-stats-emote-img" src="${src}" alt="${name}">
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
            row.innerHTML = `<div class="user-stats-header"><span class="user-stats-username">${username}</span> <span class="user-stats-total">(${total} total)</span></div>
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
})();