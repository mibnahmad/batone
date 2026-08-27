import { inflateSync, inflateRawSync } from 'node:zlib';

export interface ExtractedPage {
  page: number;
  text: string;
}

/**
 * Best-effort PDF text extraction with no native dependencies.
 *
 * Handles the common case: FlateDecode content streams containing `Tj`/`TJ`
 * show-text operators. Anything it cannot decode (scanned images, exotic
 * encodings) yields empty text, which the pipeline treats as "needs OCR"
 * rather than silently pretending the page was empty.
 */
export function extractPdfText(buffer: Buffer): {
  pages: ExtractedPage[];
  needsOcr: boolean;
} {
  const streams = extractStreams(buffer);
  const pages: ExtractedPage[] = [];

  streams.forEach((stream, index) => {
    const text = decodeContentStream(stream);
    if (text.trim().length > 0) {
      pages.push({ page: index + 1, text });
    }
  });

  const declaredPages = countPageObjects(buffer);
  const needsOcr = pages.length === 0 && declaredPages > 0;

  if (pages.length === 0 && declaredPages > 0) {
    for (let i = 1; i <= declaredPages; i += 1) {
      pages.push({ page: i, text: '' });
    }
  }

  return { pages, needsOcr };
}

function countPageObjects(buffer: Buffer): number {
  const matches = buffer.toString('latin1').match(/\/Type\s*\/Page[^s]/g);
  return matches ? matches.length : 1;
}

function extractStreams(buffer: Buffer): Buffer[] {
  const streams: Buffer[] = [];
  const marker = Buffer.from('stream');
  const endMarker = Buffer.from('endstream');
  let cursor = 0;

  while (cursor < buffer.length) {
    const start = buffer.indexOf(marker, cursor);
    if (start === -1) break;
    let dataStart = start + marker.length;
    // Skip the EOL that must follow the `stream` keyword.
    if (buffer[dataStart] === 0x0d) dataStart += 1;
    if (buffer[dataStart] === 0x0a) dataStart += 1;

    const end = buffer.indexOf(endMarker, dataStart);
    if (end === -1) break;

    const raw = buffer.subarray(dataStart, end);
    const inflated = tryInflate(raw);
    if (inflated) streams.push(inflated);
    cursor = end + endMarker.length;
  }
  return streams;
}

function tryInflate(raw: Buffer): Buffer | null {
  try {
    return inflateSync(raw);
  } catch {
    try {
      return inflateRawSync(raw);
    } catch {
      // Uncompressed content streams are legal and common in generated PDFs.
      return raw.includes(Buffer.from('Tj')) || raw.includes(Buffer.from('TJ'))
        ? raw
        : null;
    }
  }
}

function decodeContentStream(stream: Buffer): string {
  const content = stream.toString('latin1');
  const textBlocks = content.match(/BT[\s\S]*?ET/g) ?? [];
  const scope = textBlocks.length > 0 ? textBlocks.join('\nT*\n') : content;

  // Show-text operands are either literal strings `(...)` or hex strings
  // `<...>`. Within one TJ array the fragments belong to the same word and must
  // be concatenated; a text-positioning operator starts a new line.
  const token =
    /\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]+>|-?\d+(?:\.\d+)?|\bT[dDmJj*]\b|\bTD\b/g;

  // In a justified TJ array the inter-word space is a kerning adjustment, not a
  // space character. Anything past this threshold (thousandths of an em) is a
  // word break rather than letter kerning.
  const WORD_BREAK = 120;

  const lines: string[] = [];
  let current = '';
  let match: RegExpExecArray | null;

  while ((match = token.exec(scope)) !== null) {
    const value = match[0];
    if (value.startsWith('(')) {
      current += unescapePdfString(value.slice(1, -1));
    } else if (value.startsWith('<')) {
      current += decodeHexString(value.slice(1, -1));
    } else if (/^-?\d/.test(value)) {
      if (-Number.parseFloat(value) > WORD_BREAK && current && !current.endsWith(' ')) {
        current += ' ';
      }
    } else if (value === 'Td' || value === 'TD' || value === 'Tm' || value === 'T*') {
      if (current.trim()) lines.push(current.trim());
      current = '';
    }
  }
  if (current.trim()) lines.push(current.trim());

  return lines.join('\n').replace(/[ \t]+/g, ' ').trim();
}

/** WinAnsi differs from Latin-1 in 0x80–0x9F, where French typography lives. */
const WIN_ANSI_HIGH: Record<number, string> = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡',
  0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž', 0x91: '\u2018',
  0x92: '\u2019', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x98: '˜',
  0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ',
};

/** Single-byte hex strings map to WinAnsi codes for the standard fonts. */
function decodeHexString(value: string): string {
  const digits = value.replace(/\s+/g, '');
  const even = digits.length % 2 === 0 ? digits : `${digits}0`;
  let out = '';
  for (let i = 0; i < even.length; i += 2) {
    const code = Number.parseInt(even.slice(i, i + 2), 16);
    if (Number.isNaN(code) || code === 0) continue;
    out += WIN_ANSI_HIGH[code] ?? String.fromCharCode(code);
  }
  return out;
}

function unescapePdfString(value: string): string {
  return value
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\')
    .replace(/\\([0-7]{1,3})/g, (_m, oct: string) => String.fromCharCode(parseInt(oct, 8)));
}
