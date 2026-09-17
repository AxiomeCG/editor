import { afterEach, beforeEach, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { planMirror } from '@pascal-app/core/building'
import {
  DoorNode,
  LevelNode,
  UnitNode,
  WallNode,
  ZoneNode,
  type AnyNodeId,
} from '@pascal-app/core/schema'
import { SceneBridge } from '../bridge/scene-bridge'
import { registerMirror } from './mirror'
import { registerDuplicateLevel } from './duplicate-level'
import { createTestSceneOperations } from './scene-lifecycle/test-utils'

let client: Client, server: McpServer, bridge: SceneBridge
let levelId: AnyNodeId, wall: WallNode, door: DoorNode, unit: UnitNode
beforeEach(async () => {
  bridge = new SceneBridge()
  bridge.setScene({}, [])
  bridge.loadDefault()
  const buildingId = Object.values(bridge.getNodes()).find((n) => n.type === 'building')!.id
  levelId = bridge.createNode(LevelNode.parse({ level: 4, name: 'Floor 4' }), buildingId)
  wall = WallNode.parse({ parentId: levelId, start: [0, 0], end: [4, 0] })
  bridge.createNode(wall, levelId)
  door = DoorNode.parse({
    parentId: wall.id,
    wallId: wall.id,
    position: [1, 1.05, 0],
    hingesSide: 'left',
  })
  bridge.createNode(door, wall.id)
  const zone = ZoneNode.parse({
    parentId: levelId,
    name: '401',
    polygon: [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ],
    boundaryWallIds: [wall.id],
  })
  bridge.createNode(zone, levelId)
  unit = UnitNode.parse({ parentId: buildingId, name: '401', members: [zone.id] })
  bridge.createNode(unit, buildingId)
  server = new McpServer({ name: 'mirror-proof', version: '1' })
  const operations = createTestSceneOperations({ bridge }).operations
  registerMirror(server, operations)
  registerDuplicateLevel(server, operations)
  const [a, b] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: 'proof', version: '1' })
  await Promise.all([server.connect(a), client.connect(b)])
  bridge.clearHistory()
})
afterEach(async () => {
  await client.close()
  await server.close()
})

const mirror = (extra: Record<string, unknown> = {}) =>
  client.callTool({
    name: 'mirror_elements',
    arguments: { ids: [levelId], axis: 'x', coordinate: 2, copy: false, ...extra },
  })
test('MCP preview exposes the included geometry and never writes', async () => {
  const before = bridge.exportJSON()
  const response = await mirror({ preview: true })
  expect(response.isError).toBeFalsy()
  expect(response.structuredContent?.status).toBe('preview')
  expect(response.structuredContent?.sourceIds).toContain(door.id)
  expect(bridge.exportJSON()).toEqual(before)
  expect(bridge.getHistory().pastCount).toBe(0)
})
test('MCP uses the manual mirror plan and commits it as one undo', async () => {
  const before = bridge.exportJSON()
  const plan = planMirror(bridge.getNodes(), [levelId], { axis: 'x', coordinate: 2, copy: false })
  expect((await mirror()).isError).toBeFalsy()
  for (const update of plan.updates) expect(bridge.getNode(update.id)).toEqual(update.data)
  expect((bridge.getNode(door.id) as DoorNode).hingesSide).toBe('right')
  expect(bridge.getHistory().pastCount).toBe(1)
  bridge.undo()
  expect(bridge.exportJSON()).toEqual(before)
})
for (const method of ['mirror', 'duplicate'])
  test(`${method} via MCP copies and renumbers floor units`, async () => {
    const before = bridge.exportJSON()
    const result =
      method === 'mirror'
        ? await mirror({ copy: true })
        : await client.callTool({ name: 'duplicate_level', arguments: { levelId } })
    expect(result.isError).toBeFalsy()
    const newUnit = Object.values(bridge.getNodes()).find(
      (n) => n.type === 'unit' && n.id !== unit.id,
    ) as UnitNode
    expect(newUnit.name).toBe('501')
    const zone = bridge.getNode(newUnit.members[0]!) as ZoneNode
    const level = bridge.getNode(zone.parentId as AnyNodeId) as LevelNode
    expect(level.level).toBe(5)
    expect(zone.boundaryWallIds).not.toEqual([wall.id])
    expect(bridge.getHistory().pastCount).toBe(1)
    bridge.undo()
    expect(bridge.exportJSON()).toEqual(before)
  })
test('invalid hosted-opening selection fails without a partial edit', async () => {
  const before = bridge.exportJSON()
  expect((await mirror({ ids: [door.id] })).isError).toBe(true)
  expect(bridge.exportJSON()).toEqual(before)
  expect(bridge.getHistory().pastCount).toBe(0)
})
