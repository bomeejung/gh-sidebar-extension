# GH Issues Sidebar (Brave/Chrome)

Personal GitHub issues + a local "favorites" star, in the side panel.

## Install (unpacked)

1. Open `brave://extensions`
2. Toggle **Developer mode** (top right)
3. Click **Load unpacked** → select this folder
4. Pin the extension, click its icon → side panel opens
5. Click ⚙ → paste a GitHub PAT (scope: `repo`, or `public_repo` for public only)

## Use

- View dropdown: ★ Favorites, Assigned, Created, Mentioned, Review requested
- Click ★ on any issue to favorite/unfavorite (stored locally in `chrome.storage.local`)
- ↻ to refresh, filter box for substring search

## Notes

- Favorites survive across machines only if you sync via `chrome.storage.sync` (not used here — local-only).
- Token is stored in `chrome.storage.local`. Treat the profile as you would any place storing a PAT.
