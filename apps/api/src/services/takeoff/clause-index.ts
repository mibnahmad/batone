/**
 * Lightweight lexical embedding for CCTP clause retrieval.
 *
 * A hashed bag-of-words vector is enough to rank a few dozen clauses of one
 * project against one takeoff line, and it keeps the deployment free of an
 * embedding service or a vector database. The interface (embed + cosine) is the
 * same one pgvector would expose, so swapping in real embeddings later is a
 * change of implementation, not of call sites.
 */

const DIMENSIONS = 256;

/** French stop words that would otherwise dominate the similarity score. */
const STOP_WORDS = new Set([
  'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'et', 'ou', 'a', 'à', 'au', 'aux',
  'en', 'sur', 'sous', 'par', 'pour', 'dans', 'avec', 'sans', 'ce', 'cet', 'cette',
  'ces', 'il', 'elle', 'est', 'sont', 'être', 'avoir', 'que', 'qui', 'plus', 'sera',
  'seront', 'doit', 'doivent', 'the', 'of', 'and', 'to', 'in',
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function hash(token: string): number {
  let value = 2166136261;
  for (let i = 0; i < token.length; i += 1) {
    value ^= token.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return Math.abs(value) % DIMENSIONS;
}

/** Sub-linear term weighting keeps long clauses from swamping short ones. */
export function embed(text: string): number[] {
  const vector = new Array<number>(DIMENSIONS).fill(0);
  const counts = new Map<string, number>();
  for (const token of tokenize(text)) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  for (const [token, count] of counts) {
    vector[hash(token)] += 1 + Math.log(count);
  }

  const norm = Math.sqrt(vector.reduce((acc, v) => acc + v * v, 0));
  if (norm === 0) return vector;
  return vector.map((v) => v / norm);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) dot += a[i] * b[i];
  // Both vectors are stored normalized, so the dot product is the cosine.
  return dot;
}
