# 0005 — 序列化唯一实现＝yaml-scalar 文本手术，raw 往返为唯一真相源

写面（票 11）不做第二套 YAML 模型：读（`splitAgentFence` / `parseAgentDocument`）与写（`applyFrontmatterField` 字段编译器、registry 层手术）共用 `src/core/catalog/yaml-scalar.ts` 的行拼接（line-splice）文本手术；D14 逐字节往返（注释、未知键、键序、CRLF 保留）是唯一真相源。字段表单只是「生成原文编辑」的编译器（Q5=A+B 裁决），不引入平行数据路径。`js-yaml` / `zod` 依 2026-10-17 裁决保留在 `dependencies` 但标注 reserved，`src/` 不 import（check.mjs 矩阵强制；新增外部运行时 import 须先修订矩阵规则）。v1 落点：frontmatter 编译器不变式（结果 `''` 或以 `\n` 结尾）；plain 文档 ＋ 字段编辑 ⇒ 合成 `---\n` ＋ 文本 ＋ `---\n`；registry 手术前后各验一次 `readRegistryLayer`，坏层整体拒绝、绝不半写。

## Considered Options

- **js-yaml dump ＋ parse**：再序列化丢注释与键序、改写引号风格，D14 往返不成立；完整 YAML 解析留给未来转换器（票 14）需要时再议。
- **字段表单为第二真相源（原型 `serializeFrontmatter` 路线）**：不转义、丢注释与键序、不可往返（票 11 诊断记录「序列化不可往返」）；违反 Q5 裁决，拒绝。
- **两份实现按字段分工**：任何字段存在两种写法必然漂移（原型三份模板行语法、三处分隔行规则的教训）；只留一份。

## Consequences

- 手术只动目标行：单字段编辑 O(行数)，不重排任何其他字节；代价是不理解完整 YAML——锚点、多文档等构造本就不是 agent 文档的合法输入（读器已拒）。
- 写面永远与既有读者配对：`src/control` 依赖 `src/core` 的 `parseAgentDocument` / `readRegistryLayer` 做写前写后验证，不许独立演化出第二份解析语义。
- 原子性归 core 一处（`src/control/writes.ts` 的 `atomicWriteFile`：`ensureDirectory` → `writeNewFile`（wx、`0600`）→ `renameFile` → 写后重读），in-memory 与 Node 两个写适配器同走 `ControlFileSystem` 端口，temp 名的唯一性是适配器的业务。
