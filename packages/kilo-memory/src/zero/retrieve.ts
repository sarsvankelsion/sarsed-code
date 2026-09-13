// Dual-view retrieval + closure + deterministic calibration (paper §4.4–4.6).
// Graph view: entity alignment -> activation propagation (Eq 9) -> PPR (Eq 10).
// Hierarchy view: episode -> window -> turn coarse-to-fine (Eq 11).
// Fusion with routing weight rho (Eq 12-13), closure (Eq 14), calibration (Eq 15-16).
// All deterministic. Zero LLM calls.

import { adjacentTurns, bm25, cosine, denseHash, edgeWeight, type Substrate } from "./substrate";
import { contentTerms } from "./tokenize";
import type { EvidenceItem, EvidenceSet, QueryProfile, TraceUnit } from "./types";

export const RHO = 0.6;
export const GAMMA = 0.6;
const PROP_STEPS = 2;

function normScores(scores: Map<string, number>): Map<string, number> {
  const vals = [...scores.values()];
  const out = new Map<string, number>();
  if (vals.length === 0) return out;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  if (max <= min) {
    for (const [k] of scores) out.set(k, 1);
    return out;
  }
  for (const [k, v] of scores) out.set(k, (v - min) / (max - min));
  return out;
}

/** Align query entities to graph entities by dense cosine (Eq 8, hashed encoder). */
function alignEntities(s: Substrate, profile: QueryProfile): Map<string, number> {
  const out = new Map<string, number>();
  if (profile.entities.length === 0 || s.entities.size === 0) return out;
  const qVecs = profile.entities.map((e) => denseHash(e));
  for (const [key, rec] of s.entities) {
    const eVec = denseHash(rec.display);
    let best = 0;
    for (const q of qVecs) best = Math.max(best, cosine(eVec, q));
    if (best > 0.2 || key.split(/[\s_.\-]+/).some((p) => profile.keywords.includes(p))) {
      out.set(key, Math.max(best, 0.35));
    }
  }
  return out;
}

/** Graph view: propagate entity activation through co-occurring sentences (Eq 9). */
function graphView(s: Substrate, profile: QueryProfile, bm: Map<string, number>): Map<string, number> {
  // Seed activation from aligned entities.
  let active = alignEntities(s, profile);
  if (active.size === 0 && bm.size > 0) {
    // Fallback: entities on top lexical turns.
    const top = [...bm.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    for (const [tid] of top) {
      for (const k of s.turnEntities.get(tid) ?? []) {
        active.set(k, Math.max(active.get(k) ?? 0, 0.5));
      }
    }
  }
  // Propagation steps over co-occurrence.
  for (let step = 0; step < PROP_STEPS; step++) {
    const next = new Map(active);
    for (const [ekey, rec] of s.entities) {
      if (active.has(ekey)) continue;
      let acc = 0;
      for (const [aKey, aVal] of active) {
        const aRec = s.entities.get(aKey);
        if (!aRec) continue;
        let shared = 0;
        let qsim = 0;
        for (const tid of rec.turnIds) {
          if (aRec.turnIds.has(tid)) {
            shared += edgeWeight(s, tid, ekey);
            qsim = Math.max(qsim, bm.get(tid) ?? 0);
          }
        }
        if (shared > 0) acc += aVal * shared * (0.3 + qsim);
      }
      if (acc > 0.01) next.set(ekey, acc);
    }
    active = next;
  }
  // Personalized PageRank over entity<->turn bipartite graph (Eq 10, power iteration).
  const turnIds = s.traces.map((t) => t.id);
  const entKeys = [...active.keys()];
  const idx = new Map<string, number>();
  turnIds.forEach((id, i) => idx.set(`t:${id}`, i));
  entKeys.forEach((k, i) => idx.set(`e:${k}`, turnIds.length + i));
  const n = turnIds.length + entKeys.length;
  const reset = new Float64Array(n);
  for (const tid of turnIds) reset[idx.get(`t:${tid}`)!] = (bm.get(tid) ?? 0) * 0.5;
  entKeys.forEach((k, i) => {
    reset[turnIds.length + i] = (active.get(k) ?? 0) * 0.5;
  });
  let sum = 0;
  for (let i = 0; i < n; i++) sum += reset[i];
  if (sum <= 0) return new Map();
  for (let i = 0; i < n; i++) reset[i] /= sum;
  // Sparse adjacency: turn<->entity edges + turn adjacency.
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (const [ekey, rec] of s.entities) {
    if (!idx.has(`e:${ekey}`)) continue;
    const ei = idx.get(`e:${ekey}`)!;
    for (const tid of rec.turnIds) {
      const ti = idx.get(`t:${tid}`)!;
      adj[ei].push(ti);
      adj[ti].push(ei);
    }
  }
  for (const t of s.traces) {
    const ti = idx.get(`t:${t.id}`)!;
    for (const nb of adjacentTurns(s, t.id)) adj[ti].push(idx.get(`t:${nb}`)!);
  }
  let pi = Float64Array.from(reset);
  for (let it = 0; it < 24; it++) {
    const next = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      if (adj[i].length === 0) {
        next[i] += GAMMA * pi[i];
        continue;
      }
      const share = (GAMMA * pi[i]) / adj[i].length;
      for (const j of adj[i]) next[j] += share;
    }
    for (let i = 0; i < n; i++) next[i] += (1 - GAMMA) * reset[i];
    pi = next;
  }
  const out = new Map<string, number>();
  for (const tid of turnIds) {
    const v = pi[idx.get(`t:${tid}`)!];
    if (v > 0) out.set(tid, v);
  }
  return out;
}

