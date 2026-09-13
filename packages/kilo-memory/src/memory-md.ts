import * as fs from "fs/promises"
import * as path from "path"
import os from "os"

export namespace MemoryMd {
  export interface MemoryMdData {
    path: string
    content: string
    exists: boolean
    sections: Record<string, string[]>
  }

  export function canonicalPaths(projectDir: string): { workspace: string; root: string; global: string } {
    return {
      workspace: path.join(projectDir, ".sarsed", "memory.md"),
      root: path.join(projectDir, "MEMORY.md"),
      global: path.join(os.homedir(), ".sarsed", "memory.md"),
    }
  }

  export async function resolvePath(projectDir: string): Promise<string> {
    const paths = canonicalPaths(projectDir)
    try {
      await fs.access(paths.workspace)
      return paths.workspace
    } catch {
      try {
        await fs.access(paths.root)
        return paths.root
      } catch {
        return paths.workspace
      }
    }
  }

  export function parseSections(markdown: string): Record<string, string[]> {
    const sections: Record<string, string[]> = {}
    let currentSection = "General"
    sections[currentSection] = []

    const lines = markdown.split(/\r?\n/)
    for (const line of lines) {
      const match = line.match(/^##+\s+(.+)$/)
      if (match) {
        currentSection = match[1].trim()
        if (!sections[currentSection]) {
          sections[currentSection] = []
        }
      } else if (line.trim().length > 0) {
        sections[currentSection].push(line.trim())
      }
    }
    return sections
  }

  export async function read(projectDir: string): Promise<MemoryMdData> {
    const filePath = await resolvePath(projectDir)
    try {
      const content = await fs.readFile(filePath, "utf8")
      return {
        path: filePath,
        content,
        exists: true,
        sections: parseSections(content),
      }
    } catch {
      return {
        path: filePath,
        content: "",
        exists: false,
        sections: {},
      }
    }
  }

  export async function readGlobal(): Promise<string | undefined> {
    const globalPath = path.join(os.homedir(), ".sarsed", "memory.md")
    try {
      const content = await fs.readFile(globalPath, "utf8")
      return content.trim().length ? content : undefined
    } catch {
      return undefined
    }
  }

  export function formatMemoryMd(sections: {
    architecture?: string[]
    conventions?: string[]
    decisions?: string[]
    tasks?: string[]
    additional?: Record<string, string[]>
  }): string {
    const out: string[] = ["# Sarsed Code Memory", ""]

    out.push("## Project Overview & Architecture")
    if (sections.architecture?.length) {
      sections.architecture.forEach((item) => out.push(item.startsWith("-") ? item : `- ${item}`))
    } else {
      out.push("- Project structure and architecture context.")
    }
    out.push("")

    out.push("## User Preferences & Conventions")
    if (sections.conventions?.length) {
      sections.conventions.forEach((item) => out.push(item.startsWith("-") ? item : `- ${item}`))
    } else {
      out.push("- User coding conventions and preferred tools.")
    }
    out.push("")

    out.push("## Key Decisions & Findings")
    if (sections.decisions?.length) {
      sections.decisions.forEach((item) => out.push(item.startsWith("-") ? item : `- ${item}`))
    } else {
      out.push("- Architectural and security decisions made in earlier sessions.")
    }
    out.push("")

    out.push("## Active Tasks & Next Steps")
    if (sections.tasks?.length) {
      sections.tasks.forEach((item) => out.push(item.startsWith("-") ? item : `- ${item}`))
    } else {
      out.push("- Active tasks in progress to resume in the next session.")
    }
    out.push("")

    if (sections.additional) {
      for (const [title, lines] of Object.entries(sections.additional)) {
        out.push(`## ${title}`)
        lines.forEach((item) => out.push(item.startsWith("-") ? item : `- ${item}`))
        out.push("")
      }
    }

    return out.join("\n")
  }

  export async function syncCompact(
    projectDir: string,
    updates: {
      architecture?: string[]
      conventions?: string[]
      decisions?: string[]
      tasks?: string[]
    },
  ): Promise<string> {
    const existing = await read(projectDir)
    const sections = existing.sections

    const architecture = Array.from(
      new Set([...(sections["Project Overview & Architecture"] ?? []), ...(updates.architecture ?? [])]),
    )
    const conventions = Array.from(
      new Set([...(sections["User Preferences & Conventions"] ?? []), ...(updates.conventions ?? [])]),
    )
    const decisions = Array.from(
      new Set([...(sections["Key Decisions & Findings"] ?? []), ...(updates.decisions ?? [])]),
    )
    const tasks = updates.tasks ?? sections["Active Tasks & Next Steps"] ?? []

    const formatted = formatMemoryMd({
      architecture,
      conventions,
      decisions,
      tasks,
    })

    const targetPath = existing.exists ? existing.path : path.join(projectDir, ".sarsed", "memory.md")
    await fs.mkdir(path.dirname(targetPath), { recursive: true })
    await fs.writeFile(targetPath, formatted, "utf8")
    return targetPath
  }
}
