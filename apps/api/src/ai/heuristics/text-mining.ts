/**
 * Text mining for the values construction drawings and specifications carry as
 * annotations: dimensions, wall thicknesses, ceiling heights and rebar callouts.
 *
 * Every function here reports what it found *and* where, so the caller can build
 * a SourceRef. Nothing is inferred when the text is silent — the caller raises a
 * clarification instead.
 */

export interface TextHit<T> {
  value: T;
  raw: string;
  /** Character offset of the match, used to build an excerpt for the SourceRef. */
  index: number;
  excerpt: string;
}

const NUMBER = String.raw`\d+(?:[.,]\d+)?`;

function toNumber(raw: string): number {
  return Number.parseFloat(raw.replace(',', '.'));
}

function excerptAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 60);
  const end = Math.min(text.length, index + length + 60);
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}

/** Ceiling / wall heights: "HSP 2,50 m", "hauteur sous plafond 2.50", "H = 3,20 m". */
export function findHeights(text: string): TextHit<number>[] {
  const hits: TextHit<number>[] = [];
  const patterns = [
    new RegExp(String.raw`(?:HSP|hauteur\s+sous\s+plafond)\s*[:=]?\s*(${NUMBER})\s*m?`, 'gi'),
    new RegExp(String.raw`\bH\s*[:=]\s*(${NUMBER})\s*m\b`, 'gi'),
    new RegExp(String.raw`hauteur\s+(?:des\s+)?murs?\s*[:=]?\s*(${NUMBER})\s*m`, 'gi'),
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const value = toNumber(match[1]);
      // Anything outside this band is a misread, not a storey height.
      if (value >= 1.8 && value <= 6) {
        hits.push({
          value,
          raw: match[0],
          index: match.index,
          excerpt: excerptAround(text, match.index, match[0].length),
        });
      }
    }
  }
  return hits;
}

/** Wall thickness: "ép. 20 cm", "epaisseur 0,20 m", "mur 20". */
export function findThicknesses(text: string): TextHit<number>[] {
  const hits: TextHit<number>[] = [];
  const patterns: { re: RegExp; scale: number }[] = [
    { re: new RegExp(String.raw`(?:ép\.?|ep\.?|épaisseur|epaisseur)\s*[:=]?\s*(${NUMBER})\s*cm`, 'gi'), scale: 0.01 },
    { re: new RegExp(String.raw`(?:ép\.?|ep\.?|épaisseur|epaisseur)\s*[:=]?\s*(${NUMBER})\s*mm`, 'gi'), scale: 0.001 },
    { re: new RegExp(String.raw`(?:ép\.?|ep\.?|épaisseur|epaisseur)\s*[:=]?\s*(${NUMBER})\s*m\b`, 'gi'), scale: 1 },
  ];
  for (const { re, scale } of patterns) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      const value = toNumber(match[1]) * scale;
      if (value > 0.02 && value < 1.5) {
        hits.push({
          value,
          raw: match[0],
          index: match.index,
          excerpt: excerptAround(text, match.index, match[0].length),
        });
      }
    }
  }
  return hits;
}

/** Section notation: "20x40", "0,20 x 0,40", "Ø200". Returns metres. */
export function findSections(text: string): TextHit<{ a: number; b: number }>[] {
  const hits: TextHit<{ a: number; b: number }>[] = [];
  const re = new RegExp(String.raw`(${NUMBER})\s*[x×]\s*(${NUMBER})`, 'gi');
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    let a = toNumber(match[1]);
    let b = toNumber(match[2]);
    // Values above 5 are certainly centimetres, not metres.
    if (a > 5 || b > 5) {
      a /= 100;
      b /= 100;
    }
    if (a > 0.05 && a < 3 && b > 0.05 && b < 3) {
      hits.push({
        value: { a, b },
        raw: match[0],
        index: match.index,
        excerpt: excerptAround(text, match.index, match[0].length),
      });
    }
  }
  return hits;
}

export interface RebarCallout {
  count?: number;
  diameterMm: number;
  spacingM?: number;
  steel: string;
}

/**
 * Rebar callouts as written on structural sections:
 *   "4HA12"            → 4 bars of Ø12
 *   "HA8 e=20"         → stirrups Ø8 spaced 20 cm
 *   "6 HA 14"          → 6 bars of Ø14
 *   "cad. HA6 esp 15"  → stirrups Ø6 spaced 15 cm
 */
