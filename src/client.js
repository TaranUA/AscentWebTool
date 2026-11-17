/**
 * Request/response client for the Ascent serial protocol.
 *
 * Every acknowledged request carries a sequence number. If no response
 * arrives within the retry interval, the same request is sent again with an
 * incremented retry counter.
 */

import {
  ACK_RETRY_INTERVAL_MS,
  ACK_TIMEOUT_MS,
  Command,
  HEADER_SIZE,
  PROTOCOL_MAGIC,
} from "./constants.js";
import { buildPacket, EMPTY_PAYLOAD, parseDeviceInfo, parseHeader } from "./packet.js";
import { TransportTimeoutError } from "./transport.js";

// Upgrade replies carry acknowledgments or small status records (device info
// is 300 bytes). Leave room for firmware-specific extensions.
const MAX_RESPONSE_PAYLOAD_BYTES = 64 * 1024;

export class AscentClient {
  constructor(transport) {
    this.transport = transport;
    this.sequence = 0;
  }

  /** Sends a command that does not expect a response. */
  async sendNoAck(command, payload) {
    const packet = buildPacket(command, {
      sequence: this.sequence,
      retry: 0,
      payload,
    });
    this.sequence += 1;
    await this.transport.write(packet);
  }

  /** Fetches and parses the device information block. */
  async getDeviceInfo(options) {
    const response = await this.sendWithAck(Command.GET_DEVICE_INFO, EMPTY_PAYLOAD, options);
    if (!response.matched) {
      throw new Error("FIND_DEVICE timed out");
    }
    return parseDeviceInfo(response.payload);
  }

  /**
   * Sends a request and waits for a matching response.
   *
   * @param {number} command
   * @param {Uint8Array} [payload]
   * @param {object} [options]
   * @param {number} [options.expectedAckCommand] Command to match (defaults to `command`).
   * @param {number} [options.totalTimeoutMs]
   * @param {number} [options.retryIntervalMs]
   * @param {(bytesWritten: number) => void} [options.onWriteProgress]
   */
  async sendWithAck(command, payload = EMPTY_PAYLOAD, options = {}) {
    const expectedCommand = options.expectedAckCommand ?? command;
    const totalTimeoutMs = options.totalTimeoutMs ?? ACK_TIMEOUT_MS;
    const retryIntervalMs = options.retryIntervalMs ?? ACK_RETRY_INTERVAL_MS;
    const sequence = this.sequence;
    this.sequence += 1;

    let retryCount = 0;
    let packet = buildPacket(command, { sequence, retry: retryCount, payload });
    await this.transport.write(packet, options.onWriteProgress);

    const deadline = Date.now() + totalTimeoutMs;

    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        return {
          matched: false,
          command: expectedCommand,
          sequence,
          retryCount,
          payload: EMPTY_PAYLOAD,
        };
      }

      const waitTime = Math.min(retryIntervalMs, remaining);
      let header;

      try {
        header = parseHeader(await this.transport.readExact(HEADER_SIZE, waitTime));
      } catch (error) {
        if (!(error instanceof TransportTimeoutError)) throw error;

        retryCount += 1;
        packet = buildPacket(command, { sequence, retry: retryCount, payload });
        await this.transport.write(packet, options.onWriteProgress);
        continue;
      }

      if (header.magic !== PROTOCOL_MAGIC) {
        throw new Error(`bad magic in response: 0x${header.magic.toString(16)}`);
      }

      if (header.payloadLength > MAX_RESPONSE_PAYLOAD_BYTES) {
        throw new Error(`Serial response payload too large: ${header.payloadLength} bytes`);
      }

      let responsePayload = EMPTY_PAYLOAD;
      if (header.payloadLength > 0) {
        try {
          responsePayload = await this.transport.readExact(
            header.payloadLength,
            Math.max(0, deadline - Date.now()),
          );
        } catch (error) {
          if (!(error instanceof TransportTimeoutError)) throw error;
          throw new Error(`Incomplete serial response: expected ${header.payloadLength} payload bytes`, {
            cause: error,
          });
        }
      }

      // Confirm device response CRC coverage on hardware before enforcing it.

      if (header.command === expectedCommand && header.sequence === sequence) {
        return {
          matched: true,
          command: header.command,
          sequence: header.sequence,
          retryCount,
          payload: responsePayload,
        };
      }
      // A response for a different command/sequence is ignored.
    }
  }
}
