# GH Issues Sidebar (Brave/Chrome)

Personal GitHub issues + a local "favorites" star, in the side panel.

## Install (unpacked)

1. Open `brave://extensions`
2. Toggle **Developer mode** (top right)
3. Click **Load unpacked** → select this folder
4. Pin the extension, click its icon → side panel opens

## One-time setup: register an OAuth App

The extension uses GitHub's **Device Flow** for sign-in, which requires a `client_id`.

1. Go to <https://github.com/settings/developers> → **OAuth Apps** → **New OAuth App**
2. Fill in any values for "Application name", "Homepage URL", and "Authorization callback URL" (the callback URL is unused for device flow — `https://localhost` works).
3. After creating the app, on its settings page check **Enable Device Flow** and click **Update**.
4. Copy the **Client ID**.
5. In the extension's options page (⚙ in the side panel), paste it into **OAuth App Client ID** and click **Save**.
6. Click **Sign in with GitHub** and enter the displayed code at <https://github.com/login/device>.

The Client ID is stored in `chrome.storage.local` — never committed to the repo. (Client IDs are public by design, but keeping them per-install means each user uses their own OAuth App.)

## Use

- View dropdown: ★ Favorites, Assigned, Created, Mentioned, Review requested
- Click ★ on any issue to favorite/unfavorite (stored locally in `chrome.storage.local`)
- ↻ to refresh, filter box for substring search
- Search view: open-issue search with optional org/repo scope (set in options)

## Auth notes

- **Sign in with GitHub** (preferred): tokens are issued by GitHub and can be revoked anytime at <https://github.com/settings/applications>. Scope: `repo`.
- **Personal Access Token** (fallback, in options under a disclosure): long-lived bearer token stored unencrypted in `chrome.storage.local`. Anyone with read access to your browser profile can recover it. Use only if device flow doesn't fit your workflow (e.g., fine-grained PATs).
- Favorites and config survive only on the current profile (`chrome.storage.local`, not `chrome.storage.sync`).

## License

MIT — see [LICENSE](LICENSE).
