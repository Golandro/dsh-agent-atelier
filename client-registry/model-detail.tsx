/**
 * 模型条目详情正文（票 66）：可用开关、被别名指向 / fan-in、触达 agent、
 * sysPrompt 预览、删除门禁与新增表单。
 *
 * 只渲染宿主已解析的快照与页面传入的写状态；所有判定走 model-detail.ts 的
 * 纯函数，所有落盘走页面的单一写通道（票 62）。本文件不建样式，类名由主
 * bundle 的 styles.css 认领。
 */
import { createElement as h, Fragment } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import type { PanelFocus, RegistryDestination } from '../src/dsh/client/chunk-contracts.ts'
import type { ControlSnapshot } from '../src/control/index.ts'
import type { ModelRow, RegistrySpace } from './registry-model.ts'
import { registryLayerLabel } from './registry-model.ts'
import { rowPathLabel } from './model-links.ts'
import { Fact } from './alias-detail.tsx'
import {
  availabilityFactsOf,
  deleteGateOf,
  fanInOthersOf,
  modelPromptOf,
  writeHeadlineOf,
  writeLinesOf,
  writeToneOf,
} from './model-detail.ts'

import type {
  AddModelCheck,
  AddModelDraft,
  AddModelProblem,
  ModelAvailabilityFacts,
  ModelDeleteGate,
  ModelWriteUi,
} from './model-detail.ts'

export interface ModelDetailBodyProps {
  readonly snapshot: ControlSnapshot
  readonly row: ModelRow
  readonly space: RegistrySpace
  /** 空间展示词（调用方从 model-links 的 spaceLabel 传下来，避免循环 import）。 */
  readonly spaceName: string
  readonly write?: ModelWriteUi | undefined
  readonly writeBusy?: boolean | undefined
  readonly deleteConfirm: boolean
  readonly onToggleAvailable?: ((available: boolean) => void) | undefined
  readonly onRequestDelete?: (() => void) | undefined
  readonly onConfirmDelete?: (() => void) | undefined
  readonly onCancelDelete?: (() => void) | undefined
  readonly onRequestFocus?: ((focus: PanelFocus, destination?: RegistryDestination) => void) | undefined
}

/** 模型详情的全部正文；调用方只负责标题栏。 */
export function ModelDetailBody(props: ModelDetailBodyProps): ReactNode {
  const row = props.row
  const facts = availabilityFactsOf(props.snapshot, row)
  const gate = deleteGateOf(row)
  return h(
    'div',
    { className: 'model-detail-model' },
    h(
      'dl',
      { className: 'model-facts' },
      h(Fact, { label: '空间' }, props.spaceName + ' · ' + registryLayerLabel(row.source)),
      h(Fact, { label: '文件' }, h('code', null, rowPathLabel(row))),
      h(Fact, { label: '路线' }, h('code', null, row.route), row.route === row.effectiveRoute ? null : h('span', { className: 'dim' }, ' · 生效 ' + row.effectiveRoute)),
      h(Fact, { label: '层关系' }, row.layer.label === '' ? '无同名冲突' : row.layer.label),
      h(Fact, { label: '声明值' }, h('span', { className: 'tag ' + (facts.declared ? 'tag-ok' : 'tag-warn') }, facts.declared ? '可用' : '停用'), h('span', { className: 'dim' }, ' · ' + registryLayerLabel(facts.declaredLayer) + (facts.declaredPath === undefined ? '' : ' · ' + facts.declaredPath))),
      h(Fact, { label: '生效值' }, h('span', { className: 'tag ' + (facts.effective ? 'tag-ok' : 'tag-warn') }, facts.effective ? '可用' : '停用'), h('span', { className: 'dim' }, ' · 合并后 · ' + registryLayerLabel(facts.effectiveLayer))),
      h(Fact, { label: '组' }, h('code', null, facts.group), facts.group === row.name ? h('span', { className: 'dim' }, '（默认：自身条目名）') : null, facts.folded ? h('span', { className: 'tag tag-warn' }, '组级停用') : null),
    ),
    h(WriteFeedback, { write: props.write }),
    h(AvailabilitySection, {
      row,
      facts,
      writeBusy: props.writeBusy,
      onToggleAvailable: props.onToggleAvailable,
    }),
    h(AliasesSection, { row, onRequestFocus: props.onRequestFocus }),
    h(FanInSection, { row, onRequestFocus: props.onRequestFocus }),
    h(ReachSection, { row, onRequestFocus: props.onRequestFocus }),
    h(PromptSection, { row, onRequestFocus: props.onRequestFocus }),
    h(DeleteSection, {
      row,
      gate,
      deleteConfirm: props.deleteConfirm,
      writeBusy: props.writeBusy,
      onRequestDelete: props.onRequestDelete,
      onConfirmDelete: props.onConfirmDelete,
      onCancelDelete: props.onCancelDelete,
    }),
  )
}

