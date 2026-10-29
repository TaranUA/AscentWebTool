/**
 * Firmware-upgrade orchestration.
 *
 * Sequence:
 *   1. Read device info and enter clean/upgrade mode.
 *   2. Wait for the device to reboot and reconnect.
 *   3. Send the file metadata (size, MD5, path), then the file chunks.
 *   4. Ask the device to verify the image and poll its flashing progress.
 *   5. Wait for the final reboot and query the device once more.
 *
 * The device may reboot more than once, so every transport is created from
 * the same SerialPort object rather than held open for the whole operation.
 */

import {
  Command,
  DEFAULT_RECEIVE_CHUNK_SIZE,
  REBOOT_RETRY_INTERVAL_MS,
  REBOOT_TIMEOUT_MS,
  UPGRADE_STATUS_MAX_POLLS,
  UPGRADE_STATUS_POLL_MS,
  UpgradeStatus,
  rebootDelayMs,
} from "./constants.js";
import { AscentClient } from "./client.js";
import {
  buildFileStartPayload,
  parseFileEndResponse,
  parseUpgradeStatus,
  paddedUtf8,
} from "./packet.js";
import { md5Hex } from "./md5.js";

export class AbortedError extends Error {
  constructor() {
    super("Cancelled");
    this.name = "AbortedError";
  }
}

/**
 * @param {object} options
 * @param {() => import("./transport.js").SerialTransport} options.createTransport
 * @param {string} options.deviceName
 * @param {File} options.firmwareFile
 * @param {(event: {stepName: string, percent: number, message: string}) => void} [options.onProgress]
 * @param {AbortSignal} [options.signal]
 * @param {(ms: number, signal?: AbortSignal) => Promise<void>} [options.delay]
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function upgradeFirmware({
  createTransport,
  deviceName,
  firmwareFile,
  onProgress,
  signal,
  delay = sleep,
}) {
  let transport = createTransport();
  let client;

  try {
    await transport.open();
    client = new AscentClient(transport);

    emitProgress(onProgress, "FindDevice", 0.02, "Querying device info");
    const deviceInfo = await client.getDeviceInfo();
    const maxChunkSize = deviceInfo.receiveMaxSize > 0
      ? deviceInfo.receiveMaxSize
      : DEFAULT_RECEIVE_CHUNK_SIZE;

    emitProgress(onProgress, "RebootClean", 0.08, "Rebooting into clean mode");
    await client.sendNoAck(Command.REBOOT, paddedUtf8("clean", 32));

    ({ transport, client } = await reconnectDevice(
      createTransport,
      transport,
      deviceName,
      signal,
      delay,
    ));

    emitProgress(onProgress, "RemoteUpgrade", 0.13, "Entering upgrade mode");
    assertMatched(await client.sendWithAck(Command.REMOTE_UPGRADE), "REMOTE_UPGRADE failed");

    emitProgress(onProgress, "SendFileStart", 0.17, "Starting file transfer");
    const firmwareBytes = new Uint8Array(await firmwareFile.arrayBuffer());
    const firmwareHash = md5Hex(firmwareBytes);
    const remotePath = `/tmp/pc/${firmwareFile.name}`;
    const metadata = buildFileStartPayload(
      firmwareHash,
      firmwareBytes.length,
      remotePath,
      firmwareFile.name,
    );

    assertMatched(
      await client.sendWithAck(Command.SEND_FILE_START, metadata),
      "SENDFILE_START failed",
    );

    emitProgress(onProgress, "SendFileData", 0.17, "Transferring firmware");
    let offset = 0;

    while (offset < firmwareBytes.length) {
      if (signal?.aborted) throw new AbortedError();

      const chunkLength = Math.min(maxChunkSize, firmwareBytes.length - offset);
      const chunk = firmwareBytes.subarray(offset, offset + chunkLength);
      const chunkOffset = offset;

      const response = await client.sendWithAck(Command.SEND_FILE_DATA, chunk, {
        onWriteProgress: (bytesWritten) => {
          emitProgress(
            onProgress,
            "SendFileData",
            0.17 + 0.43 * ((chunkOffset + bytesWritten) / firmwareBytes.length),
            "Transferring firmware",
          );
        },
      });
      assertMatched(response, "SENDFILE_DATA failed");

      offset += chunkLength;
      emitProgress(
        onProgress,
        "SendFileData",
        0.17 + 0.43 * (offset / firmwareBytes.length),
        "Transferring firmware",
      );
    }

    emitProgress(onProgress, "SendFileEnd", 0.62, "Finishing transfer");
    const fileEndResponse = await client.sendWithAck(Command.SEND_FILE_END);
    assertMatched(fileEndResponse, "SENDFILE_END failed");

    const fileEnd = parseFileEndResponse(fileEndResponse.payload);
    if (fileEnd.status !== 0 || fileEnd.detail !== "OK") {
      throw new Error(fileEnd.detail || "SENDFILE_END reported failure");
    }

    emitProgress(onProgress, "UpgradeStatus", 0.65, "Polling upgrade status");
    await pollUpgradeStatus(client, onProgress, signal, delay);

    emitProgress(onProgress, "Reboot", 0.98, "Rebooting device");
    ({ transport, client } = await reconnectDevice(
      createTransport,
      transport,
      deviceName,
      signal,
      delay,
    ));

    // The device is fully booted when it answers again. A failure here does
    // not invalidate the upgrade, so it is deliberately ignored.
    try {
      await client.getDeviceInfo();
    } catch {
      // Ignore.
    }

    emitProgress(onProgress, "Done", 1, "Upgrade complete");
    return { success: true, message: "Upgrade complete" };
  } catch (error) {
    if (error instanceof AbortedError) {
      return { success: false, message: "Cancelled" };
    }
    return {
      success: false,
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await transport.close();
  }
}

async function pollUpgradeStatus(client, onProgress, signal, delay) {
  for (let attempt = 0; attempt < UPGRADE_STATUS_MAX_POLLS; attempt += 1) {
    if (signal?.aborted) throw new AbortedError();

    await delay(UPGRADE_STATUS_POLL_MS, signal);

    const response = await client.sendWithAck(Command.UPGRADE_STATUS);
    assertMatched(response, "UPGRADE_STATUS failed");

    const status = parseUpgradeStatus(response.payload);
    const errorMessage = upgradeErrorMessage(status.status);
    if (errorMessage !== null) throw new Error(errorMessage);

    emitProgress(
      onProgress,
      "UpgradeStatus",
      0.65 + Math.min(99, Math.max(0, status.percent)) * 0.0034,
      "Flashing firmware",
    );

    if (status.percent > 99) return;
  }

  throw new Error("upgrade status query limit exceeded");
}

/**
 * Closes the current transport, waits for the device to reboot, then opens a
 * fresh transport on the same port until the device responds or time runs out.
 */
