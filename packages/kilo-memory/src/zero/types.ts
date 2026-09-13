// Core types for hybrid Zero-Mem + .md memory.
// Paper: arXiv:2607.29377 — zero-token memory ops: no LLM call/token outside final QA.
// Hybrid: raw traces are source of record; .md is a human-editable projection, not the store.

export type Speaker = "user" | "assistant" | "tool" | "human";

export interface TraceUnit {
  /** Stable provenance id, e.g. `s1:t004`. */
  id: string;
  sessionId: string;
  /** ms epoch. */
  time: number;
  speaker: Speaker;
  text: string;
  /** Origin: live trace vs human-edited .md seed. */
  provenance: "trace" | "md";
}

export interface WindowUnit {
  id: string;
  sessionId: string;
  turnIds: string[];
  startTime: number;
  endTime: number;
}

export interface EpisodeUnit {
  id: string;
  sessionId: string;
  windowIds: string[];
  turnIds: string[];
  startTime: number;
  endTime: number;
  /** Why the boundary was cut: session change or topic drift. */
  boundary: "session" | "drift" | "cap";
}

export interface QueryProfile {
  subjects: string[];
  keywords: string[];
  entities: string[];
  answerType: "list" | "scalar" | "temporal" | "code" | "reason" | "unknown";
  temporalCues: string[];
  boundarySessionId?: string;
  route: "relational" | "local";
}

export interface EvidenceItem {
  traceId: string;
  sessionId: string;
  time: number;
  text: string;
  score: number;
  views: Array<"graph" | "hierarchy">;
  provenance: "trace" | "md";
}

export interface EvidenceSet {
  query: string;
  profile: QueryProfile;
  items: EvidenceItem[];
  /** Memory-op cost accounting: must stay at 0 LLM calls/tokens. */
  cost: {
    llmCalls: number;
    llmTokens: number;
    encoderOps: number;
    latencyMs: number;
  };
}

export interface BudgetReport {
  windowTokens: number;
  reservedForMemory: number;
  evidenceTokens: number;
  historyTokens: number;
  systemTokens: number;
  totalUsed: number;
  remaining: number;
  overBudget: boolean;
  llmCallsMemoryOps: number;
  llmTokensMemoryOps: number;
}
