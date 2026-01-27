/**
 * Calculate MD5 checksum of binary data
 * Uses Bun's native crypto module for fast hashing
 *
 * @param buffer - Binary data to hash
 * @returns 32-character lowercase hex string
 */
export const calculateMD5 = (buffer: ArrayBuffer): string => {
  const hasher = new Bun.CryptoHasher('md5');
  hasher.update(new Uint8Array(buffer));
  return hasher.digest('hex');
};
