# Mentor-only Solution Key — Pascal Split Wall

> Local spoiler document. Keep it uncommitted.
>
> Audience: the adaptive tutor. The learner has chosen not to read this file.
> Use it to validate reasoning, select the next question, and reveal the
> smallest useful hint. Do not paste the complete design or implementation into
> the learner thread unless the learner explicitly abandons the craftsman path.

## Tutoring disclosure protocol

1. First ask the learner to predict the seam or invariant.
2. If wrong, point to one source symbol or architecture paragraph.
3. If still blocked, state one invariant, not the implementation.
4. Show pseudocode only after the learner can explain the interface.
5. Let the learner type consequential code.
6. Review the smallest current diff before introducing the next slice.
7. Keep later slices out of the answer until the current completion criterion is
   demonstrated.

---

# 1. Repository facts

## Contribution baseline

- Repository: `pascalorg/editor`, MIT licensed.
- Fork: `AxiomeCG/editor`.
- Pascal requires Bun 1.3+ and Node 20.9+.
- Root verification is `bun check` followed by `bun run test`.
- Visual/interactive PRs should include a short recording.
- Maintainers request one focused capability per issue/PR.

## Kaizen baseline

Kaizen is a downstream integration against older published packages:

- `@pascal-app/core`, `editor`, `viewer`: `0.9.2`
- `@pascal-app/nodes`: `0.1.1`

Relevant behavioral reference:

- `../kaizen/src/lib/room-model.ts`
  - `planWallSplit`
  - `planWallPushPull`
- `../kaizen/src/lib/room-model.test.ts`
- `../kaizen/src/lib/pascal/architecture.ts`
  - `splitWall`
  - `pushPullWall`
- `../kaizen/src/lib/pascal/viewport-interaction.tsx`
  - split hover/active preview
  - split click/commit
  - push `TransformControls`
- `../kaizen/src/lib/pascal/viewport-interaction-split.test.ts`

Use Kaizen for felt behavior and edge cases. Do not transplant its package
patches or host bridge. Current Pascal has deeper topology and interaction
modules.

## Naming

Pascal current `main` already has a Blender-style **Loop Cut** for block mesh
editing under `packages/nodes/src/block/`. The wall feature must be named
**Split Wall** in code, UI, issue, and PR text.

---

# 2. Current Pascal behavior

## Push/Offset Wall already exists

Do not add `pushPullWall` upstream.

Current implementation:

- Activation/handles:
  `packages/editor/src/components/editor/wall-move-side-handles.tsx`
- Registry contribution:
  `packages/nodes/src/wall/definition.ts` → `affordanceTools.move`
- 3D interaction:
  `packages/nodes/src/wall/move-tool.tsx`
- 2D interaction:
  `packages/nodes/src/wall/floorplan-move.ts`
- Pure topology behavior:
  `packages/core/src/systems/wall/wall-move.ts`

It already provides:

- wall-normal movement;
- linked endpoint propagation;
- same/opposite/off-axis relation handling;
- bridge/return wall planning;
- transient live overrides;
- 2D and 3D paths;
- ghost previews;
- auto slab/ceiling coordination;
- single-step history.

If Kaizen demonstrates a better control presentation, a later contribution may
improve discoverability by activating the existing move affordance. It must not
introduce a second movement planner.

## Split topology already exists

`packages/core/src/systems/wall/wall-topology.ts` contains:

```ts
planWallSplitAtPoint(nodes, {
  levelId,
  point,
  radius,
  ignoreWallIds,
})
```

It:

- searches only walls on the target level;
- projects a plan point onto straight or curved wall centerlines;
- rejects missing hosts;
- treats a point close to an existing endpoint as an accepted no-op;
- splits one wall into replacement wall nodes;
- preserves curve shape for each segment;
- remaps door/window/wall-item ownership and local offset;
- refuses a split when an attachment straddles it or cannot be remapped;
- preserves terrain support elevation by recomputing segment support offsets;
- returns `WallTopologyChanges` without mutating its input.

