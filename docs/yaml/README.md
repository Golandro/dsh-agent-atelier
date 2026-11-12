# YAML 共享纯域

状态：**2026-11-12** 落定（分支 `port/settings-ui`）。面向维护者与实现者：读这一页就知道
原始 YAML 文本该在哪里手术、哪些规则只能有一份、加一个 frontmatter 字段要动哪里。

本域只有一件职责：**在原始文本上做行级手术，保留无法识别的字节**。它不解析整份
YAML，不建立数据模型，也不替任何读者决定值语义。agent 文档 frontmatter 与
`registry.yaml` 的读取、编辑，以及 wire 的 frontmatter 字段校验和目录投影，都从
这一份实现派生。

## 为什么只有一个手写实现

- 读面（frontmatter / registry 层）与写面（字段编译器 / registry 编辑）必须看到
  **同一套**引号、注释和 flow 字面量规则。两套实现按字段分工就会漂移；原型里三份
  模板行语法、三处分隔行规则已经是教训。
- 不引入 `js-yaml` 的数据路径。`package.json` 里的 `js-yaml` / `zod` 依 2026-10-17
  依赖裁决保留为 reserved，但 `src/` 不 import；完整 YAML 解析留给未来转换器需要时
  再议（ADR-0005）。
- 用 `js-yaml` 的 `dump` 再序列化会丢注释、丢键序、改写引号风格，D14 的逐字节往返
  就不成立。因此写面不是「先解析成对象再输出」，而是**只替换目标行**的行拼接。
- 守卫的 import 矩阵把 `src/yaml/` 列为独立纯层：只可读 `src/contract/index.ts`，
  不允许 `node:*`、Cordis 或第三方运行时依赖；`core` / `control` / `dsh/host` 只准
  经 `src/yaml/index.ts` 读取它（规则在 `scripts/checklist/matrix.mjs`）。

## 唯一真相源：raw 原文与 byte-exact 往返

- **原文是唯一真相源**：fence 切分（`splitAgentFence`）返回的 `frontmatterText` 是两道 `---` 之间的原始字节
  （含闭合 fence 前那个换行）；组合器（`composeAgentDocument`）原样拼回。D14 的往返
  覆盖注释、未知键、键序与 CRLF。
- **一次编辑只动目标行**：字段编译器替换、插入或删除一条顶层 `key:` 行，连同它
  的缩进块；其他字节不重排。未知键与注释因此自然保留。
- **可写回的编译结果**：编译器只生成读者能读回的标量 / flow 数组形式，必要时加
  双引号转义；不生成第二套模型。
- **包围不变式**：非空 frontmatter 编译结果一定以 `\n` 结尾（空结果才是 `''`），
  因为闭合 fence 需要这个换行。空数组是列表字段的删除，不是写 `key: []`。
- **编辑后验证仍归 core**：写面不独立演化解析语义，落盘前后都用既有读器验证。
  坏层整体拒绝，绝不半写。

## 模块契约

公开入口是 `src/yaml/index.ts`，只 re-export 下面三个模块；跨层读取只走这个入口。

### `src/yaml/lines.ts` —— 行级工具

| 导出 | 契约 |
| --- | --- |
| `KEY_NAME_RE` | 唯一的键名字符集，锚定形式 `^[A-Za-z0-9_.-]+$`；registry 条目名校验也用它。 |
| `indentOf(line)` | 行首空白宽度；制表符按一列计，与既有读器一致。 |
| `isIgnorable(line)` | 空行或整行注释（trim 后以 `#` 开头）。 |
| `splitKeyLine(line)` | 任意缩进的一条 `key:` 行拆成 `{ indent, key, inline }`；不是键行返回 `undefined`，缩进是否合法由调用方判断。 |
| `blockEnd(lines, keyIndex, indent?)` | 键行后缩进块的**排他**结束位置；默认阈值为键行自身缩进，缩进不高于阈值的行（含空行）结束块。registry 条目显式传入条目缩进。 |

这些函数只接收 raw 行，不 trim 语义、不判断键是否已知。

### `src/yaml/scalar.ts` —— 标量规则

| 导出 | 契约 |
| --- | --- |
| `stripComment(text)` | 去掉从 token 起算的 `#` 注释；引号内的 `#` 不动。 |
| `unquote(text)` | 去引号并处理 `\\`、`\"`、`\n`、`\t` 转义；plain 文本原样返回；未闭合引号返回 `undefined`。 |
| `splitTopLevel(text)` | 按顶层逗号切分，尊重引号与嵌套 `[]` / `{}`。 |
| `flowInner(text, open, close)` | 平衡的 `open` / `close` 对内文；闭合符之后只允许注释尾巴；不平衡返回 `undefined`。 |

这些函数只处理一个标量 token 或一个 flow 字面量，不判断布尔、不判断字段形状。

### `src/yaml/frontmatter-fields.ts` —— 可编辑字段表

- `FRONTMATTER_FIELDS`：9 项，顺序固定为 `name`、`description`、`color`、
  `emoji`、`spawn`、`reasoningEffort`、`modelOrder`、`requiredTools`、`skills`；
  每项带 `key` 与 `kind: 'scalar' | 'array'`。这个顺序是用户可见的（wire 错误消息与
  字段编译器沿用），不要按字母重排。
- `FRONTMATTER_FIELD_KEYS`、`SCALAR_FRONTMATTER_FIELDS`、`ARRAY_FRONTMATTER_FIELDS`：
  由表派生，不手写第二份列表。
