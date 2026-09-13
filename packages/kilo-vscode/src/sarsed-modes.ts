import * as fs from "fs/promises"
import * as path from "path"
import * as vscode from "vscode"

export namespace SarsedModes {
  export interface ModeDefinition {
    slug: string
    name: string
    description: string
    template: string
  }

  export const BUNDLED_MODES: Record<string, ModeDefinition> = {
    build: {
      slug: "build",
      name: "Build",
      description: "Build mode. Executes user requests end-to-end with direct code edits and tests.",
      template: `---
description: Build mode. Executes user requests end-to-end with direct code edits and tests.
mode: primary
---

You are in Build mode. Execute the user's request end-to-end. Read the relevant code, edit it directly, run focused tests and builds, fix problems you discover, and finish only when there is a working result. Do not stop at a proposal or implementation plan.
`,
    },
    plan: {
      slug: "plan",
      name: "Plan",
      description: "Plan mode. Investigates codebase and drafts evidence-based plans without modifying code.",
      template: `---
description: Plan mode. Investigates codebase and drafts evidence-based plans without modifying code.
mode: primary
---

You are in Plan mode. Investigate the repository and produce an evidence-based implementation plan. Name affected files and architecture, implementation order, tests, risks, and open decisions. Do not edit code or run mutating operations unless the user explicitly switches mode or asks you to do so.
`,
    },
    sarsed: {
      slug: "sarsed",
      name: "Sarsed",
      description: "Sarsed security validation mode adapted from sarsed.md. Use only for authorized assessment of targets the user owns or is permitted to test.",
      template: `---
description: Sarsed security validation mode adapted from sarsed.md. Use only for authorized assessment of targets the user owns or is permitted to test.
source: sarsed.md
attribution: Ported from the Sarsed agent (upstream inspiration: usestrix/strix).
mode: primary
color: error
---

You are Sarsed, an application security validation orchestrator for authorized assessments. Work only on targets the user has explicitly placed in scope. Never expand scope to an undeclared external host, service, repository, device, or account.

<core_capabilities>
- Threat modeling and attack-surface mapping
- Static and dynamic security analysis (SAST + DAST)
- Modular skill routing from \`skills/<category>/<skill>.md\`
- Reproducible proof-of-concept validation
- Secure remediation with targeted regression testing
- SARIF and HTML reporting
</core_capabilities>

<authorization_and_safety>
- Treat clearly declared user-owned or explicitly authorized targets as in scope.
- Clarify scope when a request identifies no target or authority is ambiguous.
- Refuse destructive testing, denial of service, persistence, mass targeting, credential theft, supply-chain compromise, or stealth intended to evade defenders.
- Prefer local fixtures, staging environments, and minimally invasive checks.
- Never expose secrets in logs, reports, fixtures, or prompts.
</authorization_and_safety>

<skill_system>
- Before specialized work, read the matching local skill under \`skills/\` rather than inventing a workflow.
- Use the repository's security skills for vulnerability classes, frameworks, protocols, cloud targets, and tools.
- If no relevant skill exists, use established defensive engineering practice and state the gap.
</skill_system>

<method>
1. Confirm target and boundaries.
2. Map entry points, trust boundaries, identities, data flows, dependencies, and exposed services.
3. Use static analysis first when source is available.
4. Use safe dynamic validation where a local or authorized runtime exists.
5. Confirm findings with reproducible evidence; scanner output alone is not a finding.
6. Rank by demonstrated impact and exploitability.
7. Patch source when requested, run regression tests, then re-run the proof of concept.
8. Report root cause, evidence, impact, remediation, and verification.
</method>

<operating_rules>
- Prefer existing tools and project abstractions over custom scanners.
- Keep payloads and requests scoped, throttled, and identifiable in local audit logs without embedding personal markers.
- Do not auto-install tools or change shared infrastructure without approval.
- Do not create branches, commits, pushes, issues, or pull requests unless explicitly requested.
- Keep the user informed with short progress updates and concrete validation results.
</operating_rules>

<completion>
Finish with verified findings or a clear statement of what was tested and what could not be verified. A valid result includes evidence, a concrete fix when source is available, and tests proving the fix. Do not call an unvalidated suspicion a vulnerability.
</completion>
`,
    },
    reverse: {
      slug: "reverse",
      name: "Reverse",
      description: "Reverse engineering, binary analysis, protocol decoding, and security research mode. Powered by reverse-skill.",
      template: `---
name: Reverse
description: Reverse engineering, binary analysis, protocol decoding, and security research mode. Powered by reverse-skill.
mode: primary
color: warning
icon: shield
---

# Reverse Engineering & Security Research Mode

You are in **Reverse Mode**, specialized in reverse engineering, binary analysis, firmware extraction, protocol reversing, frontend deobfuscation, and authorized CTF/security research.

## Core Knowledge & Router
- Primary router: \`C:\\Users\\Admin\\.sarsed\\skills\\reverse-skill\`
- Rules: \`C:\\Users\\Admin\\.sarsed\\skills\\reverse-skill\\RULES.md\`
- Master Routing: \`C:\\Users\\Admin\\.sarsed\\skills\\reverse-skill\\skills\\MASTER-ROUTING.md\`
`,
    },
    "skill-hunter": {
      slug: "skill-hunter",
      name: "Skill Hunter",
      description:
        "AI Skill Hunter mode. Discovers top GitHub skills/MCPs for user tasks, evaluates & presents the most effective options for user confirmation, and leverages them thoroughly.",
      template: `---
name: Skill Hunter
description: AI Skill Hunter mode. Discovers top GitHub skills/MCPs for user tasks, evaluates & presents the most effective options for user confirmation, and leverages them thoroughly.
mode: primary
color: info
icon: search
---

# Skill Hunter Mode

You are operating in **Skill Hunter Mode**. You possess full software engineering and build capabilities (editing code, running shell commands, testing), augmented with a specialized mandate: **actively hunting, integrating, and thoroughly exploiting AI skills from GitHub to solve the user's task.**

## Core Workflow
1. **Analyze Task**: Identify specialized domain knowledge, playbooks, or tools needed.
2. **Hunt on GitHub**: Proactively search GitHub and skill registries for matching AI skills and MCP servers.
3. **Evaluate & Present (Confirmation Gate)**: List the top most effective candidate skills with GitHub URLs, why they are effective, and wait for/request user confirmation before installing.
4. **Integrate & Exploit Thoroughly**: Clone/install the confirmed skill into \`.sarsed/skills/<skill-name>\`, read all instructions, and execute the task strictly and thoroughly using that skill.
`,
    },
  }

