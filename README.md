# Ascent Web Tool

An unofficial browser-based firmware upgrader for Caddx Ascent FPV video devices. It uses Web Serial to communicate with the device over USB. Firmware is read from your computer and sent directly to the device. The app has no backend, dependencies, or build step.

**[Open Ascent Web Tool](https://taranua.github.io/AscentWebTool/)** · [Run locally](#run-locally) · [Run tests](#run-tests) · [Sources and credits](#sources-and-credits)

> [!WARNING]
> This community tool is not affiliated with or endorsed by Caddx. An incorrect image or an interrupted upgrade can leave the device unusable. Use firmware intended for your exact model and keep the device, USB connection, and computer powered throughout the upgrade.

## Upgrade a device

1. Open the tool in a browser with [Web Serial support](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API#browser_compatibility), such as Chrome or Edge.
2. Plug in the device, click **Connect**, and pick its USB serial port. It may appear as **SerialGadget** or **VRX Gadget**. Check the model, firmware, and hardware version shown in the app.
3. Select the matching `.img` file from [Caddx's firmware releases](https://github.com/CaddxFPV-Tech/Caddx-Ascent-Firmware-Release). Firmware is not bundled here. The filename warning is a hint; a matching name does not establish compatibility or authenticity.
4. Click **Upgrade** and follow the status. The device may restart during the process.
5. When the tool finishes, click **Connect** again to display the installed firmware version. If the app says flashing finished but could not be verified after reboot, check whether the device responds before trying another upgrade.

The device's reported information matters more than the USB label or vendor ID. For example, the upstream author observed both the Ascent Lite+ and GT Pro using USB vendor ID `0x1D76`. See the [upstream hardware notes](https://github.com/seriyps/ascent-pc-tool/blob/4d990c0e241afd825b2dc33a07098108badae269/AGENTS.md#the-hardware).

## Run locally

From the repository root, serve the files with Python:

```sh
python -m http.server 5173
```

Open [localhost:5173](http://localhost:5173/). Web Serial requires a secure context; HTTPS and localhost qualify. Serve the directory instead of opening `index.html` directly.

## Run tests

Open the [hosted browser test page](https://taranua.github.io/AscentWebTool/tests/) or use [localhost:5173/tests](http://localhost:5173/tests/) while the local server is running. The tests use a simulated device, so no hardware is needed. To run the same headless Chrome check used in CI, use Node.js and an installed copy of Chrome:

```sh
node tests/run-browser.mjs
```

Set `CHROME_BIN` to the browser executable if Chrome is installed in a nonstandard location.

Expected result: **20 passed, 0 failed**. The suite includes 16 parity tests against the saved upstream bundle and four regression tests for port reopening, file validation, unverified completion, and invalid response lengths. The simulated upgrade compares command order, metadata, transferred bytes, and progress events. It does not test physical USB, device reboot behavior, or flashing on real hardware.

## How it works

The app checks and reads the image, queries the device, and reopens the port after rebooting it into upgrade mode. It sends file metadata and chunks, asks the device to verify the transfer, polls flash progress, then queries the device again after the final reboot. If that final query or reconnect fails, the app reports that the result could not be verified.

| Area | Where to look |
| --- | --- |
| Page, controls, and styles | [index.html](index.html), [src/ui.js](src/ui.js), [src/styles.css](src/styles.css) |
| Upgrade flow and firmware matching | [src/firmware.js](src/firmware.js), [src/device.js](src/device.js) |
| Web Serial, ACKs, and retries | [src/transport.js](src/transport.js), [src/client.js](src/client.js) |
| Packet layout, limits, and checksums | [src/packet.js](src/packet.js), [src/constants.js](src/constants.js), [src/crc32.js](src/crc32.js), [src/md5.js](src/md5.js) |
| Compatibility reference and tests | [reference/original.min.js](reference/original.min.js), [tests/tests.js](tests/tests.js) |

The client rejects oversized or incomplete replies. Incoming CRC enforcement is pending verification against real device replies. The firmware MD5 is used for transfer verification and does not authenticate the image.

For GitHub Pages, select **GitHub Actions** under **Settings → Pages**. The [Pages workflow](.github/workflows/pages.yml) runs the browser tests before publishing the app and its browser test page on pushes to `main` or manual runs.

## Sources and credits

This project is a readable JavaScript adaptation of seriyps's unofficial web tool.

| Source | What it provides |
| --- | --- |
| [Original web tool](https://ascent.seriyps.com/) · [Verified upstream bundle](https://ascent.seriyps.com/assets/index-B7ZMaRDZ.js) | The original app and the deployed JavaScript that matched our saved reference byte for byte. |
| [seriyps/ascent-pc-tool](https://github.com/seriyps/ascent-pc-tool) · [Upstream web source](https://github.com/seriyps/ascent-pc-tool/tree/main/web) | The upstream native Linux client and TypeScript web implementation. |
| [`secret-not-secret` research branch](https://github.com/seriyps/ascent-pc-tool/tree/secret-not-secret) · [Notes at `4d990c0`](https://github.com/seriyps/ascent-pc-tool/blob/4d990c0e241afd825b2dc33a07098108badae269/AGENTS.md) | Hardware observations, Wine compatibility work, and an official-versus-native protocol comparison using a simulated device. |
| [Caddx firmware releases](https://github.com/CaddxFPV-Tech/Caddx-Ascent-Firmware-Release) · [Caddx download center](https://www.caddxfpv.com/pages/download-center) | Vendor firmware and tools. |
