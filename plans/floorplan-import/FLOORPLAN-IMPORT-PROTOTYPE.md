# First prototype — Import from floorplan

**Date:** 7 September 2026. **Status:** implemented locally in the Pascal editor; end-to-end acceptance and reconstruction quality remain unverified. The user is taking over manual QA. This refines the [reconstruction R&D](./FLOORPLAN-RECONSTRUCTION-RND.md) and is not standing authorization for paid inference.

## 1. Product slice

**Create a floor → its three-dot menu → Import from floorplan → generate a complete native floor, including zones evidenced by the source.**

Use the actual Pascal editor as the prototype surface. The local extraction workbench remains an engineering instrument, not a prerequisite product users must visit. Keep the source/feature/draft/native-adapter separation from the R&D proposal; do not turn it into a multi-application user journey.

**Revised extraction priorities from manual QA:** milestone 1 is reliable walls, doors and windows; milestone 2 adds source-named rooms and supported open-plan zones; milestone 3 adds optional props. The first two are the priority. The current buttons still run the existing stages below; the [research plan](./FLOORPLAN-RECONSTRUCTION-RND.md) specifies the proposed structure-first separation and missing evidence contracts. This priority change does not claim those new extraction passes are implemented.

Cross-floor registration is explicitly out of this prototype. Import in a stable selected-level coordinate frame; do not match walls, stairs or footprints against the floor below. A later human alignment interaction and picture-to-building reveal must not block this slice. Scale within the drawing is still required.

## 2. Entry point and compact flow

**Present:** `LevelsSection.handleAddLevel` creates a `LevelNode` under the selected building, writes `DEFAULT_LEVEL_HEIGHT`, and selects it. `LevelItem` already has a three-dot popover with Duplicate, Duplicate with options, and Delete. [H1]

**Implemented entry point:** **Import from floorplan…** is first in both the sidebar level popover and the floating floor selector's three-dot popover, above duplication actions. Both receive the same host generator callback. The existing “Add level” wording is preserved; “floor” describes the user's task, not a second node type or a broad UI rename. The importer captures the clicked row's `level.id`, not whichever floor happens to be selected when an asynchronous request finishes.

```text
Building
  Ground floor                  [⋯]
  First floor                   [⋯] → Import from floorplan…
  + Add level

┌ Import from floorplan — First floor ──────────────┐
│ Choose a floorplan                              │
│ [ Drop a drawing here or choose a file ]         │
│                                                │
│ [Source preview / selected page]                 │
│ Scale: from drawing, or one known distance       │
│ Height: current level setting · assumptions      │
│                                                │
│ Creates native construction, source zones       │
│ and supported furniture/fixtures.               │
│ Does not align with other floors.               │
│                                                │
│                         Close  Extract evidence │
└────────────────────────────────────────────────┘
```

The prototype accepts a raster drawing or a selected PDF page. The broader DXF/SVG/vector investigation remains in the research plan; the prototype must not advertise an accepted file type until its real parser works. A page containing multiple plans needs a floor crop/selection, not automatic import of every plan as one floor.

1. **Choose the source.** Preview it before sending it to any provider. Select a page/crop when needed. Provider keys remain on the server.
2. **Extract evidence.** Run local raster extraction and inspect source-pixel strokes, candidate bands and regions. A band needs raster support: filled material or comparably thin outline faces, allowing window mullions. Parallel lines alone do not establish thickness. Candidate bands are translucent with separate centrelines and are not classified walls; furniture outlines can also qualify. No provider credentials, consent or model charge are required. Sparse evidence remains inspectable with blocking sufficiency issues.
3. **Optionally run SAM.** With explicit remote consent, send three concise concept requests: walls, doors/windows, and furniture. Each may return up to twelve candidates; the import retains at most twelve masks total, allocating slots round-robin among nonempty groups before downloading/normalizing selected PNGs. This removes the fixed four-per-concept reservation without adding requests or automatic retries. The prior raw-response byte bound is unchanged. Inspect source alignment and coverage, and choose which masks to include. Empty output is failed detection, not proof of object absence; provider saturation and candidates excluded by the shared budget produce separate coverage warnings. SAM is not authoritative topology or an exhaustive fixture detector.
4. **Interpret, then independently review.** Each button starts one model stage. Inspect the candidate, validation issues and semantic layers between calls. Malformed or truncated output retains its bounded raw text and reported charge and can be sent explicitly to the reviewer without manual JSON repair. The reviewer must independently reconstruct from the original source and feature ledger, not autocomplete partial geometry. Non-success provider completion reasons remain blocking even for JSON-valid output; only strictly validated reviewer output can become a draft.
5. **Resolve blockers.** Supply missing scale, resolve catalog matches, and acknowledge warnings/vertical assumptions. Editing evidence, masks or proposal text invalidates dependent results without automatically rerunning paid stages. Re-extraction creates a new ledger and invalidates downstream candidates rather than reusing obsolete feature IDs.
6. **Inspect native preview, then Apply.** The read-only preview uses the actual native adapter graph, Pascal floorplan builders and catalog plan assets. Apply is disabled until native preview readiness and review requirements pass. Nothing is inserted before explicit Apply.
7. **Inspect the result and cost.** Return to the selected level with created counts and the native source guide. Report cumulative model charges across retries, including invalid responses; identify unavailable charges separately instead of claiming a complete bill.

