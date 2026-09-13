// Query-conditioned routing (paper §4.3, Eq 6-7). Deterministic, token-free.

import { contentTerms, extractEntities } from "./tokenize";
import type { QueryProfile } from "./types";

const TEMPORAL_RE = /\b(yesterday|today|tomorrow|last\s+(week|month|session|time|night|turn)|previous|recent|lately|hôm\s+(qua|nay)|tuần\s+(trước|này)|lúc\s+(nãy|trước)|khi\s+nào|bao\s+giờ|timeline|lịch\s+sử)\b/i;
const LIST_RE = /^(list|liệt\s*kê|kể\s*(ra|tên)|what\s+are|which\s+\w+\s+(are|were)|các\s+\w+\s+nào)/i;
const CODE_RE = /\b(code|function|snippet|đoạn\s*code|hàm\s+\w+|class\s+\w+|patch|diff|stack\s*trace|error|exception|lỗi)\b/i;
const WHEN_RE = /^(when|what\s+time|what\s+date|khi\s+nào|bao\s+giờ|lúc\s+nào)/i;

export function profileQuery(query: string, opts?: { boundarySessionId?: string }): QueryProfile {
  const keywords = contentTerms(query, 16);
  const entities = extractEntities(query, 8).map((e) => e.toLowerCase());
  let answerType: QueryProfile["answerType"] = "unknown";
  if (LIST_RE.test(query)) answerType = "list";
  else if (WHEN_RE.test(query) || TEMPORAL_RE.test(query)) answerType = "temporal";
  else if (CODE_RE.test(query)) answerType = "code";
  else if (/^(why|how|tại\s*sao|làm\s*sao|giải\s*thích|vì\s*sao)/i.test(query)) answerType = "reason";
  else if (/^(who|what\s+is|what\s+was|which\s+one|ai\s+là|cái\s+gì)/i.test(query)) answerType = "scalar";

  const temporalMatch = query.match(TEMPORAL_RE);
  const temporalCues = temporalMatch ? [temporalMatch[0]] : [];
  const subjects = [...new Set([...entities, ...keywords.slice(0, 6)])];
  // Relational when entity anchors exist or multi-hop/list wiring is needed;
  // local when temporal/session locality dominates.
  const relational = entities.length > 0 || answerType === "list" || answerType === "reason";
  const local = answerType === "temporal" || temporalCues.length > 0 || !!opts?.boundarySessionId;
  const route: QueryProfile["route"] = relational && !local ? "relational" : local && !relational ? "local" : entities.length > 0 ? "relational" : "local";
  return {
    subjects,
    keywords,
    entities,
    answerType,
    temporalCues: temporalCues.map((t) => t.toLowerCase()),
    boundarySessionId: opts?.boundarySessionId,
    route,
  };
}