Current explicit caller:

- `packages/editor/src/components/tools/wall/wall-drafting.ts`
  - `resolveEndpointWallSplit`
  - used when a moved/drafted endpoint lands on another wall.

The missing capability is an intentional user interaction that previews and
commits that existing domain operation.

---

# 3. Contribution contract

## User problem

A user can create an implicit split by connecting another wall but cannot
intentionally divide an existing wall at a chosen point. Intentional segments
are useful when adjacent portions need independent topology or parameters.

## Felt behavior

1. Select one wall.
2. Invoke **Split Wall** from its contextual action menu.
3. The interaction takes ownership; ordinary selection and unrelated handles
   step back.
4. Moving the pointer over the selected wall shows a cut marker projected onto
   its centerline.
5. A valid marker uses the normal accent color.
6. Endpoint/no-op and attachment-crossing proposals use an invalid color.
7. Left click on a valid proposal commits one topology operation.
8. Escape, tool cancellation, view teardown, or invalid click leaves the scene
   unchanged.
9. The original wall ID does not remain selected after it is deleted.
10. One Undo restores the original wall and attachment ownership.
11. 2D and 3D provide equivalent targeting, validity, commit, cancel, and
    history behavior.
12. Split view has one commit owner per gesture.

## Explicit non-goals

- no Push/Offset Wall planner;
- no rendered mesh slicing or CSG operation;
- no new wall schema fields;
- no cutaway, raycast, selection-outline, camera, or opening-handle fixes;
- no package-patch migration;
- no block mesh Loop Cut changes;
- no umbrella tool framework rewrite.

---

# 4. Preferred module design

This design is subject to maintainer feedback on the issue, especially the
activation location. The domain seam and invariants should remain valid under a
different button placement.

## Module A — exact wall split planner (`packages/core`)

### Problem with using only `planWallSplitAtPoint`

The existing interface is optimized for connection snapping:

- it searches every wall on a level;
- the explicit interaction already knows the target wall;
- `ok: true` may contain an empty change set for an endpoint or blocked split;
- it does not expose `wallT`, target wall ID, or a rejection category needed for
  preview state.

The explicit UI should not infer validity from array lengths or risk selecting a
neighbor at a junction. Add an exact-target planner and let
`planWallSplitAtPoint` delegate to it.

### Proposed interface

Names can change during review. The important property is one exact target and
a tagged result.

```ts
export type WallExactSplitPlan = {
  wallId: WallNode['id']
  wallT: number
  point: WallPlanPoint
  changes: WallTopologyChanges
}

export type WallExactSplitResult =
  | { ok: true; plan: WallExactSplitPlan }
  | {
      ok: false
      reason: 'wall-not-found' | 'endpoint' | 'blocked-attachment'
    }

export function planWallSplitAtParameter(
  nodes: Record<AnyNodeId, AnyNode>,
  args: {
    wallId: WallNode['id']
    wallT: number
  },
): WallExactSplitResult
```

### Invariants

- Pure: input nodes remain referentially and structurally unchanged.
- Exact: only `wallId` can be split.
- Normalized: `wallT` is finite and strictly inside the endpoint tolerance.
- Atomic: successful changes include both replacement walls, all attachment
  updates, and deletion of the original.
- Total signaling: every result is explicitly valid or invalid; the UI never
  infers failure from an empty array.
- Curves: `point` and replacement `curveOffset` values come from the existing
  curve helpers.
- Stable semantics: existing `planWallSplitAtPoint` keeps its public behavior.

### Implementation outline

1. Look up `nodes[wallId]` and narrow to `WallNode`.
2. Reject non-finite `wallT` or values at/inside the endpoint tolerance.
3. Call the existing private `splitWall(wall, [wallT], nodes)`.
4. Map `null` to `blocked-attachment`.
5. Build the same create/update/delete change set currently assembled by
   `planWallSplitAtPoint`.
