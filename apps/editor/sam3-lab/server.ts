import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import sharp from 'sharp'
import { z } from 'zod'
import { comparisonOverlayPath, loadComparisonManifest } from './comparisons'
import { type SamRun, type Source, segment, validatePrompts } from './sam'

export async function serve(source: Source, out: string, port: number, maxRequests: number) {
  const [{ buildNativeMaskPreview }, { renderNativePreviewSvg }, { buildNativePreviewScene }, { readSourceLabels }] = await Promise.all([
    import('./mask-to-native'),
    import('./native-svg'),
    import('./native-3d'),
    import('./source-labels'),
  ])
  await mkdir(out, { recursive: true, mode: 0o700 })
  const runs: SamRun[] = []
  for (const entry of await readdir(out, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[A-Za-z0-9_-]+$/.test(entry.name)) continue
    try {
      const run = JSON.parse(await readFile(join(out, entry.name, 'run.json'), 'utf8')) as SamRun
      if (run.image.sha256 === source.sha256 && run.id === entry.name) runs.push(run)
    } catch {
      /* Incomplete or unrelated directories are not inspection results. */
    }
  }
  runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  let requestsUsed = runs.length
  let busy = false
  const comparisonRoot = join(dirname(out), 'comparisons')
  const comparisons = await loadComparisonManifest(comparisonRoot, source)
  const previewInput = z
    .object({
      variantId: z.string().max(80),
      metersPerPixel: z.number().finite().min(0.0001).max(1),
      wallHeight: z.number().finite().min(0.5).max(12),
      calibration: z.object({
        start: z.tuple([z.number().finite().min(0).max(source.width), z.number().finite().min(0).max(source.height)]),
        end: z.tuple([z.number().finite().min(0).max(source.width), z.number().finite().min(0).max(source.height)]),
        distanceMeters: z.number().finite().positive().max(10_000),
      }).refine(value => {
        const pixels = Math.hypot(value.end[0] - value.start[0], value.end[1] - value.start[1])
        const scale = value.distanceMeters / pixels
        return pixels >= 1 && scale >= 0.0001 && scale <= 1
      }, 'Calibration requires distinct source points and a scale within 0.0001–1 m/px').optional(),
    })
    .strict()
  let sourcePixels: Buffer | undefined
  let previewBusy = false
  let sourceLabels: Promise<{ labels: import('./source-labels').SourceLabel[]; issues: string[] }> | undefined
  let native3dClient: Promise<string> | undefined
  const token = randomUUID()
  const origin = `http://127.0.0.1:${port}`
  const isLocalJsonRequest = (request: Request) =>
    request.headers.get('origin') === origin &&
    request.headers.get('content-type')?.split(';')[0] === 'application/json' &&
    request.headers
      .get('cookie')
      ?.split(';')
      .some((part) => part.trim() === `sam3_lab=${token}`)
  const securityHeaders = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  }
  const json = (data: unknown, status = 200) =>
    Response.json(data, { status, headers: securityHeaders })
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port,
    idleTimeout: 255,
    maxRequestBodySize: 64 * 1024,
    async fetch(request) {
      const url = new URL(request.url)
      if (url.origin !== origin)
        return json({ error: `Use ${origin}; other hosts are not accepted.` }, 403)
      try {
        if (request.method === 'GET' && url.pathname === '/') {
          return new Response(Bun.file(join(import.meta.dir, 'index.html')), {
            headers: {
              ...securityHeaders,
              'Content-Type': 'text/html; charset=utf-8',
              'Set-Cookie': `sam3_lab=${token}; HttpOnly; SameSite=Strict; Path=/`,
            },
          })
        }
        if (request.method === 'GET' && url.pathname === '/native-3d.js') {
          native3dClient ??= Bun.build({
            entrypoints: [join(import.meta.dir, 'native-3d-client.js')],
            target: 'browser', minify: true,
            define: { 'process.env.NODE_ENV': JSON.stringify('production') },
          }).then(async result => {
            if (!result.success) throw new Error(result.logs.map(log => log.message).join('\\n'))
            return result.outputs[0]!.text()
          })
          return new Response(await native3dClient, { headers: { ...securityHeaders, 'Content-Type': 'text/javascript' } })
        }
        if (request.method === 'GET' && url.pathname === '/app.js')
          return new Response(Bun.file(join(import.meta.dir, 'app.js')), {
            headers: { ...securityHeaders, 'Content-Type': 'text/javascript; charset=utf-8' },
          })
        if (request.method === 'GET' && url.pathname === '/comparison.js')
          return new Response(Bun.file(join(import.meta.dir, 'comparison.js')), {
            headers: { ...securityHeaders, 'Content-Type': 'text/javascript; charset=utf-8' },
          })
        if (request.method === 'GET' && url.pathname === '/api/comparisons')
          return json(comparisons)
        if (request.method === 'GET' && url.pathname.startsWith('/api/comparisons/')) {
          const overview =
            url.pathname === '/api/comparisons/overview'
              ? 'all-variants.png'
              : url.pathname === '/api/comparisons/door-evidence'
                ? 'door-and-error-comparison.png'
                : null
          if (overview && comparisons.assessment) {
            const file = Bun.file(join(comparisonRoot, overview))
            if (await file.exists())
              return new Response(file, {
                headers: { ...securityHeaders, 'Content-Type': 'image/png' },
              })
          }
          const match = /^\/api\/comparisons\/([^/]+)\/overlay$/.exec(url.pathname)
          const variant = comparisons.variants.find((item) => item.id === match?.[1])
          const path = variant && comparisonOverlayPath(comparisonRoot, variant.id)
          if (!path || !(await Bun.file(path).exists()))
            return json({ error: 'Unknown comparison overlay.' }, 404)
          return new Response(Bun.file(path), {
            headers: { ...securityHeaders, 'Content-Type': 'image/png' },
          })
        }
        if (request.method === 'POST' && url.pathname === '/api/comparisons/preview') {
          if (!isLocalJsonRequest(request))
            return json({ error: 'Local previews require the same-origin lab page and JSON.' }, 403)
          const input = previewInput.parse(await request.json())
          if (input.calibration) input.metersPerPixel = input.calibration.distanceMeters /
            Math.hypot(input.calibration.end[0] - input.calibration.start[0], input.calibration.end[1] - input.calibration.start[1])
          const variant = comparisons.variants.find((item) => item.id === input.variantId)
          if (!variant) return json({ error: 'Unknown comparison variant.' }, 404)
          if (previewBusy) return json({ error: 'A local preview is already running.' }, 409)
          previewBusy = true
          try {
            sourcePixels ??= await sharp(source.png).ensureAlpha().raw().toBuffer()
            sourceLabels ??= readSourceLabels(source.png, source.width, source.height, out, source.sha256)
            const recognized = await sourceLabels
            const preview = await buildNativeMaskPreview(
              variant,
              {
                width: source.width,
                height: source.height,
                rgba: sourcePixels,
                ...recognized,
              },
              input,
            )
            return json({ ...preview, svg: await renderNativePreviewSvg(preview), scene: buildNativePreviewScene(preview) })
          } finally {
            previewBusy = false
          }
        }
        if (request.method === 'GET' && url.pathname === '/api/source')
          return new Response(source.png as Uint8Array<ArrayBuffer>, {
            headers: { ...securityHeaders, 'Content-Type': 'image/png' },
          })
        if (request.method === 'GET' && url.pathname === '/api/session')
          return json({
            source: {
              name: source.name,
              width: source.width,
              height: source.height,
              url: '/api/source',
            },
            keyConfigured: Boolean(process.env.FAL_KEY?.trim()),
            busy,
            runs,
            requestsUsed,
            maxRequests,
          })
        if (request.method === 'POST' && url.pathname === '/api/segment') {
          if (!isLocalJsonRequest(request))
            return json(
              { error: 'Paid calls require the same-origin lab page and JSON consent.' },
              403,
            )
          if (busy) return json({ error: 'A SAM request is already running.' }, 409)
          if (requestsUsed >= maxRequests)
            return json(
              {
                error:
                  'Session request cap reached. Review saved results before explicitly raising --max-requests.',
              },
              429,
            )
          const { confirmPaid, ...input } = await request.json()
          if (confirmPaid !== true)
            return json({ error: 'Explicit paid-call consent is required.' }, 400)
          const prompts = validatePrompts(input, source)
          if (prompts.prompt !== '')
            return json(
              {
                error:
                  'The prototype UI accepts spatial guidance only. Text experiments belong in the terminal tool.',
              },
              400,
            )
          const key = process.env.FAL_KEY?.trim()
          if (!key) return json({ error: 'FAL_KEY is missing; no request was made.' }, 503)
          busy = true
          requestsUsed++
          try {
            const run = await segment(source, prompts, join(out, randomUUID()), key)
            runs.unshift(run)
            return run.status === 'completed' ? json(run) : json({ error: run.error, run }, 502)
          } finally {
            busy = false
          }
        }
        if (request.method === 'GET' && url.pathname.startsWith('/runs/')) {
          const match =
            /^\/runs\/([A-Za-z0-9_-]+)\/(source\.png|run\.json|request\.json|response\.json|mask-\d+(?:\.raw)?\.png|overlay-\d+\.png)$/.exec(
              url.pathname,
            )
          if (!match || !runs.some((run) => run.id === match[1]))
            return json({ error: 'Unknown run artifact.' }, 404)
          const file = Bun.file(join(out, match[1]!, match[2]!))
          if (!(await file.exists())) return json({ error: 'Artifact does not exist.' }, 404)
          return new Response(file, {
            headers: {
              ...securityHeaders,
              'Content-Type': match[2]!.endsWith('.png') ? 'image/png' : 'application/json',
            },
          })
        }
        return json({ error: 'Not found.' }, 404)
      } catch (error) {
        return json(
          {
            error: (error instanceof Error ? error.message : 'Invalid lab request.').slice(0, 1000),
          },
          400,
        )
      }
    },
  })
  console.log(
    JSON.stringify({
      url: origin,
      source: {
        name: source.name,
        width: source.width,
        height: source.height,
        sha256: source.sha256,
      },
      out,
      requestsUsed,
      maxRequests,
      paidRequestsOnStartup: 0,
    }),
  )
  return server
}
