// ==UserScript==
// @name         Movie Mode Toggle
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  Toggle Movie Mode CSS + Exit button in video header
// @author       You + Gemini
// @match        https://om3tcw.com/r/*
// @grant        GM_addStyle
// ==/UserScript==

(function() {
    'use strict';

    let movieModeActive = localStorage.getItem("movieModeEnabled") === "true";
    let movieModeStyleElement = null;

    const movieModeCSS = `
        #MainTabContainer { display: none !important; }
        #mainpage { padding-top: 0 !important; }
        nav.navbar { display: none !important; }
        ::-webkit-scrollbar { width: 0 !important; }
        * { scrollbar-width: none !important; }
    `;

    // --- Core Logic ---

    function updateMovieMode() {
        // 1. Manage the CSS
        if (movieModeActive) {
            if (!movieModeStyleElement) {
                movieModeStyleElement = GM_addStyle(movieModeCSS);
            }
        } else {
            if (movieModeStyleElement) {
                movieModeStyleElement.remove();
                movieModeStyleElement = null;
            }
        }

        // 2. Update Toggle Button Appearance
        const mainBtn = document.getElementById('movie-mode-toggle');
        if (mainBtn) {
            mainBtn.classList.toggle('active', movieModeActive);
        }

        // 3. Update Exit Button Visibility
        const exitBtn = document.getElementById('movie-mode-exit');
        if (exitBtn) {
            exitBtn.style.display = movieModeActive ? 'inline' : 'none';
        }

        // 4. Save State
        localStorage.setItem("movieModeEnabled", movieModeActive);
    }

    // --- UI Elements ---

    function createMainToggle() {
        const container = document.getElementById('tools-button-container');
        if (!container) {
            setTimeout(createMainToggle, 500);
            return;
        }
        if (document.getElementById('movie-mode-toggle')) return;

        const btn = document.createElement('button');
        btn.id = 'movie-mode-toggle';
        btn.className = 'btn btn-sm btn-default';
        btn.textContent = '🎬';
        btn.title = 'Toggle Movie Mode';
        btn.style.marginLeft = '5px';

        btn.onclick = () => {
            movieModeActive = !movieModeActive;
            updateMovieMode();
        };

        container.appendChild(btn);
        updateMovieMode(); // Sync initial state
    }

    function createExitButton() {
        const header = document.getElementById('videowrap-header');
        if (!header) {
            setTimeout(createExitButton, 500);
            return;
        }
        if (document.getElementById('movie-mode-exit')) return;

        const exitBtn = document.createElement('span');
        exitBtn.id = 'movie-mode-exit';
        exitBtn.className = 'glyphicon glyphicon-remove pointer';
        exitBtn.title = 'Exit Movie Mode';
        exitBtn.style.cssText = 'margin-left: 10px; font-size: 16px; color: #ff4444; opacity: 0.8; cursor: pointer;';

        exitBtn.onmouseover = () => exitBtn.style.opacity = '1';
        exitBtn.onmouseout = () => exitBtn.style.opacity = '0.8';

        exitBtn.onclick = () => {
            movieModeActive = false;
            updateMovieMode();
        };

        // Insert into header
        const titleSpan = header.querySelector('#currenttitle');
        if (titleSpan) {
            header.insertBefore(exitBtn, titleSpan);
        } else {
            header.appendChild(exitBtn);
        }

        updateMovieMode(); // Sync initial state
    }

    // --- Initialization ---

    GM_addStyle(`
        #movie-mode-toggle.active {
            background: #337ab7 !important;
            border-color: #2e6da4 !important;
            color: white !important;
        }
        #movie-mode-exit:hover {
            color: #ff6666 !important;
        }
    `);

    // Run on start
    createMainToggle();
    createExitButton();

    // Re-run if content changes (AJAX/Dynamic loading)
    const observer = new MutationObserver(() => {
        if (!document.getElementById('movie-mode-toggle')) createMainToggle();
        if (!document.getElementById('movie-mode-exit')) createExitButton();
    });
    observer.observe(document.body, { childList: true, subtree: true });

})();