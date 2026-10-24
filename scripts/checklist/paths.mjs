/**
 * 仓库守卫的共享路径。
 *
 * `ROOT` 从本文件位置（`scripts/checklist/`）上溯两级，而不是从调用方推断，
 * 这样各检查模块无论被谁载入都指向同一个仓库根。
 */
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const DSH_SOURCE = process.env.DSH_SOURCE ?? join(homedir(), 'repo/deepseek-harness')
export const SCRATCH_DIRS = ['.probe']
