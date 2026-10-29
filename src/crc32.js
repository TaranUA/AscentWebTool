/**
 * CRC-32 (IEEE 802.3, reflected polynomial 0xEDB88320).
 *
 * The device protocol stores this checksum for every packet. The table is
 * generated once when the module loads.
 */

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);

  for (let byte = 0; byte < 256; byte += 1) {
    let value = byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
    }
    table[byte] = value >>> 0;
  }

  return table;
})();

/**
 * Computes the CRC-32 of one or more byte arrays, as if they were concatenated.
 *
 * @param {...Uint8Array} chunks
 * @returns {number} Unsigned 32-bit checksum.
 */
export function crc32(...chunks) {
  let checksum = 0xffffffff;

  for (const chunk of chunks) {
    for (let index = 0; index < chunk.length; index += 1) {
      checksum = CRC32_TABLE[(checksum ^ chunk[index]) & 0xff] ^ (checksum >>> 8);
    }
  }

  return (checksum ^ 0xffffffff) >>> 0;
}
