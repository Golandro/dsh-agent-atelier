/**
 * 票 06 的第一刀：目录投影、摘要与发布门控的纯函数行为。
 * 断言只看公开输出（条目、规范文本、动作/update 标志），不看内部实现。
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MockInstance } from 'vitest'

import { apply } from '../src/index.ts'
import type { AgentRegistry, AliasRegistry } from '../src/contract/index.ts'
import { installAgentCatalog } from '../src/dsh/host/catalog.ts'
import type {
  CatalogHostAgent,
  CatalogHostHeader,
  CatalogHostMessage,
  CatalogHostSession,
  CatalogPreStepDecision,
} from '../src/dsh/host/catalog.ts'

import {
  CATALOG_DESCRIPTION_MAX_LENGTH,
  catalogDigest,
  catalogSourcePayload,
  createCatalogMessage,
  digestCatalogSource,
  planCatalogPublish,
  projectCatalog,
  readCatalogSource,
  renderCatalog,
} from '../src/agent-assembly/index.ts'
import { scratchDir, write } from './support/fs.ts'

/** Identity hash: the digest is the canonical text itself, readable in assertions. */
const identity = (text: string): string => text

function agentInput(overrides: Partial<Parameters<typeof projectCatalog>[0]['agents'][number]> = {}) {
  return {
    agentName: 'alpha',
    name: 'Alpha',
    description: 'Code reviewer',
    modelOrder: ['fast'],
    missingTools: [],
    missingSkills: [],
    ...overrides,
  }
}

describe('projectCatalog', () => {
  it('normalises names, whitespace and warnings, and keeps registry order', () => {
    const snapshot = projectCatalog({
      agents: [
        agentInput({ agentName: 'second', name: 'Second', description: '  review \n code  ', missingTools: ['zeta', 'alpha'], missingSkills: ['lint'] }),
        agentInput({ agentName: 'first', name: '', description: '' }),
      ],
      aliases: ['fast', 'smart'],
      incomplete: false,
    })

    expect(snapshot.entries).toEqual([
      {
        kind: 'agent',
        agentName: 'second',
        name: 'Second',
        description: 'review code',
        modelOrder: ['fast'],
        missingTools: ['alpha', 'zeta'],
        missingSkills: ['lint'],
      },
      {
        kind: 'agent',
        agentName: 'first',
        name: 'first',
        description: '',
        modelOrder: ['fast'],
        missingTools: [],
        missingSkills: [],
      },
      { kind: 'alias', alias: 'fast' },
      { kind: 'alias', alias: 'smart' },
    ])
    expect(snapshot.incomplete).toBe(false)
  })

  it('caps a description at the published bound with an ellipsis', () => {
    const long = 'x'.repeat(CATALOG_DESCRIPTION_MAX_LENGTH + 40)
    const snapshot = projectCatalog({
      agents: [agentInput({ description: long })],
      aliases: [],
      incomplete: false,
    })
    const entry = snapshot.entries[0]

    expect(entry?.kind).toBe('agent')
    if (entry?.kind !== 'agent') throw new Error('expected an agent entry')
    expect(entry.description).toHaveLength(CATALOG_DESCRIPTION_MAX_LENGTH)
    expect(entry.description.endsWith('...')).toBe(true)
  })

  it('accepts an absent mode and incomplete flag without inventing them', () => {
    const snapshot = projectCatalog({ agents: [], aliases: [], incomplete: false })

    expect(snapshot).toEqual({ entries: [], incomplete: false })
  })
})

