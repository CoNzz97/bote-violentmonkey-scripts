// ==UserScript==
// @name         World Clock Toggle
// @namespace    world.clock
// @version      2.5
// @description  Adds clocks to nav bar
// @match        https://om3tcw.com/r/*
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function() {
  'use strict';

  const STORAGE_KEY = 'worldClockVisible';
  const TOGGLE_ID = 'world-clock-btn';
  const CLOCK_ITEM_ID = 'world-clock-li';
  const RETRY_DELAY_MS = 250;
  const MAX_RETRIES = 200;
  const CLOCK_UPDATE_MS = 30000;

  const TIMEZONES = {
    UK: 0,
    Japan: 9,
    America: -5
  };

  const state = {
    button: null,
    clockLi: null,
    clockAnchor: null,
    isVisible: GM_getValue(STORAGE_KEY, false),
    updateInterval: null
  };

  function injectStyles() {
    if (document.getElementById('world-clock-style')) {
      return;
    }

    const style = document.createElement('style');
    style.id = 'world-clock-style';
    style.textContent = `
      #${TOGGLE_ID}.active {
        background: #6c5ce7 !important;
        color: #fff !important;
      }
      #${TOGGLE_ID}:hover {
        background: #5a4dcc !important;
        color: #fff !important;
      }
      #${CLOCK_ITEM_ID} {
        display: none;
      }
      #${CLOCK_ITEM_ID} a {
        white-space: nowrap;
      }
    `;
    document.head.appendChild(style);
  }

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
    if (!state.clockAnchor) {
      return;
    }

    const times = calculateTimes();
    state.clockAnchor.textContent = `UK: ${times.UK} · JP: ${times.Japan} · EastUS: ${times.America}`;
  }

  function stopClockUpdates() {
    if (!state.updateInterval) {
      return;
    }

    clearInterval(state.updateInterval);
    state.updateInterval = null;
  }

  function startClockUpdates() {
    stopClockUpdates();
    updateClockDisplay();
    state.updateInterval = setInterval(updateClockDisplay, CLOCK_UPDATE_MS);
  }

  function ensureClockItem() {
    const motdLi = document.querySelector('#togglemotd')?.closest('li');
    if (!motdLi) {
      return false;
    }
    const navUl = motdLi.parentElement;

    if (state.clockLi && state.clockLi.isConnected) {
      if (state.clockLi.previousElementSibling !== motdLi) {
        motdLi.after(state.clockLi);
      }
      return true;
    }

    const existing = document.getElementById(CLOCK_ITEM_ID);
    if (existing) {
      state.clockLi = existing;
      state.clockAnchor = existing.querySelector('a');
      if (!state.clockAnchor) {
        state.clockAnchor = document.createElement('a');
        state.clockAnchor.href = '#';
        state.clockAnchor.addEventListener('click', (event) => event.preventDefault());
        state.clockLi.appendChild(state.clockAnchor);
      }
      if (state.clockLi.previousElementSibling !== motdLi) {
        motdLi.after(state.clockLi);
      }
      return true;
    }

    state.clockLi = document.createElement('li');
    state.clockLi.id = CLOCK_ITEM_ID;

    state.clockAnchor = document.createElement('a');
    state.clockAnchor.href = '#';
    state.clockAnchor.addEventListener('click', (event) => event.preventDefault());
    state.clockLi.appendChild(state.clockAnchor);

    motdLi.after(state.clockLi);

    return true;
  }

  function syncClockVisibility() {
    if (!ensureClockItem()) {
      return;
    }

    if (state.isVisible) {
      state.clockLi.style.display = 'list-item';
      startClockUpdates();
    } else {
      state.clockLi.style.display = 'none';
      stopClockUpdates();
    }
  }

  function ensureToggleButton() {
    const toolsContainer = document.getElementById('tools-button-container');
    if (!toolsContainer) {
      return false;
    }

    state.button = document.getElementById(TOGGLE_ID);
    if (state.button) {
      state.button.classList.toggle('active', state.isVisible);
      return true;
    }

    state.button = document.createElement('button');
    state.button.id = TOGGLE_ID;
    state.button.textContent = '🕐';
    state.button.title = 'Toggle World Clock in Navbar';
    state.button.className = 'btn btn-sm btn-default';
    state.button.style.marginLeft = '5px';
    state.button.classList.toggle('active', state.isVisible);
    state.button.addEventListener('click', () => {
      state.isVisible = !state.isVisible;
      GM_setValue(STORAGE_KEY, state.isVisible);
      state.button.classList.toggle('active', state.isVisible);
      syncClockVisibility();
    });

    toolsContainer.appendChild(state.button);
    return true;
  }

  function waitForUi(attempt = 0) {
    const hasButton = ensureToggleButton();
    const hasClockItem = ensureClockItem();
    syncClockVisibility();

    if (hasButton && hasClockItem) {
      return;
    }

    if (attempt >= MAX_RETRIES) {
      return;
    }

    setTimeout(() => waitForUi(attempt + 1), RETRY_DELAY_MS);
  }

  injectStyles();
  waitForUi();
})();