/* ── 可用开关 ─────────────────────────────────────────────────────── */

interface AvailabilitySectionProps {
  readonly row: ModelRow
  readonly facts: ModelAvailabilityFacts
  readonly writeBusy?: boolean | undefined
  readonly onToggleAvailable?: ((available: boolean) => void) | undefined
}

function AvailabilitySection(props: AvailabilitySectionProps): ReactNode {
  const disabled = !props.facts.editable || props.writeBusy === true || props.onToggleAvailable === undefined
  return h(
    'section',
    { className: 'detail-sec model-avail' },
    h('h5', { className: 'detail-sec-title' }, '可用开关（available）'),
    h(
      'div',
      { className: 'model-avail-row' },
      h(
        'label',
        { className: 'model-avail-toggle' },
        h('input', {
          type: 'checkbox',
          role: 'switch',
          checked: props.facts.declared,
          disabled,
          'data-model-available': props.row.name,
          'aria-label': '本条 available 开关 ' + props.row.name,
          onChange: (event: ChangeEvent<HTMLInputElement>) => props.onToggleAvailable?.(event.target.checked),
        }),
        '本条声明可用',
      ),
      h('span', { className: 'tag ' + (props.facts.effective ? 'tag-ok' : 'tag-warn') }, '生效：' + (props.facts.effective ? '可用' : '停用')),
    ),
    h(
      'p',
      { className: 'dim model-avail-note' },
      '声明层：' + registryLayerLabel(props.facts.declaredLayer) +
        (props.facts.declaredPath === undefined ? '' : ' · ' + props.facts.declaredPath) +
        '；开关写这一层。',
    ),
    availabilityNotes(props),
  )
}

function availabilityNotes(props: AvailabilitySectionProps): ReactNode {
  const facts = props.facts
  const switches = [
    facts.folded
      ? h(
          'p',
          { key: 'folded', className: 'model-avail-warn', role: 'alert' },
          '组级停用：' + facts.group + ' 组内 ' +
            (facts.triggers.length === 0 ? '条目' : facts.triggers.join(' / ')) +
            ' 声明 available:false，宿主已把整组折成停用；本条开关只改自己的声明，整组开关归票 67。',
        )
      : null,
    facts.readOnly
      ? h('p', { key: 'read-only', className: 'dim model-avail-note' }, '内置 / 合成条目只读：没有文件，也不能改 available。')
      : null,
    !facts.readOnly && !facts.editable
      ? h(
          'p',
          { key: 'covered', className: 'model-avail-warn' },
          '本条声明被 ' + registryLayerLabel(facts.effectiveLayer) + ' 接管；生效值来自该层，编辑 available 请切到合并视图。',
        )
      : null,
    props.onToggleAvailable === undefined
      ? h('p', { key: 'no-handler', className: 'dim model-avail-note' }, '当前没有接入写通道，开关只读。')
      : null,
  ]
  return h(Fragment, null, ...switches.filter((entry) => entry !== null))
}

/* ── 别名引用 / fan-in / 触达 ────────────────────────────────────── */

interface JumpProps {
  readonly row: ModelRow
  readonly onRequestFocus?: ModelDetailBodyProps['onRequestFocus']
}

function AliasesSection(props: JumpProps): ReactNode {
  const aliases = props.row.aliases
  return h(
    'section',
    { className: 'detail-sec' },
    h('h5', { className: 'detail-sec-title' }, '指向本条目的别名（×' + String(aliases.length) + '）'),
    aliases.length === 0
      ? h('p', { className: 'dim' }, '没有别名指向这个条目名。')
      : h('div', { className: 'alias-chips' }, aliases.map((alias) => h(
          'button',
          {
            key: alias.alias,
            type: 'button',
            className: 'btn btn-sm alias-chip',
            title: registryLayerLabel(alias.source),
            'data-jump': 'alias',
            'aria-label': '在模型关联页定位别名 ' + alias.alias,
            onClick: () => props.onRequestFocus?.({ kind: 'alias', name: alias.alias }, 'models'),
          },
          alias.alias,
        ))),
  )
}