6. Return `wallPointAt(wall, wallT)` as the centerline point.
7. Refactor `planWallSplitAtPoint` to call the exact planner after nearest-wall
   projection. Preserve its accepted no-op contract for existing endpoint-move
   callers unless maintainers approve a breaking contract adjustment.
8. Export the new function and types from `packages/core/src/index.ts`.

Do not export the existing private `splitWall` directly. It has a shallow,
ambiguous `null` interface and accepts multiple parameters for insertion
internals. The new module presents only the explicit tool's required contract.

## Module B — point-to-parameter resolver (`packages/core`)

Both presentations need to project a pointer onto the selected wall without
searching neighbors. Keep this pure and shared.

```ts
export type WallSplitProposal = {
  wallId: WallNode['id']
  wallT: number
  point: WallPlanPoint
  frame: ReturnType<typeof getWallCurveFrameAt>
  result: WallExactSplitResult
}

export function proposeWallSplitAtPoint(
  nodes: Record<AnyNodeId, AnyNode>,
  args: {
    wallId: WallNode['id']
    point: WallPlanPoint
  },
): WallSplitProposal | null
```

Implementation:

1. Resolve the exact wall.
2. Project the plan point onto that wall's centerline:
   - straight: dot product divided by chord length squared;
   - curved: reuse/refactor the existing curved projection from
     `projectPointOntoWallCenterline`.
3. Clamp the raw proposal for display, but pass the true normalized value to the
   exact planner so endpoint tolerance stays authoritative.
4. Resolve `getWallCurveFrameAt(wall, wallT)` for preview orientation.
5. Return the tagged result rather than mutating state.

Prefer refactoring the current private projection helper into an exact-wall pure
helper over duplicating straight/curved math in React.

### Why this module is deep

Callers provide one wall and one plan point. They receive position, orientation,
validity, reason, and an atomic commit plan. Straight/curved projection,
endpoint tolerance, attachment rules, and topology changes remain local to
core.

## Module C — interaction scope (`packages/editor`)

Split Wall is a reshape of one selected node.

Extend `ReshapeKind` in
`packages/editor/src/lib/interaction/scope.ts`:

```ts
export type ReshapeKind =
  | 'curve'
  | 'hole'
  | 'endpoint'
  | 'boundary'
  | 'control-point'
  | 'tangent'
  | 'split'
```

Add a builder and predicate:

```ts
export function wallSplitReshapeScope(
  nodeId: string,
  driver: ReshapeDriver = 'tool',
): ActiveInteractionScope {
  return { kind: 'reshaping', nodeId, reshape: 'split', driver }
}

export function isWallSplitReshape(scope: InteractionScope): boolean {
  return scope.kind === 'reshaping' && scope.reshape === 'split'
}
```

Expose any hook only if two or more React callers need it. Otherwise selectors
can use the pure predicate. Do not add `splittingWall` to `useEditor`.

Why `reshaping`:

- one existing node owns the interaction;
- selection should be disabled during the operation;
- `driver` already prevents simultaneous 2D and 3D commit bodies;
- lifecycle and overlay policy fall out of the existing state machine.

## Module D — registry contribution (`packages/nodes`)

In `packages/nodes/src/wall/definition.ts`:

```ts
affordanceTools: {
  curve: () => import('./curve-tool'),
  'move-endpoint': () => import('./move-endpoint-tool'),
  move: () => import('./move-tool'),
  split: () => import('./split-tool'),
},
```

The presence of `affordanceTools.split` should be the capability test used by
contextual UI. Avoid a second hard-coded list of splittable node kinds.

## Module E — contextual action activation (`packages/editor`)

Extend the shared `NodeActionMenu` with an optional `onSplit` handler and a clear
**Split Wall** label/icon. Wire it from both action menu presentations:

- `packages/editor/src/components/editor/floating-action-menu.tsx`
- `packages/editor/src/components/editor-2d/floorplan-registry-action-menu.tsx`

Availability:

```ts
const canSplit = !!nodeRegistry.get(node.type)?.affordanceTools?.split
```

Activation:

- 3D floating action menu:
  `begin(wallSplitReshapeScope(node.id, 'tool'))`
- 2D floorplan action menu:
  `begin(wallSplitReshapeScope(node.id, 'floorplan'))`

The action menu should close naturally when scope becomes active. It must not
also set a new `useEditor` tool flag.

If maintainers prefer a global toolbar tool, keep the core proposal module and
interaction bodies; replace only this activation adapter.

## Module F — 3D split interaction (`packages/nodes/src/wall/split-tool.tsx`)

### Props

Match registry affordance conventions:

```ts
type SplitWallToolProps = { node: WallNode }
```

### Event ownership

Subscribe to:

- `wall:enter`
- `wall:move`
- `wall:click`
- `wall:leave`
- `tool:cancel`

Accept events only when `event.node.id === node.id` and the active split scope
still targets `node.id` with driver `tool`.

On accepted events call `event.stopPropagation()` so the selection manager does
not process the same pointer gesture.

### Coordinate frame

`WallEvent.position` is world-space. Wall schema points are level/building plan
coordinates. Convert through the wall's parent level object:

```ts
const levelObject = node.parentId
  ? sceneRegistry.nodes.get(node.parentId as AnyNodeId)
  : null

const point = new Vector3(...event.position)
if (levelObject) levelObject.worldToLocal(point)
const planPoint: WallPlanPoint = [point.x, point.z]
```

Do not assume `event.localPosition[0]` has straight-wall semantics for curved
walls. Use the shared exact-wall proposal module.

### Preview state

React-local state or a local ref plus state is sufficient because only this tool
renders it:

```ts
type Preview = WallSplitProposal | null
```

Pointer move:

1. read current scene nodes;
2. call `proposeWallSplitAtPoint`;
3. set preview;
4. perform no `useScene.updateNode` call.

Preview rendering:

- center at `proposal.point`;
- tangent/normal from `proposal.frame`;
- base elevation from `getWallBaseElevationForNodes`;
- height from `getWallEffectiveHeightForNodes`;
- width/depth from current wall thickness plus a small visible margin;
- valid accent versus invalid warning color;
- `meshBasicMaterial`, `depthTest={false}`, `depthWrite={false}`;
- `raycast={() => {}}` or equivalent so the preview never captures its own
  interaction;
- editor layer/render order consistent with other wall affordances.

A vertical cut plane is appropriate in 3D. In plan view the equivalent is a
short line across the wall thickness.

### Commit

On left click:

1. resolve a fresh proposal from the click event instead of trusting a stale
   render frame;
2. return without mutation if proposal result is invalid;
3. call `runAsSingleSceneHistoryStep(useScene, () =>
   useScene.getState().applyNodeChanges(plan.changes))`;
4. clear the stale deleted-wall selection or select an explicitly agreed
   replacement segment;
5. end the interaction scope;
6. clear preview;
7. emit the normal commit SFX if the repository pattern expects it.

Preferred selection contract for the first contribution: clear selection after
commit. Selecting both replacement walls creates a surprising multi-selection;
choosing one at the shared cut is ambiguous. If maintainers specify a different
contract, test it explicitly.

### Cancel and cleanup

- `tool:cancel` clears preview, ends only the matching scope, and marks cancel
  consumed.
- `wall:leave` clears preview without ending the active tool.
- unmount clears preview and uses `endIf` for the matching split scope.
- cleanup never writes scene nodes.

### Mounting

Extend `ToolManager` with a generic branch for a tool-driven split reshape:

