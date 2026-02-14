// ==UserScript==
// @name         World Clock Toggle (Perfectly Matched Navbar)
// @namespace    world.clock
// @version      2.4
// @description  Toggle button in Tools tab, times inserted after MOTD, perfectly matched style
// @match        https://om3tcw.com/r/*
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function() {
    'use strict';

    const TIMEZONES = {
        'UK': 0,
        'Japan': 9,
        'America': -5
    };

    let state = {
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
        if (!state.clockLi) return;
        const times = calculateTimes();
        state.clockLi.innerHTML = `
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

            state.button = document.createElement('button');
            state.button.id = 'world-clock-btn';
            state.button.textContent = '🕐';
            state.button.title = 'Toggle World Clock in Navbar';
            state.button.classList.add('btn', 'btn-sm', 'btn-default');
            state.button.style.marginLeft = '5px';

            if (state.isVisible) state.button.classList.add('active');

            toolsContainer.appendChild(state.button);

            state.button.addEventListener('click', () => {
                state.isVisible = !state.isVisible;
                GM_setValue('worldClockVisible', state.isVisible);

                if (state.isVisible) {
                    createClockLi();
                    state.clockLi.style.display = 'list-item';
                    updateClockDisplay();
                    state.updateInterval = setInterval(updateClockDisplay, 30000);
                    state.button.classList.add('active');
                } else {
                    if (state.clockLi) state.clockLi.style.display = 'none';
                    if (state.updateInterval) clearInterval(state.updateInterval);
                    state.button.classList.remove('active');
                }
            });

            // Button styles (same as before)
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
        if (state.clockLi) return;

        const checkInterval = setInterval(() => {
            const navUl = document.querySelector('ul.nav.navbar-nav');
            const motdLi = navUl?.querySelector('a#togglemotd')?.parentElement;
            if (!navUl || !motdLi) return;
            clearInterval(checkInterval);

            state.clockLi = document.createElement('li');
            state.clockLi.id = 'world-clock-li';
            state.clockLi.style.display = 'none';

            motdLi.after(state.clockLi);
        }, 100);
    }

    // Initialize
    createToggleButton();
    createClockLi();

    // Restore visibility if enabled
    if (state.isVisible) {
        const restore = setInterval(() => {
            if (state.clockLi) {
                clearInterval(restore);
                state.clockLi.style.display = 'list-item';
                updateClockDisplay();
                state.updateInterval = setInterval(updateClockDisplay, 30000);
            }
        }, 100);
    }
})();