describe('catalogDigest canonical form', () => {
  it('hashes mode and incomplete first, then one JSON tuple per entry', () => {
    const snapshot = projectCatalog({
      agents: [agentInput()],
      aliases: ['fast'],
      mode: 'standard',
      incomplete: true,
    })

    expect(catalogDigest(snapshot, identity)).toBe([
      '["mode","standard"]',
      'incomplete',
      '["agent","alpha","Alpha","Code reviewer",["fast"],[],[]]',
      '["alias","fast"]',
    ].join('\n'))
  })

  it('ignores alias target metadata in the durable source digest', () => {
    const snapshot = projectCatalog({ agents: [agentInput()], aliases: ['fast'], incomplete: false })
    const source = catalogSourcePayload(snapshot, false)

    // A remap changes only routing metadata; the catalog source never carries it.
    const remapped = { ...source, targets: ['other-model'] }

    expect(digestCatalogSource(remapped, identity)).toBe(digestCatalogSource(source, identity))
  })

  it('changes when mode, completeness, warnings or order change', () => {
    const base = projectCatalog({ agents: [agentInput()], aliases: [], incomplete: false })
    const withMode = projectCatalog({ agents: [agentInput()], aliases: [], mode: 'minimal', incomplete: false })
    const incomplete = projectCatalog({ agents: [agentInput()], aliases: [], incomplete: true })
    const warned = projectCatalog({ agents: [agentInput({ missingTools: ['lint'] })], aliases: [], incomplete: false })
    const reordered = projectCatalog({
      agents: [agentInput({ agentName: 'second', name: 'Second' }), agentInput()],
      aliases: [],
      incomplete: false,
    })

    expect(catalogDigest(withMode, identity)).not.toBe(catalogDigest(base, identity))
    expect(catalogDigest(incomplete, identity)).not.toBe(catalogDigest(base, identity))
    expect(catalogDigest(warned, identity)).not.toBe(catalogDigest(base, identity))
    expect(catalogDigest(reordered, identity)).not.toBe(catalogDigest(base, identity))
  })

  it('quotes entries so newlines, commas and empty descriptions cannot blur boundaries', () => {
    const snapshot = projectCatalog({
      agents: [
        agentInput({ agentName: 'empty', name: 'Empty', description: '' }),
        agentInput({
          agentName: 'quoted',
          name: 'Quoted',
          description: 'first line' + String.fromCharCode(10) + 'second, line',
        }),
      ],
      aliases: [],
      incomplete: false,
    })

    expect(catalogDigest(snapshot, identity)).toBe([
      '',
      '',
      '["agent","empty","Empty","",["fast"],[],[]]',
      '["agent","quoted","Quoted","first line second, line",["fast"],[],[]]',
    ].join('\n'))
  })

  it('is deterministic for identical input', () => {
    const once = projectCatalog({ agents: [agentInput()], aliases: ['fast'], incomplete: false })
    const twice = projectCatalog({ agents: [agentInput()], aliases: ['fast'], incomplete: false })

    expect(catalogDigest(once, identity)).toBe(catalogDigest(twice, identity))
  })
})

