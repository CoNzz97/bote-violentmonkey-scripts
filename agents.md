# AGENTS — Cytube Violentmonkey Client Scripts

This repo contains **client-side userscripts** (Violentmonkey/Tampermonkey) that enhance the Cytube web UI.
Scripts run on a **live Cytube page** and interact with an existing, dynamic DOM that is **not owned by this repo**.

The `/docs` folder contains a **DOM context pack** (partial HTML snapshots + selector maps). Treat it as the
best available reference for stable selectors, **not** authoritative/full page HTML.

---

## Source of truth for DOM + selectors

Use these as your primary references:

- `docs/*reference.html`: minimal, cleaned structural snapshots
- `docs/dom-map-*.md`: selector guides + safe patterns
- `docs/README.md`: how to use the context pack

If something is missing from the reference pack, your code must:

- null-check elements
- tolerate missing permissions/layout differences
- fail silently (no infinite retry spam)

---

## Environment assumptions

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

## Core DOM usage rules (critical)

1. Prefer **IDs**, then classes, then structure.
2. Avoid usernames embedded in selectors (usernames can contain CSS-breaking characters).
3. Always null-check queried nodes.
4. Expect missing elements on:
   - mobile layouts
   - logged-out users
   - restricted permissions
5. Prefer additive behavior: **attach, don’t replace**.

### Canonical anchors & selectors

| Feature | Selector |
|---|---|
| Main tabs container | `#MainTabContainer` |
| Navbar wrapper | `nav.navbar` |
| Navbar items container | `#nav-collapsible .nav.navbar-nav` |
| Chat log container | `#messagebuffer` |
| Chat input row | `#chatinputrow` |
| Chat input field | `#chatline` |
| User list container | `#userlist` |
| Playlist wrapper | `#playlistrow` |
| Playlist queue | `#queue` |
| Tools tab pane | `#toolsTab` |
| Tools tab button container | `#tools-button-container` |
| Tools tab content area | `#tools-content-area` |
| User options modal | `#useroptions` |
| Channel settings modal | `#channeloptions` |

---

## Tools Tab host script (shared UI surface)

**Important:** This repo uses `Cytube Tools Tab.js` as the shared “UI host” for other scripts.

### Contract

- `Cytube Tools Tab.js` is responsible for ensuring the Tools tab exists and that it contains:
  - `#tools-button-container` (for toggle buttons)
  - `#tools-content-area` (for panels)
- Other scripts should **only**:
  - append their own button(s) into `#tools-button-container`
  - append their own panel root into `#tools-content-area`
  - toggle panel visibility (do not delete/recreate constantly)

### Rules

- One toggle button per script.
- One panel root per script.
- Toggle **visibility**, not existence.
- Never auto-open UI on page load.
- Never modify/remove other scripts’ UI.
- IDs/classes must be namespaced per script:
  - IDs: `cytube-tools-<script>-...`
  - classes: `<script>-...`

See: `docs/cytube-tools-tab.md` for the full integration guide and recommended helper patterns.

---

## Modals & tabs (Options / Channel Settings)

Use existing Cytube Bootstrap modals; do **not** recreate them from scratch:

- `#useroptions`
- `#channeloptions`

### Opening a modal and selecting a tab

```js
$('#channeloptions').modal('show');
$('a[href="#cs-permedit"]').tab('show');
```

### Notes

- Modals may not exist until opened (or may be injected late). Always null-check.
- Some channel settings tabs have inline socket calls (Banlist / Chat Filters / Log).
  - Do **not** overwrite these handlers.
  - If you need the data, trigger the tab the normal way, then attach your listeners after.

---

## “Permedit only” (extracting permissions editor safely)

`#cs-permedit` is a **tab pane** inside `#channeloptions`. To get only the permedit UI:

1. Ensure the channel modal exists (or open it).
2. Select the permedit tab (so content is present and laid out).
3. **Clone** the pane contents into your own panel (Tools tab) or your own modal.
4. Never move original nodes (moving breaks Cytube’s own modal).

Example pattern:

```js
function clonePermEditInto(targetEl) {
  const modal = document.querySelector('#channeloptions');
  if (!modal) return;

  const tabLink = modal.querySelector('a[href="#cs-permedit"][data-toggle="tab"]');
  if (tabLink && window.jQuery) window.jQuery(tabLink).tab('show');

  const pane = modal.querySelector('#cs-permedit');
  if (!pane) return;

  const clone = pane.cloneNode(true);
  clone.id = 'cytube-tools-permedit-clone';
  targetEl.replaceChildren(clone);
}
```

**Gotcha:** Many selects in `#cs-permedit` don’t have stable IDs in the snapshot.
If automation relies on specific fields/order, update the docs pack and/or add stable hooks
to your *clone only* (e.g., `data-*` attributes after cloning).

---

## MutationObservers (preferred over polling)

Use MutationObservers for live updates rather than tight polling loops.

### Approved targets

- Chat: `#messagebuffer`
- Playlist: `#queue`
- Userlist: `#userlist`

### Rules

