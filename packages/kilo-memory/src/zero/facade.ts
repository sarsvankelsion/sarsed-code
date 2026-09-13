import { MemoryFiles } from "../storage/store"
import { MemoryToken } from "../recall/token"
import { MemorySlug } from "../slug"
import type { MemoryRecall } from "../recall/recall"
import { profileQuery } from "./routing"
import { retrieve } from "./retrieve"
import { estimateTokens } from "./context-counter"
import { ZeroStore } from "./store"
import type { EvidenceSet, TraceUnit } from "./types"

/** Zero-Mem facade over the token-free substrate (arXiv:2607.29377).
 * All ops are deterministic with zero LLM calls/tokens. */
export namespace ZeroMemory {
  function slug(sessionID: string) {
    return MemorySlug.safe(sessionID, { max: 40, fallback: "session" })
  }

  function id(sessionID: string, text: string, time: number) {
    return MemorySlug.hash(`${sessionID}\n${time}\n${text}`, "zt")
  }

  export async function enabled(root: string) {
    const state = await MemoryFiles.readState(root)
    return state.enabled
  }

  /** Append raw turn traces. Skips (never throws) when disabled/empty/echo. */
  export async function ingestTurn(input: {
    root: string
    sessionID: string
    user: string
    assistant: string
    time?: number
    recalledMemory?: boolean
  }): Promise<{ skipped: boolean; reason?: string; ids?: string[] }> {
    if (input.recalledMemory) return { skipped: true, reason: "echo" }
    if (!(await enabled(input.root))) return { skipped: true, reason: "disabled" }
    const time = input.time ?? Date.now()
    const units: TraceUnit[] = []
    const user = input.user.trim()
    const assistant = input.assistant.trim()
    if (user) {
      units.push({ id: id(input.sessionID, user, time), sessionId: slug(input.sessionID), time, speaker: "user", text: user, provenance: "trace" })
    }
    if (assistant) {
      units.push({ id: id(input.sessionID, assistant, time), sessionId: slug(input.sessionID), time: time + 1, speaker: "assistant", text: assistant, provenance: "trace" })
    }
    if (units.length === 0) return { skipped: true, reason: "empty" }
    await ZeroStore.append(input.root, units)
    return { skipped: false, ids: units.map((u) => u.id) }
  }

  export async function recall(input: {
    root: string
    query: string
    topK?: number
    sessionID?: string
  }): Promise<EvidenceSet | undefined> {
    if (!(await enabled(input.root))) return undefined
    const s = await ZeroStore.load(input.root)
    if (s.traces.length === 0) return undefined
    const profile = profileQuery(input.query, { boundarySessionId: input.sessionID })
    return retrieve(s, input.query, profile, { topK: input.topK ?? 5 })
  }

  /** Recall hits shaped for MemoryRecall fan-out (scored later by select()). */
  export async function searchHits(input: {
    root: string
    query: string
    limit?: number
  }): Promise<MemoryRecall.Hit[]> {
    const ev = await recall({ root: input.root, query: input.query, topK: input.limit ?? 5 })
    if (!ev) return []
    return ev.items.map((item) => ({
      type: "typed" as const,
      kind: "ZERO_TRACE",
      source: `zero:${item.traceId}`,
      text: `[${item.sessionId}] ${item.text}`,
      score: 0,
      topics: [],
      current: true,
      updatedAt: item.time,
      id: item.traceId,
      time: new Date(item.time).toISOString(),
    }))
  }

  export function renderBlock(ev: EvidenceSet, maxTokens = 2000): string {
    const lines = [
      "```sarsed-zero-mem-v1 context_not_instruction",
      `scope: project  route: ${ev.profile.route}  answerType: ${ev.profile.answerType}`,
      "",
    ]
    let tokens = MemoryToken.estimate(lines.join("\n"))
    for (const it of ev.items) {
      const head = `record id=${it.traceId} session=${it.sessionId} views=${it.views.join("+") || "lex"} score=${it.score}`
      const text = `text: ${it.text.trim().split("\n")[0].slice(0, 480)}`
      const cost = MemoryToken.estimate(`${head}\n${text}\n`) + 1
      if (tokens + cost > maxTokens) break
      lines.push(head, text, "")
      tokens += cost
    }
    lines.push("```")
    return lines.join("\n")
  }

  export async function status(root: string) {
    const state = await MemoryFiles.readState(root)
    const loaded = await ZeroStore.load(root)
    return {
      root,
      enabled: state.enabled,
      traces: loaded.traces.length,
      windows: loaded.windows.length,
      episodes: loaded.episodes.length,
      entities: loaded.entities.size,
      encoderOps: loaded.encoderOps,
      llmCalls: 0,
      llmTokens: 0,
      evidenceTokens: estimateTokens(loaded.traces.map((t) => t.text).join("\n")),
    }
  }
}
