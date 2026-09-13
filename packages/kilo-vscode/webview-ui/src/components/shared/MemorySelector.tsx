/**
 * MemorySelector component
 * Popover-based memory control for the chat prompt area.
 * Covers every memory state: disconnected / loading / disabled / enabled /
 * pending-op / no-project / busy, plus remember/correct/forget inline input,
 * auto-save toggle, rebuild/inspect/status, and 2-step purge confirm.
 *
 * MemorySelectorBase — reusable core driven by explicit props (unit-testable).
 * MemorySelector     — thin wrapper wired to memory/server/session contexts.
 */

import { Component, createSignal, For, Show } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useLanguage } from "../../context/language"
import { useMemory } from "../../context/memory"
import { useServer } from "../../context/server"
import { useSession } from "../../context/session"
import { useVSCode } from "../../context/vscode"
import type { MemoryOperation } from "../../types/messages/memory"
import type { MemoryActionState } from "./memory-selector-utils"
import { formatMemoryTokens, memoryActionDisabled } from "./memory-selector-utils"
import { PopupSelector } from "./PopupSelector"

export type MemoryInlineKind = "remember" | "correct" | "forget"

export {
  formatMemoryTokens,
  memoryActionDisabled,
  type MemoryActionState,
  type MemorySelectorAction,
} from "./memory-selector-utils"

export interface ZeroStats {
  traces: number
  episodes: number
  entities: number
}

export interface MemorySelectorBaseProps {
  blocked?: boolean
  connected: boolean
  loading: boolean
  pending: boolean
  enabled: boolean
  tokens: number
  autoOn: boolean
  zero?: ZeroStats
  onOp: (operation: MemoryOperation | "auto", extra?: Record<string, unknown>) => void
}

