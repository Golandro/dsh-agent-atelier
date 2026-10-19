#!/usr/bin/env node
/**
 * Build the browser half (tickets 12 + 05) into the module-loader bundle the
 * DSH client scanner expects at `lib/client.js`.
 *
 * The main bundle stays a light shell: no CodeMirror, no TanStack — those ship
 * as package-local lazy chunks (`scripts/build-chunks.mjs`). This script
 * transpiles every `src/dsh/client/*` module to CommonJS with the declared
 * `typescript` package and wraps them in the same
 * `window.__ModuleLoader__.load` factory shape the in-tree preset emits.
 * `react` stays a platform `require`; local modules resolve through a tiny
 * in-factory registry; the on-demand chunk channel (`require.async`) is
 * forwarded into that registry so the page can lazy-load the editor and list
 * chunks (`src/dsh/client/chunk-loader.ts`).
 */
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGE_NAME = 'dsh-plugin-agents-manager'
const CLIENT_DIR = join(ROOT, 'src/dsh/client')

/** Transpile one source file to CommonJS without resolving its imports. */
function transpile(relativePath) {
  const source = readFileSync(join(ROOT, relativePath), 'utf8')
  return ts.transpileModule(source, {
    fileName: relativePath,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      verbatimModuleSyntax: false,
      jsx: relativePath.endsWith('.tsx') ? ts.JsxEmit.React : ts.JsxEmit.None,
      jsxFactory: 'h',
      sourceMap: false,
    },
  }).outputText
}

/**
 * 页面样式注入标记。刻意不用裸插件 id：`data-plugin="<插件 id>"` 是宿主
 * ClientModuleSystem 的样式归属键，chunk 物化时会被 removeOwnedStyles() 清掉。
 */
const CSS_STYLE_MARKER = `${PACKAGE_NAME}#page`

/**
 * 把一个 .css 文件编译成「加载即注入」的模块（等价 dev server 的 CSS 注入）。
 *
 * 导出 ensure()：幂等确保 <style> 存在且文本最新——宿主重建 head 后调用方可以
 * 再调一次；HMR 重新求值本模块时也会直接更新 textContent。
 */
function cssModule(cssPath) {
  const cssText = readFileSync(cssPath, 'utf8')
  return `var cssText = ${JSON.stringify(cssText)};
var styleMarker = ${JSON.stringify(CSS_STYLE_MARKER)};
function ensure() {
  if (typeof document === 'undefined') return;
  var target = document.head || document.documentElement;
  if (target === null) return;
  var el = document.querySelector('style[data-plugin="' + styleMarker + '"]');
  if (el === null) {
    el = document.createElement('style');
    el.setAttribute('data-plugin', styleMarker);
    target.appendChild(el);
  }
  if (el.textContent !== cssText) el.textContent = cssText;
}
ensure();
module.exports = { ensure: ensure };`
}

/** Map every emitted relative require onto a local module id; fail on drift. */
function remapLocalRequires(relativePath, source, map) {
  const fromDir = dirname(join(ROOT, relativePath))
  return source.replace(/require\("((?:\.\.?\/)[^"]+)"\)/g, (_whole, specifier) => {
    const target = resolve(fromDir, specifier)
    const moduleId = map.get(target)
    if (moduleId === undefined) {
      throw new Error(`${relativePath}: unexpected relative require "${specifier}" (no local module mapping)`)
    }
    return `localRequire(${JSON.stringify(moduleId)})`
  })
}

/** All client modules under src/dsh/client, each with its registry id. */
function collectClientModules() {
  const files = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      // .d.ts 只是类型声明，不产生运行时模块。
      else if (!name.endsWith('.d.ts') && /\.(ts|tsx|css)$/.test(name)) files.push(path)
    }
  }
  walk(CLIENT_DIR)
  return files.sort().map((path) => ({
    path,
    id: relative(CLIENT_DIR, path).split('\\').join('/'),
  }))
}

const modules = collectClientModules()
// Runtime control-layer imports stay limited to the two public sub-entries the
// import matrix allows; everything else (types) is erased by the transpile.
modules.push({ path: 'src/control/client-errors.ts', id: 'client-errors' })
modules.push({ path: 'src/control/http-client.ts', id: 'http-client' })
for (const module of modules) {
  module.path = relative(ROOT, resolve(ROOT, module.path))
}
const idsByPath = new Map(modules.map((module) => [resolve(ROOT, module.path), module.id]))

const localModules = {}
for (const module of modules) {
  // 页面样式是静态资源：内联成注入器，和 Vite dev 对 .css 的处理同构。
  if (module.path.endsWith('.css')) {
    localModules[module.id] = cssModule(module.path)
    continue
  }
  // The chunk-loading seam is provided by the bundle itself, not the source.
  if (module.id === 'chunk-loader.ts') {
    localModules[module.id] = `module.exports = {
  loadEditorChunk: () => localRequire.async('./client.editor.js'),
  loadListChunk: () => localRequire.async('./client.list.js'),
}`
    continue
  }
  localModules[module.id] = remapLocalRequires(module.path, transpile(module.path), idsByPath)
}

const entry = localModules['index.ts']
if (entry === undefined) throw new Error('client entry src/dsh/client/index.ts not found')
delete localModules['index.ts']

const factories = Object.entries(localModules)
  .map(([id, code]) => `  ${JSON.stringify(id)}: (module, exports, localRequire) => {\n${code}\n  },`)
  .join('\n')

const bundle = `/* generated by scripts/build-client.mjs — do not edit */
window.__ModuleLoader__.load({ id: "${PACKAGE_NAME}", factory: (require) => {
var localModules = {};
var localFactories = {
${factories}
};
function localRequire(specifier) {
  var factory = localFactories[specifier];
  if (factory === undefined) return require(specifier);
  if (localModules[specifier] === undefined) {
    var module = { exports: {} };
    localModules[specifier] = module.exports;
    factory(module, module.exports, localRequire);
    localModules[specifier] = module.exports;
  }
  return localModules[specifier];
}
localRequire.async = require.async;
var module = { exports: {} };
var exports = module.exports;
${entry}
return module.exports;
} });
`

mkdirSync(join(ROOT, 'lib'), { recursive: true })
writeFileSync(join(ROOT, 'lib/client.js'), bundle)
console.log(`built lib/client.js (${bundle.length} bytes, ${Object.keys(localModules).length + 1} modules)`)
