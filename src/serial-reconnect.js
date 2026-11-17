import { AscentClient } from "./client.js";
import { SERIAL_PORT_FILTERS } from "./constants.js";
import { SerialTransport } from "./transport.js";

/**
 * A USB reboot can invalidate an authorized SerialPort. Enumerate again on
 * every attempt. Probe replacement ports before sending upgrade commands.
 */
export class SerialReconnector {
  constructor(serial, port) {
    this.serial = serial;
    this.port = port;
    this.usbInfo = port.getInfo();
    this.selectedPort = null;
  }

  async selectPort() {
    const { usbVendorId, usbProductId } = this.usbInfo;
    const filters = usbVendorId === undefined
      ? SERIAL_PORT_FILTERS
      : [usbProductId === undefined ? { usbVendorId } : { usbVendorId, usbProductId }];
    this.selectedPort = await this.serial.requestPort({ filters });
  }

  async open(expectedDevice, remainingMs) {
    const deadline = Date.now() + remainingMs;
    const ports = await this.serial.getPorts();
    const candidates = new Set([this.selectedPort, this.port, ...ports]);
    let lastError = new Error("Select the rebooted device in the browser's port picker.");

    for (const port of candidates) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      if (!port || port.connected === false) continue;
      const selected = port === this.selectedPort;
      if (!selected && !ports.includes(port)) continue;
      if (port !== this.port && !selected && !this.matchesUsbInfo(port)) continue;

      const transport = new SerialTransport(port);
      try {
        await transport.open();
        const client = new AscentClient(transport);
        if (port !== this.port) {
          const info = await client.getDeviceInfo({
            totalTimeoutMs: Math.max(1, Math.min(2_000, deadline - Date.now())),
          });
          if (!matchesDevice(expectedDevice, info, selected)) {
            throw new Error("The selected port did not identify itself as the original device.");
          }
        }

        this.port = port;
        this.selectedPort = null;
        return { transport, client };
      } catch (error) {
        await transport.close();
        lastError = error;
      }
    }
    throw lastError;
  }

  matchesUsbInfo(port) {
    const { usbVendorId, usbProductId } = port.getInfo();
    return usbVendorId !== undefined && usbVendorId === this.usbInfo.usbVendorId &&
      usbProductId === this.usbInfo.usbProductId;
  }
}

function matchesDevice(expected, actual, selected) {
  if (actual.status !== 0 || expected.deviceName !== actual.deviceName) return false;

  const expectedSerial = expected.serialNumber.trim();
  const actualSerial = actual.serialNumber.trim();
  if (expectedSerial && actualSerial) return expectedSerial === actualSerial;

  // When clean mode omits a serial number, a fresh user selection is needed.
  return selected && expected.firmwareInfo === actual.firmwareInfo;
}
