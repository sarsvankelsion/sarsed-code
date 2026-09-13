import path from "path"
import { MemoryFs } from "../storage/fs"
import { MemorySlug } from "../slug"
import { emptySubstrate, ingest, type Substrate } from "./substrate"
import type { TraceUnit } from "./types"

/** Zero-Mem trace persistence: raw traces are the source of record (JSONL). */
export namespace ZeroStore {
  export function file(root: string) {
    return path.join(root, "zero-traces.jsonl")
  }

  export function manifest(root: string) {
    return path.join(root, "zero-manifest.json")
  }

  export async function load(root: string): Promise<Substrate> {
    const s = emptySubstrate()
    const text = await MemoryFs.read(file(root))
    if (!text) return s
    const units: TraceUnit[] = []
    for (const line of text.split("\n")) {
      const value = line.trim()
      if (!value) continue
      try {
        const u = JSON.parse(value) as TraceUnit
        if (u.id && typeof u.text === "string") units.push(u)
      } catch {
        // skip corrupt line, keep the rest
      }
    }
    ingest(s, units)
    return s
  }

  export async function append(root: string, units: TraceUnit[]): Promise<void> {
    if (units.length === 0) return
    await MemoryFs.queue(root, async () => {
      const prev = (await MemoryFs.read(file(root))) ?? ""
      const next = prev + units.map((u) => JSON.stringify(u)).join("\n") + "\n"
      await MemoryFs.write(file(root), next)
      await MemoryFs.write(
        manifest(root),
        JSON.stringify({ version: 1, traces: "zero-traces.jsonl", updatedAt: Date.now() }),
      )
    })
  }

  export async function id(root: string, sessionID: string, seq: number): Promise<string> {
    void root
    const slug = MemorySlug.safe(sessionID, { max: 40, fallback: "session" })
    return `zt:${slug}:${seq}`
  }

  export async function count(root: string): Promise<number> {
    const text = await MemoryFs.read(file(root))
    if (!text) return 0
    let n = 0
    for (const line of text.split("\n")) if (line.trim()) n += 1
    return n
  }

  export async function clear(root: string): Promise<void> {
    await MemoryFs.queue(root, async () => {
      await MemoryFs.remove(file(root))
      await MemoryFs.remove(manifest(root))
    })
  }
}
