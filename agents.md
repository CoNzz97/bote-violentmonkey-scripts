# AGENTS — Cytube Violentmonkey Client Scripts Repo

This repository contains **client-side userscripts** (Violentmonkey/Tampermonkey) that enhance the Cytube web UI.
Scripts run on a **live Cytube page** and interact with an existing, dynamic DOM that is **not owned by this repo**.

The `/docs` folder contains **DOM reference snapshots** (partial HTML + selector maps). Use them as **context and stable selector references**, not as complete/authoritative HTML.

---

## What to treat as “source of truth”

When coding against the Cytube DOM, consult these files in `/docs/cytube-dom/`:

- `*-reference.html`: minimal, cleaned structural snapshots
- `dom-map-*.md`: selector guides + safe patterns

If something is missing from the reference pack, your code must:

- null-check elements
- tolerate missing permissions/layout differences
- fail silently (no hard crash loops)

---

## Environment assumptions (core)

- Scripts execute in a **live Cytube environment**
- DOM is **dynamic and socket-driven**
- jQuery is available globally (`window.$` / `window.jQuery`)
- Bootstrap modals/tabs/collapse are already initialized by Cytube
- Elements may:
  - load late
  - be replaced
  - not exist due to permissions, layout, or login state

**Non-goals**

- Do not rewrite Cytube’s UI framework
- Do not ship a full HTML page in this repo
- Do not break native Cytube behavior

---

## DOM usage rules (critical)

1. Prefer **IDs**, then classes, then structure
2. Never rely on usernames embedded in class names unless unavoidable (usernames can contain CSS-breaking characters)
3. Always null-check queried nodes
4. Expect missing elements on:
   - mobile layouts
   - logged-out users
   - restricted permissions
5. Prefer additive behavior: *attach, don’t replace*

### Canonical anchors & selectors

| Feature | Selector |
|---|---|
| Main tabs container | `#MainTabContainer` |
| Navbar wrapper | `nav.navbar` |
| Navbar items container | `#nav-collapsible .nav.navbar-nav` |
| Chat log container | `#messagebuffer` |
| Chat input row | `#chatinputrow` |
| Chat input field | `#chatline` |
| Emote picker button | `#emotelistbtn` |
| User list container | `#userlist` |
| Playlist wrapper | `#playlistrow` |
| Playlist queue | `#queue` |
| Tools tab button container | `#tools-button-container` |
| Tools tab content area | `#tools-content-area` |
| User options modal | `#useroptions` |
| Channel settings modal | `#channeloptions` |

---

## Tools tab integration (preferred UI pattern)

If a script needs a UI panel, integrate it into the **Tools** tab.

### Rules

- One toggle button per script
- One root container per script (panel root)
- Toggle **visibility**, not existence
- Never auto-open UI on page load
- Persist state with GM storage (preferred) or localStorage (legacy scripts may already use localStorage)

### Required behavior

- Button toggles only its own panel
- Do not open/modify other scripts’ UI
- UI must survive reconnects / DOM refreshes

### Recommended structure

- Button: `#tools-button-container`
- Panel: child of `#tools-content-area`
- IDs/classes must be namespaced per script:
  - `cytube-tools-<scriptname>-*`

---

## Modals & tabs (Options / Channel Settings)

Use existing Cytube Bootstrap modals; do not recreate them from scratch:

- `#useroptions`
- `#channeloptions`

### Opening a modal and selecting a tab

```js
$('#channeloptions').modal('show');
$('a[href="#cs-permedit"]').tab('show');
```

### Safe notes

- Modals may not exist until opened (or may be injected late). Always null-check.
- Some channel settings tabs have inline socket calls (e.g. Banlist / Chat Filters / Log).
  - Do **not** overwrite these handlers.
  - If you need the data, trigger the tab the *normal* way (show tab link), then attach listeners after.

---

## “Permedit only” (extracting permissions editor safely)

`#cs-permedit` is a **tab pane** inside `#channeloptions`. To get **only** the permedit UI:

1. Ensure the channel modal exists (or open it).
2. Select the permedit tab (so content is present and laid out).
3. **Clone** the pane contents into your own panel (Tools tab) or your own modal.
4. Never move the original nodes (moving breaks Cytube’s own modal).

Example pattern:

```js
function clonePermEditInto(targetEl) {
  const modal = document.querySelector('#channeloptions');
  if (!modal) return;

  // Make sure the tab exists, then show it using bootstrap tab behavior.
  const tabLink = modal.querySelector('a[href="#cs-permedit"][data-toggle="tab"]');
  if (tabLink && window.jQuery) window.jQuery(tabLink).tab('show');

  const pane = modal.querySelector('#cs-permedit');
  if (!pane) return;

  // Clone, don't move.
  const clone = pane.cloneNode(true);
  clone.id = 'cytube-tools-permedit-clone';

  targetEl.replaceChildren(clone);
}
```