function FanInSection(props: JumpProps): ReactNode {
  const others = fanInOthersOf(props.row)
  return h(
    'section',
    { className: 'detail-sec' },
    h('h5', { className: 'detail-sec-title' }, '同线路别名（fan-in）'),
    others.length === 0
      ? h('p', { className: 'dim' }, '没有其它别名指向同一线路。')
      : h('div', { className: 'alias-chips' }, others.map((alias) => h(
          'button',
          {
            key: alias.alias,
            type: 'button',
            className: 'btn btn-sm alias-chip',
            title: registryLayerLabel(alias.source),
            'data-jump': 'alias',
            'aria-label': '在模型关联页定位别名 ' + alias.alias,
            onClick: () => props.onRequestFocus?.({ kind: 'alias', name: alias.alias }, 'models'),
          },
          alias.alias,
        ))),
  )
}

function ReachSection(props: JumpProps): ReactNode {
  const reach = props.row.reach
  return h(
    'section',
    { className: 'detail-sec' },
    h('h5', { className: 'detail-sec-title' }, '触达 Agent（×' + String(reach.length) + '）'),
    reach.length === 0
      ? h('p', { className: 'dim' }, '没有 agent 经别名触达这个条目。')
      : h(
          'div',
          { className: 'model-reach' },
          reach.map((entry) => h(
            'div',
            { key: entry.agent, className: 'model-reach-row' },
            h(
              'button',
              {
                type: 'button',
                className: 'btn btn-sm alias-chip',
                'data-jump': 'agent',
                'aria-label': '在智能体列表定位 ' + entry.agent,
                onClick: () => props.onRequestFocus?.({ kind: 'agent', name: entry.agent }),
              },
              entry.agent,
            ),
            h('span', { className: 'model-reach-via' }, '经 ' + entry.via.join(' / ')),
          )),
        ),
    h('p', { className: 'dim model-avail-note' }, '可达面按合并生效快照求值（含同线路 fan-in 别名）；链诊断由别名详情的 A2 读面提供，点上方别名查看。'),
  )
}

/* ── sysPrompt 预览 ─────────────────────────────────────────────── */

function PromptSection(props: JumpProps): ReactNode {
  const prompt = modelPromptOf(props.row)
  return h(
    'section',
    { className: 'detail-sec' },
    h('h5', { className: 'detail-sec-title' }, '系统提示词（sysPrompt）'),
    prompt === undefined
      ? h('p', { className: 'dim' }, '本条目没有声明 sysPrompt，不注入额外提示词。')
      : h('pre', { className: 'model-prompt', 'data-model-prompt': props.row.name }, prompt),
    props.row.source === props.row.effective.source
      ? null
      : h('p', { className: 'dim model-avail-note' }, '预览取运行时生效值（' + registryLayerLabel(props.row.effective.source) + '）；本层声明 ' + registryLayerLabel(props.row.source) + '。'),
    h(
      'button',
      {
        type: 'button',
        className: 'btn btn-sm alias-jump',
        'data-jump': 'prompt',
        'aria-label': '在系统提示词页定位模型条目 ' + props.row.name,
        onClick: () => props.onRequestFocus?.({ kind: 'model', name: props.row.name }, 'prompts'),
      },
      '去系统提示词页',
    ),
    h('p', { className: 'dim model-avail-note' }, '预览只读；编辑与拼装顺序归系统提示词页（票 68）。'),
  )
}

/* ── 删除门禁 ─────────────────────────────────────────────────────── */

interface DeleteSectionProps {
  readonly row: ModelRow
  readonly gate: ModelDeleteGate
  readonly deleteConfirm: boolean
  readonly writeBusy?: boolean | undefined
  readonly onRequestDelete?: (() => void) | undefined
  readonly onConfirmDelete?: (() => void) | undefined
  readonly onCancelDelete?: (() => void) | undefined
}

