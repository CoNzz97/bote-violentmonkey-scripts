// ==UserScript==
// @name         Movie Mode Toggle
// @namespace    http://tampermonkey.net/
// @version      1.5
// @description  Toggle Movie Mode CSS + Exit button in video header
// @author       You
// @match        https://om3tcw.com/r/*
// @require      https://conzz97.github.io/bote-violentmonkey-scripts/lib/movie-mode-toggle/utils.js
// @grant        GM_addStyle
// @grant        GM_getResourceText
// @resource     movieModeToggleStyles https://conzz97.github.io/bote-violentmonkey-scripts/assets/movie-mode-toggle/styles.css
// ==/UserScript==

(function() {
  'use strict';

  const STORAGE_KEY = 'movieModeEnabled';
  const TOGGLE_ID = 'movie-mode-toggle';
  const EXIT_ID = 'movie-mode-exit';
  const RETRY_DELAY_MS = 500;
  const MAX_RETRIES = 120;
  const OBSERVER_FLAG = 'data-cytube-movie-mode-observer';
  const RESOURCE_NAMES = {
    styles: 'movieModeToggleStyles'
  };

  const movieModeCSS = `
    #MainTabContainer { display: none !important; }
    #mainpage { padding-top: 0 !important; }
    nav.navbar { display: none !important; }
    ::-webkit-scrollbar { width: 0 !important; }
    * { scrollbar-width: none !important; }
  `;

  const movieModeUtils = window.CytubeMovieModeToggleUtils;
  if (!movieModeUtils) {
    return;
  }

  let movieModeActive = readStoredState();
  let movieModeStyleElement = null;
  let uiSyncTimer = null;

  function readStoredState() {
    return movieModeUtils.readStoredBoolean(localStorage, STORAGE_KEY, false);
  }

  function saveStoredState() {
    movieModeUtils.saveStoredBoolean(localStorage, STORAGE_KEY, movieModeActive);
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

  function applyMovieModeStyle() {
    if (movieModeActive) {
      if (!movieModeStyleElement) {
        movieModeStyleElement = GM_addStyle(movieModeCSS);
      }
      return;
    }

    if (movieModeStyleElement) {
      movieModeStyleElement.remove();
      movieModeStyleElement = null;
    }
  }

  function syncUiState() {
    const mainBtn = document.getElementById(TOGGLE_ID);
    if (mainBtn) {
      mainBtn.classList.toggle('active', movieModeActive);
    }

    const exitBtn = document.getElementById(EXIT_ID);
    if (exitBtn) {
      exitBtn.style.display = movieModeActive ? 'inline' : 'none';
    }
  }

  function updateMovieMode() {
    applyMovieModeStyle();
    syncUiState();
    saveStoredState();
  }

  function queueUiSync() {
    if (uiSyncTimer) {
      return;
    }
    uiSyncTimer = setTimeout(() => {
      uiSyncTimer = null;
      ensureMainToggle();
      ensureExitButton();
      syncUiState();
      startScopedObservers();
    }, 40);
  }

  function mutationHasRelevantNode(nodes) {
    for (const node of nodes) {
      if (!(node instanceof HTMLElement)) {
        continue;
      }
      if (node.id === TOGGLE_ID || node.id === EXIT_ID) {
        return true;
      }
      if (node.id === 'tools-button-container' || node.id === 'videowrap-header' || node.id === 'currenttitle') {
        return true;
      }
      if (node.querySelector?.(`#${TOGGLE_ID}, #${EXIT_ID}, #tools-button-container, #videowrap-header, #currenttitle`)) {
        return true;
      }
    }
    return false;
  }

  function observeScopedTarget(target) {
    if (!target || target.getAttribute(OBSERVER_FLAG) === '1') {
      return false;
    }
    target.setAttribute(OBSERVER_FLAG, '1');

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type !== 'childList') {
          continue;
        }
        if (mutationHasRelevantNode(mutation.addedNodes) || mutationHasRelevantNode(mutation.removedNodes)) {
          queueUiSync();
          return;
        }
      }
    });

    observer.observe(target, { childList: true, subtree: true });
    return true;
  }

  function startScopedObservers(attempt = 0) {
    const mainTabContainer = document.getElementById('MainTabContainer');
    const videoWrap = document.getElementById('videowrap');
    const attachedMain = observeScopedTarget(mainTabContainer);
    const attachedVideo = observeScopedTarget(videoWrap);

    if (attachedMain && attachedVideo) {
      return;
    }

    if (attempt >= MAX_RETRIES) {
      return;
    }

    setTimeout(() => startScopedObservers(attempt + 1), RETRY_DELAY_MS);
  }

  function ensureMainToggle() {
    const container = document.getElementById('tools-button-container');
    if (!container || document.getElementById(TOGGLE_ID)) {
      return;
    }

    const button = document.createElement('button');
    button.id = TOGGLE_ID;
    button.className = 'btn btn-sm btn-default';
    button.textContent = '🎬';
    button.title = 'Toggle Movie Mode';
    button.style.marginLeft = '5px';
    button.addEventListener('click', () => {
      movieModeActive = !movieModeActive;
      updateMovieMode();
    });

    container.appendChild(button);
    syncUiState();
  }

  function ensureExitButton() {
    const header = document.getElementById('videowrap-header');
    if (!header || document.getElementById(EXIT_ID)) {
      return;
    }

    const exitBtn = document.createElement('span');
    exitBtn.id = EXIT_ID;
    exitBtn.className = 'glyphicon glyphicon-remove pointer';
    exitBtn.title = 'Exit Movie Mode';
    exitBtn.style.cssText = 'margin-left: 10px; font-size: 16px; color: #ff4444; opacity: 0.8; cursor: pointer;';
    exitBtn.addEventListener('mouseenter', () => {
      exitBtn.style.opacity = '1';
    });
    exitBtn.addEventListener('mouseleave', () => {
      exitBtn.style.opacity = '0.8';
    });
    exitBtn.addEventListener('click', () => {
      movieModeActive = false;
      updateMovieMode();
    });

    const titleSpan = header.querySelector('#currenttitle');
    if (titleSpan) {
      header.insertBefore(exitBtn, titleSpan);
    } else {
      header.appendChild(exitBtn);
    }

    syncUiState();
  }

  function waitForUi(attempt = 0) {
    ensureMainToggle();
    ensureExitButton();
    applyMovieModeStyle();
    syncUiState();

    if (document.getElementById(TOGGLE_ID) && document.getElementById(EXIT_ID)) {
      return;
    }

    if (attempt >= MAX_RETRIES) {
      return;
    }

    setTimeout(() => waitForUi(attempt + 1), RETRY_DELAY_MS);
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
      #${EXIT_ID}:hover {
        color: #ff6666 !important;
      }
    `);
  }

  applyMovieModeStyle();
  waitForUi();
  startScopedObservers();

})();
