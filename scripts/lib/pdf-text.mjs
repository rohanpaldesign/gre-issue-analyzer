import zlib from 'node:zlib';

// Minimal PDF text extractor.
//
// Both ETS source documents (the Issue pool and the scored-sample PDFs) store
// their text in Flate-compressed content streams. Rather than pull in a PDF
// library, we inflate every stream and walk the text-showing operators.
//
// The important subtlety: these PDFs are heavily kerned, so a glyph run like
// "A na l yze" is a single word. Word boundaries are not spaces in the source,
// they are large negative kerning adjustments inside TJ arrays. We therefore
// ignore literal spacing and reconstruct word gaps from the kerning values.
// The threshold below was tuned against both documents.
const WORD_GAP_KERNING = -150;

const SIMPLE_ESCAPES = {
  n: '\n',
  r: '\r',
  t: '\t',
  b: '\b',
  f: '\f',
};

/** Resolve PDF string escapes, including three-digit octal character codes. */
function unescapePdfString(raw) {
  let out = '';
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i];
    if (ch !== '\\') {
      out += ch;
      i += 1;
      continue;
    }
    const next = raw[i + 1];
    if (next === undefined) break;
    if (SIMPLE_ESCAPES[next] !== undefined) {
      out += SIMPLE_ESCAPES[next];
      i += 2;
    } else if (next >= '0' && next <= '7') {
      const octal = /^[0-7]{1,3}/.exec(raw.slice(i + 1, i + 4))[0];
      out += String.fromCharCode(parseInt(octal, 8));
      i += 1 + octal.length;
    } else {
      out += next;
      i += 2;
    }
  }
  return out;
}

/** Inflate every content stream we can, skipping images and font programs. */
function inflateContentStreams(buffer) {
  const streams = [];
  const marker = Buffer.from('stream');
  const endMarker = Buffer.from('endstream');

  let cursor = 0;
  while (cursor < buffer.length) {
    const start = buffer.indexOf(marker, cursor);
    if (start === -1) break;
    let dataStart = start + marker.length;
    if (buffer[dataStart] === 0x0d) dataStart += 1;
    if (buffer[dataStart] === 0x0a) dataStart += 1;

    const end = buffer.indexOf(endMarker, dataStart);
    if (end === -1) break;

    const slice = buffer.subarray(dataStart, end);
    cursor = end + endMarker.length;

    let inflated;
    try {
      inflated = zlib.inflateSync(slice);
    } catch {
      continue;
    }

    const text = inflated.toString('latin1');
    if (!text.includes('TJ') && !text.includes('Tj')) continue;

    // Binary payloads occasionally contain the byte pairs "TJ" or "Tj" by
    // coincidence. Real content streams are overwhelmingly ASCII operators.
    const head = inflated.subarray(0, 400);
    let highBytes = 0;
    for (const byte of head) if (byte > 127) highBytes += 1;
    if (highBytes > 60) continue;

    streams.push(text);
  }
  return streams;
}

const PDF_STRING = String.raw`\((?:\\.|[^\\()])*\)`;
const OPERATOR_PATTERN = new RegExp(
  String.raw`\[((?:[^\[\]]|${PDF_STRING})*)\]\s*TJ|(${PDF_STRING})\s*Tj|(T\*|Td|TD|Tm|ET)`,
  'gs'
);
const TJ_ELEMENT_PATTERN = new RegExp(`${PDF_STRING}|-?[\\d.]+`, 'gs');

/**
 * Extract readable text one content stream at a time.
 *
 * Streams come back in file order, which is not always reading order. Callers
 * that need reading order should reorder using whatever page marker the
 * document prints (see extract-calibration.mjs).
 */
export function extractPdfPages(buffer) {
  const pages = [];

  for (const stream of inflateContentStreams(buffer)) {
    const parts = [];
    for (const match of stream.matchAll(OPERATOR_PATTERN)) {
      const [, tjArray, tjString, positioning] = match;

      if (tjArray !== undefined) {
        for (const element of tjArray.matchAll(TJ_ELEMENT_PATTERN)) {
          const token = element[0];
          if (token.startsWith('(')) {
            parts.push(unescapePdfString(token.slice(1, -1)));
          } else {
            const kerning = Number.parseFloat(token);
            if (Number.isFinite(kerning) && kerning <= WORD_GAP_KERNING) parts.push(' ');
          }
        }
      } else if (tjString !== undefined) {
        parts.push(unescapePdfString(tjString.slice(1, -1)));
      } else if (positioning !== undefined) {
        // A line break or text-object boundary is always a word boundary.
        parts.push(' ');
      }
    }
    pages.push(parts.join('').replace(/\s+/g, ' ').trim());
  }

  return pages;
}

/**
 * Extract readable text from a PDF buffer as a single whitespace-normalised
 * string, in file order. Reconstructs word boundaries from kerning, not from
 * literal spaces.
 */
export function extractPdfText(buffer) {
  return extractPdfPages(buffer).join(' ').replace(/\s+/g, ' ').trim();
}

/** Read a PDF from disk and extract its text. */
export async function extractPdfTextFromFile(path) {
  const { readFile } = await import('node:fs/promises');
  return extractPdfText(await readFile(path));
}
