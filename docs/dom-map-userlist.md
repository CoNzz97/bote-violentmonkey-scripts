# Cytube DOM Map — User List

## Main container

- `#userlist` — user list container

## Entry wrapper

- `.userlist_item` — one user row
- `#useritem-<username>` — row id (example: `#useritem-etch`)

## Username node

- Often a `span` with:
  - `.userlist-<username>` and/or `#userlist-<username>`
  - role markers like `.userlist_owner`, `.userlist_admin`, `.userlist_op`, `.userlist_guest`

## AFK

- `.userlist_afk` — AFK users
- `.glyphicon-time` — clock icon

## Dropdown

- `.user-dropdown` — hidden action menu per user (buttons inside)

## Safer patterns

- Prefer iterating entries:
  - `document.querySelectorAll("#userlist .userlist_item")`
- Extract the displayed name from the text content of the main name span.
