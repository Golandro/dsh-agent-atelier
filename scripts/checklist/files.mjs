/** 文件遍历工具：跳过 node_modules/.git，返回相对 base 的路径。 */
import { existsSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

/** 列出目录下所有文件（相对 dir，跳过 node_modules/.git） */
export function listFiles(dir, base = dir) {
  if (!existsSync(dir)) return []
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listFiles(path, base))
    else out.push(relative(base, path))
  }
  return out
}
