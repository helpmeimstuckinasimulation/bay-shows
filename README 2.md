# Bay Shows PWA

Bay Area live music discovery — deployable to GitHub Pages with no build step.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Complete app (React 18 via CDN, all logic inline) |
| `sw.js` | Service worker — offline caching, 6h data TTL |
| `manifest.json` | PWA manifest — enables home-screen install |
| `icon-192.svg` | App icon (192×192) |
| `icon-512.svg` | App icon (512×512, maskable) |
| `.nojekyll` | Tells GitHub Pages not to process with Jekyll |

## Data source

Events are fetched from a Google Drive document written daily by a Google Apps Script:

```
https://docs.google.com/document/d/1SdqroQ3aSDtyLFM9O5Pq631nyNf_NjrJx9wkpFRJBdw/export?format=txt
```

The document contains a JSON array of events with this shape:

```json
{ "id": "riotlist-2026-05-01-bottomofthehill",
  "d": "2026-05-01", "v": "Bottom of the Hill", "a": "Artist Name",
  "t": "21:00", "g": "rock", "sg": "punk", "r": "sf",
  "p": "15", "age": "21+", "so": "riotlist",
  "lk": "https://...", "maps_url": "https://maps.google.com/...",
  "n": "Notes", "pr": "paid", "da": 1746000000000, "dm": 1746000000000 }
```

**6-hour TTL cache** is stored in `localStorage` under key `bay-events-cache-v1`. Force-refresh via the ↻ button or pull-to-refresh.

## localStorage keys

All keys match the v15 artifact so user data is preserved if you were using the Claude artifact previously:

| Key | Contents |
|-----|----------|
| `bay-events-cache-v1` | `{ events: [...], ts: <epoch ms> }` — raw event cache |
| `bay-events-tags-v9` | `{ [eventId]: <epoch ms> }` — saved/starred events |
| `bay-events-snap-v9` | `{ [eventId]: 1 }` — snapshot for NEW badges |
| `bay-events-manual-v9` | `[...]` — manually added events |
| `bay-prefs-v14` | `{ view, genres, regions, freeOnly, allAgesOnly, showSaved, subgenres }` |

## Deploy to GitHub Pages

```bash
# 1. Create a new repo (or push to existing)
git init
git add .
git commit -m "Bay Shows PWA"
git remote add origin https://github.com/YOUR_USERNAME/bay-shows.git
git push -u origin main

# 2. Enable GitHub Pages
# Go to repo → Settings → Pages → Source: Deploy from branch → main / (root)
```

Your app will be live at `https://YOUR_USERNAME.github.io/bay-shows/` within a minute.

**Note**: If deploying to a subdirectory (e.g. `github.io/bay-shows/` not `github.io/`), update `start_url` and `scope` in `manifest.json` from `/` to `/bay-shows/`, and update the service worker registration path in `index.html` to `/bay-shows/sw.js`.

## Install on iOS

1. Open the GitHub Pages URL in Safari
2. Tap the Share button → **Add to Home Screen**
3. The app opens full-screen with offline support

## Install on Android

Chrome will automatically prompt "Add to Home Screen" after a few visits, or tap the browser menu → Install app.

## Offline behavior

- **Static shell** (HTML, React, fonts): always available after first load
- **Event data**: served from the 6h cache when offline; shows "cached" indicator
- **If cache is completely empty** (first load, no network): shows an error with retry button

## Updating

To push new events without touching the app: just run the Apps Script. The PWA will pick up new data on next fetch (or force-refresh).

To update the app itself: edit the files and `git push`. The service worker will update on next page load (after the old SW is no longer controlling any tabs).

To force all clients to update immediately, bump `CACHE_VERSION` in `sw.js`.