1. identify `scope.kind === 'reshaping' && scope.reshape === 'split'`;
2. resolve the targeted node from `useScene`;
3. call `getRegistryAffordanceTool(node.type, 'split')`;
4. render it under `Suspense` with `{ node }`.

Keep dispatch registry-driven. Do not import a wall-specific component directly
into the manager.

## Module G — 2D split interaction (`packages/editor`)

Create a focused layer such as:

```text
packages/editor/src/components/editor-2d/floorplan-wall-split-overlay.tsx
```

It is editor-owned because it consumes floorplan DOM coordinates and the
editor interaction scope. It uses only the public core planner; it does not
import `@pascal-app/nodes`.

### Mount condition

Render only when:

- scope is `reshaping/split`;
- driver is `floorplan`;
- the target is one wall on the active level;
- the scene is editable.

Mount it beside existing floorplan interaction overlays in the floorplan scene.

### Pointer conversion

Reuse the pattern in `floorplan-registry-move-overlay.tsx`:

```ts
const scene = document.querySelector<SVGGElement>('[data-floorplan-scene]')
const svg = scene?.ownerSVGElement
const ctm = scene?.getScreenCTM()
const local = svgPoint.matrixTransform(ctm.inverse())
```

Factor a shared `clientToFloorplanPoint` helper only if the repository already
has or accepts that seam. Avoid a drive-by coordinate utility refactor in this
PR.

### Target ownership

The selected wall is already known from the scope. Project every plan pointer
onto that exact wall via `proposeWallSplitAtPoint`; do not perform a nearest-wall
search.

Listen to pointer movement while inside the floorplan viewport. On click:

- ensure the event belongs to the floorplan scene;
- recompute the proposal;
- stop default selection routing;
- commit only a valid proposal;
- end the matching floorplan split scope.

### SVG preview

Render with `pointerEvents="none"`:

- valid/invalid short segment centered at `proposal.point`;
- segment direction is `proposal.frame.normal` so it crosses wall thickness;
- a light halo beneath the primary stroke;
- optional faint highlight of the selected wall;
- stable screen readability under zoom, following existing non-scaling stroke
  conventions if available.

Do not create a scene node for the marker.

### Split view

Driver ownership is the critical invariant:

- a 3D-menu activation mounts only the tool-driven body;
- a floorplan-menu activation mounts only the floorplan body;
- pointer-up/click cleanup must not make the sibling body commit;
- the scope must end atomically after one successful commit.

Test or manually verify one topology change and one history entry in split view.

---

# 5. Test solution

## Core tests

Add to `wall-topology.test.ts` or a focused sibling if the section becomes
unwieldy.

### Exact split success

Input:

```text
wall [0,0] → [6,0], split t=0.5
```

Expect:

- success;
- two creates;
- delete original;
- point `[3,0]`;
- no input mutation;
- segment endpoints meet exactly at the point.

### Attachment remapping

Input:

- wall length 6;
- door at x=1, width 0.8;
- window at x=5, width 0.8;
- split t=0.5.

Expect:

- first attachment points to first created wall with x≈1;
- second points to second created wall with x≈2;
- each created wall's `children` includes only its attachment.

### Straddling rejection

Door centered at x=3, width 1, split t=0.5.

Expect `ok: false` with `blocked-attachment`, no changes, no mutation.

### Endpoint rejection

Test `t=0`, `t=1`, just within tolerance, and non-finite values. Expect explicit
`endpoint` or agreed invalid reason.

### Curved wall

Split a wall with non-zero `curveOffset` at t=0.5. Expect:

- two curved segments;
- first start equals original start;
- second end equals original end;
- shared point equals `getWallCurveFrameAt(original, 0.5).point`;
- combined arc travel/shape remains consistent with original.

Avoid testing private formulas directly. Assert geometric continuity and public
planner output.

### Terrain support

Use the existing terrain fixture patterns. Assert each created wall preserves
the original effective base elevation while its support offset is recalculated
for its new start.

## Interaction tests