describe('planCatalogPublish', () => {
  const EMPTY = true
  const NON_EMPTY = false

  it('removes a current-batch catalog whose digest already matches', () => {
    expect(planCatalogPublish({ digest: 'same', batchDigest: 'same', newIsEmpty: NON_EMPTY }))
      .toEqual({ action: 'remove', update: false })
  })

  it('replaces a current-batch catalog in place when the digest differs', () => {
    expect(planCatalogPublish({ digest: 'new', batchDigest: 'old', newIsEmpty: NON_EMPTY }))
      .toEqual({ action: 'replace', update: true })
  })

  it('appends nothing when the visible catalog already matches', () => {
    expect(planCatalogPublish({ digest: 'same', visibleDigest: 'same', newIsEmpty: NON_EMPTY }))
      .toEqual({ action: 'keep', update: false })
  })

  it('appends a replacement when a visible catalog differs', () => {
    expect(planCatalogPublish({ digest: 'new', visibleDigest: 'old', newIsEmpty: NON_EMPTY }))
      .toEqual({ action: 'append', update: true })
  })

  it('publishes nothing on a first empty catalog', () => {
    expect(planCatalogPublish({ digest: 'empty', newIsEmpty: EMPTY }))
      .toEqual({ action: 'keep', update: false })
  })

  it('publishes a clearing message when a visible catalog becomes empty', () => {
    expect(planCatalogPublish({ digest: 'empty', visibleDigest: 'old', newIsEmpty: EMPTY }))
      .toEqual({ action: 'append', update: true })
  })

  it('publishes a first catalog when nothing is visible yet', () => {
    expect(planCatalogPublish({ digest: 'first', newIsEmpty: NON_EMPTY }))
      .toEqual({ action: 'append', update: false })
  })
})
describe('renderCatalog', () => {
  it('renders one system-reminder message with agents, aliases, mode and escaped text', () => {
    const snapshot = projectCatalog({
      agents: [
        agentInput({ description: 'Reviews <code> & notes' }),
        agentInput({ agentName: 'beta', name: 'beta', description: '', modelOrder: [], missingTools: ['lint'] }),
      ],
      aliases: ['fast', 'smart'],
      mode: 'standard',
      incomplete: false,
    })

    const text = renderCatalog(snapshot, { update: false })

    expect(text.startsWith('<system-reminder>')).toBe(true)
    expect(text.endsWith('</system-reminder>')).toBe(true)
    expect(text).toContain('<available_agents>')
    expect(text).toContain('- `alpha` (Alpha) — Reviews &lt;code&gt; &amp; notes; model order: `fast`')
    expect(text).toContain('- `beta` — missing tools: `lint`')
    expect(text).toContain('<available_models>')
    expect(text).toContain('- `fast`')
    expect(text).toContain('Current mode: `standard`.')
    expect(text).not.toContain('guarantee a summon')
    expect(text).not.toContain('deepseek')
  })

  it('uses replacement wording and omits a mode line when no mode exists', () => {
    const snapshot = projectCatalog({ agents: [agentInput()], aliases: [], incomplete: false })

    const text = renderCatalog(snapshot, { update: true })

    expect(text).toContain('replaces every earlier agent or model catalog')
    expect(text).toContain('do not use names from earlier catalogs')
    expect(text).not.toContain('Current mode:')
  })

  it('renders a clearing message instead of empty sections', () => {
    const snapshot = projectCatalog({ agents: [], aliases: [], incomplete: false })

    const text = renderCatalog(snapshot, { update: true })

    expect(text).toContain('No expert agents or model aliases are currently available.')
    expect(text).toContain('do not use names from earlier catalogs')
    expect(text).not.toContain('<available_agents>')
    expect(text).not.toContain('<available_models>')
  })

  it('states that discovery is incomplete', () => {
    const snapshot = projectCatalog({ agents: [agentInput()], aliases: [], incomplete: true })

    expect(renderCatalog(snapshot, { update: false })).toContain('Discovery is incomplete')
  })
})

describe('durable source round-trip', () => {
  it('reads back every field needed to recompute the digest', () => {
    const snapshot = projectCatalog({
      agents: [agentInput({ missingTools: ['lint'], missingSkills: ['review'] })],
      aliases: ['fast'],
      mode: 'minimal',
      incomplete: true,
    })
    const source = catalogSourcePayload(snapshot, true)

    expect(source).toMatchObject({ kind: 'agents-catalog', form: 'catalog', mode: 'minimal', incomplete: true, update: true })
    expect(readCatalogSource(source)).toEqual(snapshot)
    expect(digestCatalogSource(source, identity)).toBe(catalogDigest(snapshot, identity))
  })

  it('treats an unreadable source as not this plugin catalog instead of throwing', () => {
    expect(readCatalogSource(undefined)).toBeUndefined()
    expect(readCatalogSource({ entries: [{ kind: 'agent', agentName: 'x' }] })).toBeUndefined()
    expect(readCatalogSource({ entries: [], mode: 7 })).toBeUndefined()
    expect(readCatalogSource({ entries: 'nope' })).toBeUndefined()
    expect(readCatalogSource({ kind: 'skill-catalog', entries: [] })).toBeUndefined()
  })
})

describe('createCatalogMessage', () => {
  it('publishes a frozen user message with one text block and the durable source', () => {
    const snapshot = projectCatalog({ agents: [agentInput()], aliases: ['fast'], incomplete: false })
    const message = createCatalogMessage({ snapshot, update: false, id: 'message-1' })

    expect(message.id).toBe('message-1')
    expect(message.role).toBe('user')
    expect(message.content).toHaveLength(1)
    expect(message.content[0]?.type).toBe('text')
    expect(message.source).toMatchObject({ kind: 'agents-catalog', form: 'catalog' })
    expect(Object.isFrozen(message)).toBe(true)
    expect(Object.isFrozen(message.source)).toBe(true)
    expect(() => { (message.content[0] as { text: string }).text = 'changed' }).toThrow()
  })
})
/* ── pre-step seam: the real core row on a real Cordis Context ───────────── */

