/**
 * anchors 检查：`.scratch` / `docs` 里每一处 `path:line` 断言都必须能解析且
 * 行号在范围内；另含裸 `src/...` 路径令牌存在性（ticket 17）。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { listFiles } from './files.mjs'
import { DSH_SOURCE, ROOT } from './paths.mjs'
import { red, yellow } from './ui.mjs'

const ANCHOR_RE = /`([A-Za-z0-9_./@-]+\.(?:ts|tsx|js|mjs|json|yml|yaml|md|html)):(\d+)(?:-(\d+))?`/g
/**
 * 裸路径令牌（ticket 17）：反引号包裹、以 `src/` 开头的仓库内路径，不带 `:line`。
 * `...` 是省略写法（`src/...` 指「src 下的锚点」），不是路径断言，故排除；
 * `*`/`{`/空格等同样不在字符集里——通配与叙述片段不当地址。
 */
const BARE_PATH_RE = /`(src\/[A-Za-z0-9_./@-]+)`/g

/** 从 markdown 文本抽取 `path:line` 断言 */
export function parseAnchors(text, source = '') {
  const out = []
  for (const m of text.matchAll(ANCHOR_RE)) {
    const start = Number(m[2])
    const end = m[3] ? Number(m[3]) : start
    out.push({ token: m[0], path: m[1], line: Math.max(start, end), source })
  }
  return out
}

/**
 * 解析一处锚点：先按 workspace 相对路径，再按 DSH 源码树后缀唯一匹配，最后 $DSH_HOME。
 * @returns {{status: 'ok'|'missing'|'ambiguous'|'out-of-range', file?: string, total?: number, candidates?: string[]}}
 */
export function resolveAnchor(anchor, { root = ROOT, dshSource = DSH_SOURCE } = {}) {
  const candidates = []
  const direct = join(root, anchor.path)
  if (existsSync(direct)) candidates.push(direct)
  if (candidates.length === 0 && existsSync(join(dshSource, 'packages'))) {
    try {
      const hits = execFileSync('find', [join(dshSource, 'packages'), '-path', `*/${anchor.path}`, '-not', '-path', '*node_modules*', '-not', '-path', '*/lib/*'], { encoding: 'utf8' })
        .trim().split('\n').filter(Boolean)
      candidates.push(...hits)
    } catch {
      /* find 失败视为未解析 */
    }
  }
  const home = process.env.DSH_HOME
  if (candidates.length === 0 && home && existsSync(join(home, anchor.path))) candidates.push(join(home, anchor.path))
  if (candidates.length === 0) return { status: 'missing' }
  if (candidates.length > 1) return { status: 'ambiguous', candidates }
  const file = candidates[0]
  const total = readFileSync(file, 'utf8').split('\n').length
  if (anchor.line > total) return { status: 'out-of-range', file, total }
  return { status: 'ok', file, total }
}

/** 去掉三反引号/波浪线围栏代码块：围栏里是示例代码，不是路径断言（ticket 17）。 */
export function stripFencedBlocks(text) {
  const kept = []
  let fence = null
  for (const line of text.split('\n')) {
    const marker = /^\s*(```|~~~)/.exec(line)
    if (fence === null && marker !== null) {
      fence = marker[1]
      continue
    }
    if (fence !== null) {
      if (marker !== null && marker[1] === fence) fence = null
      continue
    }
    kept.push(line)
  }
  return kept.join('\n')
}

/** 从 markdown 文本抽取裸 `src/...` 路径令牌（fenced 之外；`...` 省略写法不算地址） */
export function parseBarePaths(text, source = '') {
  const out = []
  for (const m of stripFencedBlocks(text).matchAll(BARE_PATH_RE)) {
    if (m[1].includes('...')) continue
    out.push({ token: m[0], path: m[1], source })
  }
  return out
}

/**
 * 裸路径存在性判定（ticket 17）：`.scratch`/`docs` 的 markdown 与 `README.md` 里
 * 每一处反引号包裹的 `src/...` 都必须真实存在。只认 workspace 相对路径——
 * 裸令牌是「本仓地址」陈述，不套锚点的 DSH 源码树回退。
 * @returns {{problems: string[], tokens: number, files: number}}
 */
export function analyzeBarePaths(root = ROOT) {
  const files = []
  for (const base of [join(root, '.scratch'), join(root, 'docs')]) {
    for (const f of listFiles(base, base)) if (f.endsWith('.md')) files.push(join(base, f))
  }
  if (existsSync(join(root, 'README.md'))) files.push(join(root, 'README.md'))
  const problems = []
  let tokens = 0
  for (const file of files) {
    for (const bare of parseBarePaths(readFileSync(file, 'utf8'), relative(root, file))) {
      tokens += 1
      if (existsSync(join(root, bare.path))) continue
      problems.push(`裸路径：${bare.source} ${bare.token} → 仓库内不存在该路径`)
    }
  }
  return { problems, tokens, files: files.length }
}

function collectAnchors(root = ROOT) {
  const files = []
  for (const base of [join(root, '.scratch'), join(root, 'docs')]) {
    for (const f of listFiles(base, base)) if (f.endsWith('.md')) files.push(join(base, f))
  }
  for (const f of ['AGENTS.md', 'README.md']) if (existsSync(join(root, f))) files.push(join(root, f))
  const anchors = []
  for (const file of files) anchors.push(...parseAnchors(readFileSync(file, 'utf8'), relative(root, file)))
  return { anchors, files: files.length }
}

export function runAnchors({ root = ROOT, dshSource = DSH_SOURCE, verbose = false } = {}) {
  const { anchors, files: anchorFiles } = collectAnchors(root)
  const bare = analyzeBarePaths(root)
  const dshMissing = !existsSync(dshSource)
  const problems = []
  const preNotes = []
  let anchorFailures = 0
  let anchorUnverified = 0
  for (const anchor of anchors) {
    const res = resolveAnchor(anchor, { root, dshSource })
    if (res.status === 'ok') continue
    if (dshMissing && res.status === 'missing') {
      anchorUnverified += 1
      if (verbose) preNotes.push(`${yellow('?')} ${anchor.source} ${anchor.token}（无法判定：缺少 DSH 源码树）`)
      continue
    }
    anchorFailures += 1
    const detail = res.status === 'out-of-range'
      ? `越界：${res.file} 只有 ${res.total} 行`
      : res.status === 'ambiguous'
        ? `有 ${res.candidates.length} 个同名命中，请补全分组前缀：${res.candidates.slice(0, 3).join(' | ')}`
        : '解析不到该文件'
    problems.push({ kind: 'anchors', text: `锚点漂移：${anchor.source} ${anchor.token} → ${detail}` })
  }
  problems.push(...bare.problems.map((text) => ({ kind: 'anchors', text })))
  const failed = anchorFailures + bare.problems.length > 0
  const detail = failed
    ? `${anchorFailures + bare.problems.length} 处漂移（${anchorFailures} 处 path:line / ${bare.problems.length} 处裸路径；扫描 ${anchorFiles} 个 markdown 文件）`
    : `${anchors.length} 处 path:line 全解析 + ${bare.tokens} 处裸 src/ 路径存在（扫描 ${anchorFiles} 个 markdown 文件${dshMissing ? `；缺少 DSH 源码树，${anchorUnverified} 处未判定` : ''}）`
  return {
    kind: 'anchors',
    status: failed ? 'fail' : anchorUnverified > 0 ? 'warn' : 'ok',
    detail,
    problems,
    preNotes,
    errors: problems.map((problem) => `${red('✗')} ${problem.text}`),
  }
}