Keep pure interaction decisions outside React when feasible:

- scope builder/predicate;
- proposal validity mapping;
- preview color/state resolver if non-trivial;
- selection cleanup decision.

React tests should protect actual behavior:

- activating the action begins the correct scope;
- valid click applies one change set;
- invalid click applies none;
- cancel applies none and ends scope;
- deleted original is not selected;
- floorplan and 3D pass the same proposal to commit.

Do not test source text, component names, or incidental styling constants.

## Manual scenarios

1. Straight isolated wall, middle split.
2. Connected room wall.
3. Door on first half.
4. Window on second half.
5. Cut through opening.
6. Exact endpoint.
7. Very short wall.
8. Curved wall.
9. Rotated/translated building.
10. Elevated level.
11. Terrain-supported wall.
12. 2D.
13. 3D.
14. Split view.
15. Cancel.
16. Undo/redo.

Capture a short recording showing valid preview, invalid preview, commit, and
undo in both presentations.

---

# 6. Contribution sequence

## Issue first

Suggested title:

```text
Wall: add an explicit split-at-point editing interaction
```

Suggested body:

```markdown
## Problem or motivation

Pascal automatically splits walls when another wall connects to their interior,
but a user cannot intentionally divide an existing wall at a chosen point. This
is needed when adjacent wall portions should become independently editable.

I have a downstream proof of concept in Kaizen and would like to upstream the
interaction through Pascal's current topology and interaction modules rather
than copying the downstream bridge.

## Proposed solution

- Select a wall and invoke **Split Wall** contextually.
- Hover/click projects onto that exact wall's centerline.
- Show a valid or invalid cut preview.
- Reject endpoints and cuts crossing hosted attachments.
- Commit parametric replacement wall nodes through the existing topology plan.
- Escape cancels without mutation.
- One Undo restores the original wall.
- Match felt behavior in 2D and 3D.

The implementation would build on `planWallSplitAtPoint`/the private split
planner in `packages/core`, use the existing interaction scope, and avoid any
rendered-mesh mutation.

Open UX question: should this be a contextual selected-wall action or a global
Split Wall tool?

## Alternatives considered

Creating a rendered mesh/CSG cut would bypass wall topology, hosted openings,
room detection, and undo semantics, so I do not propose that path. Connecting a
dummy wall creates a split today but is not an intentional editing workflow.

## Additional context

[Attach short Kaizen recording.]
```

## Branch

After issue/design alignment:

```bash
git fetch upstream
git switch main
git merge --ff-only upstream/main
git push origin main
git switch -c feat/wall-split-tool
```

Use merge only for the fast-forward update shown above; do not create a merge
commit on the feature branch.

## Commit shape

Prefer reviewable commits if the maintainer is comfortable with them:

1. `core: expose exact wall split planning`
2. `editor: add split wall interaction`
3. `test: cover split wall parity and history`

The final PR remains one feature. Do not preserve temporary scaffolding or
compatibility aliases.

## Verification

During work:

```bash
bun --cwd packages/core run test
bun --cwd packages/nodes run test
bun --cwd packages/editor run test
```

Before PR:

```bash
bun check
bun run test
```

Run `bun dev` and exercise the real surface. Tests do not replace visual and
interaction verification for this contribution.

## PR description

Use the repository template:

- concise behavior and architecture summary;
- `Fixes #<issue>` if accepted;
- exact manual test steps;
- recording;
- commands actually run;
- mention invalid opening/endpoint behavior;
- mention 2D/3D/split-view verification.

---

# 7. Architecture review checklist

## Core

- Pure logic only.
- No React, Three.js, editor state, mode, or view vocabulary.
- Exact target planner returns tagged validity.
- Existing connection split behavior remains compatible.
- Tests cross the public planner seam.

## Viewer

- No changes expected.
- Preview belongs to editor interaction code, not the standalone viewer.

## Nodes

