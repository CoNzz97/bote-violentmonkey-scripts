// ==UserScript==
// @name         Cytube Emote Global Tracker
// @namespace    http://tampermonkey.net/
// @version      7.14
// @description  Emote tracker
// @author       You
// @match        https://om3tcw.com/*
// @require      https://conzz97.github.io/bote-violentmonkey-scripts/lib/emote-global-tracker/utils.js
// @require      https://conzz97.github.io/bote-violentmonkey-scripts/lib/emote-global-tracker/ui-templates.js
// @grant        GM_download
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_getResourceText
// @resource     emoteGlobalTrackerStyles https://conzz97.github.io/bote-violentmonkey-scripts/assets/emote-global-tracker/styles.css
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
    const RETRY_DELAY_MS = 500;
    const MAX_RETRIES = 120;

    const RESOURCE_NAMES = {
        styles: 'emoteGlobalTrackerStyles'
    };

    const emoteTrackerUtils = window.CytubeEmoteGlobalTrackerUtils;
    const emoteTrackerTemplates = window.CytubeEmoteGlobalTrackerUiTemplates;
    if (!emoteTrackerUtils || !emoteTrackerTemplates) {
        return;
    }

    const perf = { operations: {} };

    function safeGMOperation(operation, defaultValue) {
        return emoteTrackerUtils.safeGMOperation(operation, defaultValue, '[Cytube Logger]');
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
    const initialDisplayLimits = emoteTrackerUtils.parseDisplayLimits(rawDisplayLimits, CONFIG.DEFAULT_DISPLAY_LIMITS);
    const EMOTE_PLACEHOLDER_SRC = emoteTrackerUtils.EMOTE_PLACEHOLDER_SRC;

    let state = {
        messages: safeGMOperation(() => JSON.parse(GM_getValue('chatMessages', '[]')), []),
        emoteStats: migratedStats,
        userEmoteStats: safeGMOperation(() => JSON.parse(rawUserEmoteStats), {}),
        previewWindow: null,
        statsWindow: null,
        settingsWindow: null,
        menuDiv: null,
        toolsContentOriginalMaxHeight: null,
        toolsContentOriginalHeight: null,
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
        displayLimits: initialDisplayLimits
    };

    const domCache = {
        chatContainer: null,
        previewContent: null,
        statsContent: null
    };

    function getUKTimestamp() {
        return emoteTrackerUtils.getUKTimestamp();
    }

    function openToolsTab() {
        if (typeof $ !== 'undefined') {
            $('a[href="#toolsTab"]').tab('show');
        }
    }

    function toggleMenu() {
        openToolsTab();
        if (state.menuDiv) {
            const visible = state.menuDiv.style.display === 'block';
            state.menuDiv.style.display = visible ? 'none' : 'block';
            document.getElementById('cytube-logger-toggle')?.classList.toggle('active', !visible);
            applyPanelLayouts();
        }
    }

    function getPanelHeight() {
        const contentArea = document.getElementById('tools-content-area');
        if (!contentArea) return 320;

        const styles = window.getComputedStyle(contentArea);
        const paddingTop = parseFloat(styles.paddingTop) || 0;
        const paddingBottom = parseFloat(styles.paddingBottom) || 0;
        const menuHeight = state.menuDiv && state.menuDiv.style.display !== 'none' ? state.menuDiv.offsetHeight + 10 : 0;
        const available = contentArea.clientHeight - paddingTop - paddingBottom - menuHeight - 6;
        return Math.max(240, available);
    }

    function setToolsAreaExpanded(expanded) {
        const contentArea = document.getElementById('tools-content-area');
        if (!contentArea) return;
        if (state.toolsContentOriginalMaxHeight === null) {
            state.toolsContentOriginalMaxHeight = contentArea.style.maxHeight || '';
        }
        if (state.toolsContentOriginalHeight === null) {
            state.toolsContentOriginalHeight = contentArea.style.height || '';
        }

        if (expanded) {
            contentArea.style.maxHeight = '72vh';
            contentArea.style.height = '72vh';
        } else {
            contentArea.style.maxHeight = state.toolsContentOriginalMaxHeight;
            contentArea.style.height = state.toolsContentOriginalHeight;
        }
    }

    function applyPanelLayouts() {
        const panelHeight = getPanelHeight();
        [state.previewWindow, state.statsWindow, state.settingsWindow].forEach(panel => {
            if (!panel) return;
            panel.style.height = `${panelHeight}px`;
            panel.style.maxHeight = `${panelHeight}px`;
        });
    }

    function stopStatsRefresh() {
        if (state.statsRefreshInterval) {
            clearInterval(state.statsRefreshInterval);
            state.statsRefreshInterval = null;
        }
    }

    function hideAllPanels() {
        setToolsAreaExpanded(false);
        if (state.previewWindow) state.previewWindow.style.display = 'none';
        if (state.statsWindow) state.statsWindow.style.display = 'none';
        if (state.settingsWindow) state.settingsWindow.style.display = 'none';
        state.isPreviewVisible = false;
        state.isStatsVisible = false;
        state.isSettingsVisible = false;
        stopStatsRefresh();
    }

    function createPreviewWindow() {
        if (state.previewWindow) return;
        state.previewWindow = document.createElement('div');
        state.previewWindow.id = 'cytube-chat-preview';
        state.previewWindow.innerHTML = emoteTrackerTemplates.getPreviewWindowHtml();
        document.getElementById('tools-content-area').appendChild(state.previewWindow);
        domCache.previewContent = document.getElementById('cytube-chat-preview-content');
        applyPanelLayouts();
        state.previewWindow.querySelector('[data-logger-close="preview"]')?.addEventListener('click', () => {
            hideAllPanels();
        });
    }

    function createStatsWindow() {
        if (state.statsWindow) return;
        state.statsWindow = document.createElement('div');
        state.statsWindow.id = 'cytube-stats-preview';
        state.statsWindow.innerHTML = emoteTrackerTemplates.getStatsWindowHtml();
        document.getElementById('tools-content-area').appendChild(state.statsWindow);
        domCache.statsContent = document.getElementById('cytube-stats-preview-content');
        applyPanelLayouts();
        state.statsWindow.querySelector('[data-logger-close="stats"]')?.addEventListener('click', () => {
            hideAllPanels();
        });

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
        state.settingsWindow.innerHTML = emoteTrackerTemplates.getSettingsWindowHtml(state.displayLimits);
        document.getElementById('tools-content-area').appendChild(state.settingsWindow);
        document.getElementById('logger-save-settings').addEventListener('click', saveSettings);
        applyPanelLayouts();
        state.settingsWindow.querySelector('[data-logger-close="settings"]')?.addEventListener('click', () => {
            hideAllPanels();
        });
    }

    function togglePreview() {
        openToolsTab();
        if (state.isPreviewVisible) {
            hideAllPanels();
            return;
        }
        hideAllPanels();
        createPreviewWindow();
        applyPanelLayouts();
        state.isPreviewVisible = true;
        state.previewWindow.style.display = 'flex';
        updatePreview();
    }

    function toggleStats() {
        openToolsTab();
        if (state.isStatsVisible) {
            hideAllPanels();
            return;
        }
        hideAllPanels();
        setToolsAreaExpanded(true);
        createStatsWindow();
        applyPanelLayouts();
        state.isStatsVisible = true;
        state.statsWindow.style.display = 'flex';
        updateStatsPreview();
        stopStatsRefresh();
        state.statsRefreshInterval = setInterval(updateStatsPreview, CONFIG.AUTO_REFRESH_STATS);
    }

    function toggleSettings() {
        openToolsTab();
        if (state.isSettingsVisible) {
            hideAllPanels();
            return;
        }
        hideAllPanels();
        createSettingsWindow();
        applyPanelLayouts();
        state.isSettingsVisible = true;
        state.settingsWindow.style.display = 'flex';
    }

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
        const previewEl = domCache.previewContent;
        const previousOffsetFromBottom = previewEl.scrollHeight - previewEl.scrollTop - previewEl.clientHeight;
        const wasNearBottom = previousOffsetFromBottom <= 24;
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
        previewEl.innerHTML = html;
        if (wasNearBottom) {
            previewEl.scrollTop = previewEl.scrollHeight;
        } else {
            const targetScrollTop = previewEl.scrollHeight - previewEl.clientHeight - previousOffsetFromBottom;
            previewEl.scrollTop = Math.max(0, targetScrollTop);
        }
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
            const src = data.src || EMOTE_PLACEHOLDER_SRC;
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
                        const src = d.src || EMOTE_PLACEHOLDER_SRC;
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
        state.displayLimits = emoteTrackerUtils.sanitizeDisplayLimits({
            globalStats: document.getElementById('global-stats-limit').value,
            userStats: document.getElementById('user-stats-limit').value,
            topEmotesPerUser: document.getElementById('top-emotes-limit').value,
            previewMessages: document.getElementById('preview-messages-limit').value
        }, CONFIG.DEFAULT_DISPLAY_LIMITS);
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
        return emoteTrackerUtils.getFormattedDate(date);
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

    async function createUI() {
        const resourceCss = safeGetResourceText(RESOURCE_NAMES.styles, '');
        if (resourceCss) {
            GM_addStyle(resourceCss);
        }
        const btnContainer = await waitForEl('#tools-button-container');
        const contentArea = await waitForEl('#tools-content-area');
        if (!btnContainer || !contentArea) {
            return;
        }
        if (document.getElementById('cytube-logger-toggle')) {
            return;
        }

        const toggle = document.createElement('button');
        toggle.id = 'cytube-logger-toggle';
        toggle.className = 'btn btn-sm btn-default';
        toggle.textContent = '📊 Emote Tracker';
        toggle.title = 'Toggle Emote Tracker Menu';
        toggle.addEventListener('click', toggleMenu);
        btnContainer.appendChild(toggle);

        state.menuDiv = document.createElement('div');
        state.menuDiv.id = 'cytube-logger-menu';
        state.menuDiv.innerHTML = emoteTrackerTemplates.getMenuHtml();
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
    }

    async function initialize() {
        await createUI();
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
        window.addEventListener('resize', applyPanelLayouts);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }
})();
