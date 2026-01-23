# Akamai Debug Helper

Browser extension that injects Akamai pragma headers and surfaces CDN debug
signals in a focused popup. Built for Chrome and Firefox with per-tab toggles
and a visible badge when debug is active.

## Features
- Per-tab debug toggle with session-only persistence
- Automatic reload when enabling debug
- Green badge indicator ("DBG") on the extension icon
- Organized cache, key, and request details with copy-to-clipboard
- Main-document only (no subresource noise)

## Install (Development)
### Chrome
1. Open `chrome://extensions`.
2. Enable "Developer mode".
3. Click "Load unpacked" and select the project folder.

### Firefox
1. Open `about:debugging`.
2. Click "This Firefox".
3. Click "Load Temporary Add-on" and select `manifest.json`.

## Usage
1. Open the popup and toggle "Debug Headers".
2. The current tab reloads automatically to capture headers.
3. Look for the green "DBG" badge to confirm debug is active.
4. Use "Copy All" to share diagnostics.

## Headers
### Request (Injected)
- `Pragma: akamai-x-cache-on`
- `Pragma: akamai-x-cache-remote-on`
- `Pragma: akamai-x-check-cacheable`
- `Pragma: akamai-x-get-cache-key`
- `Pragma: akamai-x-get-true-cache-key`
- `Pragma: akamai-x-get-request-id`
- `Pragma: akamai-x-get-extracted-values`

### Response (Displayed)
- `X-Cache`
- `X-Cache-Remote`
- `X-Check-Cacheable`
- `X-Cache-Key`
- `X-True-Cache-Key`
- `X-Akamai-Request-ID`
- `X-Akamai-Session-Info`
- `X-Akamai-Staging`
- `X-Akamai-Transformed`
- `Age`
- `Cache-Control`
- `Expires`
- `Content-Type`

## Build
### Local ZIP
```bash
zip -r akamai-debug-helper.zip background.js manifest.json popup icons
```

### GitHub Release Pipeline
The workflow at `.github/workflows/release.yml` builds a versioned ZIP and
attaches it to a GitHub Release.

Options:
1. Push a tag like `v0.2.0` to trigger a release build.
2. Run the workflow manually ("Release Extension") with a version input.

For tagged releases, keep `manifest.json` version aligned with the tag.
