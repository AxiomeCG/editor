import { join } from 'node:path'
import { z } from 'zod'

export interface SourceLabel {
  text: string
  confidence: number
  box: [number, number, number, number]
}

const labelSchema = z
  .array(
    z.object({
      text: z.string().max(500),
      confidence: z.number().min(0).max(1),
      box: z.tuple([
        z.number().min(0).max(1),
        z.number().min(0).max(1),
        z.number().min(0).max(1),
        z.number().min(0).max(1),
      ]),
    }),
  )
  .max(1000)

/** One offline OCR pass per frozen source. No model service or credential is used. */
export async function readSourceLabels(
  png: Uint8Array,
  width: number,
  height: number,
  out: string,
  sha256: string,
): Promise<{ labels: SourceLabel[]; issues: string[] }> {
  if (process.platform !== 'darwin' || !Bun.which('swift'))
    return {
      labels: [],
      issues: [
        'Local source-text recognition requires macOS Vision and Swift. Unnamed zones remain geometric approximations; no room names were guessed.',
      ],
    }
  const path = join(out, `ocr-${sha256}.png`)
  if (!(await Bun.file(path).exists())) await Bun.write(path, png)
  const child = Bun.spawn(['swift', join(import.meta.dir, 'source-ocr.swift'), path], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const timeout = setTimeout(() => child.kill(), 30_000)
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    if (code !== 0) throw new Error(stderr.trim().slice(0, 300) || `OCR exited ${code}`)
    const labels = labelSchema.parse(JSON.parse(stdout)).map((label) => ({
      ...label,
      box: [
        label.box[0] * width,
        label.box[1] * height,
        label.box[2] * width,
        label.box[3] * height,
      ] as SourceLabel['box'],
    }))
    return { labels, issues: [] }
  } catch (error) {
    return {
      labels: [],
      issues: [
        `Local source-text recognition failed: ${error instanceof Error ? error.message : String(error)}. Zone names were not guessed.`,
      ],
    }
  } finally {
    clearTimeout(timeout)
  }
}
