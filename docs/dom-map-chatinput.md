# Cytube DOM Map — Chat Input

## Main container

- `#chatinputrow` — wrapper for chat input and buttons

## Input

- `#chatline` — main text input (maxlength ~320)

## Emote picker

- `#emotelistbtn` — emote list button

## Guest login

- `#guestlogin` — guest login block (hidden unless relevant)
- `#guestname` — guest name field

## Safe patterns

- Focus input:
  - `document.querySelector("#chatline")?.focus()`
- Use key handlers on `#chatline` (Enter to send, etc.)
- If adding buttons, append within `#chatinputrow`.
