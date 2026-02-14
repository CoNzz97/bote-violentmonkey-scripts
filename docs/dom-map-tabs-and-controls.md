# Cytube DOM Map — Tabs + Controls

## Main container

- `#MainTabContainer` — wraps tab headers + all tab panes

## Tabs

- `#playlistTab` — playlist pane

- `#pollsTab` — polls pane
- `#toolsTab` — tools pane
- `#pollsbadge` — badge/count indicator on Polls tab

## Playlist controls

Container:

- `#plcontrol` — playlist control button group

Buttons (IDs are the important part):

- `#showmediaurl` — toggles `#addfromurl`
- `#showsearch` — toggles `#searchcontrol`
- `#showcustomembed` — toggles `#customembed`
- `#showplaylistmanager` — toggles `#playlistmanager`
- `#showrecent` — toggles `#recentmedia`

Other controls:

- `#clearplaylist` — clear (may be hidden)
- `#shuffleplaylist` — shuffle
- `#hidePlaylist` — hide/show playlist
- `#qlockbtn` — playlist lock status (disabled in snapshot)
- `#leader` — leader/seek control
- `#rratbutton`, `#rratrefresh` — custom inputs

## Video controls

Container:

- `#videocontrols` — video-related controls

Buttons:

- `#mediarefresh` — reload player
- `#fullscreenbtn` — fullscreen
- `#getplaylist` — retrieve playlist links
- `#voteskip` — voteskip

## Polls

- `#newpollbtn` — create poll
- `#pollhistory` — poll history container

## Tools

- `#tools-button-container` — where tool toggles live
- `#tools-content-area` — tool panels/content
- `#cytube-logger-menu` — emote tracker panel

Tool button IDs:

- `#movie-mode-toggle`
- `#world-clock-btn`
- `#tweet-main-toggle`
- `#cytube-logger-toggle`
- `#holodex-toggle-btn`

Logger buttons:

- `#logger-preview-btn`
- `#logger-stats-btn`
- `#logger-export-btn`
- `#logger-settings-btn`
- `#logger-clear-btn`
