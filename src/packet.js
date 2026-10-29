/**
 * Packet encoding/decoding for the Ascent serial protocol.
 *
 * Header layout (36 bytes, all integers little-endian):
 *
 *   offset  size  field
 *   0       4     magic (0x4152544F)
 *   4       2     version (3292)
 *   6       2     type (1 = request)
 *   8       2     message id (always 0 here)
 *   10      2     reserved (0xABCD)
 *   12      4     command
 *   16      2     format (2)
 *   18      2     user id (0)
 *   20      4     payload length
 *   24      4     sequence number
 *   28      4     retry counter
 *   32      4     CRC-32 of the header (with this field zeroed) + payload
 *   36      ...   payload
 */

import { crc32 } from "./crc32.js";
import {
  FILE_START_HASH_FIELD_SIZE,
  FILE_START_PATH_FIELD_SIZE,
  FILE_START_PAYLOAD_SIZE,
  HEADER_SIZE,
  PacketType,
  PROTOCOL_FORMAT,
  PROTOCOL_MAGIC,
  PROTOCOL_VERSION,
  RESERVED_HEADER_VALUE,
} from "./constants.js";

const textEncoder = new TextEncoder();
const asciiDecoder = new TextDecoder("ascii");

export const EMPTY_PAYLOAD = new Uint8Array(0);

/**
 * Encodes a string into a fixed-size UTF-8 field. The field must already be
 * zero-filled; bytes that do not fit are truncated.
 */
export function writeUtf8Field(target, offset, length, value) {
  const encoded = textEncoder.encode(value);
  target.set(encoded.subarray(0, Math.min(encoded.length, length)), offset);
}

/**
 * Reads a null-terminated ASCII field, or the whole field if it has no NUL.
 */
export function readAsciiField(bytes, offset, length) {
  const field = bytes.subarray(offset, offset + length);
  const nulIndex = field.indexOf(0);
  return asciiDecoder.decode(nulIndex >= 0 ? field.subarray(0, nulIndex) : field);
}

/**
 * Builds a complete request packet (header + payload) with its CRC-32.
 *
 * @param {number} command
 * @param {object} [options]
 * @param {number} [options.sequence]
 * @param {number} [options.retry]
 * @param {Uint8Array|null} [options.payload]
 * @param {number} [options.type]
 * @returns {Uint8Array}
 */
export function buildPacket(
  command,
  {
    sequence = 0,
    retry = 0,
    payload = EMPTY_PAYLOAD,
    type = PacketType.REQUEST,
  } = {},
) {
  const payloadBytes = payload ?? EMPTY_PAYLOAD;
  const header = new Uint8Array(HEADER_SIZE);

  writeHeader(header, {
    magic: PROTOCOL_MAGIC,
    version: PROTOCOL_VERSION,
    type,
    messageId: 0,
    reserved: RESERVED_HEADER_VALUE,
    command,
    format: PROTOCOL_FORMAT,
    userId: 0,
    payloadLength: payloadBytes.length,
    sequence,
    retry,
    checksum: 0,
  });

  const checksum = crc32(header, payloadBytes);
  new DataView(header.buffer).setUint32(32, checksum, true);

  const packet = new Uint8Array(HEADER_SIZE + payloadBytes.length);
  packet.set(header, 0);
  if (payloadBytes.length > 0) {
    packet.set(payloadBytes, HEADER_SIZE);
  }

  return packet;
}

/**
 * Parses a 36-byte header. CRC verification is intentionally not performed:
 * the original tool did not verify it either.
 */
