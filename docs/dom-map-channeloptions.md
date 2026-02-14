# Cytube DOM Map — Channel Settings Modal

## Modal container
- `#channeloptions` — Bootstrap modal wrapper

Close controls
- `.modal-header .close[data-dismiss="modal"]`
- `.modal-footer button[data-dismiss="modal"]`

## Tabs (tab panes)
- `#cs-miscoptions` — General Settings
- `#cs-adminoptions` — Admin Settings
- `#cs-chatfilters` — Edit → Chat Filters
- `#cs-emotes` — Edit → Emotes
- `#cs-motdeditor` — Edit → MOTD
- `#cs-csseditor` — Edit → CSS
- `#cs-jseditor` — Edit → Javascript
- `#cs-permedit` — Edit → Permissions (large form)
- `#cs-chanranks` — Edit → Moderators
- `#cs-banlist` — Ban list
- `#cs-chanlog` — Log
- `#cs-recentjoins` — Recent connections (pane exists even if header link may vary)

## Dropdown / nav gotchas
- Edit dropdown toggle: `#cs-edit-dd-toggle`
- Some tab links have inline socket calls:
  - Chat Filters: `socket.emit('requestChatFilters')`
  - Moderators: `socket.emit('requestChannelRanks')`
  - Ban list: `socket.emit('requestBanlist')`
  - Log: `socket.emit('readChanLog')`
- For custom scripts: don’t overwrite these handlers; prefer additive listeners.

## General Settings IDs
- `#cs-allow_voteskip`, `#cs-allow_dupes`
- `#cs-voteskip_ratio`
- `#cs-maxlength`
- `#cs-playlist_max_duration_per_user`
- `#cs-afk_timeout`

Chat settings inside General pane:
- `#cs-enable_link_regex`
- `#cs-chat_antiflood`
- `#cs-chat_antiflood_burst`
- `#cs-chat_antiflood_sustained`
- `#cs-new_user_chat_delay`
- `#cs-new_user_chat_link_delay`

## Admin Settings IDs
- `#cs-pagetitle`, `#cs-password`
- `#cs-externalcss`, `#cs-externaljs`
- `#cs-show_public`, `#cs-torbanned`, `#cs-block_anonymous_users`, `#cs-allow_ascii_control`
- `#cs-playlist_max_per_user`

## Editor panes
MOTD:
- `#cs-motdtext`, `#cs-motdsubmit`

CSS:
- `#cs-csstext`, `#cs-csssubmit`

JS:
- `#cs-jstext`, `#cs-jssubmit`

Chat Filters:
- `#cs-chatfilters-newname`, `#cs-chatfilters-newregex`, `#cs-chatfilters-newflags`, `#cs-chatfilters-newreplace`
- `#cs-chatfilters-newsubmit`
- `#cs-chatfilters-export`, `#cs-chatfilters-import`, `#cs-chatfilters-exporttext`

Emotes:
- `#cs-emotes-newname`, `#cs-emotes-newimage`, `#cs-emotes-newsubmit`
- `#cs-emotes-export`, `#cs-emotes-import`, `#cs-emotes-exporttext`
- `.emotelist-table` — list container

Moderators:
- `#cs-chanranks-name`
- `#cs-chanranks-mod`, `#cs-chanranks-adm`, `#cs-chanranks-owner`

Channel log:
- `#cs-chanlog-filter` (multi-select)
- `#cs-chanlog-text` (pre)
- `#cs-chanlog-refresh`

## Permissions pane
- Pane anchor: `#cs-permedit`
- Content is many unlabeled `<select class="form-control">` without stable IDs in snapshot.
  - If you plan to script it, add a more detailed snapshot of `#cs-permedit` with the specific labels/order you rely on.
