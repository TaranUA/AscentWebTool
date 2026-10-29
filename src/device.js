/**
 * Helpers for matching a selected .img filename to the connected device.
 *
 * Firmware names look like "Ascent_VRX_v1.2.3_7541". The original tool takes
 * the part before the trailing digits, removes the first "Ascent" substring,
 * and checks whether the filename contains that token.
 */

export function expectedFirmwareToken(firmwareInfo) {
  const trailingDigits = /(\d\d\d+)$/.exec(firmwareInfo);

  if (trailingDigits) {
    return firmwareInfo
      .slice(0, trailingDigits.index - 1)
      .replace("Ascent", "");
  }

  return firmwareInfo.slice(0, Math.min(12, firmwareInfo.length));
}

/**
 * Returns true when the filename does NOT contain the expected token.
 * The UI asks for confirmation in that case.
 */
export function firmwareNameMismatch(fileName, firmwareInfo) {
  try {
    return !fileName.replace(".img", "").includes(expectedFirmwareToken(firmwareInfo));
  } catch {
    return false;
  }
}