**Important:** In the reference snapshot, many selects in `#cs-permedit` don’t have stable IDs.
If your automation relies on specific fields/order, update the docs pack with a more detailed snapshot and/or
add stable hooks in your *clone only* (e.g., add `data-*` attributes after cloning).

---

## MutationObservers (preferred over polling)

Use MutationObservers for live updates rather than tight `setInterval` scanning.

### Approved targets

- Chat: `#messagebuffer`
- Playlist: `#queue`
- Userlist: `#userlist`

### Rules

- Mark processed nodes with `data-*` flags
- Avoid reprocessing on reconnects
- Disconnect observers when feature is disabled
- Never attach unbounded observers (e.g., observing `document.body` without strict filters)

Example:

```js
const mo = new MutationObserver((mutations) => {
  for (const m of mutations) {
    for (const n of m.addedNodes) {
      if (!(n instanceof HTMLElement)) continue;
      if (n.dataset.myScriptProcessed) continue;
      n.dataset.myScriptProcessed = '1';
      // ...
    }
  }
});
mo.observe(document.querySelector('#messagebuffer'), { childList: true });
```

---

## Styling rules

- Use `GM_addStyle` (preferred) for CSS injection
- Namespace all classes and IDs per script
- Match Cytube’s Bootstrap look (spacing, `btn btn-sm btn-default`, etc.)
- Never globally override Bootstrap selectors (`.btn`, `.modal`, `.nav`, etc.)
- Avoid `!important` unless the feature is specifically “layout mode” (movie mode, etc.)

---

## Storage & persistence

Preferred:

- `GM_getValue` / `GM_setValue` (per-script, less collision risk)

Allowed:

- `localStorage` (legacy scripts already use it; if you do, **namespace keys**) e.g. `cytube:<script>:setting`

Rules:

- Store structured data as JSON
- Version keys if schema changes
- Handle corrupted/missing data gracefully
- Cap stored logs/stats to avoid infinite growth

---

## Performance rules

- No unbounded arrays
- Cap stored logs/stats/message buffers
- Debounce DOM scans
- Avoid synchronous loops over large DOM trees
- Prefer event delegation and MutationObservers

---

## Safety rules

- Never emit socket events unless explicitly required by the feature
- Never override Cytube globals
- Never assume moderator/admin permissions
- Never block or replace native handlers
- Scripts must fail silently if required DOM is missing (no infinite retry spam)

---

## Files to consult (docs pack index)

- Navbar:
  - `cytube-navbar-reference.html`
  - `dom-map-navbar.md`
- Userlist:
  - `cytube-userlist-reference.html`
  - `dom-map-userlist.md`
- Message buffer:
  - `cytube-messagebuffer-reference.html`
  - `dom-map-messagebuffer.md`
- Chat input:
  - `cytube-chatinput-reference.html`
  - `dom-map-chatinput.md`
- Playlist:
  - `cytube-playlist-reference.html`
  - `dom-map-playlist.md`
- Tabs/Controls (Playlist / Polls / Tools):
  - `cytube-tabs-and-controls-reference.html`
  - `dom-map-tabs-and-controls.md`
- User Options Modal:
  - `cytube-useroptions-reference.html`
  - `dom-map-useroptions.md`
- Channel Settings Modal:
  - `cytube-channeloptions-reference.html`
  - `dom-map-channeloptions.md`

---

## Repo suggestions (practical)

1. **Shared utilities module (optional but recommended)**  
   Create a tiny shared helper file (or copy/paste “snippet header”) used by each userscript:
   - `waitForEl(selector, {timeout, interval})`
   - `oncePerPage(key, fn)`
   - `safeOn(container, event, selector, handler)` for delegated events
   - `createToolsToggle({id, icon, title, onToggle})`
   Keep it dependency-free and copyable (userscripts can’t easily import without a build step).

2. **Standardize storage**  
   Prefer GM storage; if keeping localStorage for compatibility, namespace keys consistently.

3. **Consistent namespacing**  
   For every script:
   - DOM IDs: `cytube-tools-<script>-...`
   - CSS classes: `<script>-...`
   - Storage keys: `cytube:<script>:...`

4. **Docs pack maintenance workflow**  
   When you discover missing/changed DOM:
   - update the corresponding `*-reference.html`
   - update `dom-map-*.md`
   - add a quick “gotcha” note (permissions, layout variants, element appears only when modal is open, etc.)

5. **Avoid tight retry loops**  
   If using `setTimeout(retry, 500)` patterns, add a max retry count or stop after success.
   Prefer observing a stable parent (navbar/main container) and react once children appear.

---

## Output expectations for Codex/agents

When asked to implement a feature:

- Use the `/docs/cytube-dom/*` reference snapshots + `dom-map-*.md` selectors
- Write code that tolerates DOM differences and missing permissions
- Keep changes modular per script
- Avoid breaking native Cytube behavior
