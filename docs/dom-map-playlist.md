# Cytube DOM Map — Playlist / Queue

## Main containers

- `#playlistrow` — playlist wrapper
- `#rightpane` — right pane
- `#rightpane-inner` — contains controls + queue list

## Recent media

- `#recentmedia` — collapsible recent container
- `#recentmedia-list` — `<ol>` of `.recent_entry.queue_entry`

## Search controls

- `#searchcontrol` — collapsible search panel
- `#library_query` — search input
- `#library_search` — library search button
- `#youtube_search` — YouTube search button
- `#library` — results list
- `.add-temp` — add-as-temporary checkbox (appears in multiple panels)

## Add from URL

- `#addfromurl` — collapsible
- `#mediaurl` — URL input
- `#queue_next` — queue next (can be disabled)
- `#queue_end` — queue last
- `#addfromurl-queue` — status output

## Queue list

- `#queue` — `<ul>` of `.queue_entry`
- `.queue_entry` — one queued item
- `.qe_title` — anchor title/link
- `.qe_time` — duration
- `.qe_blame` — "Added by" text
- `.btn-group` — item action buttons:
  - `.qbtn-play`, `.qbtn-next`, `.qbtn-delete`, `.qbtn-tmp`, `.qbtn-mark`

## Meta

- `#plmeta` — playlist meta container
- `#plcount` — item count
- `#pllength` — total playtime

## Special classes you may see on entries

- `.queue_active` — currently playing
- `.queue_temp` — temporary entry
- `.thumbed` — thumbnail styling
