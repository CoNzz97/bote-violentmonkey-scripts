# Cytube DOM Map — Message Buffer

## Main container

- `#messagebuffer` — chat log container

## Message nodes

- Direct children are message-like divs:
  - `.chat-msg-<username>` — typical chat message
  - `.poll-notify` — poll notifications
  - `.server-msg-reconnect` — connection status
  - `.server-whisper` — join/leave system text (usually inside `.chat-msg-$server$`)

## Sub-elements

- `.timestamp` — time string
- `strong.username` — “Name:” label (may be missing on short/system messages)
- `img.channel-emote` — emotes in messages
- `.tweet-preview-toggle` — example custom inline button

## Safe patterns

- Iterate messages:
  - `document.querySelectorAll("#messagebuffer > div")`
- Observe new messages:
  - MutationObserver on `#messagebuffer` with `{ childList: true }`