async function reconnectDevice(createTransport, transport, deviceName, signal, delay) {
  await transport.close();
  await delay(rebootDelayMs(deviceName), signal);

  const deadline = Date.now() + REBOOT_TIMEOUT_MS;

  for (;;) {
    if (signal?.aborted) throw new AbortedError();

    if (Date.now() >= deadline) {
      throw new Error(
        `device did not reappear within ${REBOOT_TIMEOUT_MS}ms after reboot`,
      );
    }

    try {
      const nextTransport = createTransport();
      await nextTransport.open();
      return {
        transport: nextTransport,
        client: new AscentClient(nextTransport),
      };
    } catch {
      await delay(REBOOT_RETRY_INTERVAL_MS, signal);
    }
  }
}

function upgradeErrorMessage(status) {
  switch (status) {
    case UpgradeStatus.VERIFY_IMAGE:
      return null;
    case UpgradeStatus.UPGRADE_ERR_NO_SD:
      return "Upgrade failed, no SD card detected";
    case UpgradeStatus.UPGRADE_ERR_NO_PC:
      return "Upgrade failed, no computer connected";
    case UpgradeStatus.UPGRADE_ERR_NO_FILE:
      return "Upgrade failed, no upgrade file found";
    case UpgradeStatus.UPGRADE_ERR_BAD_FILE:
      return "Upgrade failed, upgrade file is corrupted";
    case UpgradeStatus.UPGRADE_ERR_BOARD_TYPE:
      return "Upgrade failed, the device model does not match the upgraded firmware";
    case UpgradeStatus.UPGRADE_ERR_APP_VERSION:
      return "Upgrade failed, The firmware version number is too low";
    case UpgradeStatus.UPGRADE_ERR_UPGRADE_MODE:
      return "Upgrade failed, invalid upgrade mode";
    case UpgradeStatus.UPGRADE_ERR_IMG_TYPE:
      return "Upgrade failed, image type error";
    case UpgradeStatus.UPGRADE_ERR_IMG_CRC:
      return "Upgrade failed, image CRC error";
    case UpgradeStatus.UPGRADE_ERR_MAX:
      return "Upgrade failed, unknown error";
    case UpgradeStatus.UPGRADE_ERR_FLASH_ERR:
      return "Upgrade failed, flash error";
    case UpgradeStatus.UPGRADE_ERR_CHIPID:
      return "Upgrade failed, chip ID error";
    default:
      return status >= 0 ? null : "Upgrade failed, unknown error";
  }
}

function assertMatched(response, message) {
  if (!response.matched) throw new Error(message);
}

function emitProgress(onProgress, stepName, percent, message) {
  onProgress?.({ stepName, percent, message });
}

/**
 * Promise-based delay that rejects when the abort signal fires.
 */
export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AbortedError());
      return;
    }

    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new AbortedError());
      },
      { once: true },
    );
  });
}
