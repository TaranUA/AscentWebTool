# Ascent Web Tool

An unofficial browser-based firmware upgrader for Caddx Ascent FPV video devices. It uses Web Serial to communicate with the device over USB. Firmware is read from your computer and sent directly to the device. The app has no backend, dependencies, or build step.

**[Open Ascent Web Tool](https://taranua.github.io/AscentWebTool/)** · [Run locally](#run-locally) · [Run tests](#run-tests) · [Sources and credits](#sources-and-credits)

> [!WARNING]
> This community tool is not affiliated with or endorsed by Caddx. An incorrect image or an interrupted upgrade can leave the device unusable. Use firmware intended for your exact model and keep the device, USB connection, and computer powered throughout the upgrade.

## Upgrade a device

1. Open the tool in a browser with [Web Serial support](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API#browser_compatibility), such as Chrome or Edge.
2. Plug in the device, click **Connect**, and pick its USB serial port. It may appear as **SerialGadget** or **VRX Gadget**. Check the model, firmware, and hardware version shown in the app.
3. Select the matching `.img` file from [Caddx's firmware releases](https://github.com/CaddxFPV-Tech/Caddx-Ascent-Firmware-Release). Firmware is not bundled here. The filename warning is a hint; a matching name does not establish compatibility or authenticity.
4. Click **Upgrade** and follow the status. The device may restart during the process. If Chrome loses track of the port after a reboot, click **Select port again** when it appears and choose the same device.
5. When the tool finishes, click **Connect** again to display the installed firmware version. If the app says flashing finished but could not be verified after reboot, check whether the device responds before trying another upgrade.

The device's reported information matters more than the USB label or vendor ID. For example, the upstream author observed both the Ascent Lite+ and GT Pro using USB vendor ID `0x1D76`. See the [upstream hardware notes](https://github.com/seriyps/ascent-pc-tool/blob/4d990c0e241afd825b2dc33a07098108badae269/AGENTS.md#the-hardware).

Chrome can reconnect without the picker when it still grants the site access to the port. If clean mode omits the device serial number, the reconnect checkbox lets the tool use a single authorized port with matching USB IDs, model, and firmware. It is checked by default. Uncheck it if more than one matching device is plugged in. Chrome administrators can grant access for a specific origin and USB device type using [SerialAllowUsbDevicesForUrls](https://chromeenterprise.google/intl/en_us/policies/serial-allow-usb-devices-for-urls/). That setting applies to the entire origin.

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

Expected result: **23 passed, 0 failed**. The suite includes 16 parity tests against the saved upstream bundle and seven regression tests covering port reopening and replacement, file validation, unverified completion, and invalid response lengths. The simulated upgrade compares command order, metadata, transferred bytes, and progress events. It does not test physical USB, device reboot behavior, or flashing on real hardware.

On November 17, 2026, the web tool completed a same-version reflash on an **Ascent VRX** (`FPV-Ascent-Gnd-485-V1.1-1.0`) in Chrome on Windows using `Ascent_G_Gnd_17_5_8.img`. The receiver accepted all 50,310,452 bytes in 48 chunks with zero retries. Chrome required **Select port again** after both reboots.

A follow-up reflash used the single-device option and a temporary Chrome policy scoped to the local preview and USB IDs `1D75:0101`. Both reconnects completed without opening the port picker. After the final reboot, the VRX reported the expected firmware and hardware version in normal mode.

## How it works

The app checks and reads the image, queries the device, and reopens the port after rebooting it into upgrade mode. It sends file metadata and chunks, asks the device to verify the transfer, polls flash progress, then queries the device again after the final reboot. If that final query or reconnect fails, the app reports that the result could not be verified.

| Area | Where to look |
| --- | --- |
| Page, controls, and styles | [index.html](index.html), [src/ui.js](src/ui.js), [src/styles.css](src/styles.css) |
| Upgrade flow and firmware matching | [src/firmware.js](src/firmware.js), [src/device.js](src/device.js) |
| Web Serial, reconnect, ACKs, and retries | [src/transport.js](src/transport.js), [src/serial-reconnect.js](src/serial-reconnect.js), [src/client.js](src/client.js) |
| Packet layout, limits, and checksums | [src/packet.js](src/packet.js), [src/constants.js](src/constants.js), [src/crc32.js](src/crc32.js), [src/md5.js](src/md5.js) |
| Compatibility reference and tests | [reference/original.min.js](reference/original.min.js), [tests/tests.js](tests/tests.js) |

The Web Serial buffer fits a standard 1 MiB firmware chunk plus its header. After each reboot, the app refreshes the list of authorized ports and checks device identity before using a replacement. If the device rejects the transfer at verification, the log includes the device's byte counts and the number of chunk retries.

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
