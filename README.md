# mixframe

Chrome extension that captures tracks you hear on [gds.fm](https://gds.fm) and lets you save the keepers to a Spotify playlist ("GDS finds") without tab-hopping.

**Landing page + download:** [dpurdy.me/plugins/mixframe](https://dpurdy.me/plugins/mixframe/) · built by [Dan Purdy](https://dpurdy.me)

## How it works

- While a gds.fm tab is playing audio, the extension polls the station's LibreTime API (`live.gds.fm/api/live-info-v2`) and logs each track.
- Tracks are grouped by artist + title with play counts. DJ sets are detected (long duration / missing artist / name matches the show) and logged as sets, without Spotify matching.
- If Spotify is connected, each track is matched in the background as it's captured.
- Popup: now playing + recent tracks + one-click save. Review page: full history, filters, embedded player, save/search actions, settings.
- Unsaved tracks are pruned after a configurable window (default 7 days; "never" available). Capture pauses if local storage nears its quota until you prune.

## Setup

1. Build:
   ```sh
   npm install
   npm run build
   ```
2. Load: `chrome://extensions` → enable Developer mode → **Load unpacked** → select `dist/`.
3. Create a Spotify app (free): <https://developer.spotify.com/dashboard> → Create app.
   - Redirect URI: shown in mixframe's review page → Settings (looks like `https://<extension-id>.chromiumapp.org/`).
   - API used: Web API. No client secret needed (PKCE).
4. Open the extension popup → "Open playlist" → Settings → paste the **Client ID** → **Connect Spotify**.
5. Play gds.fm in a tab. Tracks appear as they air.

## Dev

```sh
npm run dev   # vite + CRXJS hot reload
```

## Roadmap (deferred by design)

- Cloudflare Worker backend for capture while browser closed / cross-device sync
- Bandcamp search links / integration
- Audio fingerprinting for track IDs inside DJ sets
