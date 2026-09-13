/**
 * Pure logic for the chat memory selector (no JSX — unit-testable under bun).
 */

export function formatMemoryTokens(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0"
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return `${n}`
}

/** Disable matrix for every memory action in every state. */
export interface MemoryActionState {
  connected: boolean
  loading: boolean
  pending: boolean
  enabled: boolean
  blocked: boolean
}

export type MemorySelectorAction = "open" | "toggle" | "write" | "maintain" | "purge"

export function memoryActionDisabled(state: MemoryActionState, action: MemorySelectorAction): boolean {
  if (state.blocked || !state.connected || state.loading || state.pending) return true
  switch (action) {
    case "open":
    case "toggle":
      return false
    case "write":
    case "maintain":
    case "purge":
      return !state.enabled
  }
}
