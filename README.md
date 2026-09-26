# Music Folder Player · My Chart

A folder-based music player with personal weekly charts, persistent playlists, monthly and yearly rankings, and an actual audio folder you can copy to your phone.

This project extends [Music Folder Player by ltGuillaume](https://codeberg.org/ltguillaume/music-folder-player). The original player and the new chart workspace share one page and one playback queue. Music stays in your own folders; no database, cloud account, build step, or music service subscription is required.

[Installation](#installation) · [Using-my-chart](#using-my-chart) · [Configuration](#configuration) · [Data-and-backups](#data-and-backups) · [Troubleshooting](#troubleshooting) · [Development](#development)

<img width="1270" height="1026" alt="{ECAD778D-21FC-4070-9A8E-C918AE731584}" src="https://github.com/user-attachments/assets/a92e25cc-c02e-49de-90dd-5ece32ed4971" />


## Features

- **One music library:** search by filename/path, filter by playlist, reload the folder, and add individual tracks or the entire filtered result to the queue.
- **A persistent bottom player:** playback, seeking, volume, cover art, random playback, crossfade, and compact settings.
- **An editable queue:** open the queue icon to reorder tracks by dragging or arrows, remove a track, or clear the queue.
- **Saved playlists:** use each track's dropdown to select an existing playlist or create one. Playlist membership and file format appear below the title.
- **Weekly charts without a fixed track limit:** drag songs into the chart, assign positions, and carry a saved chart forward into a new week.
- **Chart history:** revisit and edit saved weeks, with movement indicators and protection against conflicting saves from multiple tabs.
- **Monthly and yearly totals:** points, weeks charted, best position, and average position.
- **Physical exports:** copy the latest chart's audio files into a numbered folder for a phone or standalone player.
- **A compact dark interface:** shared theme, internal scrolling for long lists, and notifications in the top-right corner.

The original player includes multiple languages and theme variants. **The added My Chart interface currently uses Russian labels**; this README explains its controls in English. Translating the chart interface is not yet implemented.

## Requirements

- PHP 8.1 or newer with sessions and JSON support.
- A modern browser with HTML5 audio, JavaScript, and Shadow DOM support.
- Read access to the music folder and write access for playlists, chart history, and exports.
- Enough free disk space for exported copies of your audio files.

Node.js is only needed for optional development tests. PHP and music files are not bundled.

Recognized audio extensions are configurable. The default list is `mp3, flac, ogg, aac, m4a, mp4, opus, wav, webm, fla`. Recognition does not guarantee playback: decoding depends on the browser and the actual codec.

## Installation

### Windows quick start

1. Clone this repository, or download and extract its source archive.
2. Install PHP and add `php.exe` to PATH. Alternatively, extract a Windows PHP distribution into `.runtime/php/`, so that `.runtime/php/php.exe` exists.
3. Create a `library` directory in the project root and place your music inside it. Subfolders are supported.
4. Copy `auth.example.ini` to `auth.ini` and set a private password.
5. Double-click `start.cmd`.
6. The launcher opens **http://127.0.0.1:8765/music.htm**. The interface and lists open without a password; the browser asks for the credentials when you play or download music.

Example local layout:

```text
project/
  music.htm
  music.defaults.ini
  start.cmd
  library/
    Artist - Song.mp3
    Album/
      01 - Another Song.flac
      cover.jpg
  .runtime/
    php/
      php.exe
```

The launcher checks PATH first, then the portable PHP location. It starts a hidden local server and reuses an existing server for this project. Logs are written to `.runtime/server.out.log` and `.runtime/server.err.log`.

Closing the browser does not stop the background server. To stop it, end the corresponding PHP server process in Task Manager; do not end unrelated PHP processes. The server also stops when Windows shuts down.

### Manual start: Windows, macOS, or Linux

From the project root, with PHP available in PATH:

```sh
php -S 127.0.0.1:8765 -t . router.php
```

Create `auth.ini` from `auth.example.ini` first. Open **http://127.0.0.1:8765/music.htm**. Keep the terminal open; press Ctrl+C to stop this server.

For a portable Windows installation, use PowerShell:

```powershell
.\.runtime\php\php.exe -S 127.0.0.1:8765 -t . router.php
```

**Serve the application over HTTP.** Opening `music.htm` directly with a `file://` URL cannot execute PHP and will not load the application correctly. The legacy `charts.htm` address redirects to the unified page.

### Existing PHP web server

Place the application in a PHP-enabled document root. Configure HTTP Basic authentication for audio files in `/library` and keep the PHP media endpoints protected as described below. For PHP's built-in server, use `router.php` as shown above. The PHP process must be able to read the library and create/write `music.pls`, `chart-data`, and `chart-exports`. You can create those directories beforehand and grant access to the server's user.

The launcher and built-in-server instructions use HTTP Basic authentication only for playback streams and music downloads. The page, lists, chart data, and other interface APIs are public. `auth.ini` (ignored by Git) supplies `username` and `password`; alternatively set `WEBMUSIC_USERNAME` and `WEBMUSIC_PASSWORD`. PHP protects the player and chart audio streams and downloads, and the development router also protects direct audio URLs under `library`. For Apache, apply the equivalent rule to audio files in `/library` and retain the checks in `music.php` and `charts.php`. The player's password lock is a separate UI control. Use HTTPS for public hosting so credentials are encrypted in transit. Static hosting such as GitHub Pages cannot run its PHP backend.

## Using the library and player

The library and weekly chart sit above the bottom player. Their height adapts to the available viewport, with scrolling inside long lists. Monthly/yearly totals remain below them and are reached by scrolling the page.

MP3 titles and artists are read from supported embedded ID3 tags. Empty or unsupported tags fall back to filenames (and the player's configurable `pathexp` naming pattern). Search also includes the artist and album artist.

The library opens before reading embedded tags. Tags load progressively in public batches of at most 25 files, with a one-second processing budget between files per request, so large libraries do not exceed PHP's request timeout. A failed tag batch leaves the library usable with filename labels.

Use the pencil button beside an MP3 in the library to edit **artist, album artist, and song title**. Save writes into the MP3 itself without re-encoding audio or renaming the file; playlists and chart history keep their existing paths. The PHP `iconv` extension and write permission to both the file and its folder are required. No additional runtime or package installation is needed.

The editor supports plain ID3v2.2, v2.3, v2.4, ID3v1-only files, and files without tags. Existing non-edited ID3v2 frames (including artwork) are preserved byte for byte. Existing ID3v1 title/artist fields are synchronized with their legacy length and encoding limits; full Unicode values live in ID3v2. Complex headers (extended headers, tag-level unsynchronisation, compression, footers), specially flagged edited frames, malformed tags, and tags over 16 MB are rejected without changing the original.

Each save first creates a verified original-file backup in `chart-data/tag-backups/`. Backups have hashed filenames and a 15-byte `<?php exit; ?>` plus newline prefix to prevent direct HTTP downloads. To restore, copy the bytes after that prefix into a new `.mp3` file; inspect it before replacing the current file. Backups are retained and consume space equivalent to each saved original. Existing chart exports must be refreshed separately to include tag changes. If another editor changes the file, reopen the tag dialog before saving again.

| Control | Action |
| --- | --- |
| Play / pause on a track | Start the track in the shared player; click again to pause or resume it. Both lists reflect the current playback state. |
| Add to queue on a track | Append the song to the playback queue. |
| Star on a track | Add the song to the selected weekly chart. |
| Playlist dropdown on a track | Add it to a saved playlist or create a new playlist. |
| Search + playlist filter | Display the intersection of the search and selected playlist. |
| Library refresh icon | Rescan the music folder while retaining the chart draft. |
| Library enqueue-all icon | Queue the entire filtered result, including tracks beyond the currently displayed rows. |
| Chart enqueue-all icon | Queue the selected chart in ranking order. |

The library initially displays up to 100 matching tracks; use the button below the list to display more. This is a display batch size, not a chart limit.

The queue and settings icons are on the right of the player. Each opens a floating panel above it. Close a panel with its close button, Escape, or a click outside the player. Queue controls support drag-and-drop and buttons; clearing the queue asks for confirmation.

The queue, saved playlists, and weekly charts are separate collections. Reordering one does not reorder the others. The player avoids adding tracks that are already waiting in the queue; the `nodupes` setting also controls previously played tracks.

Original player features include random playback, a ten-second crossfade, near-gapless transitions, sharing, and configurable behavior after the queue ends. Right-click Volume to mute, or Next to skip the current artist. Click the cover to enlarge it. For upstream keyboard shortcuts, see the [hotkey reference](https://codeberg.org/ltguillaume/music-folder-player/wiki/List-of-hotkeys); shortcuts for the original tree library do not describe the new flat chart library.

## Using My Chart

### Create a weekly ranking

1. Choose a date. It is normalized to the Monday of that week.
2. Drag songs from the library into **Чарт недели** (Weekly chart), or use their star buttons.
3. Reorder songs by dragging or using the up/down buttons. Remove a song with its remove button.
4. Click the save/export icon in the chart header. Its tooltip is **Сохранить чарт и создать папку** (Save chart and create folder) for the latest week.

There is no fixed maximum number of songs. Each file can appear only once in a week. Removing a track from a chart never deletes its source audio.

### Move to the next week

**Следующая неделя** (Next week) advances one week from the selected date:

- If that week already exists, it opens the saved ranking.
- Otherwise, it creates a draft from the most recent saved week before that date.
- Unsaved changes are not carried forward automatically. Leaving a modified week prompts you to discard them.
- Merely changing weeks does not save history or export files.

Rearrange the new draft and save it when ready. Previously saved weeks remain in the archive. You can choose future dates as well as past dates.

### History and movement

Use the saved-week selector to revisit older rankings. Saving changes to an existing week asks for confirmation and recalculates the totals.

Movement compares positions with the **previous calendar week**. `NEW` marks a first appearance; `ВОЗВРАТ` marks a return after absence. Missing weeks are not filled in automatically.

Concurrent saves use revision checks. If another tab has saved first, a stale save is rejected instead of silently replacing its changes.

### Monthly and yearly scoring

Each saved weekly position earns:

```text
weekly points = 100 / position
period points = sum of weekly points in the selected period
```

Position 1 earns 100 points; position 2 earns 50; position 3 earns 33⅓. Values are summed without intermediate rounding.

This is the project's fixed personal-chart formula, not a universal radio-station scoring standard. It rewards high positions and repeated appearances without requiring a fixed weekly chart size.

Ties are resolved by:

1. More weeks in the selected period.
2. Better peak position.
3. Better average position.
4. Earlier first appearance within the selected period.
5. Track path ordering.

The table shows points, weeks charted, peak, and average position. A week belongs to the month and year of its Monday, including weeks that cross month/year boundaries. Only saved charts count. Expand **Как считается** (How it is calculated) in the totals section to see the scoring explanation.

## Export audio to a phone

Saving the **latest saved week by date** also updates:

```text
chart-exports/current/
  001 - Artist - Song.mp3
  002 - Another Artist - Another Song.flac
  .mfp-export.json
```

These are **copies of the actual audio files**, not shortcuts or a playlist. Copy the folder's audio files to your phone or music player, then select filename sorting to preserve chart order.

- Audio is not transcoded, retagged, or otherwise modified.
- Embedded track numbers remain unchanged; a phone player sorting by tags may use a different order.
- A saved future week becomes the latest export; “latest” is determined by date, not today's calendar week.
- Saving an older week changes history and totals but leaves the current export untouched.
- The chart's refresh-folder icon repeats the export of the latest saved chart. Save pending edits first.
- Saving history and exporting audio are separate operations. An export error does not undo the saved chart.

The application builds a complete staging copy before replacing `current`. If copying fails, the previous export is retained. Allow space for both the old and new export during replacement.

Tracks leaving the chart disappear from the managed export, but remain in the source library. An empty saved chart produces an empty audio selection.

Do not put unrelated files into `current` or edit its `.mfp-export.json` manifest. Export stops if it finds files it does not own. Keep `chart-exports` outside the configured library so exported copies do not appear as new source songs.

## Configuration

Defaults live in [music.defaults.ini](music.defaults.ini). Create a local **music.ini** to override only the settings you need; it is excluded from Git.

Minimal example:

```ini
[server]
root = library
playlistdir = music.pls
cache = 1

[client]
pagetitle = 'My Music'
def.volume = .9
def.crossfade = false
onlinepls = true
```

Client values are emitted as JavaScript expressions: use **single quotes around strings**, lowercase `true`/`false` for booleans, and JavaScript array syntax for lists. Keep section names and option names unchanged.

### Server options

| Option | Default | Purpose |
| --- | --- | --- |
| `root` | `library` | Music directory, relative to the project directory or an absolute path (including a mounted S3-compatible bucket). |
| `playlistdir` | `music.pls` | Directory containing saved playlists and the optional library cache. |
| `cache` | `1` | Cache the scanned folder structure for faster startup; use Reload Library after changing files. |
| `maxdepth` | `10` | Maximum recursive directory depth. |
| `ext_images` | `jpg,png` | Comma-separated cover image extensions. |
| `ext_songs` | See Requirements | Comma-separated recognized audio extensions, without leading dots. |
| `uploads` | `0` | Set to `1` to show authenticated audio uploads in the library. The library directory must be writable. |
| `upload_max_bytes` | `104857600` | Maximum size per uploaded file in bytes (100 MiB by default); PHP's `upload_max_filesize` and `post_max_size` must allow at least this much. |

`root` may also be an absolute path. This lets the same application use an S3-compatible bucket mounted as a directory on a server, while local installs continue using `library` unchanged. The application accesses the mount through normal filesystem operations; it does not connect to the S3 API directly.

### Use an S3-compatible bucket on a server

Mount the bucket on the server with a tool such as [rclone](https://rclone.org/s3/), then point `root` at its mount point. For example, configure an rclone remote named `music-s3` for your S3 endpoint and bucket, and mount it at `/srv/webmusic/library`:

```sh
rclone mount music-s3:my-music-bucket /srv/webmusic/library \
  --vfs-cache-mode full
```

Run the mount as a persistent service under the same account that runs PHP, and ensure that account can access the mounted files. `--vfs-cache-mode full` lets the mount cache file contents locally for seeking and repeated playback; provide enough cache disk space. Keep the S3 credentials in rclone's protected configuration or the server's secret manager, never in the repository or browser configuration.

On that server, create `music.ini` with:

```ini
[server]
root = /srv/webmusic/library
uploads = 1
upload_max_bytes = 104857600
```

Use the platform's actual mount path. The app's playlists, chart history, and chart exports remain on the server's local disk. Keep `chart-exports` outside the mounted library. With `uploads = 1`, the library header shows an upload button. It accepts any number of audio files per selection, stores them at the library root, and skips files whose names already exist. The per-file limit is configured by `upload_max_bytes`; PHP's `upload_max_filesize` and `post_max_size` must allow each file. The mount must permit writes. S3 filesystem mounts can transfer complete files and depend on local cache space and mount write semantics; keep a backup of the bucket. The MP3 tag editor also writes files and may trigger full-file transfers.

For local development, leave `root = library` in the ignored local `music.ini` (or omit the override); no mount or S3 credentials are needed. Do not commit a server-specific `music.ini`.

### Automatic deployment

The GitHub Actions workflow deploys every push to `main` over SSH. In repository **Settings → Secrets and variables → Actions**, configure variables `SERVER_HOST`, `SERVER_USER`, and `DEPLOY_PATH` (the directory containing `docker-compose.yml`, for example `/srv/webmusic`); optionally set `SERVER_SSH_PORT` (defaults to `22`). Add the private deploy key as secret `SERVER_SSH_KEY`. The matching public key must be authorized for that account, which needs permission to write the deployment directory and run Docker Compose. Keep server-only files and persistent directories in place: the workflow excludes `data/`, `library/`, `music.ini`, and `auth.ini` while syncing application source, then runs `docker compose up -d --build` remotely.

If you choose custom library or playlist directories inside the repository, add those paths to `.gitignore` too. Git does not read these settings to discover private directories.

### Player defaults and options

Browser-local saved preferences can override `def.*` defaults. To test changed defaults, use a fresh browser profile or clear this application's local storage; clearing storage also removes the local queue.

| Option | Default | Purpose |
| --- | --- | --- |
| `def.after` | `'randomlibrary'` | After-queue behavior: `'stopplayback'`, `'repeatplaylist'`, `'playlibrary'`, `'randomlibrary'`, or `'randomfiltered'`. |
| `def.autoplay` | `1` | `0`: off; `1`: shared links; `2`: also the main library. Browser autoplay rules still apply. |
| `def.buffersec` | `.44` | Start the next track this many seconds before the current track ends. |
| `def.crossfade` | `false` | Initial crossfade setting. |
| `def.random` | `false` | Initial random playback setting. |
| `def.volume` | `.9` | Initial volume, from 0 to 1. |
| `def.cover` | `'music.png'` | Fallback cover image. |
| `def.theme` | `'colorborder colortoggle round material black'` | Initial theme and variants. |
| `def.lock`, `def.password` | `false` | Original player's UI lock defaults; not server authentication. |
| `def.debug` | `false` | Log additional playback diagnostics. |
| `def.enqueue` | `false` | Original library's enqueue behavior. The new library has explicit action buttons. |
| `def.instantfilter` | `0` | Original library's instant-filter threshold. The new search filters as you type. |
| `lsid` | `'music_folder_player'` | Browser-local storage key; use different values for separate instances. |
| `maxerrors` | `5` | Playback error threshold before stopping. |
| `nodupes` | `false` | Also exclude previously played songs when adding to the queue. |
| `onlinepls` | `true` | Enable server-side playlist saving and the library's playlist editing. |
| `pagetitle` | `'Music'` | Browser page title. |
| `pathexp` | `['dummy/artist - year album/track title.extension']` | Original player's folder/filename interpretation patterns. |
| `sharing` | `true` | Show original sharing controls. |
| `sharebutton` | `true` | Enable the native share option where available. |
| `shareapi.*` | See defaults file | External share URL templates with `{text}` and `{url}` placeholders. |
| `themes`, `focuscolors` | See defaults file | Theme and focus-color choices. |
| `sourceurl` | Upstream source URL | Source link for the running instance; set it to your fork's URL when appropriate. |

The theme options include black, blue, green, gray, and light. See [music.theme.css](music.theme.css) for variants. The fork's compact layout is defined in [music.layout.css](music.layout.css) and [charts.css](charts.css).

The chart history/export paths and the scoring formula are currently defined in code, not configurable through `music.ini`. To change the Windows launcher's port, edit `$port` in `start.ps1`.

## Data and backups

| Location | Contents | Git |
| --- | --- | --- |
| `library/` | Your source music and cover art | Ignored |
| `music.ini` | Local configuration overrides | Ignored |
| `music.pls/` | Saved `.mfp.json` playlists, backup copies, locks, and optional cache | Ignored |
| `chart-data/` | Chart history and locking files | Ignored |
| `chart-exports/` | Generated audio exports and staging directories | Ignored |
| `.runtime/` | Portable PHP, server logs, and test dependency | Ignored |
| Browser local storage | Playback queue and player preferences | Not stored in the repository |
| `music.defaults.ini` | Shareable configuration defaults | Tracked |

Back up your library, `music.ini`, `music.pls`, and the entire `chart-data` directory. The current export is reproducible from saved history and the source audio.

History is stored in `chart-data/history.php` as JSON with a protective PHP prefix. It is application data, not a file to edit manually. Preserve the complete file when backing it up.

Track identity is its relative library path. Renaming or moving a file makes it a different track; old chart entries remain in history and show as unavailable.

### Keeping a public repository free of personal data

The supplied `.gitignore` excludes default private directories, local settings, playlist files and their backups, common audio formats, logs, and local runtime files. Application assets, configuration defaults, documentation, and tests remain publishable.

Before committing, inspect:

```sh
git status --short
git diff --cached --stat
git ls-files -- library music.pls music.ini chart-data chart-exports .runtime
```

The final command should print no private files for the default layout. Check custom paths separately.

Ignore rules do not remove files already tracked or erase previous commits. If private files were previously committed, review that history before making the repository public. Do not force-add ignored personal data.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Blank interface, manifest CORS errors, `Unexpected token '<'`, or `pathexp is not defined` | Use the HTTP server URL, not `file://`. Ensure PHP executes rather than being served as source, and check INI syntax and server logs. |
| PHP not found by `start.cmd` | Install PHP in PATH or place `php.exe` at `.runtime/php/php.exe`. |
| Port 8765 is already in use | Stop the conflicting process or choose another port. The launcher refuses to reuse another application's listener. |
| Empty library | Check `root`, file permissions, `ext_songs`, and folder depth; then refresh the library. |
| A visible track will not play | Check browser codec support and whether the source file still exists. |
| Seeking returns to the beginning | Playback should use `charts.php?action=audio...`, which supports HTTP byte ranges. Hard-refresh the page after updating the application. |
| Playlist or chart cannot be saved | Check write permissions and PHP session support. For a stale-revision error, reload the saved state before editing again. |
| Chart saved but export failed | Check free space, source availability, directory permissions, and unexpected files in `current`; then retry with the refresh-folder icon. |
| Phone plays tracks in the wrong order | Sort by filename rather than embedded track tags. |
| Configuration edits appear ineffective | Check browser-stored preferences and hard-refresh with Ctrl+F5. |
| Original ZIP download fails | The upstream ZIP feature needs `7z` on Windows or `zip` on other systems, plus permission to launch it. Chart folder export does not use those tools. |

## Development

The application uses plain PHP, JavaScript, HTML, and CSS. There is no frontend build pipeline.

| File | Responsibility |
| --- | --- |
| `music.htm` | Unified page and chart template |
| `music.js` | Original player, playback queue, and chart/player integration |
| `music.php` | Player configuration, library scanning, and legacy endpoints |
| `charts.js` | Chart editor, library UI, playlist controls, and totals |
| `charts.php` | Chart API, file export, and byte-range audio streaming |
| `music.playlists.php` | Shared playlist validation and storage |
| `music.layout.css` | Bottom dock and compact original-player layout |
| `charts.css` | Chart workspace styling |
| `start.cmd`, `start.ps1` | Windows local launcher |

The chart template is mounted in a Shadow DOM to isolate it from the original player's element IDs and styles while inheriting theme variables.

### Tests

Server integration tests create their own temporary library and server rather than using your music. The current test harness uses `http_get_last_response_headers()`, so **PHP 8.4 or newer is required for this test command**, independently of the application's PHP requirement:

```sh
php tests/charts-test.php
php tests/metadata-test.php
```

DOM tests use Node.js and a test-only LinkeDOM module. Save `https://unpkg.com/linkedom@0.18.12/worker.js` as `.runtime/linkedom.mjs`, then run:

```sh
node tests/charts-ui-test.mjs
node tests/player-ui-test.mjs
```

These checks cover chart editing/history, exports, playlist integration, queue controls, playback button state, seeking logic, and viewport-height calculations. DOM tests do not replace visual browser testing or testing actual audio playback.

For additional Russian usage notes, see [CHARTS.md](CHARTS.md).

## Credits and license

This fork builds on **Music Folder Player by ltGuillaume**: [Codeberg](https://codeberg.org/ltguillaume) · [GitHub](https://github.com/ltguillaume) · [Support the original author](https://coff.ee/ltguillaume).

Original project credits:

- Concepts from [HTML5 Music Player](https://github.com/GM-Script-Writer-62850/HTML5-Music-Player) by GM-Script-Writer-62850.
- [Barlow](https://github.com/jpt/barlow) font, Regular and Semi Condensed Regular.
- [Foundation icon font](https://zurb.com/playground/foundation-icon-fonts-3).
- Album-art placeholder based on a [design by CmdRobot](http://fav.me/d7kpm65).

The repository includes the **GNU Affero General Public License v3.0**; see [LICENSE](LICENSE). Existing screenshot files show the upstream interface and do not represent all of this fork's layout changes.

## Server deployment

For the Docker deployment on `kurashev.com/music/`, keep deployment-only files on the server. In particular, create `auth.ini` from `auth.example.ini` and do not commit it to Git.

The container reads `auth.ini` at startup and generates an Apache Basic Authentication password file using bcrypt. Apache protects direct audio files under `/library`; the PHP endpoints require credentials for audio streaming and downloads. The page, lists, chart data, and other interface APIs are public. The password file is generated inside the container and is not stored in the repository.

The music library is mounted at `/var/www/html/library` from the host's `/srv/webmusic/library`, which is backed by the S3-compatible `kurashev-music` bucket through rclone.