- `isFrontmatterField(value)`：字符串是否为可编辑字段。
- `frontmatterFieldKind(field)`：该字段是标量还是数组；字段不在表里时 throw。
- 类型层的唯一真相是 `src/contract/types.ts` 的 `FrontmatterField` 联合；本表只补
  运行时事实（scalar / array）与顺序，并 import 该类型。`src/control/types.ts` 继续
  re-export，保持 control 公开面不变。
- `model`（legacy provider/model 链）是读器独有的键，**不在**可编辑字段表里；它不参与
  字段表单，也不从 wire 写入。

## 四个消费者

字段表是「哪些字段可编辑、每个字段是什么形状」的唯一运行时来源。四个消费者派生自
它，不再各写一份列表：

| 消费者 | 落点 | 从表里拿什么 | 不自己做 |
| --- | --- | --- | --- |
| frontmatter 读器 | `src/core/catalog/frontmatter.ts` | 已知键集合与标量 / 数组形状 | 不另写可编辑字段名单；`model` 的映射解析仍留在读器 |
| frontmatter 编译器 | `src/control/frontmatter-edit.ts` | 标量分支、数组分支、未知字段拒绝 | 不另写字段集合；值约束（如 `spawn` 只收 `spawn` / `fork`）留在编译器 |
| wire 白名单 | `src/dsh/host/wire.ts` | 接受的 `field` 列表与错误消息顺序 | 不另外维护 HTTP 字段名单 |
| discovery 投影 | `src/core/catalog/discovery.ts` | 从解析结果投影进 `AgentDefinition` 的字段集合 | 不重命名、不另造投影表 |

`src/core/catalog/registry-file.ts` 也消费 `lines.ts` / `scalar.ts` 的行与标量规则，但**不**消费 frontmatter 字段表：它有独立的 registry schema（`models` / `aliases`），字段集合与 frontmatter 无关。

若某个消费者的 import 图不再经过字段表，那是一次契约回退，不是局部优化。

## 新增一个可编辑字段的检查清单

1. `src/contract/types.ts`：把字段加进 `FrontmatterField` 联合（类型层唯一真相）。
2. `src/yaml/frontmatter-fields.ts`：在 `FRONTMATTER_FIELDS` 里加 `{ key, kind }`；
   位置按用户可见顺序决定，通常追加在末尾。
3. 确认第 2 步已让 `FRONTMATTER_FIELD_KEYS`、`SCALAR_FRONTMATTER_FIELDS`、
   `ARRAY_FRONTMATTER_FIELDS`、`isFrontmatterField`、`frontmatterFieldKind` 自动跟上；
   不要在任何消费者里再写一份字段名单。
4. 核对四个消费者：读器认识新键、编译器按 kind 走标量 / 数组、wire 接受新字段、
   discovery 投影到 `AgentDefinition`。若新字段还有形状之外的值约束（枚举、必填组合、
   上限），加在拥有该语义的读器 / 编译器 / wire，而不是字段表。
5. 补测试：读器正向与坏值、编译器往返与保留字节、wire 字段校验；必要时补
   host 路由的端到端用例。
6. 更新面向维护者的文档（例如本页的字段表说明），但不要在新文档里复制第二份字段表。

## 测试 seam

测的是行为边界，不是 `lines.ts` / `scalar.ts` 的函数级细节：

- `test/frontmatter.test.ts`：fence 切分、已知键形状、引号 / 注释、literal block、
  block 与 flow 序列、未知键保留、不可表达构造的诊断。
- `test/registry-file.test.ts`：`registry.yaml` 两层映射、布尔、flow 条目、别名指针、
  未知键 / 重复键 / 不可表达语法的拒绝与失败聚合。
- `test/control-frontmatter-edit.test.ts`：单行替换不碰注释 / 未知键 / 键序、插入与
  删除缩进块、空数组删除、引号策略与读回、编译器换行不变式。
- `test/host-wiring.test.ts`：wire 路由的字段编辑、commit 落盘、冲突 / 只读错误映射，
  以及 cwd 作用域回退；它证明 HTTP 入口没有另造字段规则。

## 明确不做的事

- **不做 YAML schema / 完整校验**：字段表不是 schema，不表达 required、default、
  nullable 或跨字段约束；完整 YAML 解析与 schema 校验不在 v1。
- **不决定语义**：布尔、`model` 映射、`spawn` 枚举、必填键、空值是否等于缺席，都归
  认识自己 schema 的读器；本域只给词法规则。
- **不支持完整 YAML 构造**：锚点、别名、多文档、折叠 `>` 等不是 agent 文档的合法
  输入；读器把它们记为不可表达并拒绝，不在这里补解析器。
- **不做第二套写入路径**：不引入对象模型、`dump` 再序列化、字段模板行或编辑器偏移
  作为第二真相源。
- **不碰环境**：不 import `node:*`、`@deepseek-ai/*`、React / DOM，不做 I/O、不读环境
  变量、不注册副作用；需要这些的读取 / 写入归调用层。

## 守卫与落点

- `scripts/checklist/matrix.mjs`：`yaml` 层的 `entries` 只有 `src/contract/index.ts`；
  `core` / `control` / `dsh/host` 的 entries 才列 `src/yaml/index.ts`。新增跨层读取
  先改矩阵，不要用深路径绕过。
- `scripts/check.mjs` 的 anchors 检查会扫 `.scratch` / `docs` / `README.md` 里的裸
  `src/...` 路径与 `path:line`；本页只引用真实存在的落点。
- 原始裁决与取舍见 ADR-0005：`docs/adr/0005-text-surgery-serialization.md`。
