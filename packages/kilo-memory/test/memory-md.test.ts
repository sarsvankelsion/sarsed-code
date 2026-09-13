import { describe, expect, it } from "bun:test"
import * as fs from "fs/promises"
import * as path from "path"
import os from "os"
import { MemoryMd } from "../src/memory-md"

describe("MemoryMd cross-session persistence", () => {
  it("parses and formats MEMORY.md sections correctly", () => {
    const raw = `
# Sarsed Code Memory

## Project Overview & Architecture
- Next.js frontend with FastAPI backend
- PostgreSQL relational store

## User Preferences & Conventions
- Use TypeScript strict mode
- Vietnamese comments preferred

## Key Decisions & Findings
- Switched auth to JWT
- Patched CVE-2026-X in sarsed/fix-jwt

## Active Tasks & Next Steps
- Verify PoC on staging
`
    const sections = MemoryMd.parseSections(raw)
    expect(sections["Project Overview & Architecture"]).toBeDefined()
    expect(sections["Project Overview & Architecture"][0]).toContain("Next.js")
    expect(sections["User Preferences & Conventions"][0]).toContain("TypeScript")
    expect(sections["Key Decisions & Findings"][0]).toContain("JWT")
    expect(sections["Active Tasks & Next Steps"][0]).toContain("Verify PoC")
  })

  it("syncCompact merges new updates without duplicate entries and writes to disk", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sarsed-mem-test-"))
    try {
      const filePath = await MemoryMd.syncCompact(tmpDir, {
        architecture: ["Service A on port 8080"],
        conventions: ["Always use bun for package manager"],
        decisions: ["Use SIL OFL Newsreader font"],
        tasks: ["Finish vertical slice 4"],
      })

      expect(filePath).toBe(path.join(tmpDir, ".sarsed", "memory.md"))
      const readBack = await MemoryMd.read(tmpDir)
      expect(readBack.exists).toBe(true)
      expect(readBack.content).toContain("Service A on port 8080")
      expect(readBack.content).toContain("Always use bun for package manager")
      expect(readBack.content).toContain("Use SIL OFL Newsreader font")
      expect(readBack.content).toContain("Finish vertical slice 4")

      // Second compaction adds new item while preserving old ones
      await MemoryMd.syncCompact(tmpDir, {
        decisions: ["Adopt Zero-Mem arXiv 2607.29377"],
      })
      const readBack2 = await MemoryMd.read(tmpDir)
      expect(readBack2.content).toContain("Use SIL OFL Newsreader font")
      expect(readBack2.content).toContain("Adopt Zero-Mem arXiv 2607.29377")
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })
})