afterEach(() => {
  vi.unstubAllEnvs()
})

const REGISTRY_LAYER = [
  'models:',
  '  chat: { provider: deepseek, model: deepseek-chat }',
  '  alt: { provider: vendor, model: alt-model }',
  'aliases:',
  '  fast: [chat]',
  '  smart: [alt]',
  '',
].join('\n')

const REMAPPED_LAYER = [
  'models:',
  '  chat: { provider: deepseek, model: deepseek-chat }',
  '  alt: { provider: vendor, model: alt-model }',
  'aliases:',
  '  fast: [alt]',
  '  smart: [alt]',
  '',
].join('\n')

const ALPHA_DOC = [
  '---',
  'name: Alpha',
  'description: "Reviews <code> & notes"',
  'modelOrder: [fast]',
  'requiredTools: [lint]',
  'skills: [review]',
  '---',
  'Alpha body.',
  '',
].join('\n')

const BETA_DOC = [
  '---',
  'name: Beta',
  'description: "Coordinates work"',
  'modelOrder: [smart]',
  'requiredTools: [missing-tool]',
  'skills: [missing-skill]',
  '---',
  'Beta body.',
  '',
].join('\n')

interface Fixture {
  readonly ctx: Context
  readonly agent: CatalogHostAgent
  readonly history: CatalogHostMessage[]
  readonly registry: AgentRegistry
  readonly aliasRegistry: AliasRegistry
  readonly project: string
  readonly home: string
  readonly mode: { value: string | undefined }
  readonly tools: { value: readonly string[]; fail: boolean; abort: AbortController | undefined }
  readonly presetArgs: unknown[]
  readonly warn: MockInstance
}

interface FixtureOptions {
  readonly header?: CatalogHostHeader | undefined
  /** `absent` and `throws` exercise the session-header fallback. */
  readonly workingDirectory?: 'present' | 'absent' | 'throws' | undefined
  readonly preset?: boolean | undefined
  readonly skills?: { readonly skills: readonly string[]; readonly complete: boolean } | false | undefined
  readonly looseDocument?: boolean | undefined
  readonly rawDocument?: boolean | undefined
  readonly advisoryDocument?: boolean | undefined
  readonly brokenRegistryLayer?: boolean | undefined
}

