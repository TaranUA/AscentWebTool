/**
 * MD5 (RFC 1321) for firmware images.
 *
 * The device expects the lowercase hex MD5 of the entire .img file. This is a
 * small, dependency-free implementation; the browser's Web Crypto API does
 * not support MD5.
 */

const SHIFT_AMOUNTS = [
  // Round 1
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  // Round 2
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  // Round 3
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  // Round 4
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

// floor(abs(sin(i + 1)) * 2^32) for i = 0..63, hard-coded so the result does
// not depend on the platform's Math.sin implementation.
const SINE_TABLE = new Uint32Array([
  0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee,
  0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
  0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be,
  0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
  0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa,
  0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
  0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed,
  0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
  0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c,
  0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
  0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05,
  0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
  0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039,
  0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
  0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1,
  0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
]);

/**
 * @param {Uint8Array|ArrayBuffer} input
 * @returns {string} 32-character lowercase hexadecimal MD5 hash.
 */
export function md5Hex(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);

  // Append 0x80, then zeros, then the 64-bit little-endian bit length.
  const bitLength = BigInt(bytes.length) * 8n;
  const paddedLength = (Math.floor((bytes.length + 8) / 64) + 1) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;

  const paddedView = new DataView(padded.buffer);
  paddedView.setUint32(paddedLength - 8, Number(bitLength & 0xffffffffn), true);
  paddedView.setUint32(paddedLength - 4, Number((bitLength >> 32n) & 0xffffffffn), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  const words = new Uint32Array(16);

  for (let blockOffset = 0; blockOffset < paddedLength; blockOffset += 64) {
    for (let word = 0; word < 16; word += 1) {
      words[word] = paddedView.getUint32(blockOffset + word * 4, true);
    }

    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let round = 0; round < 64; round += 1) {
      let mixed;
      let wordIndex;

      if (round < 16) {
        mixed = (b & c) | (~b & d);
        wordIndex = round;
      } else if (round < 32) {
        mixed = (d & b) | (~d & c);
        wordIndex = (5 * round + 1) % 16;
      } else if (round < 48) {
        mixed = b ^ c ^ d;
        wordIndex = (3 * round + 5) % 16;
      } else {
        mixed = c ^ (b | ~d);
        wordIndex = (7 * round) % 16;
      }

      const sum = (a + mixed + SINE_TABLE[round] + words[wordIndex]) >>> 0;
      const shift = SHIFT_AMOUNTS[round];
      const rotated = ((sum << shift) | (sum >>> (32 - shift))) >>> 0;

      a = d;
      d = c;
      c = b;
      b = (b + rotated) >>> 0;
    }

    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  return [a0, b0, c0, d0].map(wordToLittleEndianHex).join("");
}

function wordToLittleEndianHex(word) {
  let hex = "";
  for (let byte = 0; byte < 4; byte += 1) {
    hex += ((word >>> (byte * 8)) & 0xff).toString(16).padStart(2, "0");
  }
  return hex;
}
