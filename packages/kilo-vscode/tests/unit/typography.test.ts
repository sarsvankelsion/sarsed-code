import { describe, expect, it } from "bun:test"
import * as fs from "fs"
import * as path from "path"

describe("Typography and Newsreader Font Bundling", () => {
  const PKG_ROOT = path.resolve(__dirname, "../..")
  const ASSETS_FONT_DIR = path.join(PKG_ROOT, "assets", "fonts", "newsreader")
  const DIST_DIR = path.join(PKG_ROOT, "dist")
  const WEBVIEW_CSS = path.join(DIST_DIR, "webview.css")

  const VIETNAMESE_TEST_STRING =
    "Sarsed Code — Tiếng Việt: Trường đại học, Nguyễn, hướng dẫn, lập trình, ă â ê ô ơ ư đ, Á À Ả Ã Ạ, Ắ Ằ Ẳ Ẵ Ặ, Ứ Ừ Ử Ữ Ự."

  it("bundles official Newsreader font files with required weights and styles", () => {
    const requiredFiles = [
      "newsreader-vietnamese-400-normal.woff2",
      "newsreader-latin-400-normal.woff2",
      "newsreader-latin-ext-400-normal.woff2",
      "newsreader-vietnamese-400-italic.woff2",
      "newsreader-latin-400-italic.woff2",
      "newsreader-latin-ext-400-italic.woff2",
      "newsreader-vietnamese-500-normal.woff2",
      "newsreader-latin-500-normal.woff2",
      "newsreader-latin-ext-500-normal.woff2",
      "newsreader-vietnamese-600-normal.woff2",
      "newsreader-latin-600-normal.woff2",
      "newsreader-latin-ext-600-normal.woff2",
      "OFL.txt",
    ]

    for (const file of requiredFiles) {
      const filePath = path.join(ASSETS_FONT_DIR, file)
      expect(fs.existsSync(filePath)).toBe(true)
      expect(fs.statSync(filePath).size).toBeGreaterThan(0)
    }
  })

  it("includes official SIL Open Font License (OFL 1.1) attribution", () => {
    const oflPath = path.join(ASSETS_FONT_DIR, "OFL.txt")
    const content = fs.readFileSync(oflPath, "utf8")
    expect(content).toContain("SIL OPEN FONT LICENSE Version 1.1")
    expect(content).toContain("Copyright 2020 The Newsreader Project Authors")
  })

  it("verifies all glyphs in the Vietnamese test string are covered by unicode ranges", () => {
    // Unicode ranges from Newsreader Vietnamese, Latin-ext, and Latin
    const ranges: [number, number][] = [
      // Latin (0x0000-0x00FF, 0x0131, 0x0152-0x0153, 0x2000-0x206F)
      [0x0000, 0x00ff],
      [0x0131, 0x0131],
      [0x0152, 0x0153],
      [0x2000, 0x206f],
      // Latin-ext (0x0100-0x02BA, 0x1E00-0x1EFF, etc.)
      [0x0100, 0x02ba],
      [0x1e00, 0x1eff],
      // Vietnamese specific (U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+1EA0-1EF9, U+20AB)
      [0x0102, 0x0103],
      [0x0110, 0x0111],
      [0x0128, 0x0129],
      [0x0168, 0x0169],
      [0x01a0, 0x01a1],
      [0x01af, 0x01b0],
      [0x0300, 0x0309],
      [0x0323, 0x0329],
      [0x1ea0, 0x1ef9],
      [0x20ab, 0x20ab],
    ]

    function isCharCovered(char: string): boolean {
      const code = char.codePointAt(0)!
      return ranges.some(([start, end]) => code >= start && code <= end)
    }

    const chars = Array.from(VIETNAMESE_TEST_STRING)
    for (const char of chars) {
      const covered = isCharCovered(char)
      if (!covered) {
        throw new Error(
          `Character "${char}" (U+${char.codePointAt(0)?.toString(16).toUpperCase()}) not covered in declared ranges`,
        )
      }
      expect(covered).toBe(true)
    }
  })

  it("emits @font-face declarations for Newsreader with font-display: swap in webview CSS", () => {
    expect(fs.existsSync(WEBVIEW_CSS)).toBe(true)
    const css = fs.readFileSync(WEBVIEW_CSS, "utf8")

    expect(/@font-face\s*\{[^}]*font-family:\s*"?Newsreader"?/i.test(css)).toBe(true)
    expect(/font-display:\s*swap/i.test(css)).toBe(true)
    expect(/--font-family-prose:\s*"?Newsreader"?/i.test(css)).toBe(true)
    expect(/font-family:\s*var\(--font-family-prose/i.test(css)).toBe(true)
  })

  it("preserves monospace for code, diff, and tables without forcing Newsreader", () => {
    const codeCss = fs.readFileSync(
      path.resolve(PKG_ROOT, "..", "kilo-ui", "src", "components", "code.css"),
      "utf8",
    )
    expect(codeCss).toContain("monospace")
    expect(codeCss).not.toContain("Newsreader")

    const markdownCss = fs.readFileSync(
      path.resolve(PKG_ROOT, "..", "kilo-ui", "src", "components", "markdown.css"),
      "utf8",
    )
    expect(markdownCss).toContain(".shiki")
    expect(markdownCss).toContain("font-family: var(--font-family-mono, monospace)")
  })
})