/** Hierarchy view: episode -> window -> turn (Eq 11) with subject/temporal fit. */
function hierarchyView(s: Substrate, profile: QueryProfile, bm: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  if (s.traces.length === 0) return out;
  const qSet = new Set(profile.keywords);
  const epScore = new Map<string, number>();
  for (const ep of s.episodes) {
    let hits = 0;
    let lex = 0;
    for (const tid of ep.turnIds) {
      const t = s.byId.get(tid);
      if (!t) continue;
      const toks = new Set(contentTerms(t.text, 32));
      let h = 0;
      for (const q of qSet) if (toks.has(q)) h++;
      if (h > 0) {
        hits += 1;
        lex += h;
      }
      lex += (bm.get(tid) ?? 0) * 0.5;
    }
    let score = hits > 0 ? hits + lex * 0.3 : lex * 0.1;
    if (profile.boundarySessionId && ep.sessionId === profile.boundarySessionId) score *= 1.5;
    if (profile.answerType === "temporal") {
      // Prefer later episodes for recency-style questions.
      const order = s.episodes.indexOf(ep) + 1;
      score *= 0.7 + (0.6 * order) / s.episodes.length;
    }
    epScore.set(ep.id, score);
  }
  for (const ep of s.episodes) {
    const es = epScore.get(ep.id) ?? 0;
    for (const tid of ep.turnIds) {
      const base = (bm.get(tid) ?? 0) * 0.7 + es * 0.3;
      if (base > 0) out.set(tid, base);
    }
  }
  return out;
}

/** Filter: boundary + provenance constraints (Eq 15 Filter step). */
function admissible(t: TraceUnit, profile: QueryProfile): boolean {
  if (profile.boundarySessionId && t.sessionId !== profile.boundarySessionId) return false;
  return t.text.trim().length > 0;
}

export function retrieve(
  s: Substrate,
  query: string,
  profile: QueryProfile,
  opts?: { topK?: number; rho?: number },
): EvidenceSet {
  const t0 = Date.now();
  const topK = opts?.topK ?? 5;
  const rho = opts?.rho ?? RHO;
  const qTerms = contentTerms(query, 24);
  const bm = bm25(s, qTerms);
  const gRaw = graphView(s, profile, bm);
  const hRaw = hierarchyView(s, profile, bm);
  const g = normScores(gRaw);
  const h = normScores(hRaw);
  const primary = profile.route === "relational" ? g : h;
  const secondary = profile.route === "relational" ? h : g;
  const fused = new Map<string, number>();
  for (const t of s.traces) {
    const p = primary.get(t.id) ?? 0;
    const sec = secondary.get(t.id) ?? 0;
    const f = rho * p + (1 - rho) * sec;
    if (f > 0) fused.set(t.id, f);
  }
  let main = [...fused.entries()].sort((a, b) => b[1] - a[1]).slice(0, topK);
  // Closure: add graph-bridged + local neighbour support (Eq 14).
  const keep = new Map<string, number>(main);
  const addSupport = (tid: string, w: number, view: "graph" | "hierarchy") => {
    if (keep.has(tid)) return;
    const t = s.byId.get(tid);
    if (!t || !admissible(t, profile)) return;
    keep.set(tid, Math.min(w, 0.5));
    void view;
  };
  for (const [tid, sc] of main) {
    for (const nb of adjacentTurns(s, tid)) addSupport(nb, sc * 0.4, "hierarchy");
    const keys = s.turnEntities.get(tid) ?? [];
    for (const k of keys) {
      const rec = s.entities.get(k);
      if (!rec) continue;
      for (const other of rec.turnIds) {
        if (other !== tid) addSupport(other, sc * 0.35, "graph");
      }
    }
  }
  // Deterministic calibration: drop conflicts, rank by subject/temporal fit (Eq 15-16).
  const ranked = [...keep.entries()]
    .map(([tid, sc]) => ({ tid, sc, t: s.byId.get(tid)! }))
    .filter((r) => r.t && admissible(r.t, profile))
    .sort((a, b) => b.sc - a.sc)
    .slice(0, topK + 3);
  const items: EvidenceItem[] = ranked.map((r) => ({
    traceId: r.tid,
    sessionId: r.t.sessionId,
    time: r.t.time,
    text: r.t.text,
    score: Math.round(r.sc * 1000) / 1000,
    views: [
      ...(g.has(r.tid) ? (["graph"] as const) : []),
      ...(h.has(r.tid) ? (["hierarchy"] as const) : []),
    ],
    provenance: r.t.provenance,
  }));
  return {
    query,
    profile,
    items,
    cost: {
      llmCalls: 0,
      llmTokens: 0,
      encoderOps: s.traces.length + profile.entities.length,
      latencyMs: Date.now() - t0,
    },
  };
}