/** A real core row over throwaway registries, plus fake host capability services. */
async function fixture(options: FixtureOptions = {}): Promise<Fixture> {
  const home = scratchDir('agent-atelier-catalog-home-')
  vi.stubEnv('DSH_HOME', home)
  vi.stubEnv('DSH_AGENTS_HOME', join(home, 'agents-home'))
  const project = scratchDir('agent-atelier-catalog-project-')
  mkdirSync(join(project, '.git'), { recursive: true })
  write(join(home, 'agents', 'registry.yaml'), REGISTRY_LAYER)
  write(join(project, '.dsh', 'agents', 'alpha', 'alpha.agent.md'), ALPHA_DOC)
  write(join(project, '.dsh', 'agents', 'beta', 'beta.agent.md'), BETA_DOC)
  if (options.looseDocument === true) {
    write(join(project, '.dsh', 'agents', 'loose.agent.md'), '---\ndescription: "flat document"\n---\nbody\n')
  }
  if (options.rawDocument === true) {
    write(join(project, '.dsh', 'agents', 'gamma', 'gamma.agent.md'), [
      '---',
      'name: Gamma',
      'description: "Raw model chain"',
      'model: [{ provider: vendor, model: raw-model }]',
      '---',
      'Gamma body.',
      '',
    ].join('\n'))
  }
  if (options.advisoryDocument === true) {
    write(join(project, '.dsh', 'agents', 'advisable', 'advisable.agent.md'), [
      '---',
      'name: Advisable',
      'description: "No model order"',
      '---',
      'Advisable body.',
      '',
    ].join('\n'))
  }
  if (options.brokenRegistryLayer === true) {
    write(join(project, '.dsh', 'agents', 'registry.yaml'), 'aliases:\n  broken: [chat\n')
  }

  const ctx = new Context()
  await ctx.plugin({ apply })
  const registry = ctx.get('agentRegistry') as AgentRegistry
  const aliasRegistry = ctx.get('aliasRegistry') as AliasRegistry

  const mode = { value: 'standard' as string | undefined }
  const presetArgs: unknown[] = []
  if (options.preset !== false) {
    ctx.provide('agentPresets', {
      composedPreset: (target: unknown) => {
        presetArgs.push(target)
        return mode.value
      },
    })
  }

  const tools = {
    value: ['read', 'bash'] as readonly string[],
    fail: false,
    abort: undefined as AbortController | undefined,
  }
  ctx.provide('tools', {
    schemas: () => {
      if (tools.abort !== undefined) {
        tools.abort.abort()
        throw new Error('tools aborted')
      }
      if (tools.fail) throw new Error('tools unavailable')
      return tools.value.map((name) => ({ name }))
    },
  })

  const skills = options.skills === false
    ? false
    : options.skills ?? { skills: ['review'] as const, complete: true }
  if (skills !== false) {
    ctx.provide('skills', { snapshot: async () => skills })
  }

  const workingDirectory = options.workingDirectory ?? 'present'
  if (workingDirectory === 'present') {
    ctx.provide('workingDirectory', { ensure: async () => project })
  } else if (workingDirectory === 'throws') {
    ctx.provide('workingDirectory', { ensure: async () => { throw new Error('working directory unavailable') } })
  }

  const history: CatalogHostMessage[] = []
  const session: CatalogHostSession = {
    header: { cwd: project, ...options.header },
    deriveMessages: () => history,
  }
  const agent: CatalogHostAgent = { id: 'agent-1', ctx, session }
  const warn = vi.spyOn(ctx.logger, 'warn')

  return { ctx, agent, history, registry, aliasRegistry, project, home, mode, tools, presetArgs, warn }
}

function catalogSourceKind(message: CatalogHostMessage): boolean {
  const source = message.source
  return typeof source === 'object' && source !== null
    && (source as { readonly kind?: unknown }).kind === 'agents-catalog'
}

function textOf(message: CatalogHostMessage): string {
  for (const block of message.content) {
    if (typeof block !== 'object' || block === null) continue
    const candidate = block as { readonly type?: unknown; readonly text?: unknown }
    if (candidate.type === 'text' && typeof candidate.text === 'string') return candidate.text
  }
  throw new Error('catalog message carries no text block')
}

function enterMessages(decision: CatalogPreStepDecision): readonly CatalogHostMessage[] {
  if (decision.kind !== 'enter') throw new Error('expected an enter decision')
  return decision.messages
}

async function dispatch(
  fixture: Fixture,
  options: { readonly messages?: readonly CatalogHostMessage[] | undefined; readonly signal?: AbortSignal | undefined } = {},
): Promise<CatalogPreStepDecision> {
  const messages = options.messages ?? []
  return await fixture.ctx.waterfall('agent/pre-step', {
    agent: fixture.agent,
    messages,
    turn: 1,
    step: 1,
    signal: options.signal ?? new AbortController().signal,
    modelSelection: { provider: 'deepseek', model: 'deepseek-chat' },
  }, async () => ({ kind: 'enter', messages }))
}

function commitCatalog(fixture: Fixture, decision: CatalogPreStepDecision): CatalogHostMessage {
  const catalog = enterMessages(decision).filter(catalogSourceKind).at(-1)
  if (catalog === undefined) throw new Error('no catalog message to commit')
  fixture.history.push(catalog)
  return catalog
}

