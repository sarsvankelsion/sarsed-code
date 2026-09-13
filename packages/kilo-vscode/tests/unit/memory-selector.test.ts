import { describe, expect, it } from "bun:test"
import {
  formatMemoryTokens,
  memoryActionDisabled,
  type MemoryActionState,
} from "../../webview-ui/src/components/shared/memory-selector-utils"

const base: MemoryActionState = {
  connected: true,
  loading: false,
  pending: false,
  enabled: true,
  blocked: false,
}

describe("MemorySelector disable matrix", () => {
  it("blocks everything while busy/disconnected/loading/pending", () => {
    const busy: MemoryActionState = { ...base, blocked: true }
    const offline: MemoryActionState = { ...base, connected: false }
    const loading: MemoryActionState = { ...base, loading: true }
    const pending: MemoryActionState = { ...base, pending: true }
    for (const s of [busy, offline, loading, pending]) {
      expect(memoryActionDisabled(s, "open")).toBe(true)
      expect(memoryActionDisabled(s, "toggle")).toBe(true)
      expect(memoryActionDisabled(s, "write")).toBe(true)
      expect(memoryActionDisabled(s, "maintain")).toBe(true)
      expect(memoryActionDisabled(s, "purge")).toBe(true)
    }
  })

  it("allows toggle/status/inspect while disabled, blocks writes", () => {
    const off: MemoryActionState = { ...base, enabled: false }
    expect(memoryActionDisabled(off, "open")).toBe(false)
    expect(memoryActionDisabled(off, "toggle")).toBe(false)
    expect(memoryActionDisabled(off, "write")).toBe(true)
    expect(memoryActionDisabled(off, "maintain")).toBe(true)
    expect(memoryActionDisabled(off, "purge")).toBe(true)
  })

  it("allows everything while enabled and idle", () => {
    for (const a of ["open", "toggle", "write", "maintain", "purge"] as const) {
      expect(memoryActionDisabled(base, a)).toBe(false)
    }
  })
})

describe("formatMemoryTokens", () => {
  it("formats token counts compactly", () => {
    expect(formatMemoryTokens(0)).toBe("0")
    expect(formatMemoryTokens(999)).toBe("999")
    expect(formatMemoryTokens(1500)).toBe("1.5k")
    expect(formatMemoryTokens(-5)).toBe("0")
    expect(formatMemoryTokens(NaN)).toBe("0")
  })
})
