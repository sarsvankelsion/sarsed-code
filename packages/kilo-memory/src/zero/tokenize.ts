// Deterministic tokenization / normalization. No LLM, no external model.
// Mirrors paper's "lexical access signals" + lightweight rule NER substitute.

const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}_.\-]{1,}/gu;

export function rawTokens(text: string): string[] {
  return (text.match(WORD_RE) ?? []).map((t) => t.toLowerCase());
}

/** Split camelCase + snake/kebab/dot into parts: getUserName -> get,user,name */
export function splitParts(token: string): string[] {
  return token
    .split(/[_.\-]+/u)
    .flatMap((piece) =>
      piece
        .replaceAll(/(\p{Ll}|\p{N})(\p{Lu})/gu, "$1 $2")
        .replaceAll(/(\p{Lu}+)(\p{Lu}\p{Ll})/gu, "$1 $2")
        .split(/\s+/u),
    )
    .map((p) => p.toLowerCase())
    .filter(Boolean);
}

export function terms(text: string, max = 24): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tok of rawTokens(text)) {
    for (const part of splitParts(tok)) {
      if (part.length < 2) continue;
      if (seen.has(part)) continue;
      seen.add(part);
      out.push(part);
      if (out.length >= max) return out;
    }
  }
  return out;
}

const STOP = new Set([
  "the", "a", "an", "and", "or", "but", "if", "then", "else", "when", "at", "by",
  "for", "with", "about", "into", "through", "during", "before", "after", "above",
  "below", "to", "from", "up", "down", "in", "out", "on", "off", "over", "under",
  "again", "further", "once", "here", "there", "what", "which", "who", "whom",
  "this", "that", "these", "those", "am", "is", "are", "was", "were", "be",
  "been", "being", "have", "has", "had", "having", "do", "does", "did", "doing",
  "would", "should", "could", "ought", "i", "me", "my", "we", "our", "you",
  "your", "he", "she", "it", "they", "them", "of", "as", "so", "than", "too",
  "very", "can", "will", "just", "not", "no", "yes", "la", "va", "cua", "các",
  "nhung", "những", "trong", "với", "cho", "là", "có", "không", "được", "này",
]);

export function contentTerms(text: string, max = 24): string[] {
  return terms(text, max * 2).filter((t) => !STOP.has(t)).slice(0, max);
}

/**
 * Rule-based entity candidates (paper uses spaCy NER; we use deterministic
 * patterns so memory ops stay token-free and dependency-free):
 * - Capitalized phrases (2+ words or CamelCase identifiers)
 * - file paths, dotted module paths, `code spans`
 * - quoted strings, SHAs/hashes, version numbers
 */
export function extractEntities(text: string, max = 12): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const push = (e: string) => {
    const v = e.trim().replaceAll(/\s+/g, " ");
    if (v.length < 2 || v.length > 80) return;
    const key = v.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    found.push(v);
  };
  for (const m of text.matchAll(/`([^`]{2,60})`/g)) push(m[1]);
  for (const m of text.matchAll(/"([^"]{2,60})"/g)) push(m[1]);
  for (const m of text.matchAll(/(^|[\s(\[])([A-Za-z0-9_.\-/$\\]{2,80}\.(ts|js|py|lua|md|json|rs|go|exe|dll|bin))/g))
    push(m[2]);
  for (const m of text.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g)) push(m[1]);
  for (const m of text.matchAll(/\b([A-Za-z]*[a-z][A-Z][A-Za-z0-9_]+|[A-Z]{2,}[a-z0-9]+)\b/g)) push(m[1]);
  for (const m of text.matchAll(/\b(v?\d+\.\d+(?:\.\d+)?)\b/g)) push(m[1]);
  for (const m of text.matchAll(/\b([0-9a-f]{7,64})\b/gi)) {
    if (/^\d+$/.test(m[1])) continue;
    push(m[1]);
  }
  return found.slice(0, max);
}
