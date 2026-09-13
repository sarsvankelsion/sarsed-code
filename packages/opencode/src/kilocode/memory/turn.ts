import { Cause, Effect } from "effect"
import { MemoryTurn as TurnCore } from "@kilocode/kilo-memory/effect/turn"
import { MemoryPaths } from "@kilocode/kilo-memory/effect/paths"
import { MemoryRedact } from "@kilocode/kilo-memory/redact"
import { MemoryService } from "@kilocode/kilo-memory/effect/service"
import * as Log from "@opencode-ai/core/util/log"
import type { Bus } from "@/bus"
import { EffectBridge } from "@/effect/bridge"
import { InstanceState } from "@/effect/instance-state"
import type { Provider } from "@/provider/provider"
import type { Session } from "@/session/session"
import type { SessionID } from "@/session/schema"
import type { SessionSummary } from "@/session/summary"
import { KiloSession } from "@/kilocode/session"
import { KiloSessionPrompt } from "@/kilocode/session/prompt"
import { MemoryModel, MemorySession } from "./ports"

const log = Log.create({ service: "memory.lifecycle" })

function brief(cause: Cause.Cause<unknown>) {
  const err = Cause.squash(cause)
  return MemoryRedact.text(err instanceof Error ? err.message : String(err)).slice(0, 200)
}

/** Host turn-open/turn-close hooks: adapt opencode's session/provider services into the package
 * capture ports and delegate the orchestration (locking, idle-flush scheduling) to the package. */
export namespace MemoryTurn {
  export type Reason = TurnCore.Reason

  export function open(input: { sessionID: SessionID }) {
    TurnCore.open({ sessionID: input.sessionID })
  }

  export const close = Effect.fn("MemoryTurn.close")(function* (input: {
    sessionID: SessionID
    reason: Reason
    sessions: Session.Interface
    summary: SessionSummary.Interface
    provider: Provider.Interface
  }) {
    const ctx = yield* InstanceState.context
    const root = MemoryPaths.root({ ctx })
    const result = yield* TurnCore.close({
      root,
      sessionID: input.sessionID,
      reason: input.reason,
      session: MemorySession.port({ sessions: input.sessions, summary: input.summary }),
      model: MemoryModel.port({ provider: input.provider }),
    })

    // Cross-session continuity: sync Zero-Mem project state to MEMORY.md
    yield* Effect.tryPromise(async () => {
      try {
        const fs = await import("fs/promises")
        const memFiles = MemoryPaths.files(root)
        let projectText = ""
        try {
          projectText = await fs.readFile(memFiles.project, "utf8")
        } catch {}
        let decisionsText = ""
        try {
          decisionsText = await fs.readFile(memFiles.decisions, "utf8")
        } catch {}

        const architecture: string[] = []
        const conventions: string[] = []
        const decisions: string[] = []

        if (projectText) {
          const lines = projectText.split(/\r?\n/).filter((l) => l.trim().startsWith("-"))
          lines.forEach((l) => architecture.push(l.trim()))
        }
        if (decisionsText) {
          const lines = decisionsText.split(/\r?\n/).filter(Boolean)
          for (const line of lines) {
            try {
              const d = JSON.parse(line)
              if (d.decision || d.summary) decisions.push(`- ${d.decision || d.summary}`)
            } catch {}
          }
        }

        const { MemoryMd } = await import("@kilocode/kilo-memory")
        await MemoryMd.syncCompact(ctx.directory, {
          architecture: architecture.slice(0, 15),
          conventions: conventions.slice(0, 15),
          decisions: decisions.slice(-15),
        })
      } catch (err) {
        log.warn("MEMORY.md sync failed", { error: String(err) })
      }
    }).pipe(Effect.orElseSucceed(() => undefined))

    return result
  })
}

/** Host lifecycle: subscribe to session turn events and drive the memory turn open/close hooks,
 * isolating subscriber failures so they never break the host session flow. */
export namespace MemoryLifecycle {
  export const subscribe = Effect.fn("MemoryLifecycle.subscribe")(function* (input: {
    bus: Bus.Interface
    sessions: Session.Interface
    summary: SessionSummary.Interface
    provider: Provider.Interface
    memory: MemoryService.Interface
  }) {
    const bridge = yield* EffectBridge.make()
    yield* input.bus.subscribeCallback(KiloSession.Event.TurnOpen, (evt) =>
      bridge.fork(
        Effect.sync(() => MemoryTurn.open({ sessionID: evt.properties.sessionID })).pipe(
          Effect.catchCause((cause) =>
            Effect.sync(() => log.warn("memory turn-open subscriber failed", { err: brief(cause) })),
          ),
        ),
      ),
    )
    yield* input.bus.subscribeCallback(KiloSession.Event.TurnClose, (evt) =>
      bridge.fork(
        Effect.gen(function* () {
          const ctx = yield* InstanceState.context
          const enabled = yield* KiloSessionPrompt.memoryToolEnabled({ ctx })
          if (!enabled) return
          yield* MemoryTurn.close({
            sessionID: evt.properties.sessionID,
            // A superseded turn handed off to a queued follow-up after draining
            // its step; for digest purposes it was cut short like an interrupt.
            reason: evt.properties.reason === "superseded" ? "interrupted" : evt.properties.reason,
            sessions: input.sessions,
            summary: input.summary,
            provider: input.provider,
          }).pipe(Effect.provideService(MemoryService.Service, input.memory), Effect.ignore)
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.sync(() => log.warn("memory turn-close subscriber failed", { err: brief(cause) })),
          ),
        ),
      ),
    )
  })
}
