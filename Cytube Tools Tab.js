// ==UserScript==
// @name         Cytube Tools Tab
// @namespace    cytube.tools.tab
// @version      1.3
// @description  Adds a 'Tools' tab to organize script buttons and content
// @match        https://om3tcw.com/r/*
// @grant        GM_addStyle
// @grant        GM_getResourceText
// @resource     cytubeToolsTabStyles https://conzz97.github.io/bote-violentmonkey-scripts/assets/cytube-tools-tab/styles.css
// ==/UserScript==

(function() {
  'use strict';

  const TOOLS_TAB_ID = 'toolsTab';
  const BUTTON_CONTAINER_ID = 'tools-button-container';
  const CONTENT_AREA_ID = 'tools-content-area';
  const TAB_LIST_SELECTOR = 'ul.nav.nav-tabs[role="tablist"]';
  const RETRY_DELAY_MS = 500;
  const MAX_RETRIES = 120;
  const RESOURCE_NAMES = {
    styles: 'cytubeToolsTabStyles'
  };

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

  function injectStyles() {
    const resourceCss = safeGetResourceText(RESOURCE_NAMES.styles, '');
    if (resourceCss) {
      GM_addStyle(resourceCss);
      return;
    }
    GM_addStyle(`
      #${TOOLS_TAB_ID} {
        background: #1a1a1a;
        color: #ddd;
        min-height: 200px;
      }
      #${BUTTON_CONTAINER_ID} {
        padding: 10px;
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
      }
      #${CONTENT_AREA_ID} {
        padding: 10px;
        background: #252525;
        border-radius: 4px;
        overflow-y: auto;
        max-height: 400px;
      }
      #${BUTTON_CONTAINER_ID} button {
        margin: 0 !important;
      }
    `);
  }

  function createToolsPane() {
    const pane = document.createElement('div');
    pane.setAttribute('role', 'tabpanel');
    pane.className = 'tab-pane';
    pane.id = TOOLS_TAB_ID;

    const buttonContainer = document.createElement('div');
    buttonContainer.id = BUTTON_CONTAINER_ID;
    pane.appendChild(buttonContainer);

    const contentArea = document.createElement('div');
    contentArea.id = CONTENT_AREA_ID;
    pane.appendChild(contentArea);

    return pane;
  }

  function ensureTabContent(tabList) {
    let tabContent = tabList.nextElementSibling;
    if (tabContent && tabContent.classList.contains('tab-content')) {
      return tabContent;
    }

    tabContent = document.createElement('div');
    tabContent.className = 'tab-content';
    tabList.parentNode.insertBefore(tabContent, tabList.nextSibling);
    return tabContent;
  }

  function initToolsTab(tabList) {
    if (document.querySelector(`a[href="#${TOOLS_TAB_ID}"]`)) {
      return;
    }

    const item = document.createElement('li');
    item.setAttribute('role', 'presentation');

    const anchor = document.createElement('a');
    anchor.setAttribute('role', 'tab');
    anchor.setAttribute('data-toggle', 'tab');
    anchor.setAttribute('href', `#${TOOLS_TAB_ID}`);
    anchor.textContent = 'Tools';

    item.appendChild(anchor);
    tabList.appendChild(item);

    const tabContent = ensureTabContent(tabList);
    tabContent.appendChild(createToolsPane());
    injectStyles();
  }

  function waitForTabList(attempt = 0) {
    const tabList = document.querySelector(TAB_LIST_SELECTOR);
    if (tabList) {
      initToolsTab(tabList);
      return;
    }

    if (attempt >= MAX_RETRIES) {
      return;
    }

    setTimeout(() => waitForTabList(attempt + 1), RETRY_DELAY_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => waitForTabList(), { once: true });
  } else {
    waitForTabList();
  }
})();
