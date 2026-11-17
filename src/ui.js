/**
 * User-interface wiring.
 *
 * The DOM is intentionally plain: see index.html for the elements this module
 * looks up by id.
 */

import { SERIAL_PORT_FILTERS } from "./constants.js";
import { AscentClient } from "./client.js";
import { expectedFirmwareToken, firmwareNameMismatch } from "./device.js";
import { upgradeFirmware } from "./firmware.js";
import { SerialReconnector } from "./serial-reconnect.js";
import { SerialTransport } from "./transport.js";

const elements = {
  unsupportedBanner: getElement("unsupported-banner"),
  connectButton: getElement("btn-connect"),
  deviceInfo: getElement("device-info"),
  firmwareHint: getElement("firmware-hint"),
  fileInput: getElement("file-input"),
  upgradeButton: getElement("btn-upgrade"),
  reconnectButton: getElement("btn-reconnect"),
  progressBar: getElement("progress-bar"),
  statusText: getElement("status-text"),
  log: getElement("log"),
};

const state = {
  port: null,
  deviceInfo: null,
  firmwareFile: null,
};

/** Sets up the page, or shows the unsupported-browser banner. */
export function initializeUi() {
  if (!navigator.serial) {
    elements.unsupportedBanner.hidden = false;
    elements.connectButton.disabled = true;
    return;
  }

  elements.connectButton.addEventListener("click", () => void handleConnect());
  elements.fileInput.addEventListener("change", handleFileSelected);
  elements.upgradeButton.addEventListener("click", () => void handleUpgrade());
}

/** Logs a line to the on-page log and keeps it scrolled to the bottom. */
function log(message) {
  elements.log.textContent += `${message}\n`;
  elements.log.scrollTop = elements.log.scrollHeight;
}

/** Clears the progress bar, status text, and success/failure colours. */
function resetProgress() {
  elements.progressBar.classList.remove("success", "failure", "warning");
  elements.progressBar.style.width = "0%";
  elements.statusText.classList.remove("success", "failure", "warning");
  elements.statusText.textContent = "";
}

/**
 * Asks the browser for a serial port and reads the connected device's info.
 * The port is closed after inspection and reopened for the upgrade.
 */
async function handleConnect() {
  if (!navigator.serial) return;

  try {
    const port = await navigator.serial.requestPort({
      filters: SERIAL_PORT_FILTERS,
    });
    const transport = new SerialTransport(port);

    let deviceInfo;
    try {
      await transport.open();
      const client = new AscentClient(transport);
      deviceInfo = await client.getDeviceInfo();
    } finally {
      // Release the port even when device-info reading fails, otherwise a
      // retry can fail with "port already open".
      await transport.close();
    }

    state.port = port;
    state.deviceInfo = deviceInfo;

    resetProgress();
    elements.deviceInfo.textContent =
      `Device: ${deviceInfo.deviceName} | ` +
      `Firmware: ${deviceInfo.firmwareInfo} | ` +
      `Hardware: ${deviceInfo.hardwareVersion} | ` +
      `Serial: ${deviceInfo.serialNumber} | ` +
      `CPU: ${deviceInfo.cpuTemp}C`;
    elements.firmwareHint.textContent =
      `Expect a firmware filename containing ` +
      `"${expectedFirmwareToken(deviceInfo.firmwareInfo)}" for this device.`;

    elements.fileInput.disabled = false;
    elements.fileInput.value = "";
    elements.upgradeButton.disabled = true;
    state.firmwareFile = null;

    log(`Connected: ${deviceInfo.deviceName}`);
  } catch (error) {
    log(`Connect failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Accepts the selected .img file. If its name does not contain the token
 * expected for the connected device, asks for confirmation first.
 */
function handleFileSelected() {
  const file = elements.fileInput.files?.[0];
  if (!file) return;

  if (state.deviceInfo && firmwareNameMismatch(file.name, state.deviceInfo.firmwareInfo)) {
    const confirmed = window.confirm(
      `"${file.name}" doesn't look like it matches this device's firmware ` +
      `("${state.deviceInfo.firmwareInfo}").\n\n` +
      "Flashing the wrong image can brick the device. Continue anyway?",
    );

    if (!confirmed) {
      elements.fileInput.value = "";
      elements.upgradeButton.disabled = true;
      state.firmwareFile = null;
      log("Firmware selection cancelled (name doesn't match connected device).");
      return;
    }

    log(
      `Warning: "${file.name}" doesn't match device firmware "${state.deviceInfo.firmwareInfo}" ` +
      "— proceeding anyway (user override).",
    );
  }

  state.firmwareFile = file;
  elements.upgradeButton.disabled = false;
}

/** Confirms, then runs the full upgrade and updates the progress display. */
async function handleUpgrade() {
  if (
    !state.port ||
    !state.deviceInfo ||
    !state.firmwareFile ||
    !window.confirm(
      "During the upgrade, the device may flash its status light abnormally or restart on its own " +
      "— this is normal. Keep this computer, the USB connection, and the device powered until it " +
      "finishes. Continue?",
    )
  ) {
    return;
  }

  elements.connectButton.disabled = true;
  elements.upgradeButton.disabled = true;
  elements.fileInput.disabled = true;
  resetProgress();
  elements.statusText.textContent = "Checking firmware image…";

  const port = state.port;
  const reconnect = new SerialReconnector(navigator.serial, port);
  const selectRebootedPort = async () => {
    elements.reconnectButton.disabled = true;
    try {
      await reconnect.selectPort();
    } catch (error) {
      if (error?.name !== "NotFoundError") {
        log(`Port selection failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    } finally {
      elements.reconnectButton.disabled = false;
    }
  };
  elements.reconnectButton.addEventListener("click", selectRebootedPort);
  const reportProgress = (event) => {
    const percent = Math.round(event.percent * 100);
    elements.progressBar.style.width = `${percent}%`;
    elements.statusText.textContent = `${event.message} (${percent}%)`;
    log(`[${event.stepName}] ${event.message} — ${percent}%`);
  };

  try {
    const result = await upgradeFirmware({
      createTransport: () => new SerialTransport(port),
      openReconnectedPort: async (deviceInfo, remainingMs) => {
        try {
          const reopened = await reconnect.open(deviceInfo, remainingMs);
          elements.reconnectButton.hidden = true;
          return reopened;
        } catch (error) {
          elements.reconnectButton.hidden = false;
          elements.statusText.textContent = "Waiting for the device. If it has reappeared, select its port again.";
          throw error;
        }
      },
      deviceName: state.deviceInfo.deviceName,
      firmwareFile: state.firmwareFile,
      onProgress: reportProgress,
    });
    const style = result.warning ? "warning" : result.success ? "success" : "failure";
    const message = result.warning || result.success
      ? result.message
      : `Upgrade failed: ${result.message}`;
    showUpgradeResult(style, message);
  } catch (error) {
    showUpgradeResult("warning", `Could not finish serial cleanup: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    state.port = reconnect.port;
    elements.reconnectButton.hidden = true;
    elements.reconnectButton.removeEventListener("click", selectRebootedPort);
    elements.connectButton.disabled = false;
    elements.fileInput.disabled = false;
    elements.upgradeButton.disabled = false;
  }
}

function showUpgradeResult(style, message) {
  elements.progressBar.classList.add(style);
  elements.statusText.classList.add(style);
  elements.statusText.textContent = message;
  log(message);
}

function getElement(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing element #${id}`);
  return element;
}
