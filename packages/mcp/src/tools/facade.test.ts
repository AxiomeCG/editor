import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { DEFAULT_FACADE_UNIT } from '@pascal-app/core'
import { type AnyNode, WallNode } from '@pascal-app/core/schema'
import { SceneBridge } from '../bridge/scene-bridge'
import { registerApplyPatch } from './apply-patch'
import { registerFacadeTools } from './facade'

type Result = { isError?: boolean; content: Array<{ type: string; text: string }> }
const parse = (result: Result) => JSON.parse(result.content[0]!.text)

describe('facade tools', () => {
  let client: Client
  let bridge: SceneBridge

  beforeEach(async () => {
    bridge = new SceneBridge()
    bridge.setScene({}, [])
    bridge.loadDefault()
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerFacadeTools(server, bridge)
    registerApplyPatch(server, bridge)
    const [srvT, cliT] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(srvT), client.connect(cliT)])
    // Real hosts list first; the client then enforces every output schema.
    await client.listTools()
  })

  /** A closed 10 × 7 m rectangle of walls, returning the south wall. */
  function rectangle(): WallNode {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const corners: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 7],
      [0, 7],
    ]
    const walls = corners.map((start, i) =>
      WallNode.parse({ start, end: corners[(i + 1) % 4], thickness: 0.2, height: 3 }),
    )
    for (const wall of walls) bridge.createNode(wall, level.id)
    return walls[0]!
  }

  const facadeWindows = () =>
    Object.values(bridge.getNodes()).filter(
      (n: AnyNode) => n.type === 'window' && n.metadata.facadeOwner,
    )

  test('previews a unit across widths and interior walls, with no scene', async () => {
    const result = (await client.callTool({
      name: 'preview_facade_unit',
      arguments: { unit: DEFAULT_FACADE_UNIT, widths: [2.5, 12], partitions: [6] },
    })) as Result
    expect(result.isError).toBeFalsy()
    const [narrow, wide] = parse(result).scenarios

    expect(narrow.runs).toHaveLength(1)
    expect(narrow.openings).toHaveLength(1)
    // The interior wall at 6 m splits the 12 m run into two rooms.
    expect(wide.runs).toHaveLength(2)
    for (const opening of wide.openings)
      expect(opening.right <= 5.95 || opening.left >= 6.05).toBe(true)
    expect(wide.sketch).toContain('#')
    expect(wide.sketch.startsWith('|')).toBe(true)
  })

  test('reports an invalid unit as a tool error', async () => {
    const result = (await client.callTool({
      name: 'preview_facade_unit',
      arguments: { unit: { name: '', bays: [] } },
    })) as Result
    expect(result.isError).toBe(true)
  })

  test('fills the outside loop, and a second apply re-solves in place', async () => {
    const south = rectangle()
    const first = parse(
      (await client.callTool({
        name: 'apply_facade',
        arguments: { wallId: south.id, scope: 'exterior', unit: DEFAULT_FACADE_UNIT },
      })) as Result,
    )
    expect(first.walls).toBe(4)
    expect(first.created).toBeGreaterThan(0)
    const windows = facadeWindows()
    expect(windows.length).toBe(first.created)
    expect(bridge.getNode(south.id)?.children).toEqual(
      expect.arrayContaining(windows.filter((w) => w.parentId === south.id).map((w) => w.id)),
    )

    const again = parse(
      (await client.callTool({
        name: 'apply_facade',
        arguments: { wallId: south.id, scope: 'exterior', unit: DEFAULT_FACADE_UNIT },
      })) as Result,
    )
    expect(again).toMatchObject({ created: 0, removed: 0 })
    expect(
      facadeWindows()
        .map((w) => w.id)
        .sort(),
    ).toEqual(windows.map((w) => w.id).sort())
  })

  test('refuses a node that is not a wall', async () => {
    const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
    const result = (await client.callTool({
      name: 'apply_facade',
      arguments: { wallId: level.id, unit: DEFAULT_FACADE_UNIT },
    })) as Result
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('expected wall')
  })

  test('apply_patch refuses to edit what a facade generated', async () => {
    const south = rectangle()
    await client.callTool({
      name: 'apply_facade',
      arguments: { wallId: south.id, scope: 'wall', unit: DEFAULT_FACADE_UNIT },
    })
    const window = facadeWindows()[0]!
    const result = (await client.callTool({
      name: 'apply_patch',
      arguments: { patches: [{ op: 'update', id: window.id, data: { width: 2 } }] },
    })) as Result
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('apply_facade')
    expect((bridge.getNode(window.id) as { width: number }).width).toBe(window.width)
  })
})
