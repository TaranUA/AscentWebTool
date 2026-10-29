/**
 * Protocol and device constants.
 *
 * These values were recovered from the original production bundle. Do not
 * change them unless you are deliberately changing the wire protocol.
 */

/** Header magic: 0x4152544F ("ARTO" when read big-endian). */
export const PROTOCOL_MAGIC = 0x4152544f;

/** Header protocol version. */
export const PROTOCOL_VERSION = 3292;

/** Header "format" field written by this tool. */
export const PROTOCOL_FORMAT = 2;

/** Header reserved/unused field: 0xABCD. */
export const RESERVED_HEADER_VALUE = 0xabcd;

/** All requests sent by this tool use packet type 1. */
export const PacketType = Object.freeze({
  REQUEST: 1,
});

/**
 * Command IDs used by the device protocol.
 *
 * Names are descriptive. The device itself only sees the numeric values.
 */
export const Command = Object.freeze({
  /** Reboots the device; the "clean" payload selects the clean/upgrade boot. */
  REBOOT: 3,
  /** Returns the device information block parsed by parseDeviceInfo(). */
  GET_DEVICE_INFO: 60,
  /** Switches the device into remote-upgrade mode. */
  REMOTE_UPGRADE: 114,
  /** Announces the firmware file (size, MD5, remote path). */
  SEND_FILE_START: 115,
  /** Transfers one firmware chunk. */
  SEND_FILE_DATA: 116,
  /** Finishes the transfer and makes the device verify the image. */
  SEND_FILE_END: 117,
  /** Polls flashing progress. */
  UPGRADE_STATUS: 118,
});

/** Size in bytes of the fixed packet header. */
export const HEADER_SIZE = 36;

/** Serial writes are split into slices of this size. */
export const WRITE_SLICE_SIZE = 32 * 1024;

/** Chunk size used when the device does not report its own limit. */
export const DEFAULT_RECEIVE_CHUNK_SIZE = 1024 * 1024;

/** Time allowed for an acknowledged command, including retries. */
export const ACK_TIMEOUT_MS = 20_000;

/** How long to wait for a response before resending a request. */
export const ACK_RETRY_INTERVAL_MS = 2_000;

/** How long to wait for the device to reappear after a reboot. */
export const REBOOT_TIMEOUT_MS = 60_000;

/** Retry interval while waiting for the device to reappear. */
export const REBOOT_RETRY_INTERVAL_MS = 1_000;

/** Delay between upgrade-status polls. */
export const UPGRADE_STATUS_POLL_MS = 1_000;

/** Maximum number of upgrade-status polls before giving up. */
export const UPGRADE_STATUS_MAX_POLLS = 200;

/** Metadata layout for SEND_FILE_START. */
export const FILE_START_HASH_FIELD_SIZE = 64;
export const FILE_START_PATH_FIELD_SIZE = 128;
export const FILE_START_PAYLOAD_SIZE = 328;

/**
 * How long each device model needs to reboot before the serial port can be
 * opened again. The original tool uses these as fixed delays.
 */
export const REBOOT_DELAY_MS_BY_DEVICE = Object.freeze({
  ascent_vrx: 9_500,
  ascent_vrx_pro: 12_000,
  cx485_pro: 12_000,
  ascent_vrx_max: 12_000,
  ascent_vrx_max_hf: 12_000,
  ascent_vrx_max_wf: 12_000,
  ascent_vrx_cine: 12_000,
  ascent_gt_pro: 9_500,
  ascent_gt_pro_z40: 9_500,
  ascent_gt_pro_z8: 9_500,
  ascent_gt_pro_hub: 9_500,
  ascent_gt: 9_500,
  ascent_gt_27: 9_500,
  ascent_gt_night: 9_500,
  ascent_gt_ultra: 9_500,
  ascent_gt_max: 11_500,
  ascent_lite: 8_000,
  ascent_lite_plus: 8_000,
  yohd_micro: 8_000,
  ascent_rc: 8_000,
  caddx_gm3: 6_000,
  caddx_gm1: 6_000,
});

/** Reboot delay for a device, with the original 10-second fallback. */
export function rebootDelayMs(deviceName) {
  return REBOOT_DELAY_MS_BY_DEVICE[deviceName.toLowerCase()] ?? 10_000;
}

/**
 * USB vendor IDs accepted by the browser's serial-port picker.
 *
 * The labels are informational only; the device reports its own name after
 * connecting.
 */
export const DEVICE_NAME_BY_USB_VENDOR_ID = Object.freeze({
  6790: "GM_V2",
  7531: "ASCENT_L_GND401",
  7532: "ASCENT_L_SKY402",
  7533: "ASCENT_H_SKY482",
  7534: "ASCENT_L_GND",
  7535: "ASCENT_GND_EX1",
  7536: "ASCENT_SKY_EX1",
  7537: "ASCENT_GND_EX2",
  7538: "ASCENT_SKY_EX2",
  7539: "ASCENT_GND_EX3",
  7540: "ASCENT_SKY_EX3",
  7541: "Ascent_VRX",
  7542: "Ascent_GT_Pro / Lite+",
  7543: "Ascent_VRX_Pro",
  7544: "Ascent_VRX_Max",
  7545: "ASCENT_VRX_Cine",
  7546: "ASCENT_VRX_EX",
  7547: "ASCENT_VRX_EX2",
  7552: "ASCENT_JoyStick",
  7553: "OPV2_VTX",
  7554: "OPV2_Z40VTX",
  7555: "OPV2_Z8VTX",
  7556: "OPV2_VRX",
});

/** Numeric vendor IDs, in ascending order. */
export const USB_VENDOR_IDS = Object.freeze(
  Object.keys(DEVICE_NAME_BY_USB_VENDOR_ID).map(Number),
);

/** Filter list passed to navigator.serial.requestPort(). */
export const SERIAL_PORT_FILTERS = Object.freeze(
  USB_VENDOR_IDS.map((usbVendorId) => ({ usbVendorId })),
);

/**
 * Values used in the UPGRADE_STATUS response.
 *
 * Zero means "still verifying". Negative values are errors.
 */
export const UpgradeStatus = Object.freeze({
  VERIFY_IMAGE: 0,
  UPGRADE_ERR_NO_SD: -1,
  UPGRADE_ERR_NO_PC: -2,
  UPGRADE_ERR_NO_FILE: -3,
  UPGRADE_ERR_BAD_FILE: -4,
  UPGRADE_ERR_BOARD_TYPE: -5,
  UPGRADE_ERR_APP_VERSION: -6,
  UPGRADE_ERR_UPGRADE_MODE: -7,
  UPGRADE_ERR_IMG_TYPE: -8,
  UPGRADE_ERR_IMG_CRC: -9,
  UPGRADE_ERR_MAX: -10,
  UPGRADE_ERR_FLASH_ERR: -11,
  UPGRADE_ERR_CHIPID: -12,
});