export function parseHeader(bytes) {
  if (bytes.length < HEADER_SIZE) {
    throw new Error(`header too short: ${bytes.length} bytes`);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;

  const magic = view.getUint32(offset, true);
  offset += 4;
  const version = view.getUint16(offset, true);
  offset += 2;
  const type = view.getUint16(offset, true);
  offset += 2;
  const messageId = view.getUint16(offset, true);
  offset += 2;
  const reserved = view.getUint16(offset, true);
  offset += 2;
  const command = view.getUint32(offset, true);
  offset += 4;
  const format = view.getUint16(offset, true);
  offset += 2;
  const userId = view.getUint16(offset, true);
  offset += 2;
  const payloadLength = view.getUint32(offset, true);
  offset += 4;
  const sequence = view.getUint32(offset, true);
  offset += 4;
  const retry = view.getUint32(offset, true);
  offset += 4;
  const checksum = view.getUint32(offset, true);

  return {
    magic,
    version,
    type,
    messageId,
    reserved,
    command,
    format,
    userId,
    payloadLength,
    sequence,
    retry,
    checksum,
  };
}

/**
 * Parses the 300-byte device-info payload returned by GET_DEVICE_INFO.
 */
export function parseDeviceInfo(payload) {
  if (payload.length < 300) {
    throw new Error(`FIND_DEVICE payload too short: ${payload.length} bytes`);
  }

  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  let offset = 0;

  const receiveMaxSize = view.getInt32(offset, true);
  offset += 4;
  const sdkVersion = readAsciiField(payload, offset, 32);
  offset += 32;
  const deviceName = readAsciiField(payload, offset, 64);
  offset += 64;
  const cpuTemp = view.getInt32(offset, true);
  offset += 4;
  const firmwareInfo = readAsciiField(payload, offset, 64);
  offset += 64;
  const serialNumber = readAsciiField(payload, offset, 32);
  offset += 32;
  const hardwareVersion = readAsciiField(payload, offset, 32);
  offset += 32;
  const status = view.getInt32(offset, true);
  offset += 4;
  const detail = readAsciiField(payload, offset, 64);

  return {
    receiveMaxSize,
    sdkVersion,
    deviceName,
    cpuTemp,
    firmwareInfo,
    serialNumber,
    hardwareVersion,
    status,
    detail,
  };
}

/**
 * Parses the response to SEND_FILE_END.
 */
export function parseFileEndResponse(payload) {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);

  return {
    length: view.getInt32(0, true),
    currentSize: view.getInt32(4, true),
    totalSize: view.getInt32(8, true),
    status: view.getInt32(12, true),
    detail: readAsciiField(payload, 16, 64),
  };
}

/**
 * Parses the response to UPGRADE_STATUS.
 */
export function parseUpgradeStatus(payload) {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);

  return {
    percent: view.getInt32(0, true),
    status: view.getInt32(4, true),
    detail: readAsciiField(payload, 8, 64),
  };
}

/**
 * Builds the 328-byte metadata payload sent before the firmware bytes.
 *
 * Layout: MD5 (64-byte field), total size (int32), constant 1 (int32),
 * remote path (128-byte field), last 128 characters of the filename
 * (128-byte field).
 */
export function buildFileStartPayload(md5Hash, totalSize, remotePath, fileName) {
  const payload = new Uint8Array(FILE_START_PAYLOAD_SIZE);
  const view = new DataView(payload.buffer);

  writeUtf8Field(payload, 0, FILE_START_HASH_FIELD_SIZE, md5Hash);
  view.setInt32(FILE_START_HASH_FIELD_SIZE, totalSize, true);
  view.setInt32(FILE_START_HASH_FIELD_SIZE + 4, 1, true);
  writeUtf8Field(payload, 72, FILE_START_PATH_FIELD_SIZE, remotePath);

  const shortName = fileName.length > FILE_START_PATH_FIELD_SIZE
    ? fileName.slice(-FILE_START_PATH_FIELD_SIZE)
    : fileName;
  writeUtf8Field(payload, 200, FILE_START_PATH_FIELD_SIZE, shortName);

  return payload;
}

/**
 * Creates a fixed-size, zero-padded UTF-8 string payload.
 */
export function paddedUtf8(value, length) {
  const bytes = new Uint8Array(length);
  writeUtf8Field(bytes, 0, length, value);
  return bytes;
}

/** Internal header serializer; throws if the layout and offsets disagree. */
function writeHeader(header, fields) {
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  let offset = 0;

  view.setUint32(offset, fields.magic, true);
  offset += 4;
  view.setUint16(offset, fields.version, true);
  offset += 2;
  view.setUint16(offset, fields.type, true);
  offset += 2;
  view.setUint16(offset, fields.messageId, true);
  offset += 2;
  view.setUint16(offset, fields.reserved, true);
  offset += 2;
  view.setUint32(offset, fields.command, true);
  offset += 4;
  view.setUint16(offset, fields.format, true);
  offset += 2;
  view.setUint16(offset, fields.userId, true);
  offset += 2;
  view.setUint32(offset, fields.payloadLength, true);
  offset += 4;
  view.setUint32(offset, fields.sequence, true);
  offset += 4;
  view.setUint32(offset, fields.retry, true);
  offset += 4;
  view.setUint32(offset, fields.checksum, true);
  offset += 4;

  if (offset !== HEADER_SIZE) {
    throw new Error(`header packing produced ${offset} bytes, expected ${HEADER_SIZE}`);
  }
}
