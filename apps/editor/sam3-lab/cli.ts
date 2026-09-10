import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { ENDPOINT, loadSource, REQUEST_HEADERS, requestBody, segment, validatePrompts } from './sam'
import { serve } from './server'

const usage = `SAM3 isolation lab — paid segmentation and local saved-comparison previews.

Commands:
  doctor                         Show local runtime/key presence; no API request.
  segment --prompts FILE          Preview one exact request; add --execute to pay.
  inspect --run DIRECTORY         Read a saved run without network activity.
  serve                          Start the loopback click-guided inspection UI.

Source (segment/serve): exactly one of --image FILE or --inspection FILE.
Options:
  --out DIRECTORY                segment: required new run directory, never overwritten.
                                 serve: artifact workspace (default editor/.sam3-lab).
  --execute                      segment only: authorize exactly one fal API request.
  --port NUMBER                  serve only: loopback port (default 3117).
  --max-requests NUMBER           serve only: total saved/new runs for this source (default 6).
  --help                         Show commands and examples; no API request.

FAL_KEY comes from the environment, never a CLI flag or browser. Load the existing
editor env with Bun's --env-file if needed. Segment previews never need a key.
Stdout is JSON; errors are JSON on stderr with a nonzero exit. Failed runs retain
request/response artifacts and unknown billing; there are no automatic retries.
Prompts use source pixels and label 1=foreground / 0=background. Set prompt to an
explicit empty string for spatial-only experiments; fal's omitted default is wheel.
One target: give all its points/boxes the same object_id (e.g. 1).

Examples (from editor/apps/editor):
  bun sam3-lab/cli.ts doctor
  bun sam3-lab/cli.ts segment --image /tmp/plan.png --prompts /tmp/points.json --out /tmp/sam-run-a
  bun --env-file=../../.env.local sam3-lab/cli.ts segment --image /tmp/plan.png --prompts /tmp/points.json --out /tmp/sam-run-a --execute
  bun sam3-lab/cli.ts inspect --run /tmp/sam-run-a
  bun --env-file=../../.env.local sam3-lab/cli.ts serve --inspection ~/Downloads/floorplan-inspection.json
`

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    strict: true,
    options: {
      help: { type: 'boolean' },
      image: { type: 'string' },
      inspection: { type: 'string' },
      prompts: { type: 'string' },
      out: { type: 'string' },
      execute: { type: 'boolean' },
      port: { type: 'string' },
      'max-requests': { type: 'string' },
      run: { type: 'string' },
    },
  })
  if (values.help || positionals.length === 0) {
    console.log(usage)
    return
  }
  if (positionals.length !== 1) throw new Error('Expected one command. Run --help for examples.')
  const command = positionals[0]
  if (command === 'doctor') {
    console.log(
      JSON.stringify({
        runtime: Bun.version,
        endpoint: ENDPOINT,
        falKeyConfigured: Boolean(process.env.FAL_KEY?.trim()),
        authVerified: false,
        networkCalls: 0,
      }),
    )
    return
  }
  if (command === 'inspect') {
    if (!values.run) throw new Error('inspect requires --run DIRECTORY.')
    console.log(await readFile(resolve(values.run, 'run.json'), 'utf8'))
    return
  }
  if (command !== 'segment' && command !== 'serve')
    throw new Error(`Unknown command ${command}. Run --help.`)
  if (command === 'serve' && values.execute)
    throw new Error('--execute is only for segment; serving starts no inference.')
  const source = await loadSource({ image: values.image, inspection: values.inspection })
  if (command === 'serve') {
    const port = Number(values.port ?? 3117)
    const maxRequests = Number(values['max-requests'] ?? 6)
    if (!Number.isInteger(port) || port < 1024 || port > 65535)
      throw new Error('--port must be 1024–65535.')
    if (!Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 100)
      throw new Error('--max-requests must be 1–100.')
    await serve(
      source,
      resolve(values.out ?? resolve(import.meta.dir, '../../../.sam3-lab')),
      port,
      maxRequests,
    )
    return
  }
  if (!values.prompts || !values.out)
    throw new Error(
      'segment requires --prompts FILE and --out NEW_DIRECTORY. Run --help for examples.',
    )
  const prompts = validatePrompts(JSON.parse(await readFile(values.prompts, 'utf8')), source)
  const out = resolve(values.out)
  if (!values.execute) {
    const body = requestBody(source, prompts)
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          endpoint: ENDPOINT,
          image: {
            name: source.name,
            width: source.width,
            height: source.height,
            sha256: source.sha256,
          },
          out,
          request: { ...body, image_url: '[local PNG embedded as data URI only on execution]' },
          headers: REQUEST_HEADERS,
          clientTimeoutMs: 180_000,
          automaticRetry: false,
          advertisedCostUsd: 0.005,
          reportedCostUsd: null,
          networkCalls: 0,
          privacy:
            'X-Fal-Store-IO: 0 disables fal request/response JSON storage, not all provider/media retention.',
        },
        null,
        2,
      ),
    )
    return
  }
  const run = await segment(source, prompts, out, process.env.FAL_KEY ?? '')
  console.log(JSON.stringify({ ...run, out }, null, 2))
  if (run.status !== 'completed') process.exitCode = 1
}

main().catch((error) => {
  const key = process.env.FAL_KEY
  let message = error instanceof Error ? error.message : String(error)
  if (key) message = message.split(key).join('<REDACTED>')
  console.error(JSON.stringify({ error: message, automaticRetry: false }))
  process.exitCode = 1
})
