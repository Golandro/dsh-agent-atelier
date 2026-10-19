/**
 * 页面样式作为静态资源导入（不是 CSS Modules：全部规则自挂 .agents-manager-page）。
 *
 * 发布产物（scripts/build-client.mjs）会把 .css 内联成「加载即注入」的模块，
 * 并导出幂等的 ensure()——宿主重建 head 后可以补注入一次。
 * 走原生 CSS 管线（Vite / esbuild 等）时没有这个导出，调用方按可选处理。
 */
declare module '*.css' {
  /** 幂等确保页面 <style> 存在且文本最新（仅发布构建提供）。 */
  export const ensure: (() => void) | undefined
}
