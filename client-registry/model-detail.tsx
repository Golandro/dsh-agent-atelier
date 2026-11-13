/**
 * 模型条目详情正文（票 66 / 67）：可用开关、组成员与整组动作、被别名指向 /
 * fan-in、触达 agent、sysPrompt 预览、删除门禁与新增表单。
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
import { rowPathLabel, sourceTagClass } from './model-links.ts'
import { Fact } from './alias-detail.tsx'
import {
  availabilityFactsOf,
  deleteGateOf,
  fanInOthersOf,
  groupTogglePlanOf,
  modelGroupFactsOf,
  modelPromptOf,
  writeHeadlineOf,
  writeLinesOf,
  writeToneOf,
} from './model-detail.ts'

import type {
  AddModelCheck,
  AddModelDraft,
  AddModelProblem,
  GroupMemberFacts,
  ModelAvailabilityFacts,
  ModelDeleteGate,
  ModelGroupAction,
  ModelGroupFacts,
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
  /** 整组关闭 / 开启。 */
  readonly onToggleGroup?: ((action: ModelGroupAction) => void) | undefined
  readonly onRequestDelete?: (() => void) | undefined
  readonly onConfirmDelete?: (() => void) | undefined
  readonly onCancelDelete?: (() => void) | undefined
  readonly onRequestFocus?: ((focus: PanelFocus, destination?: RegistryDestination) => void) | undefined
}

/** 模型详情的全部正文；调用方只负责标题栏。 */
export function ModelDetailBody(props: ModelDetailBodyProps): ReactNode {
  const row = props.row
  const facts = availabilityFactsOf(row)
  const group = modelGroupFactsOf(props.snapshot, props.space, row)
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
      h(Fact, { label: '组' },
        h('code', null, facts.group),
        facts.group === row.name ? h('span', { className: 'dim' }, '（默认：自身条目名）') : null,
        facts.folded ? h('span', { className: 'tag tag-warn' }, '组级停用') : null,
      ),
    ),
    h('p', { className: 'dim model-avail-note', 'data-group-hint': facts.group }, '池内混用不同 modelGroup 的提示（pool-mixed-groups）归别名诊断；本页只按 modelGroup 归组，不重复告警。'),
    h(WriteFeedback, { write: props.write }),
    h(AvailabilitySection, {
      row,
      facts,
      triggers: group.triggers,
      writeBusy: props.writeBusy,
      onToggleAvailable: props.onToggleAvailable,
    }),
    h(GroupSection, {
      group,
      rowName: row.name,
      writeBusy: props.writeBusy,
      onToggleGroup: props.onToggleGroup,
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
  /** 组内声明 false 的条目：折叠的唯一解释，与组成员区同源。 */
  readonly triggers: readonly string[]
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
            (props.triggers.length === 0 ? '条目' : props.triggers.join(' / ')) +
            ' 声明 available:false，宿主已把整组折成停用；本条开关只改自己的声明，整组动作见下方组成员区。',
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

/* ── 组成员与整组开关 ─────────────────────────────────────────────── */

interface GroupSectionProps {
  readonly group: ModelGroupFacts
  readonly rowName: string
  readonly writeBusy?: boolean | undefined
  readonly onToggleGroup?: ((action: ModelGroupAction) => void) | undefined
}

/**
 * 组成员与整组动作。折叠归宿主；这里只展示成员、层与触发者，并把整组
 * 关闭 / 开启落成一批 setAvailable（可写范围按当前空间收敛）。
 */
function GroupSection(props: GroupSectionProps): ReactNode {
  const group = props.group
  if (group.members.length <= 1) return null
  const action: ModelGroupAction = group.available ? 'close' : 'open'
  const plan = groupTogglePlanOf(group, action)
  const disabled = plan.blocked !== undefined || props.writeBusy === true || props.onToggleGroup === undefined
  const count = plan.edits.length
  const verb = action === 'close' ? '整组关闭' : '整组开启'
  const label = count === 0 ? verb : verb + '（写 ' + String(count) + ' 条）'
  return h(
    'section',
    { className: 'detail-sec model-group', 'data-model-group': group.name },
    h('h5', { className: 'detail-sec-title' }, '组成员（×' + String(group.members.length) + '）'),
    h(
      'p',
      { className: 'dim model-avail-note' },
      '同一 modelGroup 任一条目声明 available:false ⇒ 整组停用；折叠由宿主在装载期完成，本页只展示，不再判一遍。',
    ),
    h(
      'div',
      { className: 'model-group-list' },
      group.members.map((member) => h(GroupMemberRow, {
        key: member.name,
        member,
        current: member.name === props.rowName,
      })),
    ),
    h(
      'div',
      { className: 'model-group-action-row' },
      h('span', { className: 'tag ' + (group.available ? 'tag-ok' : 'tag-warn') }, '整组' + (group.available ? '可用' : '停用')),
      h(
        'button',
        {
          type: 'button',
          className: 'btn btn-sm',
          'data-model-group-toggle': group.name,
          'data-model-group-action': action,
          disabled,
          onClick: () => props.onToggleGroup?.(action),
        },
        label,
      ),
    ),
    props.writeBusy === true ? h('p', { className: 'dim model-avail-note' }, '写通道在途：等这一批结束再试。') : null,
    plan.blocked === undefined ? null : h('p', { className: 'model-avail-warn', role: 'alert', 'data-group-blocked': group.name }, plan.blocked),
    plan.note === undefined ? null : h('p', { className: 'dim model-avail-note', 'data-group-note': group.name }, plan.note),
    h('p', { className: 'dim model-avail-note' }, '整组动作是一批写入（逐笔串行）：关闭给组内可写且可用的条目各写一条 available:false，开启清掉可写的 false 声明；只改本条请用上方单条开关。'),
    props.onToggleGroup === undefined
      ? h('p', { className: 'dim model-avail-note' }, '当前没有接入写通道，整组动作只读。')
      : null,
  )
}

interface GroupMemberRowProps {
  readonly member: GroupMemberFacts
  readonly current: boolean
}

function GroupMemberRow(props: GroupMemberRowProps): ReactNode {
  const member = props.member
  const declared = member.declaredAvailable
  const foldTag = member.trigger
    ? h('span', { className: 'tag tag-warn', 'data-group-trigger': member.name }, '折叠触发')
    : declared === true && !member.effective
      ? h('span', { className: 'tag tag-warn' }, '被组折叠')
      : null
  return h(
    'div',
    { className: 'model-group-row', 'data-group-member': member.name },
    h(
      'span',
      { className: 'model-group-name' },
      h('code', null, member.name),
      props.current ? h('span', { className: 'dim' }, ' · 本条') : null,
    ),
    h('code', { className: 'model-group-route' }, member.route),
    h('span', { className: 'tag ' + sourceTagClass(member.declaredLayer) }, registryLayerLabel(member.declaredLayer)),
    declared === undefined
      ? h('span', { className: 'tag tag-dim' }, '无层声明')
      : h('span', { className: 'tag ' + (declared ? 'tag-ok' : 'tag-warn') }, '声明 ' + (declared ? '可用' : '停用')),
    h('span', { className: 'tag ' + (member.effective ? 'tag-ok' : 'tag-warn') }, '生效 ' + (member.effective ? '可用' : '停用')),
    foldTag,
    h('span', { className: 'tag tag-dim' }, member.readOnly ? '只读' : member.editable ? '本空间可写' : '本空间不可写'),
    member.declaredPath === undefined
      ? null
      : h('span', { className: 'dim model-group-path' }, member.declaredPath),
  )
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