function DeleteSection(props: DeleteSectionProps): ReactNode {
  return h(
    'section',
    { className: 'detail-sec model-delete' },
    h('h5', { className: 'detail-sec-title' }, '删除条目'),
    deleteBody(props),
  )
}

function deleteBody(props: DeleteSectionProps): ReactNode {
  const gate = props.gate
  if (gate.block !== undefined) {
    return h(
      Fragment,
      null,
      h('p', { className: gate.block === 'referenced' ? 'model-avail-warn' : 'dim' }, gate.reason ?? '不能删除。'),
      gate.block === 'referenced' ? referenceList(gate) : null,
    )
  }
  return h(
    Fragment,
    null,
    gate.refs.length === 0
      ? h('p', { className: 'dim' }, '没有别名引用这个条目。')
      : referenceList(gate),
    gate.takeover === undefined
      ? null
      : h('p', { className: 'dim model-avail-note' }, '删除后由下层接管：' + registryLayerLabel(gate.takeover.source) + ' · ' + (gate.takeover.path ?? '（无文件）') + '。'),
    gate.file === undefined ? null : h('p', { className: 'dim model-avail-note' }, '写入文件：' + gate.file),
    props.onRequestDelete === undefined
      ? h('p', { className: 'dim model-avail-note' }, '当前没有接入写通道，删除只读。')
      : h(
          'button',
          {
            type: 'button',
            className: 'btn btn-sm model-delete-btn',
            'data-model-delete': props.row.name,
            disabled: props.writeBusy === true,
            onClick: props.onRequestDelete,
          },
          '删除条目',
        ),
    props.deleteConfirm
      ? h(
          'div',
          { className: 'model-delete-confirm', role: 'group', 'aria-label': '删除确认' },
          h('p', null, '确认删除 ' + props.row.name + '？'),
          gate.takeover === undefined
            ? null
            : h('p', { className: 'dim' }, '删除后由下层接管：' + registryLayerLabel(gate.takeover.source) + ' · ' + (gate.takeover.path ?? '（无文件）') + '。'),
          h('p', { className: 'dim' }, '引用列表：' + (gate.refs.length === 0 ? '无' : gate.refs.map((alias) => alias.alias).join('、'))),
          h('p', { className: 'dim' }, '写入文件：' + (gate.file ?? '（无文件）')),
          h(
            'div',
            { className: 'model-delete-actions' },
            h(
              'button',
              {
                type: 'button',
                className: 'btn btn-sm model-delete-btn',
                'data-model-delete-confirm': props.row.name,
                disabled: props.writeBusy === true || props.onConfirmDelete === undefined,
                onClick: props.onConfirmDelete,
              },
              '确认删除',
            ),
            h('button', { type: 'button', className: 'btn btn-sm', onClick: props.onCancelDelete }, '取消'),
          ),
        )
      : null,
  )
}

function referenceList(gate: ModelDeleteGate): ReactNode {
  return h(
    Fragment,
    null,
    h('p', { className: 'dim' }, '引用列表（别名 ×' + String(gate.refs.length) + '）'),
    h(
      'div',
      { className: 'alias-chips' },
      gate.refs.map((alias) => h(
        'button',
        {
          key: alias.alias,
          type: 'button',
          className: 'btn btn-sm alias-chip',
          'data-model-ref': alias.alias,
          title: registryLayerLabel(alias.source),
          disabled: true,
        },
        alias.alias,
      )),
    ),
  )
}

/* ── 新增模型条目 ────────────────────────────────────────────────── */

export interface AddModelFormProps {
  readonly spaceName: string
  readonly draft: AddModelDraft
  readonly check: AddModelCheck
  readonly write?: ModelWriteUi | undefined
  readonly writeBusy?: boolean | undefined
  readonly onDraftChange?: ((patch: Partial<AddModelDraft>) => void) | undefined
  readonly onSubmit?: (() => void) | undefined
  readonly onCancel?: (() => void) | undefined
}

