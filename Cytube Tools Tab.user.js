// ==UserScript==
// @name         Cytube Tools Tab
// @namespace    cytube.tools.tab
// @version      1.1
// @description  Adds a 'Tools' tab to organize script buttons and content
// @match        https://om3tcw.com/r/*
// @grant        GM_addStyle
// ==/UserScript==

(function() {
    'use strict';

    // Wait for the page to load the existing tabs
    const init = () => {
        const tabList = document.querySelector('ul.nav.nav-tabs[role="tablist"]');
        if (!tabList) {
            setTimeout(init, 500); // Retry if not found yet
            return;
        }

        // Check if our tab already exists (to avoid duplicates)
        if (document.querySelector('a[href="#toolsTab"]')) return;

        // Add new tab <li> to the right of existing tabs
        const newLi = document.createElement('li');
        newLi.setAttribute('role', 'presentation');
        const newA = document.createElement('a');
        newA.setAttribute('role', 'tab');
        newA.setAttribute('data-toggle', 'tab');
        newA.setAttribute('href', '#toolsTab');
        newA.textContent = 'Tools';
        newLi.appendChild(newA);
        tabList.appendChild(newLi); // Appends to the end

        // Find or create the tab content container (assumes .tab-content follows .nav-tabs)
        let tabContent = tabList.nextElementSibling;
        if (!tabContent || !tabContent.classList.contains('tab-content')) {
            tabContent = document.createElement('div');
            tabContent.classList.add('tab-content');
            tabList.parentNode.insertBefore(tabContent, tabList.nextSibling);
        }

        // Add the new tab pane
        const newPane = document.createElement('div');
        newPane.setAttribute('role', 'tabpanel');
        newPane.classList.add('tab-pane');
        newPane.id = 'toolsTab';

        // Add a button container inside the pane (this is where scripts will append buttons)
        const buttonContainer = document.createElement('div');
        buttonContainer.id = 'tools-button-container';
        buttonContainer.style.padding = '10px';
        buttonContainer.style.display = 'flex';
        buttonContainer.style.flexWrap = 'wrap';
        buttonContainer.style.gap = '5px';
        newPane.appendChild(buttonContainer);

        // Add content area below buttons
        const contentArea = document.createElement('div');
        contentArea.id = 'tools-content-area';
        contentArea.style.padding = '10px';
        contentArea.style.background = '#252525';
        contentArea.style.borderRadius = '4px';
        contentArea.style.overflowY = 'auto';
        contentArea.style.maxHeight = '400px'; // Adjustable
        newPane.appendChild(contentArea);

        tabContent.appendChild(newPane);

        // Add some basic styles for the tab pane
        GM_addStyle(`
            #toolsTab {
                background: #1a1a1a;
                color: #ddd;
                min-height: 200px;
            }
            #tools-button-container button {
                margin: 0 !important; /* Override messy margins from other scripts */
            }
        `);
    };

    // Run on page load
    if (document.readyState === 'complete') {
        init();
    } else {
        window.addEventListener('load', init);
    }
})();