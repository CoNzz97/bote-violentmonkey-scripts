# Usercount Hover Profile Box (Cytube)

This document describes the **hover-expanded DOM behavior** of the Cytube user count element.

## Trigger element

```html
<span class="pointer" id="usercount">
  46 connected users
</span>
```

## Hover-expanded state

On mouse hover, Cytube **injects a child element** into the same node.
No separate tooltip/popover container is created.

```html
<span class="pointer" id="usercount">
  46 connected users
  <div class="profile-box">
    <strong>Site Admins:&nbsp;</strong>0<br>
    <strong>Channel Admins:&nbsp;</strong>4<br>
    <strong>Moderators:&nbsp;</strong>12<br>
    <strong>Regular Users:&nbsp;</strong>21<br>
    <strong>Guests:&nbsp;</strong>2<br>
    <strong>Anonymous:&nbsp;</strong>7<br>
    <strong>AFK:&nbsp;</strong>25<br>
  </div>
</span>
```

### Notes

- `.profile-box` is ephemeral (hover-only)
- Inserted on hover, removed on mouseleave
- Inline position styles are dynamic and omitted

## Safe selectors

```js
const trigger = document.querySelector('#usercount');
const box = trigger?.querySelector('.profile-box');
```

## Recommended handling

- Use MutationObserver on #usercount
- Never rely on inline positioning
