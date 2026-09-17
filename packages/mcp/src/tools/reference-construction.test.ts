import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { planReferenceConstruction } from '@pascal-app/core/building'
import { type AnyNodeId, GuideNode, LevelNode } from '@pascal-app/core/schema'
import { SceneBridge } from '../bridge/scene-bridge'
import { registerReferenceConstruction } from './reference-construction'
import { createTestSceneOperations } from './scene-lifecycle/test-utils'

describe('reference construction shared by MCP and manual editing', () => {
  let client: Client, server: McpServer, bridge: SceneBridge
  let guide: GuideNode
  let levelId: AnyNodeId, buildingId: AnyNodeId
  beforeEach(async () => {
    bridge = new SceneBridge()
    bridge.setScene({}, [])
    bridge.loadDefault()
    buildingId = Object.values(bridge.getNodes()).find((n) => n.type === 'building')!.id
    levelId = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!.id
    guide = GuideNode.parse({
      name: 'Synthetic measured reference', parentId: levelId, url: '/synthetic.svg', scale: 1,
      metadata: {
        requireHumanCalibration: true,
        planReference: { width: 100, height: 100, sharedFrame: 'fixture-100', assetId: 'fixture' },
        referenceContours: [
          { id: 'left', points: [[10,10],[50,10],[50,50],[10,50]] },
          { id: 'right', points: [[50,10],[90,10],[90,50],[50,50]] },
        ],
      },
    })
    bridge.createNode(guide, levelId)
    server = new McpServer({ name: 'reference-proof', version: '1' })
    registerReferenceConstruction(server, createTestSceneOperations({ bridge }).operations)
    const [a,b] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'proof', version: '1' })
    await Promise.all([server.connect(a), client.connect(b)])
    bridge.clearHistory()
  })
  afterEach(async () => { await client.close(); await server.close() })
  const measurement = { start: [0,0], end: [4,0], realLengthMeters: 4, measuredLengthUnits: 4, metersPerUnit: 1 }
  const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args })

  test('uncalibrated requests return an actionable human handoff and mutate nothing', async () => {
    const before = bridge.exportJSON()
    const response = await call('create_reference_elements', { guideIds: [guide.id], kind: 'walls' })
    expect(response.isError).toBe(true)
    expect(JSON.stringify(response.content)).toContain('human_action_required')
    expect(bridge.exportJSON()).toEqual(before)
    expect(bridge.getHistory().pastCount).toBe(0)
  })

  test('the MCP wall geometry equals the manual operation, shares the party wall, and undoes atomically', async () => {
    bridge.updateNode(guide.id, { scaleReference: measurement as GuideNode['scaleReference'] })
    bridge.clearHistory()
    const expected = planReferenceConstruction({ nodes: bridge.getNodes(), guideIds: [guide.id], kind: 'walls' })
    const response = await call('create_reference_elements', { guideIds: [guide.id], kind: 'walls' })
    expect(response.isError).toBeFalsy()
    const actual = Object.values(bridge.getNodes()).filter((n) => n.type === 'wall')
    const geometry = (nodes: typeof actual) => nodes.map((n) => [n.start, n.end, n.thickness, n.height]).sort()
    expect(actual).toHaveLength(7)
    expect(geometry(actual)).toEqual(geometry(expected as typeof actual))
    expect(bridge.getHistory().pastCount).toBe(1)
    const again = await call('create_reference_elements', { guideIds: [guide.id], kind: 'walls' })
    expect(again.structuredContent?.status).toBe('already_present')
    bridge.undo()
    expect(Object.values(bridge.getNodes()).filter((n) => n.type === 'wall')).toHaveLength(0)
  })

  test('one invalid floor prevents the whole building operation', async () => {
    bridge.updateNode(guide.id, { scaleReference: measurement as GuideNode['scaleReference'] })
    const upper = bridge.createNode(LevelNode.parse({ level: 1 }), buildingId)
    const other = GuideNode.parse({ ...guide, id: undefined, parentId: upper })
    bridge.createNode(other, upper)
    const before = bridge.exportJSON()
    const response = await call('create_reference_elements', { guideIds: [guide.id, other.id], kind: 'unit' })
    expect(response.isError).toBe(true)
    expect(bridge.exportJSON()).toEqual(before)
  })

  test('shared calibration permits eight distinct floors; units retain floor membership', async () => {
    bridge.updateNode(guide.id, { scaleReference: measurement as GuideNode['scaleReference'] })
    const ids = [guide.id]
    for (let i = 1; i < 8; i++) {
      const floorId = bridge.createNode(LevelNode.parse({ level: i }), buildingId)
      const ref = GuideNode.parse({ ...guide, id: undefined, parentId: floorId })
      bridge.createNode(ref, floorId)
      ids.push(ref.id)
    }
    expect((await call('align_reference_frames', { anchorGuideId: guide.id, targetGuideIds: ids.slice(1) })).isError).toBeFalsy()
    expect((await call('create_reference_elements', { guideIds: ids, kind: 'unit' })).isError).toBeFalsy()
    const nodes = Object.values(bridge.getNodes())
    expect(nodes.filter((n) => n.type === 'unit')).toHaveLength(16)
    expect(new Set(nodes.filter((n) => n.type === 'zone').map((n) => n.parentId)).size).toBe(8)
    expect((await call('create_reference_elements', { guideIds: ids, kind: 'unit' })).structuredContent?.status).toBe('already_present')
  })

  test('unrelated frames cannot inherit calibration', async () => {
    bridge.updateNode(guide.id, { scaleReference: measurement as GuideNode['scaleReference'] })
    const target = GuideNode.parse({ ...guide, id: undefined, metadata: { planReference: { width: 100, height: 100, sharedFrame: 'other' } } })
    bridge.createNode(target, levelId)
    const before = bridge.exportJSON()
    expect((await call('align_reference_frames', { anchorGuideId: guide.id, targetGuideIds: [target.id] })).isError).toBe(true)
    expect(bridge.exportJSON()).toEqual(before)
  })
})
