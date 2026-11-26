/**
 * 票 83：活 agent 表。
 *
 * 读面的入参是 `agentName`（atelier 的名字），要装配的却是宿主真的 `Agent`——
 * 只有一处能同时拿到两者：`summon_agent` 的 `agent/created` 监听器里
 * `pending.get(agent.id)` 命中的那条预留（见 `./summon.ts` 的
 * `installRestrictions`）。所以这张表只由那里写，别处一律不猜。
 *
 * 为什么不用 `ctx.agents.list()` + 会话头反推：会话头里的名字是宿主自己的，
 * 不是 atelier 的 `agentName`；拿它去匹配会给出一个看起来成立、实际错位的
 * agent，而读面宁可说「当前没有活跃会话」也不能装配错对象。
 *
 * 表按名字存**强引用**（一个活 Agent 本来就该被会话持有），条目在
 * `agent/disposed` 与宿主行卸载时删除。
 *
 * 它作为宿主内部服务提供（键见 {@link AGENT_LIVE_AGENTS_SERVICE}），刻意不进
 * `src/contract/service-keys.ts`：契约层不该知道活 `Agent` 的存在，这个键只是
 * 本 bundle 两个宿主行之间的交接。
 */

/** 宿主内部服务键：`agentName` → 活 `Agent`。 */
export const AGENT_LIVE_AGENTS_SERVICE = 'agentLiveAgents'

/** 宿主 `ModelSelection` 的结构镜像；只读本模块要用的三个字段。 */
export interface HostModelSelection {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string | undefined
}

/** 宿主 `Agent` 的结构镜像：读面真正会碰到的三样东西。 */
export interface HostLiveAgent {
  /** 宿主自己的会话 id；仅用于诊断。 */
  readonly id: string
  /** 该 Agent 的 scoped context：服务从它读，scope 键就是 Agent 本身。 */
  readonly ctx: { get(name: string): unknown }
  /** 宿主 `AgentModel`；缺席表示这个宿主版本没有这条访问路径。 */
  readonly model?: { current(): Readonly<HostModelSelection> | undefined } | undefined
}

/** 活 agent 表：写侧只有 `summon_agent`，读侧是提示词预览。 */
export interface LiveAgents {
  /** 记下一个刚创建、且本 bundle 知道其 `agentName` 的 Agent。 */
  record(agentName: string, agent: HostLiveAgent): void
  /** 忘掉这个 Agent 的登记；只删指向它自己的条目。 */
  forget(agent: HostLiveAgent): void
  /** 按 atelier 名字取当前活跃的 Agent。 */
  get(agentName: string): HostLiveAgent | undefined
  /** 清空（宿主行卸载时）。 */
  clear(): void
}

/** 建一张空表。 */
export function createLiveAgents(): LiveAgents {
  const table = new Map<string, HostLiveAgent>()
  return {
    record(agentName, agent) {
      table.set(agentName, agent)
    },
    forget(agent) {
      for (const [agentName, recorded] of table) {
        if (recorded === agent) table.delete(agentName)
      }
    },
    get(agentName) {
      return table.get(agentName)
    },
    clear() {
      table.clear()
    },
  }
}
