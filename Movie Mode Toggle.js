// ==UserScript==
// @name         Movie Mode Toggle
// @namespace    http://tampermonkey.net/
// @version      1.3
// @description  Toggle Movie Mode CSS + Exit button in video header
// @author       You + Gemini
// @match        https://om3tcw.com/r/*
// @grant        GM_addStyle
// ==/UserScript==

(function() {
  'use strict';

  const STORAGE_KEY = 'movieModeEnabled';
  const TOGGLE_ID = 'movie-mode-toggle';
  const EXIT_ID = 'movie-mode-exit';
  const RETRY_DELAY_MS = 500;
  const MAX_RETRIES = 120;

  const movieModeCSS = `
    #MainTabContainer { display: none !important; }
    #mainpage { padding-top: 0 !important; }
    nav.navbar { display: none !important; }
    ::-webkit-scrollbar { width: 0 !important; }
    * { scrollbar-width: none !important; }
  `;

  let movieModeActive = readStoredState();
  let movieModeStyleElement = null;

  function readStoredState() {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch (err) {
      return false;
    }
  }

  function saveStoredState() {
    try {
      localStorage.setItem(STORAGE_KEY, String(movieModeActive));
    } catch (err) {
      // Ignore storage failures to keep runtime behavior stable.
    }
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

  applyMovieModeStyle();
  waitForUi();

  const observer = new MutationObserver(() => {
    if (!document.getElementById(TOGGLE_ID)) {
      ensureMainToggle();
    }
    if (!document.getElementById(EXIT_ID)) {
      ensureExitButton();
    }
    syncUiState();
  });

  observer.observe(document.body, { childList: true, subtree: true });

})();
