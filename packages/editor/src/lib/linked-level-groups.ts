import type { LevelNode } from '@pascal-app/core'

export function linkedLevelSource(level: LevelNode): string | undefined {
  if (typeof level.metadata.placeholderSource === 'string') return level.metadata.placeholderSource
  const link = level.metadata.linkedArray as {sourceRootId?: string} | undefined
  return link?.sourceRootId
}
export type LevelListEntry = {level: LevelNode; copies?: LevelNode[]; sourceId?: string}
/** Consecutive linked floors form one visual block; a materialized middle floor splits it. */
export function groupLinkedLevels(levels: LevelNode[]): LevelListEntry[] {
  const entries: LevelListEntry[] = []
  for (const level of [...levels].sort((a,b)=>b.level-a.level)) {
    const sourceId = linkedLevelSource(level), previous = entries.at(-1)
    if (sourceId && previous?.sourceId === sourceId) previous.copies!.push(level)
    else entries.push(sourceId ? {level,sourceId,copies:[level]} : {level})
  }
  return entries
}

/** Move a source and all still-linked floors together; detached floors are independent. */
export function reorderLinkedLevels(levels:LevelNode[],activeId:string,overId:string):LevelNode[] {
  const ordered=[...levels].sort((a,b)=>a.level-b.level),groups=new Map<string,LevelNode[]>()
  for(const level of ordered){const key=linkedLevelSource(level)??level.id;const group=groups.get(key)??[];group.push(level);groups.set(key,group)}
  const keys=[...groups.keys()]
  const active=ordered.find(l=>l.id===activeId),over=ordered.find(l=>l.id===overId)
  if(!active||!over)return ordered
  const from=keys.indexOf(linkedLevelSource(active)??active.id),to=keys.indexOf(linkedLevelSource(over)??over.id)
  if(from===to)return ordered
  const [key]=keys.splice(from,1);keys.splice(to,0,key!)
  return keys.flatMap(key=>groups.get(key)!)
}
