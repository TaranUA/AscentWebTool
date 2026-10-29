# C@ddx A$cent PC Tool (Web) — readable local copy

A local, refactored copy of the unofficial browser-based Caddx Ascent firmware
upgrade tool at <https://ascent.seriyps.com/>.

> **Warning:** Unofficial, community-built tool — not affiliated with or
> endorsed by Caddx. This writes to the device's flash; a failed or interrupted
> upgrade can brick the hardware. Use at your own risk.

## What changed

The original site is a Vite production build with one minified JavaScript
bundle. It has been rebuilt here as readable ES modules with comments and
meaningful names. The application is still a plain static site: there is no
build step, no package installation, and no framework.

The untouched production bundle is kept in `reference/original.min.js`. The
tests use it as a reference implementation to verify that the refactor produces
identical bytes on the wire.

One small robustness fix was made in the UI: if reading device info fails, the
serial port is now always closed so a retry does not get stuck with an
already-open port.

## Project layout

```
index.html                       Page markup
favicon.svg
src/
  main.js                        Entry point
  ui.js                          DOM wiring and user interactions
  constants.js                   Protocol, command, timing, USB, and device constants
  packet.js                      Header/payload encoding and decoding
  transport.js                   Web Serial byte transport with timeouts
  client.js                      Request/response protocol client
  firmware.js                    Upgrade orchestration and progress polling
  md5.js                         Dependency-free MD5 for firmware images
  crc32.js                       Packet checksums
  device.js                      Firmware filename/device matching
  styles.css                     Dark-theme styles
reference/
  original.min.js                Original production bundle (reference only)
tests/
  index.html                     Browser test runner
  tests.js                       Parity tests and simulated full upgrade
.github/workflows/pages.yml      GitHub Pages deployment
```

## Run locally

Web Serial only works in a secure context. `http://localhost` counts as secure,
so serve the folder instead of opening `index.html` via `file://`.

Using Python:

```powershell
cd C:\_Dev\AscentWebTool
python -m http.server 5173
```

Then open <http://localhost:5173/>.

Using Node.js, if installed:

```powershell
cd C:\_Dev\AscentWebTool
npx --yes serve . -l 5173
```

Use a recent Chromium-based browser (Chrome, Edge, Brave, Opera) or
Firefox 151+.

## Tests

With the local server running, open <http://localhost:5173/tests/>.

The suite checks:

- CRC-32 and MD5 against the original bundle and known vectors
- Packet encoding byte-for-byte, including headers and checksums
- Device-info, file-end, and upgrade-status parsing
- File-start metadata and filename/device matching
- Reboot delays and USB serial filters
- ACK timeout/retry behaviour
- A complete simulated upgrade, using a mock serial device, comparing the
  result, command sequence, progress events, metadata, and transferred bytes
  against the original implementation

Expected result: **16 passed, 0 failed**.

The simulation validates the software flow, not real hardware. Test on a real
device at your own risk.

## Publish to GitHub Pages

1. Create a new repository on GitHub and push this folder to it, with `main` as
   the default branch:

   ```powershell
   cd C:\_Dev\AscentWebTool
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/<your-user>/<your-repo>.git
   git push -u origin main
   ```

2. In the repository, open **Settings → Pages**.
3. Under **Build and deployment → Source**, choose **GitHub Actions**.
4. The included workflow deploys on every push to `main`, copying only
   `index.html`, `favicon.svg`, `.nojekyll`, and `src/` to the site.
5. Your site will be at `https://<your-user>.github.io/<your-repo>/`.

All paths are relative, so the site works at a repository subpath or a custom
domain root. GitHub Pages provides HTTPS, which Web Serial requires.

## How the upgrade works

1. `GET_DEVICE_INFO` reads the model, firmware info, and the device's preferred
   chunk size.
2. A `REBOOT` command with a zero-padded `"clean"` payload puts the device into
   clean/upgrade mode. The port is closed and reopened after the model-specific
   reboot delay.
3. `REMOTE_UPGRADE` enables remote upgrade mode.
4. `SEND_FILE_START` sends the firmware size, MD5, remote path, and filename.
5. `SEND_FILE_DATA` transfers the image in chunks; each request is acknowledged
   and retried on timeout.
6. `SEND_FILE_END` asks the device to verify the image.
7. `UPGRADE_STATUS` is polled once per second while the device flashes.
8. After the final reboot, the device is queried once more and the operation is
   reported as complete.

The protocol header is 36 bytes (little-endian): magic, version, packet type,
message id, reserved field, command, format, user id, payload length, sequence,
retry count, and CRC-32. See `src/packet.js` for the exact layout.

## Notes on modifying it

- UI markup lives in `index.html`; styles in `src/styles.css`.
- Protocol and device values live in `src/constants.js`. Changing them can make
  the tool incompatible or unsafe — the tests will catch protocol differences.
- Firmware `.img` files are selected from disk at runtime and are **not**
  bundled. Only distribute firmware you are allowed to redistribute.
- The original bundle has no source map; `reference/original.min.js` is retained
  so behavior can always be compared or rolled back.

Original tool: <https://ascent.seriyps.com/>