For this first new-floor flow, importing into a level that already contains construction, zones or props is blocked with “Create an empty floor to import this plan.” Existing reference guides alone do not make it occupied. Recheck at commit; no implicit merge, replacement or duplicate generation. These are later workflows, not hidden default behavior.

### Implemented interpretation checkpoints

Requested during manual QA and now implemented locally. Intermediate interpretation is visible before committing Pascal primitives:

1. **Source and extraction:** untouched drawing, extracted lines/regions, and source-pixel coordinates. Printed dimensions are interpreted later, not OCR claims from the classical extraction stage.
2. **Semantic review:** independently toggleable floor, wall/opening, room, and prop groups; decoded masks over the source, not RLE alone. Masks are provider suggestions; labels/geometry remain subject to evidence and local validation.
3. **2.5D review:** slightly raised or separated semantic layers for inspecting overlaps and omissions. Presentation height is not inferred construction height.
4. **Native proposal and Apply:** read-only native top-view inspection before explicit commit. All native groups must be restored before Apply so hiding a group cannot bypass its geometry checks. This replaces clean-import auto-commit; it is not a second insertion path.

Stage inputs, outputs, model identity, duration, reported cost and source transforms are retained in the dialog and downloadable through **Save inspection data**. A failed or stopped stage leaves preceding checkpoints inspectable; editing upstream evidence invalidates downstream proposals. Closing discards this in-memory inspection session. Stop never silently retries and warns that provider work already started may still be charged. PNG decoding, source dimensions and measured alpha coverage are checked; geometric orientation is preserved, while semantic correctness still requires human inspection.

### Provider configuration and cost

