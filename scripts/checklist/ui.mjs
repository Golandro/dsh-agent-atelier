/**
 * 终端渲染：ANSI 颜色与步骤行。
 *
 * 颜色开关沿用原判定：`NO_COLOR` 未设置、未传 `--no-color`，且
 * `FORCE_COLOR=1` 或 stdout 是 TTY 才着色。
 */
const ARGS = new Set(process.argv.slice(2))

export const COLOR = process.env.NO_COLOR === undefined
  && !ARGS.has('--no-color')
  && (process.env.FORCE_COLOR === '1' || process.stdout.isTTY === true)
export const paint = (code, text) => (COLOR ? `\u001b[${code}m${text}\u001b[0m` : text)
export const green = (text) => paint('32', text)
export const red = (text) => paint('31', text)
export const yellow = (text) => paint('33', text)
export const cyan = (text) => paint('36', text)
export const dim = (text) => paint('2', text)
export const bold = (text) => paint('1', text)

/** 打印一行步骤状态：`▸ i/total label ✓ detail · Nms`。 */
export function reportStep(index, total, label, status, detail, elapsed) {
  const icon = status === 'ok' ? green('✓') : status === 'warn' ? yellow('!') : red('✗')
  console.log(`  ${dim(`▸ ${index}/${total}`)} ${label} ${icon} ${detail} ${dim(`· ${elapsed}ms`)}`)
}
