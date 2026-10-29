/**
 * Browser-based parity tests.
 *
 * The original production bundle is loaded as a classic script by index.html.
 * Its top-level functions are globals, so this module can compare the
 * refactored implementation against it byte-for-byte.
 *
 * Run by serving the project root and opening /tests/.
 */

import {
  Command,
  HEADER_SIZE,
  SERIAL_PORT_FILTERS,
  rebootDelayMs,
} from "../src/constants.js";
import { crc32 } from "../src/crc32.js";
import { expectedFirmwareToken, firmwareNameMismatch } from "../src/device.js";
import { upgradeFirmware } from "../src/firmware.js";
import { AscentClient } from "../src/client.js";
import { md5Hex } from "../src/md5.js";
import {
  buildFileStartPayload,
  buildPacket,
  EMPTY_PAYLOAD,
  paddedUtf8,
  parseDeviceInfo,
  parseFileEndResponse,
  parseHeader,
  parseUpgradeStatus,
} from "../src/packet.js";
import { SerialTransport } from "../src/transport.js";

const summary = document.getElementById("summary");
const results = document.getElementById("results");

const originalFunctions = ["h", "m", "n", "O", "k", "M", "S", "C", "V", "l", "D", "I", "b", "x", "_", "U"];
const missingOriginalFunctions = originalFunctions.filter(
  (name) => typeof window[name] !== "function" && name !== "U",
);

if (typeof window.U === "undefined") {
  missingOriginalFunctions.push("U");
}

