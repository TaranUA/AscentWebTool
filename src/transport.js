/**
 * Byte transport over a Web Serial port.
 *
 * The reader runs continuously in the background and appends incoming bytes
 * to an internal buffer. readExact() then waits until enough bytes are
 * available, with a timeout.
 */

import { WRITE_SLICE_SIZE } from "./constants.js";

export class TransportTimeoutError extends Error {
  constructor(message = "transport read timed out") {
    super(message);
    this.name = "TransportTimeoutError";
  }
}

export class SerialTransport {
  /**
   * @param {SerialPort} port
   * @param {number} [writeSliceSize]
   */
  constructor(port, writeSliceSize = WRITE_SLICE_SIZE) {
    this.port = port;
    this.writeSliceSize = writeSliceSize;
    this.writer = null;
    this.reader = null;
    this.pending = new Uint8Array(0);
    this.pumpError = null;
    this.waiters = [];
  }

  async open(baudRate = 115200) {
    await this.port.open({ baudRate });

    if (!this.port.readable || !this.port.writable) {
      throw new Error("serial port has no readable/writable stream after open()");
    }

    this.writer = this.port.writable.getWriter();
    this.reader = this.port.readable.getReader();
    void this.pumpLoop();
  }

  /** Continuously moves bytes from the serial reader into `pending`. */
  async pumpLoop() {
    const reader = this.reader;
    if (!reader) return;

    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value || value.length === 0) continue;

        const combined = new Uint8Array(this.pending.length + value.length);
        combined.set(this.pending, 0);
        combined.set(value, this.pending.length);
        this.pending = combined;
        this.wakeWaiters();
      }
    } catch (error) {
      this.pumpError = error;
      this.wakeWaiters();
    }
  }

  wakeWaiters() {
    const waiters = this.waiters;
    this.waiters = [];
    for (const wake of waiters) wake();
  }

  waitForDataOrTimeout(timeoutMs) {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      this.waiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  /**
   * Writes all bytes, splitting large payloads into smaller serial writes.
   *
   * @param {Uint8Array} bytes
   * @param {(bytesWritten: number) => void} [onProgress]
   */
  async write(bytes, onProgress) {
    if (!this.writer) throw new Error("transport not open");

    let offset = 0;
    while (offset < bytes.length) {
      const end = Math.min(offset + this.writeSliceSize, bytes.length);
      await this.writer.write(bytes.subarray(offset, end));
      offset = end;
      onProgress?.(offset);
    }

    if (bytes.length === 0) onProgress?.(0);
  }

  /**
   * Waits for exactly `count` bytes, removing them from the buffer.
   *
   * @param {number} count
   * @param {number} timeoutMs
   * @returns {Promise<Uint8Array>}
   */
  async readExact(count, timeoutMs) {
    const deadline = Date.now() + timeoutMs;

    while (this.pending.length < count) {
      if (this.pumpError) throw this.pumpError;

      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new TransportTimeoutError();

      await this.waitForDataOrTimeout(remaining);

      if (this.pending.length < count && Date.now() >= deadline) {
        throw new TransportTimeoutError();
      }
    }

    const result = this.pending.slice(0, count);
    this.pending = this.pending.slice(count);
    return result;
  }

  async close() {
    try {
      await this.reader?.cancel();
    } catch {
      // Already cancelled or the device disappeared.
    }

    try {
      this.writer?.releaseLock();
    } catch {
      // Already released.
    }

    this.reader = null;
    this.writer = null;

    try {
      await this.port.close();
    } catch {
      // Already closed.
    }
  }
}