describe('agent catalog pre-step seam', () => {
  it('publishes one catalog for a top-level session, with mode and escaped descriptions', async () => {
    const fx = await fixture()
    const decision = await dispatch(fx)

    expect(enterMessages(decision)).toHaveLength(1)
    const message = enterMessages(decision)[0]
    if (message === undefined) throw new Error('missing catalog message')
    expect(message.role).toBe('user')
    expect(message.source).toMatchObject({ kind: 'agents-catalog', form: 'catalog' })
    const text = textOf(message)

    expect(text).toContain('<available_agents>')
    expect(text).toContain('- \`alpha\` (Alpha) — Reviews &lt;code&gt; &amp; notes; model order: \`fast\`; missing tools: \`lint\`')
    expect(text).toContain('- \`beta\` (Beta) — Coordinates work; model order: \`smart\`; missing tools: \`missing-tool\`; missing preset skills: \`missing-skill\`')
    expect(text).toContain('<available_models>')
    expect(text).toContain('- \`fast\`')
    expect(text).toContain('- \`smart\`')
    expect(text).toContain('Current mode: \`standard\`.')
    expect(text).not.toContain('deepseek')
    expect(JSON.stringify(message.source)).not.toContain('deepseek')
    // The preset service receives the Agent's scoped context, not the root.
    expect(fx.presetArgs).toEqual([fx.agent.ctx])
  })

  it('is a no-op on an unchanged registry and on an alias remap', async () => {
    const fx = await fixture()
    const first = commitCatalog(fx, await dispatch(fx))

    expect(enterMessages(await dispatch(fx))).toHaveLength(0)

    write(join(fx.home, 'agents', 'registry.yaml'), REMAPPED_LAYER)
    fx.aliasRegistry.invalidate()
    expect(enterMessages(await dispatch(fx))).toHaveLength(0)
    expect(textOf(first)).toContain('- \`fast\`')
    expect(textOf(first)).not.toContain('alt-model')
  })

  it('appends one replacement message when a description changes', async () => {
    const fx = await fixture()
    const first = commitCatalog(fx, await dispatch(fx))
    write(join(fx.project, '.dsh', 'agents', 'alpha', 'alpha.agent.md'), ALPHA_DOC.replace('Reviews', 'Deeply reviews'))
    fx.registry.invalidate()

    const decision = await dispatch(fx)
    const messages = enterMessages(decision)

    expect(messages).toHaveLength(1)
    const replacement = messages[0]
    if (replacement === undefined) throw new Error('missing replacement message')
    expect(replacement.id).not.toBe(first.id)
    expect(replacement.source).toMatchObject({ kind: 'agents-catalog', update: true })
    expect(textOf(replacement)).toContain('replaces every earlier agent or model catalog')
    // The old catalog stays in derived history; the wording does the replacing.
    expect(fx.history).toHaveLength(1)
  })

  it('appends one replacement message when a model order changes', async () => {
    const fx = await fixture()
    commitCatalog(fx, await dispatch(fx))
    write(
      join(fx.project, '.dsh', 'agents', 'alpha', 'alpha.agent.md'),
      ALPHA_DOC.replace('modelOrder: [fast]', 'modelOrder: [smart]'),
    )
    fx.registry.invalidate()

    const messages = enterMessages(await dispatch(fx))

    expect(messages).toHaveLength(1)
    expect(messages[0]?.source).toMatchObject({ update: true })
    expect(textOf(messages[0]!)).toContain('model order: `smart`')
  })

  it('treats a changed effective tool surface as a catalog change', async () => {
    const fx = await fixture()
    commitCatalog(fx, await dispatch(fx))
    fx.tools.value = ['read', 'bash', 'lint']

    const decision = await dispatch(fx)
    const messages = enterMessages(decision)

    expect(messages).toHaveLength(1)
    expect(messages[0]?.source).toMatchObject({ update: true })
    expect(textOf(messages[0]!)).not.toContain('missing tools: \`lint\`')
  })

  it('treats a preset switch as a catalog change', async () => {
    const fx = await fixture()
    commitCatalog(fx, await dispatch(fx))
    fx.mode.value = 'minimal'

    const messages = enterMessages(await dispatch(fx))

    expect(messages).toHaveLength(1)
    expect(textOf(messages[0]!)).toContain('Current mode: \`minimal\`.')
  })

  it('skips subagent sessions classified by origin or delegation depth', async () => {
    for (const header of [{ origin: 'subagent' as const }, { delegationDepth: 1 }]) {
      const fx = await fixture({ header })
      expect(enterMessages(await dispatch(fx))).toHaveLength(0)
    }
  })

  it('never asserts missing skills over an incomplete skill snapshot', async () => {
    const fx = await fixture({ skills: { skills: ['review'], complete: false } })
    const message = enterMessages(await dispatch(fx))[0]
    if (message === undefined) throw new Error('missing catalog message')

    expect(message.source).toMatchObject({ kind: 'agents-catalog', incomplete: true })
    expect(textOf(message)).toContain('Discovery is incomplete')
    expect(textOf(message)).not.toContain('missing preset skills')
  })

  it('flags incomplete discovery when an agent diagnostic hides an entry', async () => {
    const fx = await fixture({ looseDocument: true })
    const message = enterMessages(await dispatch(fx))[0]
    if (message === undefined) throw new Error('missing catalog message')

    expect(message.source).toMatchObject({ incomplete: true })
    expect(textOf(message)).toContain('Discovery is incomplete')
    expect(textOf(message)).not.toContain('- \`loose\`')
  })

  it('leaves the decision untouched and warns once when a host probe fails', async () => {
    const fx = await fixture()
    fx.tools.fail = true

    expect(enterMessages(await dispatch(fx))).toHaveLength(0)
    expect(fx.warn).toHaveBeenCalledTimes(1)
  })

  it('logs one summary warning even when a cwd fallback and a later probe both fail', async () => {
    const fx = await fixture({ workingDirectory: 'throws' })
    fx.tools.fail = true

    expect(enterMessages(await dispatch(fx))).toHaveLength(0)
    expect(fx.warn).toHaveBeenCalledTimes(1)
  })

  it('propagates cancellation instead of swallowing it', async () => {
    const fx = await fixture()
    const controller = new AbortController()
    fx.tools.abort = controller

    await expect(dispatch(fx, { signal: controller.signal })).rejects.toThrow('tools aborted')
    expect(fx.warn).not.toHaveBeenCalled()
  })

  it('drops or replaces a catalog already present in the step batch', async () => {
    const fx = await fixture()
    const first = enterMessages(await dispatch(fx))[0]
    if (first === undefined) throw new Error('missing catalog message')

    expect(enterMessages(await dispatch(fx, { messages: [first] }))).toHaveLength(0)

    fx.tools.value = ['read', 'bash', 'lint']
    const replaced = enterMessages(await dispatch(fx, { messages: [first] }))

    expect(replaced).toHaveLength(1)
    expect(replaced[0]?.id).not.toBe(first.id)
    expect(replaced[0]?.source).toMatchObject({ update: true })
  })

  it('falls back to the session cwd when the working-directory service is absent', async () => {
    const fx = await fixture({ workingDirectory: 'absent', preset: false })
    const message = enterMessages(await dispatch(fx))[0]
    if (message === undefined) throw new Error('missing catalog message')

    expect(textOf(message)).toContain('- \`alpha\`')
    expect(textOf(message)).not.toContain('Current mode:')
  })

  it('falls back to the session cwd when the working-directory service throws', async () => {
    const fx = await fixture({ workingDirectory: 'throws' })
    const message = enterMessages(await dispatch(fx))[0]
    if (message === undefined) throw new Error('missing catalog message')

    expect(textOf(message)).toContain('- \`alpha\`')
    expect(fx.warn).toHaveBeenCalledTimes(1)
    expect(fx.warn).toHaveBeenCalledWith(expect.stringContaining('working directory unavailable'))
  })

  it('scans user-global only when neither the service nor the header names a cwd', async () => {
    const fx = await fixture({ workingDirectory: 'absent', header: { cwd: undefined } })
    const message = enterMessages(await dispatch(fx))[0]
    if (message === undefined) throw new Error('missing catalog message')

    expect(textOf(message)).not.toContain('- \`alpha\`')
    expect(textOf(message)).toContain('- \`default\`')
  })

  it('never renders a real provider/model from an alias target or a raw chain', async () => {
    const fx = await fixture({ rawDocument: true })
    const message = enterMessages(await dispatch(fx))[0]
    if (message === undefined) throw new Error('missing catalog message')
    const text = textOf(message)
    const source = JSON.stringify(message.source)

    expect(text).toContain('- `gamma` (Gamma) — Raw model chain')
    for (const secret of ['deepseek', 'alt-model', 'vendor', 'raw-model']) {
      expect(text).not.toContain(secret)
      expect(source).not.toContain(secret)
    }
  })

  it('flags incomplete discovery when an alias layer is dropped', async () => {
    const fx = await fixture({ brokenRegistryLayer: true })
    const message = enterMessages(await dispatch(fx))[0]
    if (message === undefined) throw new Error('missing catalog message')

    expect(message.source).toMatchObject({ incomplete: true })
    expect(textOf(message)).toContain('Discovery is incomplete')
    expect(textOf(message)).toContain('- `fast`')
    expect(textOf(message)).not.toContain('- `broken`')
  })

  it('omits missing-skill warnings when the skills service is absent', async () => {
    const fx = await fixture({ skills: false })
    const message = enterMessages(await dispatch(fx))[0]
    if (message === undefined) throw new Error('missing catalog message')

    expect(textOf(message)).not.toContain('missing preset skills')
    expect(message.source).not.toMatchObject({ incomplete: true })
    // The tool warning still comes from the surface that does exist.
    expect(textOf(message)).toContain('missing tools: `lint`')
  })

  it('keeps advisory agent diagnostics visible without marking the catalog incomplete', async () => {
    const fx = await fixture({ advisoryDocument: true })
    const message = enterMessages(await dispatch(fx))[0]
    if (message === undefined) throw new Error('missing catalog message')

    expect(textOf(message)).toContain('- `advisable` (Advisable)')
    expect(textOf(message)).not.toContain('Discovery is incomplete')
    expect(message.source).not.toMatchObject({ incomplete: true })
  })

  it('publishes a clearing message when a visible catalog becomes empty', async () => {
    const ctx = new Context()
    const emptyAgents = {
      list: async () => [],
      get: async () => undefined,
      diagnostics: async () => [],
      invalidate: () => {},
    } as unknown as AgentRegistry
    const emptyAliases = {
      snapshot: async () => ({ models: [], aliases: [] }),
      getAlias: async () => undefined,
      getModel: async () => undefined,
      diagnostics: async () => [],
      invalidate: () => {},
    } as unknown as AliasRegistry
    installAgentCatalog(ctx, { agentRegistry: emptyAgents, aliasRegistry: emptyAliases, warn: () => {} })

    // The bundled default keeps the production catalog non-empty today; this
    // direct listener mount pins the clearing branch the spec still requires.
    const visible = createCatalogMessage({
      snapshot: projectCatalog({ agents: [agentInput()], aliases: [], incomplete: false }),
      update: false,
      id: 'visible-catalog',
    })
    const history: CatalogHostMessage[] = [visible]
    const session: CatalogHostSession = {
      header: { cwd: '/tmp/catalog-fixture' },
      deriveMessages: () => history,
    }
    const agent: CatalogHostAgent = { id: 'agent-empty', ctx, session }

    const decision = await ctx.waterfall('agent/pre-step', {
      agent,
      messages: [],
      turn: 1,
      step: 1,
      signal: new AbortController().signal,
      modelSelection: { provider: 'test', model: 'test' },
    }, async () => ({ kind: 'enter', messages: [] }))

    expect(enterMessages(decision)).toHaveLength(1)
    const message = enterMessages(decision)[0]
    if (message === undefined) throw new Error('missing clearing message')
    expect(message.source).toMatchObject({ kind: 'agents-catalog', update: true, entries: [] })
    expect(textOf(message)).toContain('No expert agents or model aliases are currently available.')
    expect(textOf(message)).toContain('do not use names from earlier catalogs')
  })
})