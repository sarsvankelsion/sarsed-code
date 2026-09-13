import { describe, expect, it } from "bun:test"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { MemoryFiles } from "../src/storage/store"
import { ZeroMemory } from "../src/zero/facade"
import { KiloMemory } from "../src/effect"
import { profileQuery } from "../src/zero/routing"
import { retrieve } from "../src/zero/retrieve"
import { ZeroStore } from "../src/zero/store"
import { emptySubstrate, ingest } from "../src/zero/substrate"

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "zero-e2e-"))
}

describe("zero end-to-end: ingest -> recall -> verify remembers", () => {
  it("ingests raw traces and recalls them with 0 llm cost", async () => {
    const root = tmpRoot()
    await MemoryFiles.scaffold(root)
    const r1 = await ZeroMemory.ingestTurn({
      root,
      sessionID: "s1",
      user: "Deploy the staging build with bun run deploy:staging.",
      assistant: "Staging deploy uses bun run deploy:staging against host staging-02.",
    })
    expect(r1.skipped).toBe(false)
    const ev = await ZeroMemory.recall({ root, query: "staging deploy command" })
    expect(ev).toBeDefined()
    expect(ev!.cost.llmCalls).toBe(0)
    expect(ev!.cost.llmTokens).toBe(0)
    expect(ev!.items.length).toBeGreaterThan(0)
    expect(ev!.items.map((i) => i.text).join(" ")).toContain("deploy:staging")
  })

  it("skips echo turns and disabled roots", async () => {
    const root = tmpRoot()
    await MemoryFiles.scaffold(root)
    const echo = await ZeroMemory.ingestTurn({
      root,
      sessionID: "s9",
      user: "status?",
      assistant: "ok",
      recalledMemory: true,
    })
    expect(echo.skipped).toBe(true)
    await MemoryFiles.writeState(root, { ...(await MemoryFiles.readState(root)), enabled: false })
    const off = await ZeroMemory.ingestTurn({ root, sessionID: "s9", user: "hello", assistant: "world" })
    expect(off.skipped).toBe(true)
    expect(off.reason).toBe("disabled")
  })

  it("bridges sessions through shared entity", async () => {
    const root = tmpRoot()
    await MemoryFiles.scaffold(root)
    await ZeroMemory.ingestTurn({
      root,
      sessionID: "s1",
      user: "Investigate CVE-2026-X in auth module.",
      assistant: "Root cause in packages/kilo-vscode/src/extension.ts token refresh.",
    })
    await ZeroMemory.ingestTurn({
      root,
      sessionID: "s2",
      user: "Continue the auth fix.",
      assistant: "Verify PoC for CVE-2026-X on staging, then rebuild the vsix.",
    })
    const ev = await ZeroMemory.recall({ root, query: "CVE-2026-X auth fix next step" })
    expect(ev).toBeDefined()
    const sessions = new Set(ev!.items.map((i) => i.sessionId))
    expect(sessions.size).toBeGreaterThanOrEqual(1)
    expect(ev!.items.map((i) => i.text).join(" ")).toContain("CVE-2026-X")
  })

  it("KiloMemory.zeroIngest/zeroRecall/zeroStatus work through facade", async () => {
    const root = tmpRoot()
    await MemoryFiles.scaffold(root)
    await KiloMemory.zeroIngest({ root, sessionID: "a", user: "Bun test from packages/opencode.", assistant: "Confirmed." })
    const ev = await KiloMemory.zeroRecall({ root, query: "bun test command" })
    expect(ev).toBeDefined()
    expect(ev!.items.length).toBeGreaterThan(0)
    const st = await KiloMemory.zeroStatus({ root })
    expect(st.traces).toBe(2)
    expect(st.llmCalls).toBe(0)
    expect(st.llmTokens).toBe(0)
  })

  it("persistence round-trips raw traces (source of record)", async () => {
    const root = tmpRoot()
    await MemoryFiles.scaffold(root)
    await ZeroMemory.ingestTurn({ root, sessionID: "p", user: "Remember the API freeze v2.", assistant: "Noted: API contract v2 frozen." })
    const loaded = await ZeroStore.load(root)
    expect(loaded.traces.length).toBe(2)
    expect(loaded.traces.map((t) => t.text).join(" ")).toContain("API contract v2")
    const s2 = emptySubstrate()
    ingest(s2, loaded.traces)
    const ev = retrieve(s2, "API contract", profileQuery("API contract"), { topK: 3 })
    expect(ev.items.length).toBeGreaterThan(0)
    expect(ev.cost.llmCalls).toBe(0)
  })
})
