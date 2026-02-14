# Cytube DOM Map — User Options Modal

## Modal container
- `#useroptions` — Bootstrap modal wrapper

Close buttons:
- `.modal-header .close[data-dismiss="modal"]`
- `.modal-footer button[data-dismiss="modal"]`

Save action:
- Save button calls `saveUserOptions()` (inline onclick in snapshot)

## Tabs (tab panes)
- `#us-general`
- `#us-playback`
- `#us-chat`
- `#us-scriptcontrol`
- `#us-mod`

Tab links are in `.nav.nav-tabs a[data-toggle="tab"]`

## General IDs
- `#us-theme` — theme select
- `#us-layout` — layout select
- `#us-no-channelcss` — ignore channel CSS
- `#us-no-channeljs` — ignore channel JS

## Playback IDs
- `#us-synch` — synchronize playback
- `#us-synch-accuracy` — threshold seconds
- `#us-hidevideo` — remove video player
- `#us-playlistbuttons` — hide playlist buttons
- `#us-oldbtns` — old playlist buttons
- `#us-default-quality` — quality select
- `#us-peertube` — accept PeerTube embeds

## Chat IDs
- `#us-chat-timestamp`
- `#us-sort-rank`
- `#us-sort-afk`
- `#us-blink-title`
- `#us-ping-sound`
- `#us-notifications`
- `#us-sendbtn`
- `#us-no-emotes`
- `#us-strip-image`
- `#us-chat-tab-method`

## Script access
- `#us-scriptcontrol table.table` — rows in `<tbody>`

## Moderator
- `#us-modflair`
- `#us-shadowchat`
- `#us-show-ip-in-tooltip`

## Safe scripting patterns
- The modal may not exist until opened; always null-check `#useroptions`.
- Prefer event delegation on `#useroptions` for dynamic content.
