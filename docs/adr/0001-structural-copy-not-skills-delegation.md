# 0001 — agent 发现采用结构照抄，不委托 ctx.skills

维护者规则是「可创建委托实例则优先委托，否则照抄」。2026-10-14 运行时探针裁决该条件不成立：本包以软链装入 profile，Node 从 realpath（workspace）解析依赖，profile 的 node_modules 不在链上——动态导入 `@deepseek-ai/dsh-skill`、`@deepseek-ai/dsh-skill-filesystem`、`yaml` 全部 `ERR_MODULE_NOT_FOUND`，而零运行时依赖守卫（`scripts/check.mjs`）禁止声明依赖（软链装包缺依赖会装崩 profile row）；原生 `FileSystemSkillProvider` 的 locator 又硬编码 `SKILL.md`/平铺 `*.md` 布局，认不出 agent 文档。因此 agent 发现在本仓自有模块中**照抄原生形状**（根表 + rank 常量 + `{cwd, signal}` 查询 + invalidate），不注册进 `ctx.skills`。

## Considered Options

- 实例化原生 `FileSystemSkillProvider` 复用根枚举：import 不可达 + 布局硬编码，双重不可行。
- 注册自有 SkillProvider 进 `ctx.skills`（以 `invocation.modelInvocable: false` 挡目录）：机制层不提供根/rank 逻辑（那在 provider 内部），agent 字段需 launder 进 skill `metadata`，且 agent 会漏进 skills 读面（skills-manager UI 等）。
- 结构照抄（选定）：保住零运行时依赖与领域隔离，代价是与原生形状的相似性靠约定维持。

## Consequences

- 「尽量委托」降级为「形状镜像」：查询选项、rank 决胜、invalidate 语义与原生 skills 同构，降低双轨漂移；若上游将来开放可导入的发现设施，可重新评估。