  function sanitizeSlug(slug: string): string {
    const trimmed = slug.trim()
    if (!trimmed || trimmed.includes("..") || trimmed.includes("/") || trimmed.includes("\\")) {
      throw new Error(`Invalid mode slug "${slug}". Slug must not contain path traversal characters.`)
    }
    const sanitized = trimmed.toLowerCase().replace(/[^a-z0-9_-]/g, "-")
    if (!sanitized) {
      throw new Error(`Invalid mode slug "${slug}". Slug must contain valid characters.`)
    }
    return sanitized
  }

  export function getModePath(projectDir: string, slug: string): string {
    const safeSlug = sanitizeSlug(slug)
    return path.join(projectDir, ".sarsed", "agents", safeSlug, "AGENT.md")
  }

  /**
   * Seed default bundled modes into .sarsed/agents/<mode>/AGENT.md on first initialization.
   * Idempotent: Never overwrites existing files.
   */
  export async function seedDefaultModes(projectDir: string): Promise<string[]> {
    const created: string[] = []
    for (const [slug, mode] of Object.entries(BUNDLED_MODES)) {
      const targetFile = getModePath(projectDir, slug)
      const targetDir = path.dirname(targetFile)

      try {
        await fs.access(targetFile)
        // File already exists - never overwrite user modifications!
      } catch {
        await fs.mkdir(targetDir, { recursive: true })
        await fs.writeFile(targetFile, mode.template, "utf8")
        created.push(slug)
      }
    }
    return created
  }

  /**
   * Restore bundled template with explicit confirmation.
   */
  export async function restoreBundledTemplate(
    projectDir: string,
    slug: string,
    confirmed: boolean,
  ): Promise<boolean> {
    if (!confirmed) {
      throw new Error("Confirmation required before restoring bundled template.")
    }
    const safeSlug = sanitizeSlug(slug)
    const bundled = BUNDLED_MODES[safeSlug]
    if (!bundled) {
      throw new Error(`Mode "${slug}" is not a bundled mode with a default template.`)
    }
    const targetFile = getModePath(projectDir, safeSlug)
    await fs.mkdir(path.dirname(targetFile), { recursive: true })
    await fs.writeFile(targetFile, bundled.template, "utf8")
    return true
  }

  /**
   * Create a new mode with custom or starter template.
   */
  export async function createMode(
    projectDir: string,
    slug: string,
    customTemplate?: string,
  ): Promise<string> {
    const safeSlug = sanitizeSlug(slug)
    const targetFile = getModePath(projectDir, safeSlug)
    try {
      await fs.access(targetFile)
      throw new Error(`Mode "${safeSlug}" already exists at ${targetFile}`)
    } catch (err: any) {
      if (err.code !== "ENOENT") throw err
    }

    const template =
      customTemplate ??
      `---
description: Custom mode ${safeSlug}
mode: primary
---

You are in ${safeSlug} mode.
`
    await fs.mkdir(path.dirname(targetFile), { recursive: true })
    await fs.writeFile(targetFile, template, "utf8")
    return targetFile
  }

  /**
   * Rename a mode by moving its directory cleanly.
   */
  export async function renameMode(
    projectDir: string,
    oldSlug: string,
    newSlug: string,
  ): Promise<void> {
    const safeOld = sanitizeSlug(oldSlug)
    const safeNew = sanitizeSlug(newSlug)

    const oldDir = path.join(projectDir, ".sarsed", "agents", safeOld)
    const newDir = path.join(projectDir, ".sarsed", "agents", safeNew)

    try {
      await fs.access(oldDir)
    } catch {
      throw new Error(`Mode directory "${oldDir}" does not exist.`)
    }

    try {
      await fs.access(newDir)
      throw new Error(`Target mode directory "${newDir}" already exists.`)
    } catch (err: any) {
      if (err.code !== "ENOENT") throw err
    }

    await fs.rename(oldDir, newDir)
  }

  /**
   * Duplicate a mode.
   */
  export async function duplicateMode(
    projectDir: string,
    sourceSlug: string,
    newSlug: string,
  ): Promise<string> {
    const safeSource = sanitizeSlug(sourceSlug)
    const safeNew = sanitizeSlug(newSlug)

    const sourceFile = getModePath(projectDir, safeSource)
    const content = await fs.readFile(sourceFile, "utf8")
    return createMode(projectDir, safeNew, content)
  }

  /**
   * Delete a mode.
   */
  export async function deleteMode(
    projectDir: string,
    slug: string,
    force = false,
  ): Promise<boolean> {
    const safeSlug = sanitizeSlug(slug)
    if (!force && BUNDLED_MODES[safeSlug]) {
      throw new Error(`Cannot delete bundled mode "${safeSlug}" without force flag.`)
    }
    const modeDir = path.join(projectDir, ".sarsed", "agents", safeSlug)
    await fs.rm(modeDir, { recursive: true, force: true })
    return true
  }
}
