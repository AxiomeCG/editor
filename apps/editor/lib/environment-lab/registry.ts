import { nodeRegistry } from '@pascal-app/core'
import { environmentPlugin } from '@pascal-app/plugin-environment'
import { loadExternalPlugins } from '@/lib/bootstrap'

const REGISTRY_WAIT_LIMIT_MS = 10_000
const REGISTRY_POLL_INTERVAL_MS = 16

const ENVIRONMENT_KINDS = (environmentPlugin.nodes ?? []).map((definition) => definition.kind)

/**
 * The bootstrap loader is intentionally fire-and-forget and its in-flight guard
 * returns early to later callers. Registry membership is therefore the actual
 * completion condition for an Environment fixture, not the loader promise.
 */
export async function waitForEnvironmentRegistry(): Promise<void> {
  await loadExternalPlugins()
  const startedAt = performance.now()
  let missing = ENVIRONMENT_KINDS.filter((kind) => !nodeRegistry.has(kind))
  while (missing.length > 0 && performance.now() - startedAt < REGISTRY_WAIT_LIMIT_MS) {
    const { promise, resolve } = Promise.withResolvers<void>()
    window.setTimeout(resolve, REGISTRY_POLL_INTERVAL_MS)
    await promise
    missing = ENVIRONMENT_KINDS.filter((kind) => !nodeRegistry.has(kind))
  }

  if (missing.length > 0) {
    throw new Error(`Environment registry did not load: ${missing.join(', ')}`)
  }
}
