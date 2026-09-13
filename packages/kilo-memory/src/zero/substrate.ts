// Provenance-preserving token-free substrate (paper §4.2).
// - Raw traces are the source of record (never replaced by abstractions).
// - Entity–context graph: co-occurrence + adjacency edges (Eq 3-4).
// - Temporal hierarchy: turn -> window -> episode -> local span (Eq 5).
// - Access signals: BM25 lexical + hashed dense vectors (stand-in for BGE-M3;
//   deterministic, dependency-free; counted as encoderOps, never LLM tokens).

import { contentTerms, extractEntities, rawTokens, terms } from "./tokenize";
import type { EpisodeUnit, TraceUnit, WindowUnit } from "./types";

export const WINDOW_TURNS = 6;
export const EPISODE_WINDOWS_CAP = 4;
export const DRIFT_JACCARD = 0.18;
const DENSE_DIM = 256;

function hashStr(s: string, seed: number): number {
  let h = 2166136261 ^ seed;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic hashed encoder: char-trigram projection to DENSE_DIM. */
export function denseHash(text: string): Float64Array {
  const v = new Float64Array(DENSE_DIM);
  const t = text.toLowerCase();
  if (!t.trim()) return v;
  const grams = new Set<string>();
  for (const tok of rawTokens(t)) {
    const p = `^${tok}$`;
    for (let i = 0; i + 3 <= p.length; i++) grams.add(p.slice(i, i + 3));
  }
  if (grams.size === 0) grams.add(t.slice(0, 3));
  for (const g of grams) {
    const h1 = hashStr(g, 0) % DENSE_DIM;
    const h2 = hashStr(g, 0x9e37) % DENSE_DIM;
    v[h1] += 1;
    v[h2] += 0.5;
  }
  let norm = 0;
  for (let i = 0; i < DENSE_DIM; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < DENSE_DIM; i++) v[i] /= norm;
  return v;
}

export function cosine(a: Float64Array, b: Float64Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export interface Substrate {
  traces: TraceUnit[];
  byId: Map<string, TraceUnit>;
  windows: WindowUnit[];
  episodes: EpisodeUnit[];
  /** entityKey(lower) -> display + turn ids */
  entities: Map<string, { display: string; turnIds: Set<string> }>;
  /** turnId -> entity keys */
  turnEntities: Map<string, string[]>;
  /** turnId -> normalized term freq map */
  termFreq: Map<string, Map<string, number>>;
  docFreq: Map<string, number>;
  avgLen: number;
  dense: Map<string, Float64Array>;
  encoderOps: number;
}

export function emptySubstrate(): Substrate {
  return {
    traces: [],
    byId: new Map(),
    windows: [],
    episodes: [],
    entities: new Map(),
    turnEntities: new Map(),
    termFreq: new Map(),
    docFreq: new Map(),
    avgLen: 0,
    dense: new Map(),
    encoderOps: 0,
  };
}

/** Append raw traces; rebuilds derived views deterministically. */
export function ingest(s: Substrate, units: TraceUnit[]): void {
  for (const u of units) {
    if (s.byId.has(u.id)) continue;
    s.traces.push({ ...u });
    s.byId.set(u.id, s.traces[s.traces.length - 1]);
  }
  s.traces.sort((a, b) => a.time - b.time || (a.id < b.id ? -1 : 1));
  buildHierarchy(s);
  buildGraph(s);
  buildLexicalDense(s);
}

function buildHierarchy(s: Substrate): void {
  s.windows = [];
  s.episodes = [];
  const turns = s.traces;
  for (let i = 0; i < turns.length; i += WINDOW_TURNS) {
    const slice = turns.slice(i, i + WINDOW_TURNS);
    s.windows.push({
      id: `w${s.windows.length}`,
      sessionId: slice[slice.length - 1].sessionId,
      turnIds: slice.map((t) => t.id),
      startTime: slice[0].time,
      endTime: slice[slice.length - 1].time,
    });
  }
  // Episodes: cut on session change, topic drift, or cap.
  let cur: WindowUnit[] = [];
  let curTerms = new Set<string>();
  const flush = (boundary: EpisodeUnit["boundary"]) => {
    if (cur.length === 0) return;
    const turnIds = cur.flatMap((w) => w.turnIds);
    s.episodes.push({
      id: `e${s.episodes.length}`,
      sessionId: cur[cur.length - 1].sessionId,
      windowIds: cur.map((w) => w.id),
      turnIds,
      startTime: cur[0].startTime,
      endTime: cur[cur.length - 1].endTime,
      boundary,
    });
    cur = [];
    curTerms = new Set();
  };
  for (const w of s.windows) {
    const wTerms = new Set<string>();
    for (const tid of w.turnIds) {
      const t = s.byId.get(tid);
      if (t) for (const term of contentTerms(t.text)) wTerms.add(term);
    }
    if (cur.length > 0) {
      const lastSession = cur[cur.length - 1].sessionId;
      if (w.sessionId !== lastSession) {
        flush("session");
      } else if (cur.length >= EPISODE_WINDOWS_CAP) {
        flush("cap");
      } else {
        const inter = [...wTerms].filter((t) => curTerms.has(t)).length;
        const union = new Set([...wTerms, ...curTerms]).size || 1;
        if (union > 4 && inter / union < DRIFT_JACCARD) flush("drift");
      }
    }
    cur.push(w);
    for (const t of wTerms) curTerms.add(t);
  }
  flush(cur.length > 0 && s.episodes.length === 0 ? "cap" : "drift");
}

function buildGraph(s: Substrate): void {
  s.entities = new Map();
  s.turnEntities = new Map();
  for (const t of s.traces) {
    const ents = extractEntities(t.text);
    const keys: string[] = [];
    for (const e of ents) {
      const key = e.toLowerCase();
      keys.push(key);
      let rec = s.entities.get(key);
      if (!rec) {
        rec = { display: e, turnIds: new Set() };
        s.entities.set(key, rec);
      }
      rec.turnIds.add(t.id);
    }
    s.turnEntities.set(t.id, keys);
  }
}

function buildLexicalDense(s: Substrate): void {
  s.termFreq = new Map();
  s.docFreq = new Map();
  s.dense = new Map();
  let totalLen = 0;
  for (const t of s.traces) {
    const toks = terms(t.text, 64);
    totalLen += toks.length;
    const tf = new Map<string, number>();
    for (const tok of toks) tf.set(tok, (tf.get(tok) ?? 0) + 1);
    const len = toks.length || 1;
    for (const [k, c] of tf) tf.set(k, c / len);
    s.termFreq.set(t.id, tf);
    for (const k of tf.keys()) s.docFreq.set(k, (s.docFreq.get(k) ?? 0) + 1);
    s.dense.set(t.id, denseHash(t.text));
    s.encoderOps += 1;
  }
  s.avgLen = s.traces.length ? totalLen / s.traces.length : 0;
}

/** BM25 over trace turns (k1=1.2, b=0.75). */
export function bm25(s: Substrate, queryTerms: string[]): Map<string, number> {
  const out = new Map<string, number>();
  const N = s.traces.length;
  if (N === 0) return out;
  const k1 = 1.2;
  const b = 0.75;
  for (const t of s.traces) {
    const tf = s.termFreq.get(t.id);
    if (!tf) continue;
    const dl = [...tf.values()].reduce((a, c) => a + c, 0) * 64 || 1;
    let score = 0;
    for (const q of queryTerms) {
      const f = tf.get(q) ?? 0;
      if (f <= 0) continue;
      const df = s.docFreq.get(q) ?? 1;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * dl) / (s.avgLen || 1))));
    }
    if (score > 0) out.set(t.id, score);
  }
  return out;
}

/** Entity–context edge weight w(d,e) = c(e,d)/sum c (Eq 4). Here c is 0/1 per turn. */
export function edgeWeight(s: Substrate, turnId: string, entityKey: string): number {
  const keys = s.turnEntities.get(turnId) ?? [];
  if (!keys.includes(entityKey) || keys.length === 0) return 0;
  return 1 / keys.length;
}

/** Adjacent-turn neighbours (trace adjacency edges). */
export function adjacentTurns(s: Substrate, turnId: string): string[] {
  const idx = s.traces.findIndex((t) => t.id === turnId);
  if (idx < 0) return [];
  const out: string[] = [];
  if (idx > 0) out.push(s.traces[idx - 1].id);
  if (idx + 1 < s.traces.length) out.push(s.traces[idx + 1].id);
  return out;
}
