// Decrypt PDF 2.0 (AES-256, revision 6) documents that carry an empty user
// password.
//
// ETS publishes sample-issue-task.pdf with permissions restrictions but no open
// password, so the content is readable by design and simply needs the standard
// security handler applied. Without this the file inflates to nothing and its
// scored sample essays are unreachable.
//
// Implements ISO 32000-2 algorithms 2.A (retrieve the file key) and 2.B (the
// hardened password hash).

import crypto from 'node:crypto';

/**
 * Algorithm 2.B: iterated SHA-256/384/512 hardened with AES-128-CBC.
 *
 * The loop runs at least 64 times and then keeps going until the last byte of
 * the AES output is small enough, which is what makes the hash expensive.
 */
function hash2B(password, salt, userData = Buffer.alloc(0)) {
  let k = crypto.createHash('sha256').update(Buffer.concat([password, salt, userData])).digest();

  for (let round = 0; ; round += 1) {
    const k1 = Buffer.concat(Array.from({ length: 64 }, () => Buffer.concat([password, k, userData])));

    const cipher = crypto.createCipheriv('aes-128-cbc', k.subarray(0, 16), k.subarray(16, 32));
    cipher.setAutoPadding(false);
    const e = Buffer.concat([cipher.update(k1), cipher.final()]);

    let modulus = 0;
    for (let i = 0; i < 16; i += 1) modulus += e[i];
    modulus %= 3;

    const algorithm = modulus === 0 ? 'sha256' : modulus === 1 ? 'sha384' : 'sha512';
    k = crypto.createHash(algorithm).update(e).digest();

    if (round >= 63 && e[e.length - 1] <= round - 31) break;
  }

  return k.subarray(0, 32);
}

/** Unescape a PDF literal string into raw bytes. */
function parseLiteralString(bytes, start) {
  const out = [];
  let depth = 1;
  let i = start;

  while (i < bytes.length) {
    const byte = bytes[i];
    if (byte === 0x5c) {
      const next = bytes[i + 1];
      const simple = { 0x6e: 0x0a, 0x72: 0x0d, 0x74: 0x09, 0x62: 0x08, 0x66: 0x0c };
      if (simple[next] !== undefined) {
        out.push(simple[next]);
        i += 2;
      } else if (next >= 0x30 && next <= 0x37) {
        let octal = '';
        let j = i + 1;
        while (j < bytes.length && octal.length < 3 && bytes[j] >= 0x30 && bytes[j] <= 0x37) {
          octal += String.fromCharCode(bytes[j]);
          j += 1;
        }
        out.push(parseInt(octal, 8) & 0xff);
        i = j;
      } else {
        out.push(next);
        i += 2;
      }
      continue;
    }
    if (byte === 0x28) depth += 1;
    if (byte === 0x29) {
      depth -= 1;
      if (depth === 0) return { value: Buffer.from(out), end: i + 1 };
    }
    out.push(byte);
    i += 1;
  }
  return { value: Buffer.from(out), end: i };
}

/** Pull a named literal string out of an encryption dictionary. */
function readStringEntry(dictBytes, name) {
  const marker = Buffer.from(name);
  let index = dictBytes.indexOf(marker);
  while (index !== -1) {
    let cursor = index + marker.length;
    while (cursor < dictBytes.length && dictBytes[cursor] === 0x20) cursor += 1;
    if (dictBytes[cursor] === 0x28) return parseLiteralString(dictBytes, cursor + 1).value;
    index = dictBytes.indexOf(marker, index + 1);
  }
  return null;
}

/**
 * Recover the file encryption key for an empty user password.
 * Returns null when the document is not R6, or the password is not empty.
 */
export function getFileKey(buffer) {
  const text = buffer.toString('latin1');

  const reference = /\/Encrypt\s+(\d+)\s+\d+\s*R/.exec(text);
  if (!reference) return null;

  const objectPattern = new RegExp(`(?<![0-9])${reference[1]}\\s+0\\s+obj([\\s\\S]{0,1200}?)endobj`);
  const object = objectPattern.exec(text);
  if (!object) return null;

  const dictStart = text.indexOf(object[1], object.index);
  const dictBytes = buffer.subarray(dictStart, dictStart + object[1].length);
  const dictText = object[1];

  if (!/\/R\s*6/.test(dictText) || !/AESV3/.test(dictText)) return null;

  const u = readStringEntry(dictBytes, '/U');
  const ue = readStringEntry(dictBytes, '/UE');
  if (!u || u.length < 48 || !ue) return null;

  const password = Buffer.alloc(0);
  const validationSalt = u.subarray(32, 40);
  const keySalt = u.subarray(40, 48);

  // Confirm the user password really is empty before going further.
  const check = hash2B(password, validationSalt);
  if (!check.equals(u.subarray(0, 32))) return null;

  const intermediate = hash2B(password, keySalt);
  const decipher = crypto.createDecipheriv('aes-256-cbc', intermediate, Buffer.alloc(16));
  decipher.setAutoPadding(false);
  return Buffer.concat([decipher.update(ue.subarray(0, 32)), decipher.final()]);
}

/**
 * Decrypt one AES-256 encrypted stream. The initialisation vector is the first
 * 16 bytes of the stream itself.
 */
export function decryptStream(data, fileKey) {
  if (data.length <= 16) return Buffer.alloc(0);
  try {
    // Stream slices taken up to the "endstream" keyword carry trailing end of
    // line bytes, which leaves the ciphertext not a multiple of the block size
    // and makes the cipher throw. Truncate to whole blocks.
    const blocks = Math.floor((data.length - 16) / 16) * 16;
    if (blocks === 0) return Buffer.alloc(0);

    const decipher = crypto.createDecipheriv('aes-256-cbc', fileKey, data.subarray(0, 16));
    decipher.setAutoPadding(false);
    const plain = Buffer.concat([decipher.update(data.subarray(16, 16 + blocks)), decipher.final()]);
    // Strip PKCS#7 padding.
    const pad = plain[plain.length - 1];
    return pad >= 1 && pad <= 16 ? plain.subarray(0, plain.length - pad) : plain;
  } catch {
    return Buffer.alloc(0);
  }
}