export function AddModelForm(props: AddModelFormProps): ReactNode {
  const canWrite = props.check.canSubmit && props.writeBusy !== true && props.onSubmit !== undefined
  return h(
    'section',
    { className: 'detail-sec model-add', 'data-model-add': props.draft.name },
    h('h5', { className: 'detail-sec-title' }, '新增模型条目'),
    props.check.target === undefined
      ? null
      : h(
          'p',
          { className: 'dim model-add-target' },
          '写入 ' + props.check.target.label + (props.check.target.path === undefined ? '' : ' · ' + props.check.target.path),
        ),
    h('p', { className: 'dim model-avail-note' }, '新增写入当前空间：' + props.spaceName + '；合并视图落工作区层，当前空间没有可写层时禁写。'),
    h(AddField, { label: '条目名', value: props.draft.name, ariaLabel: '模型条目名', onChange: (value) => props.onDraftChange?.({ name: value }) }),
    h(AddField, { label: 'provider', value: props.draft.provider, ariaLabel: 'provider', onChange: (value) => props.onDraftChange?.({ provider: value }) }),
    h(AddField, { label: 'model', value: props.draft.model, ariaLabel: 'model', onChange: (value) => props.onDraftChange?.({ model: value }) }),
    h(
      'label',
      { className: 'model-add-field' },
      h('span', { className: 'model-add-label' }, 'sysPrompt（可空）'),
      h('textarea', {
        className: 'input model-add-prompt',
        rows: 3,
        value: props.draft.sysPrompt,
        'aria-label': 'sysPrompt',
        onChange: (event: ChangeEvent<HTMLTextAreaElement>) => props.onDraftChange?.({ sysPrompt: event.target.value }),
      }),
    ),
    h(
      'label',
      { className: 'model-add-check' },
      h('input', {
        type: 'checkbox',
        checked: props.draft.available,
        'aria-label': '新条目 available',
        onChange: (event: ChangeEvent<HTMLInputElement>) => props.onDraftChange?.({ available: event.target.checked }),
      }),
      'available（默认启用）',
    ),
    h(ProblemList, { problems: props.check.problems }),
    h(
      'div',
      { className: 'model-add-actions' },
      h('button', { type: 'button', className: 'btn btn-sm', onClick: props.onCancel }, '取消'),
      h(
        'button',
        {
          type: 'button',
          className: 'btn btn-sm btn-primary',
          'data-model-add-submit': props.draft.name,
          disabled: !canWrite,
          onClick: props.onSubmit,
        },
        props.check.target === undefined ? '写入不可用' : '写入 ' + props.check.target.label,
      ),
    ),
    h(WriteFeedback, { write: props.write }),
  )
}

interface AddFieldProps {
  readonly label: string
  readonly value: string
  readonly ariaLabel: string
  readonly onChange: (value: string) => void
}

function AddField(props: AddFieldProps): ReactNode {
  return h(
    'label',
    { className: 'model-add-field' },
    h('span', { className: 'model-add-label' }, props.label),
    h('input', {
      className: 'input',
      value: props.value,
      'aria-label': props.ariaLabel,
      onChange: (event: ChangeEvent<HTMLInputElement>) => props.onChange(event.target.value),
    }),
  )
}

function ProblemList(props: { readonly problems: readonly AddModelProblem[] }): ReactNode {
  if (props.problems.length === 0) return null
  return h(
    'ul',
    { className: 'model-add-problems' },
    props.problems.map((problem) => h('li', { key: problem.field + problem.message, 'data-problem': problem.field }, problem.message)),
  )
}

/* ── 写结果反馈 ─────────────────────────────────────────────────── */

function WriteFeedback(props: { readonly write?: ModelWriteUi | undefined }): ReactNode {
  const write = props.write
  if (write === undefined || write.status === 'idle') return null
  if (write.status === 'writing') {
    return h('div', { className: 'model-write', role: 'status', 'data-model-write': 'writing' }, '正在写入：' + write.label + '…')
  }
  if (write.status === 'error') {
    return h(
      'div',
      { className: 'model-write model-write-err', role: 'alert', 'data-model-write': 'error' },
      '写入失败：' + write.message,
    )
  }
  const tone = writeToneOf(write.outcome)
  return h(
    'div',
    {
      className: 'model-write model-write-' + tone,
      role: tone === 'ok' ? 'status' : 'alert',
      'data-model-write': tone,
    },
    h('div', { className: 'model-write-head' }, writeHeadlineOf(write.outcome)),
    h(
      'ul',
      { className: 'model-write-lines' },
      writeLinesOf(write.outcome).map((line, index) => h('li', { key: index, className: 'model-write-line model-write-line-' + line.tone }, line.text)),
    ),
  )
}
