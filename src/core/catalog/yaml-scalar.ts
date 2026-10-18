/**
 * Scalar-level utilities shared by the two hand-rolled YAML readers.
 *
 * Ticket 01's agent-document reader (`./frontmatter.ts`) and ticket 02's
 * registry.yaml reader (`./registry-file.ts`) need the same quote, comment and
 * flow-literal rules, and this bundle ships with zero runtime dependencies
 * (ADR-0001, enforced by `scripts/check.mjs:188`), so the rules live here once
 * instead of being copied into each reader.
 *
 * Everything here works on one scalar token or one flow literal. None of it
 * decides what a value *means* — booleans, entry shapes and required keys stay
 * with the reader that knows its own schema.
 */

/** Cut a `#` comment that starts a token, leaving quoted text alone. */
export function stripComment(text: string): string {
  let quote: string | undefined
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? ''
    if (quote !== undefined) {
      if (char === '\\' && quote === '"') index += 1
      else if (char === quote) quote = undefined
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === '#' && (index === 0 || /\s/.test(text[index - 1] ?? ''))) return text.slice(0, index)
  }
  return text
}

/** Unwrap a quoted scalar; plain text passes through, an unterminated quote does not. */
export function unquote(text: string): string | undefined {
  const quote = text[0]
  if (quote !== '"' && quote !== "'") return text
  let out = ''
  for (let index = 1; index < text.length; index += 1) {
    const char = text[index] ?? ''
    if (quote === '"' && char === '\\') {
      const escaped = text[index + 1]
      /* v8 ignore next -- a trailing backslash is not a value we can recover. */
      if (escaped === undefined) return undefined
      out += escaped === 'n' ? '\n' : escaped === 't' ? '\t' : escaped
      index += 1
      continue
    }
    if (char === quote) {
      return stripComment(text.slice(index + 1)).trim() === '' ? out : undefined
    }
    out += char
  }
  return undefined
}

/** Split on top-level commas, respecting quotes and nested brackets. */
export function splitTopLevel(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quote: string | undefined
  let start = 0
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? ''
    if (quote !== undefined) {
      if (char === '\\' && quote === '"') index += 1
      else if (char === quote) quote = undefined
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === '[' || char === '{') depth += 1
    else if (char === ']' || char === '}') depth -= 1
    else if (char === ',' && depth === 0) {
      parts.push(text.slice(start, index))
      start = index + 1
    }
  }
  parts.push(text.slice(start))
  return parts
}

/** Inner text of a balanced `open`/`close` pair, or `undefined` when unbalanced. */
export function flowInner(text: string, open: string, close: string): string | undefined {
  let depth = 0
  let quote: string | undefined
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? ''
    if (quote !== undefined) {
      if (char === '\\' && quote === '"') index += 1
      else if (char === quote) quote = undefined
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === open) depth += 1
    else if (char === close) {
      depth -= 1
      if (depth === 0) {
        const trailing = stripComment(text.slice(index + 1)).trim()
        return trailing === '' ? text.slice(1, index) : undefined
      }
    }
  }
  return undefined
}