export const MemorySelectorBase: Component<MemorySelectorBaseProps> = (props) => {
  const language = useLanguage()
  const [open, setOpen] = createSignal(false)
  const [kind, setKind] = createSignal<MemoryInlineKind>("remember")
  const [text, setText] = createSignal("")
  const [purgeArmed, setPurgeArmed] = createSignal(false)

  const t = (key: string, params?: Record<string, string | number | boolean>) =>
    language.t(key, params)

  const snapshot = (): MemoryActionState => ({
    connected: props.connected,
    loading: props.loading,
    pending: props.pending,
    enabled: props.enabled,
    blocked: props.blocked ?? false,
  })

  function runOp(operation: MemoryOperation | "auto", extra: Record<string, unknown> = {}) {
    props.onOp(operation, extra)
    setOpen(false)
  }

  function submitInline() {
    const value = text().trim()
    if (!value || memoryActionDisabled(snapshot(), "write")) return
    const k = kind()
    if (k === "forget") runOp("forget", { query: value })
    else runOp(k, { text: value })
    setText("")
  }

  function onOpen(val: boolean) {
    if (val && memoryActionDisabled(snapshot(), "open")) return
    if (!val) setPurgeArmed(false)
    setOpen(val)
  }

  const triggerLabel = () =>
    !props.connected
      ? t("prompt.memory.offline")
      : props.loading
        ? t("prompt.memory.loading")
        : props.enabled
          ? `Zero-Mem: Active · Memory: ${formatMemoryTokens(props.tokens)} tokens`
          : "Zero-Mem: Active · Memory: Off"

  return (
    <Tooltip value={triggerLabel()} placement="top" openDelay={0}>
      <PopupSelector
        expanded={false}
        placement="top-start"
        preferredWidth={300}
        minHeight={100}
        open={open()}
        onOpenChange={onOpen}
        triggerAs={IconButton}
        triggerProps={{
          icon: "database",
          variant: "ghost",
          size: "small",
          "aria-label": t("prompt.memory.label"),
          disabled: memoryActionDisabled(snapshot(), "open"),
          loading: props.pending || props.loading,
          class: `prompt-status-button ${props.enabled ? "prompt-status-button--active" : ""}`,
        }}
        trigger={<></>}
      >
        {() => (
          <div class="memory-selector-panel" role="dialog" aria-label={t("prompt.memory.label")}>
            <Show
              when={props.connected}
              fallback={<div class="memory-selector-note">{t("prompt.memory.offlineHint")}</div>}
            >
              <div class="memory-selector-section--zero">
                <div class="memory-selector-header-row">
                  <span class="memory-selector-badge">⚡ Zero-Mem Substrate</span>
                  <span class="memory-selector-badge-sub">0 Token Cost</span>
                </div>
                <div class="memory-selector-note">
                  {t("prompt.memory.zeroLine", {
                    traces: `${props.zero?.traces ?? 0}`,
                    episodes: `${props.zero?.episodes ?? 0}`,
                    entities: `${props.zero?.entities ?? 0}`,
                  })}
                </div>
              </div>

              <div class="memory-selector-status">
                <span
                  class={`memory-selector-dot ${props.enabled ? "memory-selector-dot--on" : "memory-selector-dot--off"}`}
                />
                <span>
                  {props.enabled
                    ? `Project Memory: ${t("prompt.memory.enabledTokens", { tokens: `${props.tokens}` })}`
                    : `Project Memory: ${t("prompt.memory.disabled")}`}
                </span>
              </div>

              <div class="memory-selector-row">
                <Show
                  when={props.enabled}
                  fallback={
                    <Button
                      size="small"
                      disabled={memoryActionDisabled(snapshot(), "toggle")}
                      onClick={() => runOp("enable")}
                    >
                      {t("prompt.memory.enable")}
                    </Button>
                  }
                >
                  <Button
                    size="small"
                    variant="secondary"
                    disabled={memoryActionDisabled(snapshot(), "toggle")}
                    onClick={() => runOp("disable")}
                  >
                    {t("prompt.memory.disable")}
                  </Button>
                </Show>
                <Button
                  size="small"
                  variant="secondary"
                  disabled={memoryActionDisabled(snapshot(), "toggle")}
                  onClick={() => props.onOp("auto", { mode: props.autoOn ? "off" : "on" })}
                >
                  {props.autoOn ? t("prompt.memory.autoOff") : t("prompt.memory.autoOn")}
                </Button>
              </div>

              <Show when={props.enabled}>
                <div class="memory-selector-tabs" role="tablist">
                  <For each={["remember", "correct", "forget"] as MemoryInlineKind[]}>
                    {(k) => (
                      <button
                        role="tab"
                        aria-selected={kind() === k}
                        class={`memory-selector-tab ${kind() === k ? "memory-selector-tab--active" : ""}`}
                        onClick={() => setKind(k)}
                      >
                        {t(`prompt.memory.${k}`)}
                      </button>
                    )}
                  </For>
                </div>
                <div class="memory-selector-inline">
                  <input
                    class="memory-selector-input"
                    value={text()}
                    onInput={(e) => setText(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault()
                        submitInline()
                      }
                    }}
                    placeholder={t(`prompt.memory.${kind()}Placeholder`)}
                    aria-label={t(`prompt.memory.${kind()}`)}
                  />
                  <Button
                    size="small"
                    disabled={memoryActionDisabled(snapshot(), "write") || !text().trim()}
                    onClick={submitInline}
                  >
                    {t("prompt.memory.save")}
                  </Button>
                </div>
              </Show>

              <div class="memory-selector-row">
                <Button
                  size="small"
                  variant="ghost"
                  disabled={memoryActionDisabled(snapshot(), "toggle")}
                  onClick={() => runOp("status")}
                >
                  {t("prompt.memory.status")}
                </Button>
                <Button
                  size="small"
                  variant="ghost"
                  disabled={memoryActionDisabled(snapshot(), "maintain")}
                  onClick={() => runOp("rebuild")}
                >
                  {t("prompt.memory.rebuild")}
                </Button>
                <Button
                  size="small"
                  variant="ghost"
                  disabled={memoryActionDisabled(snapshot(), "toggle")}
                  onClick={() => runOp("inspect")}
                >
                  {t("prompt.memory.inspect")}
                </Button>
              </div>

              <Show when={props.enabled}>
                <div class="memory-selector-danger">
                  <Show
                    when={!purgeArmed()}
                    fallback={
                      <>
                        <span>{t("prompt.memory.purgeConfirm")}</span>
                        <Button
                          size="small"
                          variant="secondary"
                          disabled={memoryActionDisabled(snapshot(), "purge")}
                          onClick={() => {
                            setPurgeArmed(false)
                            runOp("purge", { confirm: true })
                          }}
                        >
                          {t("prompt.memory.purgeYes")}
                        </Button>
                        <Button size="small" variant="ghost" onClick={() => setPurgeArmed(false)}>
                          {t("prompt.memory.purgeNo")}
                        </Button>
                      </>
                    }
                  >
                    <Button
                      size="small"
                      variant="ghost"
                      disabled={memoryActionDisabled(snapshot(), "purge")}
                      onClick={() => setPurgeArmed(true)}
                    >
                      {t("prompt.memory.purge")}
                    </Button>
                  </Show>
                </div>
              </Show>
            </Show>
          </div>
        )}
      </PopupSelector>
    </Tooltip>
  )
}

export const MemorySelector: Component<{ blocked?: boolean }> = (props) => {
  const memory = useMemory()
  const server = useServer()
  const session = useSession()
  const vscode = useVSCode()

  const zeroStats = () => {
    const z = memory.zero()
    if (!z) return { traces: 0, episodes: 0, entities: 0 }
    return { traces: z.traces, episodes: z.episodes, entities: z.entities }
  }
  return (
    <MemorySelectorBase
      blocked={props.blocked}
      connected={server.isConnected()}
      loading={memory.loading()}
      pending={memory.pending()}
      enabled={memory.enabled()}
      tokens={memory.totalTokens()}
      autoOn={memory.status()?.state.autoConsolidate ?? false}
      zero={zeroStats()}
      onOp={(operation, extra = {}) =>
        vscode.postMessage({ type: "memoryOperation", operation, sessionID: session.currentSessionID(), ...extra })
      }
    />
  )
}