- Wall-specific 3D affordance is colocated with the wall definition.
- Registry advertises the split affordance.
- No app-specific import.
- No committed preview nodes.

## Editor

- Interaction is represented by `useInteractionScope`, not a new legacy flag.
- Contextual activation is capability-driven.
- 2D owns only its presentation/input adapter.
- Split view has one driver/committer.
- Action menu remains generic enough to render only supplied actions.

## State and performance

- Pointer move never replaces the `useScene.nodes` map.
- No `updateNode` per pointer tick.
- Preview is local/transient.
- Commit calls one atomic `applyNodeChanges` path.
- Cleanup is idempotent.

## UX

- Normal selection cannot steal active pointer events.
- Invalid state is visible.
- Marker cannot raycast itself.
- Escape is reliable.
- Original deleted ID is removed from selection.
- One undo/redo round trip works.
- Terms are **Split Wall** and **Push/Offset Wall**, never wall Loop Cut.

---

# 8. Likely failure modes and tutoring hints

## Duplicate Push implementation

**Symptom:** learner begins porting `planWallPushPull`.

**Hint:** ask them to trace `affordanceTools.move` through `MoveWallTool` and
`planWallMoveJunctions`, then apply the deletion test to the duplicate.

## Mesh mutation

**Symptom:** proposal cuts a `BufferGeometry` or changes renderer groups.

**Hint:** ask which persisted node and hosted attachment owns the result after
reload/undo.

## Per-move scene writes

**Symptom:** `updateNode` inside `wall:move` or pointermove.

**Hint:** ask how many `useScene(s => s.nodes)` subscribers re-render per frame
and where preview state belongs.

## Nearest-wall ambiguity

**Symptom:** explicit selected-wall tool calls the level-wide nearest planner
with a large radius and can split a neighbor at a junction.

**Hint:** ask what target information the interaction already knows and whether
the domain interface should preserve it.

## Straight-only projection

**Symptom:** local X/chord projection is used for every wall.

**Hint:** ask the learner to predict a cut on a curved wall and locate
`getWallCurveFrameAt` plus the existing curved projection implementation.

## Stale selection

**Symptom:** commit deletes original wall but `selectedIds` still contains it.

**Hint:** ask which UI state references persisted node identity after the
change set.

## Double commit in split view

**Symptom:** two replacement pairs or two undo entries.

**Hint:** ask which `ReshapeDriver` owns this gesture and why both interaction
bodies are mounted.

## Preview intercepts events

**Symptom:** marker appears, then hover/click freezes.

**Hint:** ask what the raycaster hits after the marker is rendered.

## Empty-success treated as valid

**Symptom:** endpoint marker appears valid but click changes nothing.

**Hint:** inspect the current successful no-op contract and ask whether UI
validity should be inferred from change-array length.

## Scope leak

**Symptom:** handles remain hidden or selection disabled after cancel/view
switch.

**Hint:** trace every exit through matching `endIf` and confirm cleanup is
idempotent.

## Broad refactor

**Symptom:** learner redesigns all action menus, coordinate helpers, or tool
routing.

**Hint:** restate the one-capability PR and ask which existing adapter can be
extended with the smallest new surface.

---

# 9. Acceptance definition

The solution is ready for PR only when all are true:

- Maintainer-facing issue is focused and has received design opportunity.
- No duplicate Push implementation exists.
- Core planner has explicit exact-target validity and focused tests, or the
  maintainer-approved equivalent.
- Straight and curved wall behavior is correct.
- Attachments are remapped or the split is rejected.
- 3D preview/commit/cancel works without pointer-time scene writes.
- 2D matches the same felt behavior.
- Split view commits once.
- Selection contains no deleted wall ID.
- One Undo restores the full original topology.
- Focused package tests pass.
- `bun check` passes.
- `bun run test` passes.
- Real Pascal interaction has been exercised and recorded.
- The learner can explain every interface and invariant without relying on the
  solution key.
