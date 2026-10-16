import { describe, expect, it } from 'vitest'

import { readRegistryLayer, DEFAULT_ALIAS_NAME } from '../src/registry-file.ts'

/** The spec §5.2 example: block and flow entries, comments, a quoted sysPrompt. */
const SPEC_LAYER = `models:                        # 真实模型条目：调优层挂这里（D6）
  ds-chat:
    provider: deepseek
    model: deepseek-chat
    sysPrompt: "你是 DeepSeek-V3，偏对话与工具调用。"
    available: true            # v1 手动开关
  ds-reasoner: { provider: deepseek, model: deepseek-reasoner, sysPrompt: "先想, 再答", available: false }
aliases:                       # 纯指针（意图层）
  smart: [ds-reasoner]
  fast: [ds-chat]
`

/** The failure messages of a rejected layer, for asserting on the reason. */
function failuresOf(text: string): readonly string[] {
  const read = readRegistryLayer(text)
  if (read.ok) throw new Error('expected the layer to be rejected')
  return read.failures.map((failure) => failure.message)
}

function codesOf(text: string): readonly string[] {
  const read = readRegistryLayer(text)
  if (read.ok) throw new Error('expected the layer to be rejected')
  return read.failures.map((failure) => failure.code)
}

describe('registry.yaml layer reader', () => {
  it('reads the spec example into model entries and alias pointers', () => {
    expect(readRegistryLayer(SPEC_LAYER)).toEqual({
      ok: true,
      data: {
        models: [
          {
            modelName: 'ds-chat',
            provider: 'deepseek',
            model: 'deepseek-chat',
            sysPrompt: '你是 DeepSeek-V3，偏对话与工具调用。',
            available: true,
          },
          {
            modelName: 'ds-reasoner',
            provider: 'deepseek',
            model: 'deepseek-reasoner',
            sysPrompt: '先想, 再答',
            available: false,
          },
        ],
        aliases: [
          { alias: 'smart', targets: ['ds-reasoner'] },
          { alias: 'fast', targets: ['ds-chat'] },
        ],
      },
    })
  })

  it('keeps declaration order, because the merge and dsh-default pick the first match', () => {
    const read = readRegistryLayer(
      'models:\n  charlie: { provider: p, model: c }\n  alpha: { provider: p, model: a }\naliases:\n  zulu: [charlie]\n  echo: [alpha]\n',
    )

    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.data.models.map((entry) => entry.modelName)).toEqual(['charlie', 'alpha'])
    expect(read.data.aliases.map((entry) => entry.alias)).toEqual(['zulu', 'echo'])
  })

  it('defaults a model entry to available when the switch is absent', () => {
    const read = readRegistryLayer('models:\n  ds-chat:\n    provider: deepseek\n    model: deepseek-chat\n')

    expect(read).toMatchObject({ ok: true, data: { models: [{ modelName: 'ds-chat', available: true }] } })
  })

  it('treats an empty file, and a layer that declares nothing, as nothing to merge', () => {
    expect(readRegistryLayer('')).toEqual({ ok: true, data: { models: [], aliases: [] } })
    expect(readRegistryLayer('# only a comment\n\n')).toEqual({ ok: true, data: { models: [], aliases: [] } })
    expect(readRegistryLayer('models:\naliases:\n')).toEqual({ ok: true, data: { models: [], aliases: [] } })
    expect(readRegistryLayer('models: {}\naliases: {}\n')).toEqual({ ok: true, data: { models: [], aliases: [] } })
  })

  it('reads the block sequence form of an alias as well as the flow form', () => {
    const read = readRegistryLayer('aliases:\n  smart:\n    - ds-reasoner\n')

    expect(read).toEqual({ ok: true, data: { models: [], aliases: [{ alias: 'smart', targets: ['ds-reasoner'] }] } })
  })

  it('rejects an unknown top-level key, so a typo cannot silently yield an empty registry', () => {
    // `alias:` instead of `aliases:` would otherwise merge nothing at all.
    expect(codesOf('alias:\n  smart: [ds-chat]\n')).toEqual(['invalid-registry'])
    expect(failuresOf('alias:\n  smart: [ds-chat]\n')[0]).toContain('alias')
  })

  it('rejects a key declared twice', () => {
    expect(failuresOf('aliases:\n  a: [x]\naliases:\n  b: [y]\n')[0]).toContain('more than once')
  })

  it('rejects a model entry that is not a mapping', () => {
    expect(codesOf('models:\n  ds-chat: deepseek\n')).toEqual(['invalid-registry'])
    expect(failuresOf('models:\n  ds-chat: deepseek\n')[0]).toContain('ds-chat')
  })

  it('rejects a model entry without both provider and model', () => {
    // One direction names the field that is missing, whichever it is.
    expect(failuresOf('models:\n  ds-chat:\n    provider: deepseek\n')[0]).toContain('model "ds-chat" requires a non-empty model')
    expect(failuresOf('models:\n  ds-chat:\n    model: deepseek-chat\n')[0]).toContain('non-empty provider')
  })

  it('rejects an unknown field inside a model entry', () => {
    // A misspelt `provider:` must not be dropped silently.
    const failures = failuresOf('models:\n  ds-chat:\n    provder: deepseek\n    model: deepseek-chat\n')
    expect(failures.length).toBeGreaterThan(0)
    expect(failures.join(' ')).toContain('provder')
  })

  it('rejects an available switch that is not true or false', () => {
    expect(failuresOf('models:\n  ds-chat:\n    provider: p\n    model: m\n    available: yes\n').join(' ')).toContain('available')
  })

  it('rejects an alias whose targets are not a single-target array', () => {
    // v1 aliases are single-target arrays (D18): a scalar, an empty array and a
    // pool all fail here, and the pool form becomes R1/R2 work.
    expect(failuresOf('aliases:\n  smart: ds-reasoner\n').join(' ')).toContain('smart')
    expect(failuresOf('aliases:\n  smart: []\n').join(' ')).toContain('smart')
    expect(failuresOf('aliases:\n  smart: [ds-reasoner, ds-chat]\n').join(' ')).toContain('single')
  })

  it('reserves the dsh-default name in both the alias and the model map', () => {
    // The built-in pointer owns the name (triage Q3); writing it is a validation
    // error, not a silent override, because the built-in must stay authoritative.
    expect(DEFAULT_ALIAS_NAME).toBe('dsh-default')
    expect(failuresOf('aliases:\n  dsh-default: [ds-chat]\n').join(' ')).toContain('reserved')
    expect(failuresOf('models:\n  dsh-default: { provider: p, model: m }\n').join(' ')).toContain('reserved')
  })

  it('reports syntax the subset cannot read as unparseable', () => {
    expect(codesOf('aliases:\n  smart: [ds-chat\n')).toEqual(['unparseable-registry'])
    expect(codesOf('this line is not a key\n')).toEqual(['unparseable-registry'])
    expect(codesOf('models:\n  ds-chat:\n    provider: "unterminated\n')).toEqual(['unparseable-registry'])
  })

  it('collects every failure instead of stopping at the first', () => {
    const failures = failuresOf('nope: 1\nmodels:\n  ds-chat: deepseek\n')

    expect(failures.length).toBe(2)
  })
})