export function findRebarCallouts(text: string): TextHit<RebarCallout>[] {
  const hits: TextHit<RebarCallout>[] = [];
  const re = new RegExp(
    String.raw`(?:(\d+)\s*)?(HA|T|Ø|φ)\s*(\d{1,2})(?:\s*(?:e|esp|espacement)\s*[.=:]?\s*(${NUMBER})\s*(cm|mm|m)?)?`,
    'gi',
  );
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const diameterMm = Number.parseInt(match[3], 10);
    if (![6, 8, 10, 12, 14, 16, 20, 25, 32, 40].includes(diameterMm)) continue;

    let spacingM: number | undefined;
    if (match[4]) {
      const rawSpacing = toNumber(match[4]);
      const unit = (match[5] ?? 'cm').toLowerCase();
      spacingM = unit === 'm' ? rawSpacing : unit === 'mm' ? rawSpacing / 1000 : rawSpacing / 100;
      if (spacingM <= 0 || spacingM > 1) spacingM = undefined;
    }

    hits.push({
      value: {
        count: match[1] ? Number.parseInt(match[1], 10) : undefined,
        diameterMm,
        spacingM,
        steel: match[2].toUpperCase() === 'HA' ? 'HA' : 'HA',
      },
      raw: match[0].trim(),
      index: match.index,
      excerpt: excerptAround(text, match.index, match[0].length),
    });
  }
  return hits;
}

/** Structural element references: "S1", "P12", "PT-3", "SEMELLE S2". */
export function findElementReferences(text: string): TextHit<string>[] {
  const hits: TextHit<string>[] = [];
  const re = /\b((?:SEM|POT|PT|LG|LONG|CH|DAL|ESC|S|P|PO|L|D|E)[-_ ]?\d{1,3})\b/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    hits.push({
      value: match[1].replace(/[-_ ]/g, ''),
      raw: match[0],
      index: match.index,
      excerpt: excerptAround(text, match.index, match[0].length),
    });
  }
  return hits;
}

/**
 * Splits a CCTP into numbered clauses. Falls back to paragraph splitting when
 * the document has no visible numbering scheme.
 */
export function splitClauses(text: string): {
  reference: string;
  title: string;
  text: string;
  index: number;
}[] {
  const clauses: { reference: string; title: string; text: string; index: number }[] = [];
  // The sub-numbering is part of the reference: "Article 1.1" and "Article 1.2"
  // are two different contractual clauses and must not collapse into one.
  const re =
    /(?:^|\n)\s*((?:\d+\.)+\d*|ARTICLE\s+\d+(?:\.\d+)*|LOT\s+\d+(?:\.\d+)*)\s*[-–—:.]?\s*([^\n]{0,120})/gi;

  const matches: { ref: string; title: string; start: number }[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    matches.push({ ref: match[1].trim(), title: match[2].trim(), start: match.index });
  }

  if (matches.length >= 2) {
    matches.forEach((entry, i) => {
      const end = i + 1 < matches.length ? matches[i + 1].start : text.length;
      const body = text.slice(entry.start, end).trim();
      if (body.length > 10) {
        clauses.push({
          reference: entry.ref,
          title: entry.title || entry.ref,
          text: body.slice(0, 4000),
          index: entry.start,
        });
      }
    });
    return clauses;
  }

  // No numbering detected: fall back to blank-line-separated paragraphs.
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 40);
  let cursor = 0;
  paragraphs.forEach((paragraph, i) => {
    const start = text.indexOf(paragraph, cursor);
    cursor = start + paragraph.length;
    clauses.push({
      reference: `§${i + 1}`,
      title: paragraph.split(/[.\n]/)[0].slice(0, 100).trim(),
      text: paragraph.trim().slice(0, 4000),
      index: start,
    });
  });
  return clauses;
}

/** Detects the floor a plan refers to, from its filename or its annotations. */
export function detectFloor(...candidates: (string | null | undefined)[]): string | null {
  const haystack = candidates.filter(Boolean).join(' ');
  const rules: { pattern: RegExp; floor: string }[] = [
    { pattern: /\b(sous[- ]?sol|ss|basement)\b/i, floor: 'Sous-sol' },
    { pattern: /\b(fondation|semelle|footing)\b/i, floor: 'Fondations' },
    { pattern: /\b(rdc|rez[- ]?de[- ]?chauss)\b/i, floor: 'RDC' },
    { pattern: /\b(r\+?1|1er\s+étage|first\s+floor|etage\s*1)\b/i, floor: 'R+1' },
    { pattern: /\b(r\+?2|2e\s+étage|second\s+floor|etage\s*2)\b/i, floor: 'R+2' },
    { pattern: /\b(r\+?3|3e\s+étage|etage\s*3)\b/i, floor: 'R+3' },
    { pattern: /\b(toiture|terrasse|roof)\b/i, floor: 'Toiture' },
  ];
  for (const rule of rules) {
    if (rule.pattern.test(haystack)) return rule.floor;
  }
  return null;
}
