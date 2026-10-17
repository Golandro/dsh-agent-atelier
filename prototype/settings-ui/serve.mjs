/** PROTOTYPE — 极简静态服务器：serve 本目录（index.html / dist / styles）。无依赖。 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))
const port = Number(process.env.PORT ?? 4188)
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
}

createServer(async (req, res) => {
  try {
    const url = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/')
    const rel = normalize(url === '/' ? '/index.html' : url).replace(/^[/\\]+/, '')
    const file = join(root, rel)
    if (!file.startsWith(root)) {
      res.writeHead(403)
      res.end('forbidden')
      return
    }
    const data = await readFile(file)
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' })
    res.end(data)
  } catch {
    res.writeHead(404)
    res.end('not found')
  }
}).listen(port, () => console.log(`原型 → http://localhost:${port}/  （Ctrl-C 停止）`))
