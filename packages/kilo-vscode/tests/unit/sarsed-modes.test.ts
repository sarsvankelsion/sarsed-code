import { describe, expect, it } from "bun:test"
import * as fs from "fs/promises"
import * as path from "path"
import os from "os"
import { SarsedModes } from "../../src/sarsed-modes"

describe("SarsedModes management (VS Code)", () => {
  it("seeds default bundled modes (build, plan, sarsed) idempotently without overwriting", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sarsed-modes-test-"))
    try {
      const seeded = await SarsedModes.seedDefaultModes(tmpDir)
      expect(seeded).toContain("build")
      expect(seeded).toContain("plan")
      expect(seeded).toContain("sarsed")

      // Verify canonical file exists
      const sarsedPath = SarsedModes.getModePath(tmpDir, "sarsed")
      const sarsedContent = await fs.readFile(sarsedPath, "utf8")
      expect(sarsedContent).toContain("You are Sarsed")
      expect(sarsedContent).toContain("authorized assessments")
      expect(sarsedContent).toContain("skills/<category>/<skill>.md")

      // Simulate user modification
      const modifiedContent = sarsedContent + "\n<!-- user customization -->"
      await fs.writeFile(sarsedPath, modifiedContent, "utf8")

      // Second seed must not overwrite user modifications
      const secondSeeded = await SarsedModes.seedDefaultModes(tmpDir)
      expect(secondSeeded).toEqual([])
      const afterSecondSeed = await fs.readFile(sarsedPath, "utf8")
      expect(afterSecondSeed).toContain("<!-- user customization -->")
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it("restores bundled template only upon confirmation", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sarsed-restore-test-"))
    try {
      await SarsedModes.seedDefaultModes(tmpDir)
      const sarsedPath = SarsedModes.getModePath(tmpDir, "sarsed")

      // Overwrite with custom text
      await fs.writeFile(sarsedPath, "custom text", "utf8")

      // Restore without confirmation must throw
      let threw = false
      try {
        await SarsedModes.restoreBundledTemplate(tmpDir, "sarsed", false)
      } catch (err: any) {
        threw = true
        expect(err.message).toContain("Confirmation required")
      }
      expect(threw).toBe(true)

      // Restore with confirmation succeeds
      const ok = await SarsedModes.restoreBundledTemplate(tmpDir, "sarsed", true)
      expect(ok).toBe(true)
      const restored = await fs.readFile(sarsedPath, "utf8")
      expect(restored).toContain("You are Sarsed")
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it("creates, renames, duplicates, and deletes modes with path traversal protection", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sarsed-crud-test-"))
    try {
      // Path traversal check
      let threwTraversal = false
      try {
        await SarsedModes.createMode(tmpDir, "../malicious")
      } catch {
        threwTraversal = true
      }
      expect(threwTraversal).toBe(true)

      // Create new mode
      const createdFile = await SarsedModes.createMode(tmpDir, "pentest")
      expect(await fs.readFile(createdFile, "utf8")).toContain("You are in pentest mode")

      // Duplicate
      const dupFile = await SarsedModes.duplicateMode(tmpDir, "pentest", "pentest-copy")
      expect(await fs.readFile(dupFile, "utf8")).toContain("You are in pentest mode")

      // Rename
      await SarsedModes.renameMode(tmpDir, "pentest-copy", "pentest-v2")
      expect(await fs.readFile(SarsedModes.getModePath(tmpDir, "pentest-v2"), "utf8")).toBeDefined()

      // Delete
      await SarsedModes.deleteMode(tmpDir, "pentest-v2")
      let notFound = false
      try {
        await fs.access(SarsedModes.getModePath(tmpDir, "pentest-v2"))
      } catch {
        notFound = true
      }
      expect(notFound).toBe(true)
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })
})
