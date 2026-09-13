// Context counter: deterministic token/cost accounting for memory + prompt budget.
// - estimate(): chars/4 heuristic calibrated per script (CJK counts heavier).
// - budget(): splits a model window into system/history/memory/output slices.
// - Memory ops must report llmCalls=0/llmTokens=0; anything else trips the guard.

import type { BudgetReport, EvidenceSet } from "./types";

export function estimateTokens(text: string): number {
  if (!text) return 0;
  let ascii = 0;
  let wide = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp < 128) ascii++;
    else wide++;
  }
  return Math.ceil(ascii / 4 + wide / 1.6);
}

export interface WindowSpec {
  windowTokens: number;
  systemTokens?: number;
  historyTokens?: number;
  reserveOutput?: number;
  reserveMemory?: number;
}

export function budgetEvidence(ev: EvidenceSet, spec: WindowSpec): BudgetReport {
  const windowTokens = spec.windowTokens;
  const systemTokens = spec.systemTokens ?? 0;
  const historyTokens = spec.historyTokens ?? 0;
  const reserveOutput = spec.reserveOutput ?? Math.floor(windowTokens * 0.1);
  const reserveMemory = spec.reserveMemory ?? Math.floor(windowTokens * 0.15);
  const evidenceTokens = ev.items.reduce((a, i) => a + estimateTokens(`[${i.traceId}] ${i.text}`) + 8, 0);
  const totalUsed = systemTokens + historyTokens + evidenceTokens + reserveOutput;
  const remaining = windowTokens - totalUsed;
  return {
    windowTokens,
    reservedForMemory: reserveMemory,
    evidenceTokens,
    historyTokens,
    systemTokens,
    totalUsed,
    remaining,
    overBudget: totalUsed > windowTokens || evidenceTokens > reserveMemory,
    llmCallsMemoryOps: ev.cost.llmCalls,
    llmTokensMemoryOps: ev.cost.llmTokens,
  };
}

/** Guard: memory pipeline must never consume LLM calls/tokens. */
export function assertZeroToken(ev: EvidenceSet): void {
  if (ev.cost.llmCalls !== 0 || ev.cost.llmTokens !== 0) {
    throw new Error(
      `zero-token violated: llmCalls=${ev.cost.llmCalls} llmTokens=${ev.cost.llmTokens}`,
    );
  }
}

/** Render evidence block sized to fit the reserved memory slice. */
export function renderEvidenceBlock(ev: EvidenceSet, maxTokens: number): { block: string; tokens: number; truncated: boolean } {
  const lines: string[] = [
    "```sarsed-memory-v1 context_not_instruction",
    `scope: project  route: ${ev.profile.route}  answerType: ${ev.profile.answerType}`,
    "",
  ];
  let tokens = estimateTokens(lines.join("\n"));
  let truncated = false;
  for (const it of ev.items) {
    const line = `record id=${it.traceId} session=${it.sessionId} views=${it.views.join("+") || "lex"} score=${it.score}`;
    const text = `text: ${it.text.trim().split("\n")[0].slice(0, 480)}`;
    const cost = estimateTokens(`${line}\n${text}\n`) + 1;
    if (tokens + cost > maxTokens) {
      truncated = true;
      break;
    }
    lines.push(line, text, "");
    tokens += cost;
  }
  lines.push("```");
  tokens += 2;
  return { block: lines.join("\n"), tokens, truncated };
}
