# Cytube Userlist Hover Dropdown (`.user-dropdown`)

Cytube’s userlist entries (`#userlist`) can expose a hover popup menu for each user.

## Where it lives

- Root list: `#userlist`
- Per-user row: `.userlist_item`
  - Example id: `#useritem-Kusa`
- Hover popup menu: `.user-dropdown`

Observed structure (example):

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

Notes:

- The `.user-dropdown` is commonly present but hidden (`display: none`) until Cytube toggles it.
- Buttons shown depend on your permissions and the target user (e.g., “Unmute” may be hidden).

## Console logger snippet

This attaches event listeners to `#userlist` and logs the `.user-dropdown` HTML when you hover a user row.

```js
(function () {
  const root = document.querySelector('#userlist');
  if (!root) {
    console.warn('No #userlist found');
    return;
  }

  const logDropdown = (item, label) => {
    const dropdown = item.querySelector('.user-dropdown');
    if (!dropdown) return;

    console.log(label, {
      userId: item.id,
      html: dropdown.outerHTML
    });
  };

  root.addEventListener(
    'mouseover',
    (e) => {
      const item = e.target.closest('.userlist_item');
      if (!item) return;

      // Defer until Cytube toggles visibility
      setTimeout(() => logDropdown(item, 'hover open:'), 0);
    },
    true
  );

  root.addEventListener(
    'mouseout',
    (e) => {
      const item = e.target.closest('.userlist_item');
      if (!item) return;

      setTimeout(() => logDropdown(item, 'hover close:'), 0);
    },
    true
  );

  console.log('[Cytube] Userlist hover logger attached');
})();
```

### If you want the *whole row* HTML

Replace `dropdown.outerHTML` with `item.outerHTML` in the logger.

## Script integration guidance

- Prefer selecting by `#useritem-<username>` **only** when you already know the username.
- Otherwise, use `event.target.closest('.userlist_item')` while handling pointer events.
- Don’t rely on `.userlist-<name>` classes; they’re convenient but can break if usernames contain characters Cytube escapes/normalizes.