- Mark processed nodes with `data-*` flags
- Avoid reprocessing on reconnects
- Disconnect observers when feature is disabled
- Avoid observing `document.body` unless you have strict filtering + a hard stop

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

- Use `GM_addStyle` for CSS injection.
- Namespace all CSS selectors per script.
- Match Cytube’s Bootstrap look (`btn btn-sm btn-default`, spacing, etc.).
- Never globally override Bootstrap selectors (`.btn`, `.modal`, `.nav`, etc.).
- Avoid `!important` unless the feature is specifically “layout mode” (e.g. movie mode).

---

## Storage & persistence

Preferred:

- `GM_getValue` / `GM_setValue` (per-script, less collision risk)

Allowed:

- `localStorage` (legacy scripts may already use it; **namespace keys**)

Rules:

- Store structured data as JSON
- Version keys if schema changes
- Handle corrupted/missing data gracefully
- Cap stored logs/stats to avoid infinite growth

Suggested key format:

- `cytube:<script>:<setting>`

---

## Performance rules

- No unbounded arrays
- Cap stored logs/stats/message buffers
- Debounce DOM scans
- Avoid synchronous loops over large DOM trees
- Prefer event delegation + MutationObservers

---

## Safety rules

- Never emit socket events unless explicitly required by the feature
- Never override Cytube globals
- Never assume moderator/admin permissions
- Never block or replace native handlers
- Scripts must fail silently if required DOM is missing

---

## Docs pack index

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
- Tools Tab integration (this repo):
  - `cytube-tools-tab.md`

---


---

## Hover-injected DOM elements (ephemeral mutations)

Some Cytube UI elements **mutate their own DOM on hover** rather than using separate tooltip nodes.
These elements will appear “normal” in the Elements tab unless they are actively hovered.

### Known pattern: `#usercount` hover profile box

- Base element:
  - `#usercount` (`<span class="pointer" id="usercount">`)
- On hover:
  - Cytube **injects a child `<div class="profile-box">` directly inside `#usercount`**
  - This node is removed on mouseleave
- The injected node:
  - Is repositioned on every mousemove
  - Cannot be reliably inspected via Elements tab
  - Must be captured via console timing or runtime observers

Example hover-expanded structure:

```html
<span id="usercount" class="pointer">
  46 connected users
  <div class="profile-box">
    <strong>Site Admins:</strong> 0<br>
    <strong>Channel Admins:</strong> 4<br>
    <strong>Moderators:</strong> 12<br>
    <strong>Regular Users:</strong> 21<br>
    <strong>Guests:</strong> 2<br>
    <strong>Anonymous:</strong> 7<br>
    <strong>AFK:</strong> 27<br>
  </div>
</span>
```

### Rules for scripts

- Do **not** assume `.profile-box` exists persistently
- Always query **inside** `#usercount`
- Never move or detach the injected node
- If you need the data:
  - read it while hovered, or
  - recreate your own UI using socket/userlist state

See: `docs/cytube-usercount-hover-profile-box.md`



## Userlist username hover dropdown

Hovering a user’s name in `#userlist` injects (or reveals) a per-user action menu:

- Container: `.userlist_item` (e.g. `#useritem-Kusa`)
- Popup: `.user-dropdown` (usually `style="display: none;"` until Cytube toggles it)

Example (as observed):

```html
<div class="userlist_item" id="useritem-Kusa">
  <span></span>
  <span class="userlist_owner userlist-Kusa">Kusa</span>
  <div class="user-dropdown" style="display: none;">
    <strong>Kusa</strong><br>
    <div class="btn-group-vertical">
      <button class="btn btn-xs btn-default">Ignore User</button>
      <button class="btn btn-xs btn-default">Private Message</button>
      <button class="btn btn-xs btn-default">Give Leader</button>
      <button class="btn btn-xs btn-default">Kick</button>
      <button class="btn btn-xs btn-default">Mute</button>
      <button class="btn btn-xs btn-default">Shadow Mute</button>
      <button class="btn btn-xs btn-default" style="display: none;">Unmute</button>
    </div>
  </div>
</div>
```

### Rules for scripts

- Do **not** assume `.user-dropdown` is visible (or even present) at all times
- Always query **inside** the `.userlist_item` you’re operating on
- Never move/detach Cytube’s `.user-dropdown`
- Don’t rely on the username being present in a CSS class (e.g. `.userlist-Kusa`) — use `id="useritem-<name>"` or the inner text

See: `docs/cytube-userlist-hover-user-dropdown.md`


## Practical repo suggestions

1. **Standardize on max-retry waiters**  
   Prefer a `waitFor(selector)` helper with a max attempt count (like your Tools Tab + Movie Mode scripts),
   rather than an always-on `MutationObserver(document.body)`.

2. **Namespacing standard**  
   - Button IDs: `<script>-toggle`
   - Panel root IDs: `cytube-tools-<script>-panel`
   - CSS prefix: `.cytube-tools-<script>-*`

3. **Shared “Tools Tab API” snippet**  
   Keep a small copy/paste helper pattern (in docs) that scripts can reuse to:
   - ensure the Tools tab is present
   - register a button
   - register a panel
   - persist open/closed state
