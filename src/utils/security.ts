import crypto from 'node:crypto';

/**
 * Constant-time password comparison using SHA-256 digests so password length is never leaked.
 */
export function verifyPasswordTimingSafe(candidate: string, expected: string): boolean {
  if (typeof candidate !== 'string' || typeof expected !== 'string') return false;
  if (candidate.length < 8 || candidate.length > 256) return false;
  const hashA = crypto.createHash('sha256').update(candidate, 'utf8').digest();
  const hashB = crypto.createHash('sha256').update(expected, 'utf8').digest();
  return crypto.timingSafeEqual(hashA, hashB);
}
