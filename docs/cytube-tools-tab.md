# Cytube Tools Tab — Integration Guide

This doc describes the **shared UI surface** provided by `Cytube Tools Tab.js`, and the patterns that other
userscripts should follow to add buttons/panels without fighting Cytube’s dynamic DOM.

---

## What `Cytube Tools Tab.js` provides

It ensures a Bootstrap tab exists:

- Tab link: `a[href="#toolsTab"]`
- Tab pane: `#toolsTab`

Inside the pane, it creates:

- `#tools-button-container` — place for script toggle buttons
- `#tools-content-area` — place for script panels

These IDs are referenced in the DOM context pack (`dom-map-tabs-and-controls.md`).

---

## Why this exists

Many scripts want a “home” for UI. If every script injects UI into random parts of the page, it becomes:

- hard to find controls
- prone to collisions and layout breakage
- difficult to maintain across Cytube updates

The Tools tab makes UI predictable and keeps the main page clean.

---

## Integration contract for other scripts

### Do

- Append **one** toggle button into `#tools-button-container`.
- Append **one** panel root into `#tools-content-area`.
- Toggle panel **visibility**, not existence.
- Persist open/closed state via `GM_getValue`/`GM_setValue` (preferred) or `localStorage` (legacy).

### Don’t

- Don’t rename or remove `#tools-button-container` / `#tools-content-area`.
- Don’t delete other scripts’ buttons/panels.
- Don’t auto-open your UI on page load.
- Don’t use global CSS selectors that override Cytube/Bootstrap.

---

## Recommended naming scheme

- Button id: `<script>-toggle`
  - examples: `movie-mode-toggle`, `cytube-logger-toggle`
- Panel root id: `cytube-tools-<script>-panel`
  - example: `cytube-tools-movie-mode-panel`
- CSS class prefix: `.cytube-tools-<script>-*`

---

## Recommended helper pattern

Copy/paste this into scripts that need a Tools button + panel:

```js
const RETRY_DELAY_MS = 500;
const MAX_RETRIES = 120;

function waitForEl(selector, attempt = 0) {
  const el = document.querySelector(selector);
  if (el) return Promise.resolve(el);
  if (attempt >= MAX_RETRIES) return Promise.resolve(null);
  return new Promise((r) => setTimeout(r, RETRY_DELAY_MS))
    .then(() => waitForEl(selector, attempt + 1));
}

async function ensureToolsUi({ toggleId, toggleLabel, toggleTitle, panelId }) {
  const btnHost = await waitForEl('#tools-button-container');
  const panelHost = await waitForEl('#tools-content-area');
  if (!btnHost || !panelHost) return null;

  // Button
  let btn = document.getElementById(toggleId);
  if (!btn) {
    btn = document.createElement('button');
    btn.id = toggleId;
    btn.className = 'btn btn-sm btn-default';
    btn.textContent = toggleLabel;
    btn.title = toggleTitle;
    btnHost.appendChild(btn);
  }

  // Panel root
  let panel = document.getElementById(panelId);
  if (!panel) {
    panel = document.createElement('div');
    panel.id = panelId;
    panel.style.display = 'none';
    panelHost.appendChild(panel);
  }

  return { btn, panel };
}
```

### Toggle behavior

```js
function togglePanel(panel, btn) {
  const next = panel.style.display !== 'block';
  panel.style.display = next ? 'block' : 'none';
  btn.classList.toggle('active', next);
}
```

---

## Coexistence rules (avoid collisions)

1. **No shared IDs** except the host IDs provided by the Tools Tab script.
2. Never attach a body-wide MutationObserver unless you:
   - filter heavily
   - use a hard stop
   - disconnect when disabled
3. Prefer event delegation inside your own panel.

---

## Troubleshooting

### “My button doesn’t show up”

- Your script likely ran before Tools Tab existed.
  - Wait for `#tools-button-container` and `#tools-content-area` before injecting.
  - Use a max-retry pattern (500ms x 120 = 60s) rather than infinite loops.

### “The Tools tab duplicates”

- Always check `document.querySelector('a[href="#toolsTab"]')` before injecting a new tab.
  - `Cytube Tools Tab.js` already does this; other scripts should not add the tab.

### “My panel disappears after reconnect”

- Cytube can re-render sections.
  - Re-run your `ensureToolsUi(...)` on a safe schedule (max-retry),
    or observe a stable parent like `#MainTabContainer` with strict filtering.

---

## Reference files in this repo

- Host script: `Cytube Tools Tab.js`
- DOM guide: `docs/dom-map-tabs-and-controls.md`
- HTML snapshot: `docs/cytube-tabs-and-controls-reference.html`
