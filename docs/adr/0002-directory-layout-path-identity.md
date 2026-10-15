# 0002 — agent 采用目录制布局，身份来自路径而非 frontmatter

agent 的唯一合法形状是 `<发现根>/<agent-name>/<agent-name>.agent.md`：一个目录一个 agent，目录名（小写 kebab `[a-z0-9]+(-[a-z0-9]+)*`，保留字 `default`）就是寻址键与跨层去重键；frontmatter 的 `id` 字段废弃，显示名 `name` 缺省回退目录名。原生 skills 允许平铺 `<name>.md`，agent 刻意不跟随：路径身份让「文件在哪」与「叫什么名」永远一致，消灭文件名/frontmatter 二义；目录为未来扩展（每 agent 局部资源）留位；文档名前缀提供目录↔文档一致性校验。

## Consequences

- 从 skills 平铺习惯迁移的用户会踩坑：根下可疑平铺文件产出 `misplaced-file` 诊断并提示正确形状。
- frontmatter `id` 成为历史字段：出现即 `unexpected-id` 诊断，值按原文进 `extra` 保留（UI 回写不丢）。
- 无 frontmatter 块的合规命名文档仍是合法 agent（全字段默认）——文档名匹配已确立意图。