- `OPENROUTER_API_KEY` enables **`google/gemini-3.8-flash`** for both interpretation and explicitly triggered review. The user replaced Astra after an upstream rate-limit error. The reviewer still rechecks original evidence in a separate request, but this is no longer a cross-model review. `FAL_KEY` separately enables optional `fal-ai/sam-3/image` segmentation. Missing SAM configuration does not prevent interpretation without masks. Production paid-route host/token guards remain in force.
- Model calls use direct evidence-grounded instructions, text before original/marked/mask images, strict structured output, no temperature override, required parameter support, no provider fallback, and existing data-denial/ZDR settings. Interpretation uses **low reasoning**; review retains **high reasoning**. Both roles use Gemini's reduced wire schema, selected by model family rather than role: omit pattern/exclusive-bound keywords and array cardinality while retaining inclusive numeric constraints. Earlier live probes isolated `minItems`/`maxItems` as the cause of a 400 for this nested floorplan grammar, not as universally unsupported Gemini keywords. Local Zod retains all constraints, including string lengths and array limits. Neither reasoning setting is a measured floorplan quality/cost optimum.
- Both Gemini roles request `max_tokens: 65536` with a six-minute provider timeout. The reviewer was raised from 12,000 tokens/90 seconds after a real `length` / `MAX_TOKENS` response; it must reconstruct the complete candidate, not a shorter patch. The route job timeout remains 390 seconds and its declared maximum duration remains 400 seconds. These are upper bounds, not reserved/billed token quantities or a guarantee of completed output. More generated output may cost more; truncated output remains blocked. Public [Flash endpoint metadata](https://openrouter.ai/api/v1/models/google/gemini-3.8-flash/endpoints) and the [ZDR endpoint registry](https://openrouter.ai/api/v1/endpoints/zdr) list compatible Vertex routes; they do not prove account-specific routing or live availability. Privacy is not weakened to work around a rejection.
- **Total reported model cost** accumulates successful and schema-invalid responses plus explicit reruns throughout the open import session. Known client or server preflight rejections report zero model cost. Failures after a provider-backed stream starts, stopped requests, and SAM responses without billing data remain unknown and make the total explicitly incomplete. The UI shows known USD charges and unknown-attempt counts, including on completion; it does not substitute advertised pricing for actual charges.
- Guidance consulted: [OpenAI model and prompting guide](https://developers.openai.com/api/docs/guides/latest-model.md), [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs.md), [OpenRouter image inputs](https://openrouter.ai/docs/guides/overview/multimodal/image-understanding), [OpenRouter completion contract](https://openrouter.ai/docs/api/api-reference/chat/create-a-chat-completion), [OpenRouter HTTP-200 error semantics](https://openrouter.ai/docs/api_reference/errors-and-debugging.md), and [fal SAM 3 PNG contract](https://fal.ai/models/fal-ai/sam-3/image/llms.txt). These inform configuration; they do not establish reconstruction accuracy.
- **Flash switch verification, 7 September 2026:** 12 server regression tests passed. An offline smoke run exercised the real server request/resolution path with intercepted provider responses: Flash/low reasoning, Gemini-compatible token field, unchanged privacy, valid wall geometry, and local rejection of invalid IDs despite the reduced wire schema. No paid inference or floorplan-accuracy evaluation was performed. [Gemini structured-output limits](https://ai.google.dev/gemini-api/docs/structured-output) and [OpenRouter reasoning controls](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens.md) informed the request changes.
- **Flash schema regression correction, 7 September 2026:** switching back from Sol had inadvertently retained array bounds in Gemini's wire schema; the initial offline smoke did not catch this. A deterministic replay of the recorded provider rejection failed before the correction and passed afterward. All **13 server tests / 59 assertions** passed, including local rejection of invalid wall counts, polygon and tuple lengths, and oversized arrays. A direct offline server smoke observed zero array-bound keywords for Flash versus 34 for Astra, strict output/privacy unchanged, and valid wall geometry for both roles. No paid probe was repeated; current live-provider acceptance and completed floorplan reconstruction remain unverified.
- **Gemini reviewer replacement, 7 September 2026:** switched the explicit reviewer from Astra to Flash after the user reported an upstream rate limit. Both roles passed the Gemini schema/token-field compatibility regressions; **16 server/client tests / 64 assertions** passed, as did Biome on the three changed code files. An offline call through the actual server observed Flash/low for interpretation and Flash/high for review, their respective output caps, strict privacy, one intercepted request per action, and resolved wall geometry. No paid inference was run. The separate W5 opening-width rejection remains undiagnosed without its retained candidate and feature ledger.
- **Reviewer budget correction, 7 September 2026:** the user reported a truncated Gemini reviewer candidate. Raised its output cap and timeout to match interpretation, retaining high review reasoning. **16 server/client tests / 64 assertions** and Biome passed. An offline actual-server smoke observed `max_tokens: 65536` and a 360,000 ms deadline; completed output resolved, while `length` / `MAX_TOKENS` still produced no draft and retained candidate text and reported cost without retry. No paid inference was run, and no truncated text was repaired or accepted as geometry.

## 3. What “full floor” means

The selected `LevelNode` already exists. The importer populates it; it must not create a second level, renumber the building, or rewrite the target's height/base elevation as a side effect of calibration.

| Source content | Generated native content / rule |
|---|---|
| Exterior and interior wall evidence | Editable `WallNode`s with source-supported axes, thickness and connectivity. No wall where there is only a semantic boundary. |
| Floor footprint and voids | Native surfaces respecting validated boundaries/holes. Use the existing explicit-versus-derived surface policy; do not create a slab and also accidentally trigger a duplicate auto-slab. |
| Doors, windows and pass-throughs | Real native hosted openings, correct wall children, orientation and cut dimensions. Missing elevations are disclosed assumptions; unsupported host/symbol cases are unresolved, not decorative meshes. |
| Source rooms / semantic zones | Native `ZoneNode`s under this level according to the rules below. |
| Furniture and fixtures | Existing catalog `ItemNode`s or justified native parametric kinds, preserving source-derived pose and asset normalization. Missing matches remain visible in the review; they are not replaced with fake boxes or broken assets. |
| Accepted printed dimensions | Native associative dimension annotations where references are proven, retaining source values separately from calculated lengths. |

The [native mapping](./FLOORPLAN-RECONSTRUCTION-RND.md#7-native-pascal-integration-without-mcp) remains authoritative for field conventions and host limitations. “Full” means the selected milestone's supported, source-evidenced contents are accounted for, not that a plan reveals exact hidden construction, heights, materials or product identities. Milestone 1 must not claim rooms or furnishing; milestone 2 can succeed without props. When optional furnishing is requested, report missing/unresolved props explicitly rather than relabeling an incomplete furnishing pass as complete.

### Source-zone policy

- A room label associated with an unambiguous enclosed boundary becomes a named room zone. Preserve the source name, number and language; do not translate or relabel silently.
- A clearly bounded but unlabelled room may become a zone with a neutral generated name such as “Room 1,” visibly distinguished from source text. Do not infer “bedroom” solely because the room is rectangular.
- Explicit hatches, outlines or clearly supported semantic subregions can define open-plan zones. Living and dining can share a physical enclosure. Do not insert a wall to make a zone easier to represent.
- A label floating in an open area without enough evidence for a boundary remains unresolved. Ask for confirmation/correction rather than manufacture a precise polygon or divide the space evenly.
- No source-supported room/zone regions means no imported zones. Do not fill the floor with invented zones merely to satisfy a count.
- Use `spaceRole: 'room'` for architectural room documentation. Only a proven wall enclosure gets `autoFromWalls: true` and actual `boundaryWallIds`. Source-defined open-plan zones retain explicit polygons with `autoFromWalls: false`; mark `enclosureStatus` according to the accepted evidence. [H2]
- Reconcile repeated labels and connected regions before creation: one source zone should not become duplicate native zones. Room/surface detection is not a substitute for source-name association.

### Coordinate contract without cross-floor alignment

Use a calibrated metric source-to-level X/Z transform. A deterministic initial placement is the accepted floor footprint's bounds centre at level-local `(0, 0)`, with drawing-up mapped to `-Z` and no automatic north/previous-floor rotation. Preserve source pixel/vector coordinates and the complete mapping, including page/crop transforms, so a later alignment step does not require recognition again.

Do not let the current camera pose determine geometry. Native level stacking provides world elevation; `baseElevation` is an additive stack offset, not an absolute Y. Surface elevations and thickness follow native vertical semantics. Existing lower-floor authored nodes are not edited, although native derived behavior such as a covering slab's effect on wall tops can still apply. [H3]

## 4. Lifecycle and failure behavior

| State | Visible surface / available action | Mutation rule |
|---|---|---|
| Choosing source | File/page preview, target floor, scale/assumptions; Cancel | No new scene nodes. |
| Ready | Extract evidence | Bind source, target level and scene revision to this attempt. |
| Processing stage | Actual extraction / segmentation / interpretation / review progress; Stop stage | Work on retained isolated evidence/drafts. No streaming partial walls into the document. |
| Needs input / checkpoint | Inspect stage JSON, masks and semantic/native groups; correct, continue or Close | Invalidate dependent results after changes; never mix old scale with new coordinates. Apply requires reviewed native-preview readiness. |
| Applying | Short non-interruptible native commit; “Creating floor” | Prevalidated full graph, public mutation API, parents before children, one import history step. Failure must restore the pre-import document. |
| Complete | Native floor, source guide, created counts, reported cost, Undo | Ordinary native editing. Import worker is no longer needed to render or edit the floor. |
| Failed | Actionable error, retained source/input, Retry or Close | No half-created floor and no automatic paid retry. Retry rechecks target/revision and duplicate protection. |
| Cancelled | Dialog closes, focus returns to the floor menu trigger | Discard draft; late worker results cannot commit. The floor created before opening the importer remains. |

Other-floor navigation must not retarget the attempt. A deleted target, occupied target, or changed relevant scene revision blocks commit and asks for a fresh validation. Applying twice is rejected; Undo removes imported content but leaves the previously created empty floor. Redo restores the import. A history wrapper alone does not establish rollback; this needs an exercised failure path.

Reuse Pascal's existing popover/dialog primitives and semantic tokens (`bg-popover`, `text-popover-foreground`, `border-border`, `bg-accent`, destructive/error states), not a separate visual theme. Keep the current compact menu spacing. The import view must fit the viewport, scroll its body on small windows, and keep actions reachable. Use an accessible name for the three-dot button, show it on keyboard focus as well as hover, restore focus on close, trap focus inside the dialog, and announce real stage changes/errors. Escape cancels outside the short commit phase; expose that temporary restriction clearly.

## 5. Later alignment and reveal — explicitly deferred

The proposed later interaction is a top-down comparison of the imported source/geometry with the floor below: pan/zoom the camera for inspection and adjust the import's planar translation/yaw with human-selected correspondences. Scale correction is distinct from rigid alignment; do not silently resize a correctly calibrated floor to make silhouettes match. Camera movement changes the view, not alignment data.

Keep an import record with source reference/transform and generated node membership so a future alignment command can transform the correct native roots and annotations once, without double-transforming wall-hosted openings. This is proposed integration data, not a new persistent mesh group or a claim that the host already offers this API.

A later reveal can hold the source flat, introduce zone outlines, and visually raise the construction into place while moving to an oblique view. It is presentation-only, skippable and respects reduced motion. Native nodes are committed in their final geometry before it runs; skipping or interrupting the animation must not affect document state, undo or export. No reveal animation is required for the first prototype's acceptance.

## 6. Implementation order and completion gate

1. **Integrated adapter proof:** add the real selected-level entry point and run a hand-checked draft through the native adapter in the editor. This is a developer diagnostic, never a canned response to an uploaded plan and not the finished prototype.
2. **Real generation:** connect raster/PDF-page evidence, scale, shape-grounded Gemini 3.8 Flash/Astra interpretation/validation and native asset resolution to that same flow. Provider setup/spend approval remains an external prerequisite; no fake generation when it is absent.
3. **End-to-end acceptance:** exercise a supplied/authorized drawing through the actual three-dot entry point and inspect the native result. Do not declare completion at the adapter-only milestone.

Acceptance scenarios for implementation:

- Create a floor, open its menu, import a drawing, generate native construction, source zones, dimensions and supported props on that exact floor. No extra floor is created.
- A labelled enclosed room retains its name and editable zone; an unlabelled room gets only a neutral name; an open-plan living/dining example does not acquire an invented partition; a no-zones drawing does not receive fabricated zones.
- Withhold one dimension and verify the scaled estimate against independent truth. Unknown scale produces a question, not arbitrary metric geometry.
- Change selection while extraction runs; the target remains bound. Delete or populate that target; the import cannot silently apply elsewhere or overwrite it.
- Cancel, fail a native apply, double-submit, Undo and Redo; observe no partial residue or duplication. Creation of the initial floor remains a separate history action.
- Inspect native 2D/3D, move a wall, edit an opening, rename a zone and move/rotate a prop. Save/reload; verify normal native content and usable source-overlay persistence.
- Import above an existing floor without any registration step. Neither recognition nor completion depends on matching the lower floor or playing a reveal animation.

**Verification checkpoint — 7 September 2026**

- Upstream `505013b4` was merged into the local fork as `7e2c5ce1`, preserving Environment host capabilities and the uncommitted importer. The editor is served at `http://localhost:3001/`; the local Environment source mirror remains active.
- The capture-protocol, core, viewer, and nodes builds passed. Native-import and raster-feature tests passed: **11 tests, 53 assertions**, covering native graph creation, undo/redo, rollback, stale/occupied targets, calibration blockers, opening validation, reserved source IDs, and concave boundaries.
- Browser checks exercised mouse/keyboard entry, PNG preparation and known-distance calibration, two-page PDF rendering and page selection, consent gating, and Escape/focus restoration. These are limited observations, not completion of the acceptance scenarios above; crop interaction and native-result inspection still need user QA.
- The configuration endpoint reported a configured server. The initial real OpenRouter attempt reached the interpreter but received HTTP 400, retained the source, and created no scene content. A successful interpreter/reviewer/native-commit cycle has **not** been verified.
- Initial schema normalization did not eliminate Google's HTTP 400. Three subsequently authorized schema-only interpreter probes isolated array cardinality constraints: minimal schema **200**, current floorplan schema **400 INVALID_ARGUMENT**, the same floorplan schema without `minItems`/`maxItems` **200**. Provider serialization now omits those constraints while Zod still enforces wall-count, polygon and tuple bounds; an offline post-fix check exercised that separation. The two accepted probes stopped at the 64-token cap (`finish_reason: length`); they prove request acceptance, not completed reconstruction. Reported total cost: **$0.00219225**. No floorplan image was sent or generation retried.
- Two earlier isolated `fal-ai/sam-3-1/image-rle` probes used a synthetic 640 × 480 floorplan: text-only `room interior` returned no masks; a point-prompted request returned RLE `1 307200` with score `0.5` and null boxes. Under one-based start/length decoding this covers all 307,200 pixels, not a room. The endpoint documentation does not specify its RLE convention; decoding/orientation remain unverified. Null boxes are not independently proof of failure, and the score is not calibrated semantic correctness. Neither result establishes useful room segmentation. These probes predate the new PNG integration and do not validate it.
- Following the floating-menu and aspect-ratio fixes, editor-package typechecking and the **11 importer tests / 53 assertions** passed. A throwaway DOM probe opened the actual file picker from the floating floor menu and exercised calibration mapping with portrait and landscape sources. Preview and crop image sizing now preserve intrinsic proportions; no browser visual verification was performed. The whole-host typecheck still reports TSL union-complexity errors in Environment's `field-vegetation.tsx:20` and `neighborhood-shadows.tsx:38`; those unrelated files were left untouched.
- The user's subsequent real interpreter response parsed as JSON but failed local grounded-schema validation. Its original content was not retained, so the specific offending field is still unknown. Errors now expose up to four schema paths and validation messages, bounded to 1,500 detail characters, without returning the raw model payload. An offline fixture verified that invalid wall/polygon/tuple counts remain rejected and produce actionable field diagnostics with no retry; this is not a diagnosis of the user's discarded response.
- The staged implementation now retains raw invalid candidates, path diagnostics, inputs/outputs and usage; independent review is an explicit separate action. No clean-import auto-commit remains.
- A throwaway DOM/runtime smoke exercised actual PNG preparation, extraction checkpoint, consent gating, semantic review, real native SVG/catalog loading and explicit Apply. The resulting diagnostic floor contained four walls, one door, one zone, one catalog bed, one associative dimension and one surface, with no extra level or pre-Apply mutation. It also exercised Stop/late-result rejection, explicit reviewer rerun cost accumulation and proposal-edit invalidation. Model outputs were local deterministic fixtures, not reconstruction of a real supplied floorplan.
- Offline server smoke exercised actual raster extraction, inspectable sparse evidence, syntax/schema-invalid candidates with retained cost/path diagnostics, JSON-valid reviewer repair, metric transformation, and provider rejection without retry. Separate PNG-mask smoke exercised three-group dispatch, asymmetric source-pixel correspondence, transparent normalization, exact coverage, off-origin URL rejection and source-size mismatch rejection. All provider responses were local fixtures; **zero paid requests**.
- After integration, editor-package typechecking passed and native-import/raster-feature tests passed: **11 tests, 53 assertions**. Repository-configured formatting/lint passed for the seven included touched files; the two UI files are excluded by the existing Biome configuration. Host typechecking remains blocked outside this importer by Environment's `neighborhood-shadows.tsx:38` union-complexity error and `third-ring.ts:442,824,998` missing-field errors. Those files were left untouched.
- The running local API also accepted an actual consent-free `extract` request: HTTP **200**, `extracting` progress, preserved 140 × 140 source dimensions, **110 lines**, reported cost **0**, and no provider models. Both provider configuration flags were available. This checked the live local route only, not a paid model stage.
- The user's 567 × 916 inspection export exposed false 42 px, 35 px and 46 px bands between dimension annotations and the building. Offline re-extraction of that exact raster removed those margin bands while preserving the measured 11 px left, right and top wall candidates. Regression coverage includes the dimension-gap failure, hollow outlines, window mullions and a thick diagonal wall, not a wall-width cap. The actual React evidence component was rendered offline and its SVG raster inspected; no browser interaction was automated.
- A subsequent offline client → API route → server → NDJSON smoke retained a truncated interpreter candidate and its charge, accepted it for an explicit independent review, and returned strictly validated source-ledger-derived geometry. Provider responses were local fixtures and made no network requests. The real interpreter's earlier raw response/completion status was not in the supplied export, so its specific syntax/truncation cause remains unknown.
- Focused validation passed: **28 tests** across raster, native import, SAM masks, model recovery and preflight billing; editor-package typechecking; isolated host-importer typechecking; and repository-configured formatting/lint for nine included files. SAM tests preserve distinct source-aligned instances across twelve masks, but do not establish recognition quality on the user's drawing. No paid inference ran during these corrections.
- Subsequent request corrections passed **30 focused tests**, editor-package typechecking, isolated host-importer typechecking and Biome checks on the five changed provider/route files. An offline call through the actual server captured both role-specific request bodies and resolved grounded geometry, then compared their output parameter/ceiling with the live public endpoint and ZDR metadata: Gemini matched Vertex ZDR routes; Astra matched Azure ZDR routes. No authenticated inference was made, so the user's reviewer 404 is not claimed resolved in their account. SAM regressions verify seven retained furniture instances when other groups are empty, fair selection under saturation, source-aligned pixels and no download of discarded candidates. These checks establish request/normalization behavior, not real-plan detection accuracy.
- Later manual QA reported empty SAM results for `walls` and `doors and windows`, an opening rejected on `wall-living-south`, and a reviewer response-contract failure. The SAM warning inspects the original validated provider mask list, not a list shortened by shared-budget selection or PNG decoding. Existing positive-mask replay retained all twelve masks. No inference was rerun; whether spatial prompts or a better concept query recover those detections remains unmeasured.
- The GPT cutover also corrected three reproducible integration cases: ordered text-part responses are concatenated before strict candidate parsing; HTTP-200 provider errors cannot become a candidate and surface a bounded, redacted provider reason; jambs on a measured thick wall face may project onto its axis, while points beyond the bounded normal/span tolerances remain blocked. The opening normal tolerance is `max(existing pixel tolerance, measured thickness / 2)`; longitudinal bounds are unchanged. Other invalid provider envelopes now name offending schema paths without dumping their values. The available inspection export contains neither the actual rejected candidate nor reviewer envelope, so these corrections are not proof that every reported run now succeeds.
- All three new regressions failed before correction and passed after it. Final verification: **33 focused tests / 7,462 assertions**, editor-package typechecking, scoped production host-importer typechecking, and Biome on the three changed source/test files passed. A throwaway call through the actual server captured Sol/Astra request bodies, preserved strict privacy and schema bounds, resolved an 8 px hosted opening from wall-face jambs, blocked a span overrun, and exercised provider diagnostics using five mocked responses and zero network requests. The running local configuration route also returned both provider flags successfully. No paid inference or browser automation ran.

The user explicitly requested that remaining manual QA be left to them. No further browser automation or live inference checks are implied by this checkpoint.

## Local evidence

- **[H1]** [Site panel](../../../editor/packages/editor/src/components/ui/sidebar/panels/site-panel/index.tsx), `LevelItem` and `LevelsSection.handleAddLevel`; [import dialog](../../packages/editor/src/components/ui/floorplan-import-dialog.tsx); [native adapter](../../packages/editor/src/lib/floorplan-import/native.ts).
- **[H2]** [Zone schema](../../../editor/packages/core/src/schema/nodes/zone.ts), lines 5–28: polygon, wall-bound behavior, room role, number, enclosure and room metadata. `parentId` comes from the base node.
- **[H3]** [Vertical architecture](../../../editor/wiki/architecture/vertical-model.md), lines 18–39 and 79–90; [node architecture](../../../editor/wiki/architecture/node-schemas.md), lines 48–72. The broader native mapping and evidence are maintained in the [R&D proposal](./FLOORPLAN-RECONSTRUCTION-RND.md#local-evidence-index).