const tests = [];
const lines = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assertDeepEqual(actual, expected, message) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${message}\n      expected: ${expectedJson}\n      actual:   ${actualJson}`);
  }
}

function assertBytesEqual(actual, expected, message) {
  assert(
    actual instanceof Uint8Array && expected instanceof Uint8Array,
    `${message}: both values must be Uint8Array`,
  );

  if (actual.length !== expected.length) {
    throw new Error(`${message}: length ${actual.length}, expected ${expected.length}`);
  }

  for (let index = 0; index < actual.length; index += 1) {
    if (actual[index] !== expected[index]) {
      throw new Error(
        `${message}: byte ${index} is 0x${hexByte(actual[index])}, expected 0x${hexByte(expected[index])}`,
      );
    }
  }
}

function hexByte(value) {
  return value.toString(16).padStart(2, "0");
}

function encode(value) {
  return new TextEncoder().encode(value);
}

/** Deterministic pseudo-random bytes, so failures are reproducible. */
function makeBytes(length, seed = 0x12345678) {
  const bytes = new Uint8Array(length);
  let state = seed >>> 0 || 1;

  for (let index = 0; index < length; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    bytes[index] = state & 0xff;
  }

  return bytes;
}

function writeField(target, offset, length, value) {
  const bytes = encode(value);
  target.set(bytes.subarray(0, Math.min(bytes.length, length)), offset);
}

function makeDeviceInfoPayload(overrides = {}) {
  const {
    receiveMaxSize = 4096,
    sdkVersion = "SDK 1.2.3",
    deviceName = "Ascent_VRX",
    cpuTemp = 42,
    firmwareInfo = "Ascent_VRX_1.2.3_7541",
    serialNumber = "SN-123456",
    hardwareVersion = "HW-1.0",
    status = 0,
    detail = "OK",
  } = overrides;

  const payload = new Uint8Array(300);
  const view = new DataView(payload.buffer);

  view.setInt32(0, receiveMaxSize, true);
  writeField(payload, 4, 32, sdkVersion);
  writeField(payload, 36, 64, deviceName);
  view.setInt32(100, cpuTemp, true);
  writeField(payload, 104, 64, firmwareInfo);
  writeField(payload, 168, 32, serialNumber);
  writeField(payload, 200, 32, hardwareVersion);
  view.setInt32(232, status, true);
  writeField(payload, 236, 64, detail);

  return payload;
}

function makeFileEndPayload(overrides = {}) {
  const {
    length = 0,
    currentSize = 0,
    totalSize = 0,
    status = 0,
    detail = "OK",
  } = overrides;

  const payload = new Uint8Array(80);
  const view = new DataView(payload.buffer);

  view.setInt32(0, length, true);
  view.setInt32(4, currentSize, true);
  view.setInt32(8, totalSize, true);
  view.setInt32(12, status, true);
  writeField(payload, 16, 64, detail);

  return payload;
}

function makeUpgradeStatusPayload(overrides = {}) {
  const { percent = 0, status = 0, detail = "" } = overrides;

  const payload = new Uint8Array(72);
  const view = new DataView(payload.buffer);

  view.setInt32(0, percent, true);
  view.setInt32(4, status, true);
  writeField(payload, 8, 64, detail);

  return payload;
}

// ---------------------------------------------------------------------------
// CRC-32
// ---------------------------------------------------------------------------

test("CRC-32 known value", () => {
  assertEqual(crc32(encode("123456789")), 0xcbf43926, "CRC-32 of '123456789'");
});

test("CRC-32 matches the original implementation", () => {
  for (const length of [0, 1, 2, 31, 32, 33, 100, 1_000, 65_536]) {
    const first = makeBytes(length, 0x1111 + length);
    const second = makeBytes(Math.floor(length / 2), 0x2222 + length);
    assertEqual(
      crc32(first, second),
      window.m(first, second),
      `CRC-32 for length ${length}`,
    );
  }
});

// ---------------------------------------------------------------------------
// MD5
// ---------------------------------------------------------------------------

test("MD5 known vectors", () => {
  const vectors = [
    ["", "d41d8cd98f00b204e9800998ecf8427e"],
    ["abc", "900150983cd24fb0d6963f7d28e17f72"],
    [
      "The quick brown fox jumps over the lazy dog",
      "9e107d9d372bb6826bd81d3542a419d6",
    ],
  ];

  for (const [input, expected] of vectors) {
    assertEqual(md5Hex(encode(input)), expected, `MD5 of ${JSON.stringify(input)}`);
  }

  const millionAs = new Uint8Array(1_000_000).fill(0x61);
  assertEqual(
    md5Hex(millionAs),
    "7707d6ae4e027c70eea2a935c2296f21",
    "MD5 of one million 'a' bytes",
  );
});

test("MD5 matches the original implementation", () => {
  for (const length of [0, 1, 55, 56, 57, 63, 64, 65, 127, 128, 129, 1_000, 65_536, 100_000]) {
    const bytes = makeBytes(length, 0x3333 + length);
    assertEqual(md5Hex(bytes), window.D(bytes), `MD5 for length ${length}`);
  }
});

// ---------------------------------------------------------------------------
// Packet encoding and parsing
// ---------------------------------------------------------------------------

test("Packet encoding matches the original implementation", () => {
  const payloads = [
    EMPTY_PAYLOAD,
    makeBytes(1),
    makeBytes(31),
    makeBytes(300),
    makeBytes(1_000),
  ];

  for (const command of [3, 60, 114, 115, 116, 117, 118]) {
    for (const sequence of [0, 1, 42, 999]) {
      for (const retry of [0, 1, 7]) {
        for (const payload of payloads) {
          const expected = window.h(command, 1, sequence, retry, payload);
          const actual = buildPacket(command, { sequence, retry, payload });
          assertBytesEqual(
            actual,
            expected,
            `packet command=${command} seq=${sequence} retry=${retry} payload=${payload.length}`,
          );
        }
      }
    }
  }
});

test("Packet header parsing matches the original implementation", () => {
  const packet = window.h(118, 1, 5, 2, makeBytes(50));
  const expected = window._(packet.subarray(0, HEADER_SIZE));
  const actual = parseHeader(packet.subarray(0, HEADER_SIZE));

  assertEqual(actual.magic, expected.magic, "magic");
  assertEqual(actual.version, expected.version, "version");
  assertEqual(actual.type, expected.type, "type");
  assertEqual(actual.messageId, expected.msgid, "msgid");
  assertEqual(actual.reserved, expected.unused, "unused");
  assertEqual(actual.command, expected.command, "command");
  assertEqual(actual.format, expected.format, "format");
  assertEqual(actual.userId, expected.userid, "userid");
  assertEqual(actual.payloadLength, expected.length, "length");
  assertEqual(actual.sequence, expected.seq, "seq");
  assertEqual(actual.retry, expected.retry, "retry");
  assertEqual(actual.checksum, expected.crc32, "crc32");
});

test("Device info parsing matches the original implementation", () => {
  const payloads = [
    makeDeviceInfoPayload(),
    makeDeviceInfoPayload({
      receiveMaxSize: 1,
      sdkVersion: "SDK",
      deviceName: "Ascent_GT_Pro / Lite+",
      cpuTemp: -5,
      firmwareInfo: "Ascent_GT_Pro_1.0.0_7542",
      serialNumber: "SERIAL",
      hardwareVersion: "HW",
      status: -3,
      detail: "not ready",
    }),
    new Uint8Array([
      ...makeDeviceInfoPayload(),
      ...makeBytes(25, 0x4444),
    ]),
  ];

  for (const payload of payloads) {
    assertDeepEqual(
      parseDeviceInfo(payload),
      window.n(payload),
      `device info payload (${payload.length} bytes)`,
    );
  }

  let threw = false;
  try {
    parseDeviceInfo(new Uint8Array(299));
  } catch (error) {
    threw = error.message.includes("too short");
  }
  assert(threw, "short device-info payload should throw");
});

test("File-end parsing matches the original implementation", () => {
  for (const overrides of [
    { length: 328, currentSize: 100, totalSize: 200, status: 0, detail: "OK" },
    { status: -9, detail: "image CRC error" },
    { status: 7, detail: "" },
  ]) {
    const payload = makeFileEndPayload(overrides);
    const expected = window.O(payload);
    const actual = parseFileEndResponse(payload);

    assertEqual(actual.length, expected.length, "file-end length");
    assertEqual(actual.currentSize, expected.cursize, "file-end current size");
    assertEqual(actual.totalSize, expected.totalsize, "file-end total size");
    assertEqual(actual.status, expected.status, "file-end status");
    assertEqual(actual.detail, expected.detail, "file-end detail");
  }
});

test("Upgrade status parsing matches the original implementation", () => {
  for (const overrides of [
    { percent: 0, status: 0, detail: "" },
    { percent: 42, status: 0, detail: "flashing" },
    { percent: 100, status: -11, detail: "flash error" },
  ]) {
    const payload = makeUpgradeStatusPayload(overrides);
    assertDeepEqual(
      parseUpgradeStatus(payload),
      window.k(payload),
      `upgrade-status payload ${JSON.stringify(overrides)}`,
    );
  }
});

test("File-start metadata matches the original implementation", () => {
  const payloads = [
    [md5Hex(makeBytes(1)), 1, "/tmp/pc/a.img", "a.img"],
    [md5Hex(makeBytes(1_000)), 1_000, "/tmp/pc/Ascent_VRX_1.2.3_7541.img", "Ascent_VRX_1.2.3_7541.img"],
    ["0".repeat(32), 0, "/tmp/pc/", ""],
    ["f".repeat(32), 4_294_967_295, `/tmp/pc/${"x".repeat(200)}.img`, `${"x".repeat(200)}.img`],
    ["a".repeat(32), 123, "/tmp/pc/üñïçødé.img", "üñïçødé.img"],
  ];

  for (const [hash, size, path, name] of payloads) {
    assertBytesEqual(
      buildFileStartPayload(hash, size, path, name),
      window.M(hash, size, path, name),
      `file-start payload for ${name.slice(0, 20)}`,
    );
  }
});

test("Padded UTF-8 payloads match the original implementation", () => {
  for (const [value, length] of [
    ["clean", 32],
    ["", 0],
    ["", 32],
    ["a".repeat(100), 32],
    ["üñïçødé", 16],
  ]) {
    assertBytesEqual(
      paddedUtf8(value, length),
      window.V(value, length),
      `padded UTF-8 ${JSON.stringify(value)} length=${length}`,
    );
  }
});

// ---------------------------------------------------------------------------
// Device helpers and constants
// ---------------------------------------------------------------------------

test("Firmware-name matching matches the original implementation", () => {
  const firmwareInfos = [
    "Ascent_VRX_1.2.3_7541",
    "Ascent_L_GND401",
    "ASCENT_L_GND401",
    "Ascent_GT_Pro / Lite+",
    "Ascent_VRX_v1.2.3",
    "foo_1234",
    "foo_12",
    "x_999",
    "123456",
    "abc",
    "",
  ];
  const fileNames = [
    "Ascent_VRX_1.2.3_7541.img",
    "Ascent_VRX_1.2.3.img",
    "other.img",
    "no-extension",
    "foo.img.img",
    "ASCENT_L_GND401.img",
  ];

  for (const firmwareInfo of firmwareInfos) {
    assertEqual(
      expectedFirmwareToken(firmwareInfo),
      window.S(firmwareInfo),
      `expected token for ${JSON.stringify(firmwareInfo)}`,
    );

    for (const fileName of fileNames) {
      assertEqual(
        firmwareNameMismatch(fileName, firmwareInfo),
        window.C(fileName, firmwareInfo),
        `mismatch for ${JSON.stringify(fileName)} / ${JSON.stringify(firmwareInfo)}`,
      );
    }
  }
});

test("Reboot delays match the original implementation", () => {
  const names = [
    "ascent_vrx",
    "ASCENT_VRX",
    "ascent_vrx_pro",
    "cx485_pro",
    "ascent_gt_max",
    "ascent_lite_plus",
    "caddx_gm3",
    "unknown_device",
    "Ascent_GT_Pro",
  ];

  for (const name of names) {
    assertEqual(rebootDelayMs(name), window.l(name), `reboot delay for ${name}`);
  }
});

test("Serial-port filters match the original implementation", () => {
  assertDeepEqual(SERIAL_PORT_FILTERS, window.U, "serial port filters");
});

// ---------------------------------------------------------------------------
// Full upgrade simulation
// ---------------------------------------------------------------------------

class MockPort {
  constructor(deviceInfoPayload, { dropFirstInfoRequest = false } = {}) {
    this.deviceInfoPayload = deviceInfoPayload;
    this.dropFirstInfoRequest = dropFirstInfoRequest;
    this.infoRequestCount = 0;
    this.statusPercents = [0, 50, 100];
    this.statusIndex = 0;
    this.receiveBuffer = new Uint8Array(0);
    this.commandLog = [];
    this.dataChunks = [];
    this.metadataPayloads = [];
    this.openCount = 0;
    this.closeCount = 0;
    this.readController = null;
    this.readable = null;
    this.writable = null;
  }

  async open() {
    this.openCount += 1;
    this.receiveBuffer = new Uint8Array(0);
    this.readable = new ReadableStream({
      start: (controller) => {
        this.readController = controller;
      },
    });
    this.writable = new WritableStream({
      write: (chunk) => {
        this.receive(new Uint8Array(chunk));
      },
    });
  }

  async close() {
    this.closeCount += 1;
    try {
      this.readController?.close();
    } catch {
      // Already closed.
    }
    this.readController = null;
    this.readable = null;
    this.writable = null;
  }

  /** Reassembles packets across arbitrary serial write boundaries. */
  receive(chunk) {
    const combined = new Uint8Array(this.receiveBuffer.length + chunk.length);
    combined.set(this.receiveBuffer, 0);
    combined.set(chunk, this.receiveBuffer.length);
    this.receiveBuffer = combined;

    for (;;) {
      if (this.receiveBuffer.length < HEADER_SIZE) return;

      const header = parseHeader(this.receiveBuffer.subarray(0, HEADER_SIZE));
      const packetLength = HEADER_SIZE + header.payloadLength;
      if (this.receiveBuffer.length < packetLength) return;

      const packet = this.receiveBuffer.slice(0, packetLength);
      this.receiveBuffer = this.receiveBuffer.slice(packetLength);
      this.handlePacket(header, packet.subarray(HEADER_SIZE));
    }
  }

  handlePacket(header, payload) {
    this.commandLog.push({
      command: header.command,
      sequence: header.sequence,
      retry: header.retry,
      payloadLength: payload.length,
    });

    switch (header.command) {
      case Command.REBOOT:
        return;
      case Command.GET_DEVICE_INFO:
        this.infoRequestCount += 1;
        if (this.dropFirstInfoRequest && this.infoRequestCount === 1) return;
        this.respond(header, this.deviceInfoPayload);
        return;
      case Command.REMOTE_UPGRADE:
        this.respond(header, EMPTY_PAYLOAD);
        return;
      case Command.SEND_FILE_START:
        this.metadataPayloads.push(payload.slice());
        this.respond(header, EMPTY_PAYLOAD);
        return;
      case Command.SEND_FILE_DATA:
        this.dataChunks.push(payload.slice());
        this.respond(header, EMPTY_PAYLOAD);
        return;
      case Command.SEND_FILE_END:
        this.respond(header, makeFileEndPayload({ status: 0, detail: "OK" }));
        return;
      case Command.UPGRADE_STATUS: {
        const percent = this.statusPercents[
          Math.min(this.statusIndex, this.statusPercents.length - 1)
        ];
        this.statusIndex += 1;
        this.respond(header, makeUpgradeStatusPayload({ percent }));
        return;
      }
      default:
        // Unknown command: do not respond.
    }
  }

  respond(requestHeader, payload) {
    const packet = buildPacket(requestHeader.command, {
      sequence: requestHeader.sequence,
      payload,
      type: 2,
    });
    this.readController.enqueue(packet);
  }
}

function joinChunks(chunks) {
  const totalLength = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const joined = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }

  return joined;
}

function normalizeProgress(events) {
  return events.map((event) => `${event.stepName}|${event.percent}|${event.message}`);
}

test("ACK retry matches the original implementation", async () => {
  const deviceInfo = makeDeviceInfoPayload();
  const originalPort = new MockPort(deviceInfo, { dropFirstInfoRequest: true });
  const refactoredPort = new MockPort(deviceInfo, { dropFirstInfoRequest: true });

  const runOriginal = async () => {
    const transport = new window.b(originalPort);
    await transport.open();

    try {
      const client = new window.x(transport);
      const response = await client.sendWithAck(
        Command.GET_DEVICE_INFO,
        EMPTY_PAYLOAD,
        { retryIntervalMs: 50, totalTimeoutMs: 1_000 },
      );

      return {
        matched: response.matched,
        retryCount: response.retryCount,
        payloadLength: response.payload.length,
      };
    } finally {
      await transport.close();
    }
  };

  const runRefactored = async () => {
    const transport = new SerialTransport(refactoredPort);
    await transport.open();

    try {
      const client = new AscentClient(transport);
      const response = await client.sendWithAck(
        Command.GET_DEVICE_INFO,
        EMPTY_PAYLOAD,
        { retryIntervalMs: 50, totalTimeoutMs: 1_000 },
      );

      return {
        matched: response.matched,
        retryCount: response.retryCount,
        payloadLength: response.payload.length,
      };
    } finally {
      await transport.close();
    }
  };

  const [originalResponse, refactoredResponse] = await Promise.all([
    runOriginal(),
    runRefactored(),
  ]);

  assertDeepEqual(refactoredResponse, originalResponse, "retry response");
  assertEqual(refactoredResponse.retryCount, 1, "refactored retry count");
  assertDeepEqual(refactoredPort.commandLog, originalPort.commandLog, "retry command log");
  assertEqual(refactoredPort.commandLog.length, 2, "two request attempts were recorded");
});

test("Full upgrade flow matches the original implementation", async () => {
  const deviceInfo = makeDeviceInfoPayload({
    receiveMaxSize: 100_000,
    deviceName: "Ascent_VRX",
    firmwareInfo: "Ascent_VRX_1.2.3_7541",
  });
  const firmwareBytes = makeBytes(150_000, 0x5555);
  const fileName = "Ascent_VRX_1.2.3_7541.img";

  const originalPort = new MockPort(deviceInfo);
  const refactoredPort = new MockPort(deviceInfo);
  const originalProgress = [];
  const refactoredProgress = [];

  const originalResult = await window.I(
    () => new window.b(originalPort),
    "Ascent_VRX",
    new File([firmwareBytes], fileName),
    (event) => originalProgress.push(event),
    undefined,
    async () => {},
  );

  const refactoredResult = await upgradeFirmware({
    createTransport: () => new SerialTransport(refactoredPort),
    deviceName: "Ascent_VRX",
    firmwareFile: new File([firmwareBytes], fileName),
    onProgress: (event) => refactoredProgress.push(event),
    delay: async () => {},
  });

  assertDeepEqual(refactoredResult, originalResult, "upgrade result");
  assertDeepEqual(refactoredPort.commandLog, originalPort.commandLog, "command log");
  assertDeepEqual(
    normalizeProgress(refactoredProgress),
    normalizeProgress(originalProgress),
    "progress events",
  );

  assertBytesEqual(
    joinChunks(refactoredPort.dataChunks),
    firmwareBytes,
    "refactored flow transferred the firmware",
  );
  assertBytesEqual(
    joinChunks(originalPort.dataChunks),
    firmwareBytes,
    "original flow transferred the firmware",
  );

  const expectedMetadata = buildFileStartPayload(
    md5Hex(firmwareBytes),
    firmwareBytes.length,
    `/tmp/pc/${fileName}`,
    fileName,
  );
  assertBytesEqual(refactoredPort.metadataPayloads[0], expectedMetadata, "metadata");
  assertBytesEqual(originalPort.metadataPayloads[0], expectedMetadata, "original metadata");

  assertEqual(refactoredPort.openCount, 3, "refactored transport reopened after reboots");
  assertEqual(refactoredPort.closeCount, 3, "refactored transport closed after each phase");
  assertEqual(originalPort.openCount, 3, "original transport reopened after reboots");
  assertEqual(originalPort.closeCount, 3, "original transport closed after each phase");
});

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function run() {
  if (missingOriginalFunctions.length > 0) {
    summary.textContent = "Cannot run: original reference functions are missing.";
    results.textContent = missingOriginalFunctions
      .map((name) => `FAIL  reference function window.${name} is unavailable`)
      .join("\n");
    return;
  }

  for (const { name, fn } of tests) {
    try {
      await fn();
      passed += 1;
      lines.push(`PASS  ${name}`);
    } catch (error) {
      failed += 1;
      lines.push(`FAIL  ${name}\n      ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  summary.textContent = `${passed} passed, ${failed} failed`;
  results.textContent = lines.join("\n");
  window.__ascentTestResults = { passed, failed, lines };
}

void run();
