# Plan-to-Pascal — dimension-constrained reconstruction R&D

**Date:** 7 September 2026. **Status:** proposal, not an implemented feature or an accuracy claim.

Plan-to-Pascal is a reconstruction R&D project for the Pascal editor and Studio, requested by Adam. Its planning belongs with the editor, not the Environment plugin or its mission corpus. This proposal does not authorize paid inference. The companion [primary-source research note](./FLOORPLAN-RECONSTRUCTION-SOURCES.md) records model/tool candidates and their limitations.

**Revised direction after manual QA:** milestone 1 is precise walls, doors and windows; milestone 2 adds room boundaries and OCR-grounded names; milestone 3 adds optional furniture/fixtures. The first two take priority. Keep the native floor adapter and evidence-grounded Gemini 3.8 Flash / GPT-6 Astra experiment, but do not mistake a larger model budget or more SAM masks for a complete feature extractor. The [source note](./FLOORPLAN-RECONSTRUCTION-SOURCES.md) compares the proposed extraction stack with floorplan-specific alternatives.

**Prototype lifecycle:** create a floor → that floor's three-dot menu → **Import from floorplan…** → review native construction, then source-supported rooms/zones and optionally props. The [integrated prototype](./FLOORPLAN-IMPORT-PROTOTYPE.md) records the implemented stages and their limited verification. The three semantic milestones proposed here are not yet separate implemented passes. Cross-floor alignment and the picture-to-building reveal are deferred; source-to-model scale is not.

## 1. Decision and product promise

Build a **measured, reviewable reconstruction pipeline** that turns a CAD/vector or raster floorplan into **a native, editable Pascal floor: walls, floor surfaces, hosted doors/windows, room zones and dimension annotations, with optional identified props**. Trace geometry to the drawing; label catalog-selected 3D appearance and missing heights as reconstructions or assumptions. Do not build an image-to-mesh generator or depend on MCP.

The commercial promise is **less tracing and fewer dimensional mistakes, with an editable result and visible evidence**. A convincing render alone is not success. “Accurate” must distinguish compliance with accepted drawing dimensions, agreement with independently checked geometry, and fidelity to the physical building; this project can establish the first two, not an as-built survey.

Recommended progression: **selected-floor import entry point and native adapter in the editor → grounded extraction experiments feeding that same flow → complete automatic floor import → Studio-owned production jobs and packaging**. A local workbench remains an engineering instrument, not a separate prerequisite user journey. Output remains ordinary Pascal content after the importer is removed. Reuse native architectural and item kinds rather than inventing a second geometry system.

## 2. What Pascal already has, and what is missing

| Status | Observed capability | Consequence |
|---|---|---|
| Present | Editor reference upload saves an image and creates a `GuideNode`; its panel supports positioning, rotation, opacity and scale calibration. [P1] | Useful source overlay, not automatic reconstruction. |
| Present, separate MCP path | `analyze_floorplan_image` asks the host model for wall segments, named room polygons and approximate dimensions. `photo_to_scene` materializes walls/zones in a new scene. [P2] | A useful conceptual single-shot baseline, but not the requested product. No native door/window extraction, dimension-to-feature association or geometric reconciliation in that orchestrator. |
| Present | Native architectural nodes, hosted-opening geometry, scene mutation/history, geometric room detection, semantic zones, and associative measurement infrastructure. [P3–P6] | Reuse Pascal for authoring and rendering; the missing work is evidence extraction, constrained topology and review. |
| Present | Native level/slab geometry, catalog-backed `ItemNode` props, parametric cabinet runs/modules and native prop floorplan projections. [P12–P16] | Reuse their schema/rendering/asset conventions. Source segmentation overlays and semantic-to-native matching remain importer work. |
| Present prototype; incomplete extraction | Selected-floor import, bounded raster feature ledger, optional SAM masks, two VLM stages, strict draft validation and native adapter. [Integrated checkpoint](./FLOORPLAN-IMPORT-PROTOTYPE.md) | Original-resolution evidence, explicit opening cues, independent OCR, structural graph reconstruction and metric constraint solving remain missing; the prototype does not establish milestone 1/2 extraction accuracy. |

The preceding inspection ran `bun test src/tools/photo-to-scene/photo-to-scene.test.ts src/tools/vision/analyze-floorplan-image.test.ts` in `editor/packages/mcp`: **9 passed, 0 failed**. These use mocked vision responses. They establish neither real recognition quality nor the new pipeline.

### Local extraction audit — 7 September 2026

The current implementations were inspected separately from the research literature:

| Observed boundary | Evidence and required consequence |
|---|---|
| Prepared raster is not the uploaded original | [`source.ts`](../../packages/editor/src/lib/floorplan-import/source.ts), `fitDimensions` / `prepareRenderedPage`, downscales the page to at most 1600 px per side before cropping. The prepared request carries neither original dimensions nor an inverse original-to-prepared transform. Preserve original bytes/vector page and reversible crop/resize/rectification transforms before claiming source-level precision. This cap does not downscale the supplied 567 × 916 fixture. |
| Candidate limits are reached on the supplied plan | An actual consent-free `generateFloorplanOnServer(action: 'extract')` run returned **1,423 points, 80 L bands, 80 E strokes, 51 S empty regions and 29 R ink regions**, cost 0, no models and no issues. [`features.ts`](../../packages/editor/src/lib/floorplan-import/features.ts), `findSegments` / `findRegions`, limits each line family and the combined region set to 80. This proves saturation, not which useful features were lost. The new extractor needs bounded spatial/detail coverage with explicit overflow, not an unexplained global longest/largest shortlist or an unbounded prompt dump. |
| No typed opening or OCR evidence | [`schema.ts`](../../packages/editor/src/lib/floorplan-import/schema.ts), `floorplanFeaturesSchema`, exposes only points, lines and regions. The extractor has no arc/leaf/jamb/gap/OCR observations. A VLM cannot reference a precise opening endpoint or text observation that the ledger does not contain. |
| Validation is not reconstruction | [`floorplan-import-server.ts`](../../apps/editor/lib/floorplan-import-server.ts), `projectOpeningToWall`, projects and tolerance-clamps existing points onto a selected segment. `resolveScale` checks scale consistency but does not solve a wall graph against dimensions. `resolveGroundedDraft` validates generic region/point references for zones; these are not independently read text or solved enclosure boundaries. Keep those safeguards, but add the missing observations and structural solve rather than relaxing grounding. |
| Empty raster components are not rooms | `findRegions` preserves useful concave contours, but text/furniture fragment free space and door gaps connect spaces. Room boundaries must come from accepted structural chains and hosted portals, not a raw flood fill or the existence of an `S` region. |

The existing source-aligned masks, retained provider failures/costs, separation of candidate bands from semantic walls, and native validation remain useful. None supplies the missing observations by itself.

## 3. First fixture: the supplied 567 × 916 image

This attachment is a **raster reproduction of an architectural drawing**, not source CAD. Its original vector file is not available in the current evidence.

| Evidence visible in the attachment | Interpretation permitted now |
|---|---|
| Horizontal text `7000`; vertical text `11725` | Preserve these raw strings. No unit is printed alongside them. Millimetres are a plausible interpretation requiring confirmation. |
| Horizontal witness lines apparently span the main top exterior edges | Candidate overall-width constraint; verify exact reference faces and exclude the lower left projection unless proven otherwise. |
| Vertical witnesses apparently span the top edge to the Bedroom 1/porch baseline | Candidate overall-depth constraint, not automatically the lowest dashed outline or projecting element. |
| Bedroom 1/2/3, two `T&B` labels, kitchen, dirty kitchen, dining, partly obscured living-area label, porch | Semantic hypotheses. Living/dining can be separate named zones in one connected space; do not invent a partition. |
| Door arcs, paired linework at openings, filled wall bands, furniture, isolated black blocks and dashed lines | Candidate symbol classes. Closets, furniture, columns and porch outlines must not become walls by default. |
| No legible internal dimension chain or vertical schedule | Internal widths, wall thicknesses, sill/head heights and storey height cannot all be declared measured. |

**Sampling calculation, not an extraction result:** assuming `7000` means millimetres and manually estimating a roughly 460-pixel witness span gives `7000 / 460 ≈ 15.22 mm/pixel`. Two to three pixels correspond to approximately **30–46 mm**. This calculation was executed during planning; no segmentation or paid recognition was run. Upscaling helps inspect symbols but does not manufacture missing geometric information.

Fixture milestone 1 means recovering wall topology, creating real hosted openings and satisfying the two constraints **once their units/references are confirmed**. Milestone 2 adds independently read labels attached to accepted enclosures or explicitly supported open-plan regions. Props are a separate optional milestone. Clearly separate printed dimensions, scaled geometric estimates, catalog dimensions and unknowns. The preview cannot justify millimetre-accurate internal geometry or identification of an exact furniture product.

**Measured local OCR diagnostic, not a parser benchmark.** On the original 567 × 916 raster, Apple Vision `VNRecognizeTextRequest` revision 3, accurate mode, `en-US`, no language correction, full-frame input and no crops returned 12 observations in approximately 0.325 seconds of request execution on this workstation (compile/startup excluded). It read `7000`, `DIRTY KITCHEN`, `BEDROOM 3`, `KITCHEN`, `BEDROOM 2`, two distinct `T&B`, `BEDROOM 1` and `PORCH`. It returned `DINING:` instead of the visible `DINING`, only `LIVING` from the obscured living-area label, and a false `00000` from the five small drawn squares. It missed vertical `11725`. All returned candidates had confidence 1, including the false symbol reading. No external provider request or new dependency installation was made; Tesseract was not installed. This single run justifies raw-text retention, symbol rejection and a rotated-text/crop experiment, **not** choosing Apple Vision over an untested OCR engine. Apple documents the [recognition/language controls](https://developer.apple.com/documentation/vision/vnrecognizetextrequest); it is a macOS diagnostic here, not the portable server recommendation.

## 4. Pipeline and stage contracts

```text
Source drawing
  → deterministic source parsing / raster preparation
  → calibrated, stable-ID shapes / edges / landmarks + dimension evidence
  → model-assigned labels / instance groups / feature relations
  → metric constraints and deterministic solve
  → independent evidence review + bounded arbitration
  → source overlay and explicit human decisions
  → validated native floor draft, including measured object placements
  → accepted scene commit + native 2D/3D and edit checks
```

| Stage | Work | Durable output / exit condition |
|---|---|---|
| S0 — intake | Identify DXF, SVG, vector PDF, scan or photographed page; preserve originals, page/layer identity and source digest. Separate paper-space/model-space transforms and clipped viewports. DWG is a conversion route with a separately verified reader/license, not presumed DXF compatibility. | Source manifest, supported/unsupported features, coordinate frames, file rights and privacy choice. Never execute SVG scripts, external resources or drawing text as instructions. |
| S1 — recover evidence | Extract vector paths, blocks, text and dimension entities before rasterizing. For raster input, preserve full resolution and page/crop transforms; combine strokes, arcs, junctions, connected components and segmentation candidates. Attach stable IDs and compute contours, oriented axes, landmarks and nearby relations. OCR text separately. | Versioned shape/feature ledger and reversible coordinate transforms. Original, unmarked crops remain available. A segmentation region is not yet an architectural object. |
| S2 — dimensions | Associate printed values with witness features; establish and cross-check scale/rectification before converting extracted geometry to metres. Retain a separate record for an undimensioned span estimated from calibrated boundaries. | Printed constraints versus inferred measurements, with reference/scale/boundary uncertainty and unresolved alternatives. Conflicting calibration blocks a metric-verified result. |
| S3 — semantics | Gemini 3.8 Flash and Astra see the original plan, numbered shape overlays and feature records. Classify walls/openings, room labels and props; propose instance grouping, facing/hinge feature references and relative relationships. | Labels and relations grounded in existing evidence IDs; no trusted free-form XYZ, size or rotation. Missing shapes trigger a localized extraction/review request, not invented geometry. |
| S4 — graph and solve | Pair wall faces, split real junctions, attach openings and identify spaces. Solve metric constraints; derive object footprints/placements from accepted geometry and orientation features, then match supported native assets. | Candidate floor graph, object transforms, residuals and unresolved relations. Inferred dimensions remain estimates; impossible or conflicting geometry is not silently averaged. |
| S5 — review | Independently inspect high-risk dimensions, labels, hosts, prop grouping and facing. Give reviewers original pixels as well as marked shapes so shared extraction mistakes remain visible. Compute geometry diagnostics in code. | Supported/refuted/insufficient-evidence findings with source references. Targeted arbitration may request a better mask/feature fit, but cannot override absent evidence by consensus. |
| S6 — human release | Compare source and native orthographic projection; inspect dimensions, hosts, orientations, unmapped props and uncertain vertical/asset parameters. Confirm, correct, or retain a visibly incomplete draft. | Accepted graph and assumption list bound to source/segmentation/transform/constraint versions. No silent acceptance of disputed placement or omitted objects. |
| S7 — Pascal | Build native nodes through the direct floor adapter, validate the graph and asset references, preview off the live scene, then commit. | Editable floor surfaces, walls/openings/zones, dimensions and supported props, source-to-node mapping, one undoable import and save/reload evidence. Cancellation leaves the scene unchanged. |
| S8 — verify and report | Overlay actual native floorplan features/prop footprints; inspect 3D cuts, pivot alignment and facing. Score geometry, semantics and asset correspondence separately; measure correction time, cost and latency. | Reproducible run bundle and accuracy/coverage report. A convincing render does not validate placement. |

### Build order: the floor importer first

The first runnable engineering result is **one source plan becoming one editable Pascal floor through a real native adapter**, using an independently traced/checked draft as the input. “Floor” means the level and its construction/content, not merely a background image or slab. Exercise it behind the actual selected-floor menu, with source upload/overlay, calibration and native creation; no model credential or SAM installation is required for this adapter proof. It is not the complete user prototype: that requires real extraction from the uploaded drawing, not a canned or manually substituted recognition result.

The accepted draft carries the coordinate frame, level/vertical assumptions, floor boundaries, wall/opening/space graph, dimension references and semantic object inventory. Start with a small known floor containing real hosted openings and an asymmetric native prop; prove native edits and transform alignment. Hand-checked evidence is the initial fixture, not a production fallback that fabricates a successful recognition result.

Once that import path works, replace manual evidence capture with the vector/raster/segmentation extractors while retaining the same review and creation path. This isolates recognition errors from Pascal integration errors and gives every later model experiment an immediate 2D/3D result to inspect.

### Extraction milestones: structure first, rooms second, props optional

These are **proposed semantic passes and release gates**, not new buttons or implemented extraction. Share one versioned evidence ledger; do not rebuild the drawing from scratch in each call.

| Milestone | Input and work | Output / acceptance boundary |
|---|---|---|
| **M1 — walls, doors, windows** | Original/vector geometry plus overview and original-resolution detail crops; independently extracted wall faces, filled bands, line endpoints, junction candidates, jambs/gaps, leaves/arcs and window-frame cues. OCR may run here to separate annotations and read scale evidence. Interpret structural classes/relations, then deterministically fit chains and host-relative opening intervals. | Reviewed wall/portal graph and native wall cuts; wall/opening precision/recall, boundary error and wrong-host rates measured independently. No invented partition, erased opening, orphan opening, unsupported thickness or clamped-away host mismatch. Rooms and props are not required outputs. |
| **M2 — spaces and OCR names** | Freeze the accepted M1 graph. Derive enclosure cycles with doors represented as portals, associate raw OCR polygons with those spaces, and distinguish labels from dimensions/symbols. Handle multiple names in a connected open space without adding walls. | Room geometry and text association scored separately. Keep repeated `T&B` as separate observations/rooms when topology supports them. A living/dining label without a supported dividing boundary remains a semantic label or an unresolved zone, not an arbitrary polygon. OCR disagreement cannot silently rewrite M1. |
| **M3 — optional props** | Freeze construction and spaces. Only then classify/group furniture/fixtures, extract instance footprints and supported facing cues, and resolve native catalog assets. | Separate instance/pose/asset coverage report. Missing or ambiguous props do not invalidate a completed M1/M2 run, but may not be advertised as furnished completion. No generic rectangles pretending to be identified furniture. |

**Execution order is not three blind model calls.** Source parsing, geometry candidates and OCR form shared evidence; OCR must be available early for text/dimension discrimination even though named-room reconstruction is M2. Use small stage-specific semantic outputs and immutable accepted inputs. Independent review checks each selected milestone against original pixels; any proposed structural correction reopens M1 and invalidates dependent results explicitly. Further paid calls remain user-authorized, not automatic recovery.

**Pattern grammar for M1.** Filled wall material or supported double faces are candidates only when boundary continuity and junction context agree. A wall chain can continue logically across a source-evidenced door/window cut; the cut remains a hosted interval, not an invented solid partition. Door evidence can combine jamb endpoints, a leaf and a hinge-centred arc; sliding doors or passages require their own cues rather than a mandatory arc. Window evidence can combine a band interruption with frame/sill/mullion strokes. Dimension baselines, witness lines, ticks/arrows, text glyphs, tile hatching, dashed porch outlines, isolated columns and furniture/closet contours are negative or ambiguous structural evidence—not walls by appearance alone. Keep unresolved alternatives when conventions differ. A model chooses among measured observations; it does not turn these verbal patterns into measured coordinates.

**Preprocessing contract.** Preserve the original and derive separately recorded grayscale, threshold, deskew and denoise views only for observation extraction. Keep the coordinate mapping back to the original; these pixel operations are not themselves lossless or reversible. Read text before suppressing candidate glyphs in a separate geometry view; never erase source ink or globally close gaps to force rooms. Compare every selected boundary back to original pixels. Generative cleanup/super-resolution is excluded from geometric authority; no measured benefit or source-faithfulness guarantee has been established for it. Global context plus bounded native-resolution crops is preferred to a single downscaled image, subject to the benchmark below.

## 5. Geometry authority and the internal representation

Use one small external interface for the reconstruction module: **prepare evidence → reconstruct a reviewable draft → accept a versioned draft**. Keep OCR, model calls, candidate enumeration and solving inside the implementation. A native Pascal adapter consumes the accepted graph; it never interprets free-form model prose.

Minimum internal records:

- **Source:** digest, format, page/layer/view, declared units, source bounds, and complete source→canonical-plan transform. Every crop stores its own invertible mapping back to the source.
- **Shape/feature:** stable ID within an extraction revision; source vector IDs or mask/contour; child edges/landmarks; holes/overlaps; candidate instance groups; fitted axes/footprint; crop-to-source transform; boundary uncertainty. Colors are a display property, not identity or an already accepted class.
- **Observation:** stable ID, kind, source primitive/shape/feature/crop IDs, raw text or geometry, model/parser provenance, alternatives and decision state. Raw evidence never changes because a solver moved a wall; re-extraction creates a new revision with explicit lineage.
- **Dimension:** value, unit, rounding/tolerance, two or more geometric references, reference type (axis, structural face, finished face, jamb/clear opening, etc.), status and evidence. A dimension is not just a floating text label near a wall.
- **Plan graph:** junctions, wall chains with face/axis geometry and thickness, openings as host-relative intervals, enclosure cycles, and separate named functional zones. Include non-wall obstacles such as columns when they affect the interpretation; unknown symbols remain evidence, not invented native content.
- **Semantic object:** evidence group, proposed class/subtype, room/host relations, facing/back/hinge feature IDs, measured footprint, native asset/primitive resolution state and transform provenance. Keep class, boundary, facing, scale and asset-match confidence separate. “Bed” can be known while its head direction or exact 3D asset remains unresolved.
- **Vertical parameters:** value plus `dimensioned`, `user-confirmed`, `estimated` or `unknown`. Storey height, door head, window head and sill are independent of plan XY evidence.
- **Decision/release:** selected alternatives, explicit assumptions, residuals, source/graph versions, human actions and a digest. Native IDs map back to accepted graph IDs and source evidence.

Use canonical SI metres in level-local X/Z for Pascal. Conversion from image coordinates must explicitly account for rotation, reflection and origin; verify a known asymmetric fixture so a Y-down image cannot silently mirror a hinge. Cropping and resampling must not change metric scale.

### Constraint kernel

Solve discrete alternatives (symbol class, host, face/axis association) separately from continuous parameters (junction positions, thicknesses, opening positions/widths). Fit line evidence robustly, but make accepted dimensional requirements explicit constraints with their actual tolerances. Pixel-derived observations are lower-authority estimates with a documented uncertainty model, not fake survey measurements.

Rules for conflicting evidence:

1. Preserve both CAD geometry and displayed/overridden dimensions. An inconsistency creates a review finding; neither wins silently.
2. After the user accepts a dimensional interpretation, the solver must satisfy it within the declared rounding/tolerance or report infeasibility with the conflicting observations.
3. Orthogonality/parallelism are supported hypotheses, not blanket Manhattan assumptions. Preserve diagonal/curved walls when the drawing supports them.
4. Distinguish wall axis, structural faces and finished faces. Pairing dark bands cannot alone establish assembly thickness or finish layers.
5. Preserve the wall's host continuity through a recognized door/window opening. The opening is a cutout with a host, not a reason to erase the logical wall. Do not bridge arbitrary gaps merely to force room closure.
6. Validate opening spans, intersections, junctions and enclosure topology after solving. Width, host, elevation and swing must agree with the chosen native semantics.
7. Detect closed spaces from the wall graph; associate labels afterwards. A named open-plan area is not proof of an enclosed room. Porch, void, exterior and room classifications remain distinct.
8. Rank-deficient or underconstrained regions remain explicit. Request an internal dimension or user acceptance of an estimate; an overall bounding dimension does not uniquely locate every partition.

**Printed constraints and generated annotations are different:** show the source's immutable dimension value beside the actual geometry-derived Pascal measurement and its residual. Never override a displayed measurement to hide a mismatch. Imported dimension evidence is not automatically a persistent CAD constraint system after later manual Pascal edits; revalidation must report divergence.

### Segmentation can estimate missing measurements—after calibration

Yes: when the drawing is to scale, an extracted boundary provides otherwise missing distances, footprint extents and relative positions. The roles are **segmentation/vectorization = where the drawn geometry is; VLM = what it represents and which features belong together; geometry/constraint code = metric placement and dimensions**. None of these steps establishes the accuracy of the original drawing itself.

For a rectified, uniformly scaled plan, a reference of `D` metres spanning `N` source pixels gives `s = D / N`; an undimensioned span of `n` pixels estimates `L = n × s`. Use multiple independent dimensions, preferably along both axes, to detect wrong references or distortion. Do not independently stretch X/Z merely to conceal a disagreement. A photographed plan requires justified rectification; two scalar dimensions alone do not establish an arbitrary homography.

**Illustrative arithmetic checked during planning, not a floorplan extraction:** a 10 m reference spanning 1,000 px yields 0.01 m/px. An 80 × 160 px footprint estimates 0.8 × 1.6 m. With ±2 px uncertainty on each endpoint of both the reference and object spans, conservative bounds are approximately 0.757–0.843 m and 1.554–1.647 m, even before source-drawing or rectification error. Upscaling cannot remove that uncertainty.

Keep four different dimensional origins visible: **printed/accepted constraint**, **scaled geometric estimate**, **catalog or explicit user assumption**, and **unknown**. Do not calibrate a whole plan from an assumed standard bed width. Furniture symbols may not be drawn to scale; overlapping symbols, line thickness, text occlusion and missing boundaries need explicit flags. The geometry of a swing arc is not the footprint of the door leaf or wall.

### Numbered shapes as the VLM's spatial vocabulary

This is a floorplan-specific experiment in the spirit of [Set-of-Mark prompting](https://arxiv.org/abs/2310.11441): models refer to marked source regions instead of recreating their coordinates. The published method is evidence for the interaction pattern, not proof of accuracy on plans or on the selected frontier models; the source note records its limitations.

1. Preserve the original plan and derive a neutral overlay with translucent candidate regions, outlines and prefixed region/edge IDs such as `R37` and `R37:E2`. Compare alphabetic versus numeric marks where printed dimensions could be confused with labels; keep marks away from dimension text and small features. Colors distinguish regions without pre-labeling all blue regions as “bed.” Supply separate original and marked crops so overlays cannot conceal the only evidence.
2. Give each model the original, the marked view, full-floor context and a compact feature ledger in the same source coordinate frame. IDs survive crop/resize/palette changes; extraction revisions are explicit.
3. Ask for semantic selections such as **“regions 37 and 38 form one bed; edge 37:e2 is its headboard; it belongs to space 2”**, not “put a bed at approximately (4.2, 3.1).” These IDs are an illustrative contract, not detections in the supplied image.
4. Compute the object's footprint and anchor from the selected geometry. A minimum-area rectangle or dominant axis supplies candidate axes, not guaranteed facing: rectangles have a 180° ambiguity and near-squares may not provide a stable axis at all. A visible headboard, seat back, fixture back edge or accepted wall relationship resolves direction relative to actual features.
5. Validate grouping and transforms. One object may span several masks; a single mask may merge a table and chairs. Record explicit split/merge proposals rather than treating every colored component as one prop. When an instance is missing, ask for a new candidate region and rerun extraction—do not silently create geometry from a model guess.
6. Match an existing native asset/primitive and align its known local footprint, forward axis and pivot to the measured object frame. Model-local origin need not be the mask centroid. Inspect the transformed native footprint against source before accepting placement.

The reviewer must be able to reject the extraction itself. Two VLMs agreeing on the same incorrect mask are not independent geometric evidence. Compare raw-image coordinate predictions as an experimental baseline, including Astra; promote them only as reviewed hypotheses, never to trusted placement because the model is newer.

## 6. Multi-VLM strategy: adapt the rig's principles, not its private implementation

The local Topology Review Rig preserves independent critic results, computes disagreement in code, and targets `(discordant ∪ mandatory)` rules for arbitration. It also has typed content-addressed cache keys and snapshot-bound review decisions. [T1–T3] These are directly relevant mechanisms; they are not evidence that an ensemble measures floorplans accurately.

Recommended floorplan roles:

| Role | Input and responsibility | Not allowed |
|---|---|---|
| Parser/OCR | Vector primitives or source pixels; propose text, lines, arcs, dimensions and associations. | Converting a scale note into unconditional building units without checking the page/view. |
| Gemini 3.8 Flash — architectural interpreter | Original plan, marked shapes and feature ledger; assign classes, instance groups, room/host relations and facing/hinge feature references, including props. | Repainting the layout or turning guessed coordinates into accepted transforms. |
| GPT-6 Astra — independent reviewer | Original evidence and same closed schema, without Flash's narrative on its first pass; inspect dimensions, shape completeness, labels, host and facing. Also test Astra as the initial interpreter. | Assuming it localizes precisely because it is a frontier model, or accepting shared-mask errors because labels agree. |
| Deterministic checker | Metric conversion, fitted geometry, dimension residuals, topology, opening bounds, asset pivot/footprint alignment, collisions and missing-evidence flags. | Treating high model confidence as a substitute for geometric evidence. |
| Arbiter — targeted escalation | Original evidence, alternate groupings/relations, relevant rule and diagnostics for a disputed crop. Can request re-extraction before choosing an interpretation. | Resolving absent source information by majority vote or silently revising a measurement. |
| Human | Units/references, unresolved geometry/semantics, prop matching and missing vertical parameters. | Being told that catalog appearance or a model placement guess was recovered precisely from the plan. |

Start with the requested frontier pair; do not begin with the older model shortlist. Compare both as interpreters before fixing roles, and add a third family only if a later experiment justifies it. Every calibration and auto-accepted opening host is a mandatory check. Preserve minority findings. Self-confidence and consensus are not calibrated probabilities, and sharing a feature ledger creates a shared failure mode.

Transfer the rig's region-lock idea as **a declared graph edit scope**: changes name wall/opening/zone/object/feature IDs and revalidate affected relations. A rectangular crop is not a safe topology mutation boundary; a split or merged mask invalidates dependent label/pose decisions.

Use content-addressed stage caching including source bytes, page/layer selection, crop transform, accepted dimensions, schema/prompt/parser versions, model/provider identity and decoding settings. Distinguish cache replay from fresh evaluation; record actual fresh spend separately from nominal replay value. A changed calibration invalidates dependent geometry even when the pixels are identical.

**Ownership:** the inspected rig identifies itself as private AssetHub-inc research. Reuse architectural lessons, not its code, prompts, rulebooks, reference images or proprietary fixtures without permission. Adam's earlier Evolution Virtual bpy/SVG workflow is user-reported precedent; the narrow local search did not locate its source. Neither codebase is a prerequisite for an independent Pascal implementation.

## 7. Native Pascal integration, without MCP

Use native schema factories and public `@pascal-app/core` authoring facilities, not imports from MCP tool handlers or a replacement Blender mesh. Python is a practical research worker for CAD/OCR/segmentation; TypeScript owns the Pascal adapter and native round-trip. Blender/bpy can be a synthetic-fixture oracle if useful, but is not required to create the building.

Adapter requirements based on inspected local host contracts; exercise the foundation in E0 and the full automatic path in E6 before claiming a working importer:

- Select an existing target level or create one under the chosen building; supply explicit vertical assumptions. Import the accepted floor surface, with holes, through `SlabNode` or the deliberately chosen native auto-surface mode. Do not overwrite an existing level's height/elevation as an incidental calibration effect. [P12]
- Resolve semantic props to real native kinds/assets. Compute native pose from source features and the selected asset's canonical frame; store the accepted label and source-to-node association without inventing node kinds or geometry. [P13–P16]
- Create walls in level-local metric coordinates. Choose a consistent endpoint order; host-relative opening orientation depends on it.
- Create each door/window with a real wall parent/host relation, not a mesh positioned beside a wall. Translate jamb/clear-opening/frame evidence into the exact native width/height semantics before creating a node.
- Reconstruct hinge, swing and sliding semantics supported by the native kind. Unsupported symbol variants must be reported, not substituted silently.
- Create semantic zones separately from detected spaces. Open-plan living/dining may share an enclosure without gaining an artificial wall.
- Use the host's existing floor/ceiling derivation and measurement machinery where applicable; do not duplicate geometry systems. Explicit floor/ceiling parameters require evidence or disclosed assumptions.
- Materialize verified source dimension strings as **native associative `ConstructionDimensionNode`s visible on the reconstructed floor plan**, with correct witness features, baseline and metric notation. Keep the immutable source value separately and display any residual; never use `textOverride` to make incorrect geometry appear to satisfy a printed dimension. [P11]
- Prevalidate the full graph, references and opening constraints before touching `useScene`. Group accepted creation into one history step using public mutation APIs. **One history step is not by itself proof of rollback on failure**; cancellation, partial-failure recovery and undo are native acceptance gates.
- Bind the accepted draft to the target level and scene revision; stale drafts require review, not automatic overwrite. Make repeated application of the same accepted import a detectable duplicate.
- Keep raw drawings, model responses and job metadata outside node geometry. Persist source-to-native mapping and accepted provenance through a documented host-owned import record; that record is a proposed seam, not an existing plugin capability.
- Prove normal native editing, save/reload, editor 2D/3D, parametric viewer, generic GLB export and Pascal GLB viewing. The import job is not needed to render the finished scene.

A later native edit may legitimately break a source dimension. Report this as divergence; do not make an invisible background AI job move the user's wall back.

### Verified local adapter mapping

| Accepted graph fact | Native representation | Important qualification |
|---|---|---|
| Target floor | `LevelNode` with explicit storey `height`; level children for construction/content | `baseElevation` is an additive offset above the computed stack, not an absolute world height. Keep the import in the selected level-local frame. [P12] |
| Floor surface | `SlabNode`: `polygon`, `holes`, `elevation`, `thickness`, parent = level | `elevation` is the walking top; thickness grows down. The first fixture can use one explicit slab; later surfaces follow the accepted plan, not an assumed one-slab-per-room rule. [P12] |
| Wall axis and thickness | `WallNode`: `start/end: [x,z]`, `thickness`, parent = level | Ordinary plane-bound walls omit `height` and follow the native level/covering-slab bound. Set storey height explicitly from a source or acknowledged assumption; do not freeze every wall height unnecessarily. [P3] |
| Door on a straight wall | `DoorNode`: `parentId = wallId`, `wallId`, `position: [s, centreY, 0]`, wall-local rotation, `side`, `width/height` | `s` locates the opening centre along the wall from its authored start. Use native `doorType`, `leafCount`, `hingesSide`, `swingDirection` and `slideDirection` as supported. [P7] |
| Window on a straight wall | `WindowNode`: same parent/host/position contract | Use `windowType`, `operationState`, `awningDirection`, `casementStyle`, `hingesSide`; door swing fields are not window fields. The vertical centre requires a window height and bottom elevation; neither is generally recoverable from a plan alone. [P7] |
| Opening size | Native `width/height` drive the rendered wall cut | These are modeled overall dimensions, not a guaranteed clear passage or manufacturer rough opening. `roughOpening*`, `masonryOpening*`, `finishOpening*` are separate document fields and do not change this CSG cut. Preserve the source dimension's meaning; do not copy a clear width into `width` without a supported conversion. [P7–P8] |
| Named space | Explicit `ZoneNode` under the level | Room detection does not itself create named zones. Only proven enclosure associations get wall-bound behavior; living/dining sub-zones remain separate semantic polygons without new partitions. [P4] |
| Floor furniture/fixture | `ItemNode` with a resolved catalog `asset`, level-local `position`, Euler `rotation` and instance `scale` | **Parent = level, not slab.** Slab support is geometric. Preserve asset `offset/rotation/scale`; they normalize the GLB and are distinct from the item's pose. [P13–P14] |
| Parametric construction/furnishing | Existing `ColumnNode`, or `CabinetNode` plus hosted `CabinetModuleNode`s when that interpretation is justified | Use kind-specific geometry and parameters. The catalog's `tool: 'cabinet'` entry is not a generic `ItemNode` instruction. A class label alone does not recover cabinet compartments or material details. [P14–P16] |
| Verified dimension annotation | `ConstructionDimensionNode` with semantic anchors, independent `baseline`, suitable `chainMode` and `metricNotation` | Wall features include start/end, centreline and left/right faces. Associate the actual referenced feature rather than substituting an axis for a face; retain source witness locations in provenance. Unresolved dimensions stay review evidence. [P11] |
| Approved batch | `useScene.getState().applyNodeChanges({ create: createOps })` inside `runAsSingleSceneHistoryStep(useScene, ...)` | Each create operation is **`{ node, parentId }`**, not a raw node. Submit parents before children; the store maintains `children` lists. Prevalidation and the failure/undo experiments remain required. [P9] |

The viewer derives wall cutouts from the wall's actual `children`, not a standalone `wallId` reference. This is why genuine containment is essential. Local opening yaw is relative to the host wall; confirm front/back and hinge mapping with asymmetric fixtures, including reversed wall endpoints. [P8]

Choose one surface mode per import: let native closed-wall detection create/reconcile floors and ceilings, or submit explicit validated surfaces with detection deliberately suspended and resumed through public `pauseSpaceDetection`/`resumeSpaceDetection`. Do not accidentally request both; verify the selected mode's complete undo behavior. [P4]

### Native prop reuse and transform acceptance

1. **Resolve semantics before selecting geometry.** The public `CATALOG_ITEMS` export at `@pascal-app/editor/catalog` supplies real asset records; a host can supply its own resolver. Match accepted class, footprint and tags to a concrete asset, preserving the full record. A generic catalog bed is a representative reconstruction, not proof of the exact pictured product. Respect catalog tool dispatch and native parametric kinds rather than wrapping every tile as a GLB item. [P14, P16]
2. **Derive pose in the native frame.** Floor items remain level children. Their `rotation[1]` is yaw in radians; native X/Z plan rotation is clockwise for positive yaw. Match the source's directed features to the chosen asset's canonical frame and check an asymmetric fixture. Do not simply copy an image-angle convention or subtract the corrective asset rotation a second time. [P13, P15]
3. **Keep normalization separate.** The inspected renderer composes node position/rotation, then node scale, then asset corrective offset/rotation/scale. `getScaledDimensions()` multiplies catalog dimensions by node scale only. Preserve those corrections; do not modify `asset.dimensions` to cosmetically claim a fit to an unchanged mesh. Compare the transformed native footprint and actual rendered asset. [P13]
4. **Treat scale and height explicitly.** Prefer a correctly sized catalog asset or suitable parametric native kind. Any instance scaling must follow an accepted fit policy; arbitrary nonuniform stretching can distort the object. Source footprints do not reveal all heights, mounting elevations or vertical construction. Keep catalog-derived dimensions distinct from measured plan dimensions.
5. **Do not hide missing matches.** A semantic class and source footprint can be accepted while the native asset remains unresolved. Preserve the labeled object in the review/report for user selection; do not persist a fake item URL, a generic block disguised as furniture, or an unavailable GLB as a successful reconstruction. Report furnished coverage separately from construction completeness.
6. **Reuse native projections without overloading them.** `buildItemFloorplan` draws a rotated declared footprint and, when available, `asset.floorPlanUrl`. That URL is the catalog's own top-down symbol, not a place for source masks or confidence colors. The original/numbered segmentation overlay belongs to the import presentation layer; compare it against the native result. [P15]

The first adapter proof uses a floor-standing prop. The full experiment must also exercise any detected wall-, ceiling- or surface-attached fixtures through their real host-local conventions, and native cabinet modules where selected. Unhandled attachments remain explicit unresolved cases, not silently flattened floor props.

**Identified host limitations to investigate, not hide:**

- Current door/window placement tools reject curved wall hosts although walls have `curveOffset`. Preserve curved source geometry; a curved-host opening is an explicit host-integration gate, not permission to silently flatten the wall into an inaccurate approximation. [P10]
- The existing door floorplan projection depicts a conventional 90° swing independently of live `swingAngle`. Compare symbol semantics (hinge, direction, family), not raw arc-image equality; determine whether another annotation representation is required for nonstandard source notation. [P10]
- There is no verified general “clear passage width → complete frame/leaf geometry” conversion or reconstruction-job contract. These are specific research/product gaps, not reasons to bypass native nodes.

## 8. Research workbench and review experience

The first product prototype lives in the editor's selected-floor menu, as specified in the [prototype draft](./FLOORPLAN-IMPORT-PROTOTYPE.md). A local source/overlay view and stage artifacts remain developer tools. Avoid building a generalized agent platform before proving recognition.

The user flow is **Create floor → floor menu → Import from floorplan → choose source → Generate floor → inspect native result**. Confirm scale, missing vertical assumptions or conflicting reconstruction only when needed; if resolving issues changes the draft, require explicit confirmation before insertion. Do not require cross-floor alignment or a separate research workbench. The review view must expose:

- Source drawing and actual native floorplan overlay with a visibility slider, not a generated “corrected” image.
- Distinct measured, user-confirmed, estimated and unresolved states; no single reassuring score hiding local uncertainty.
- Click a wall, opening or prop to see its source shapes/features, semantic label, measured footprint, facing alternatives, native match and geometric residual.
- Concrete decisions such as “Does 7000 reference these outside faces?”, “Door or open passage?” or “Is this edge the sofa back?”, not a generic “approve AI output.”
- Named open regions versus enclosed rooms, unmapped/grouped props, missing boundaries and a missing-dimensions checklist.
- Current spend, remaining cap, cache status, and the cost/reason before further inference.
- Cancel with no live scene changes; explicit release of a complete or visibly incomplete draft.

A milestone 1 demo should end with the user moving a generated wall, editing a hosted opening and reading a live native dimension. Milestone 2 additionally renames a source-grounded room; milestone 3 moves/rotates a generated furniture item. The adapter must support the selected milestone's actions before AI recognition is treated as its result.

## 9. Experiments and stopping rules

All thresholds below are **proposed research gates**, not achieved results. Approve each paid batch separately. Do not run a full Cartesian product of models, prompts and drawings.

| Experiment | Comparison and deliverable | Gate / decision |
|---|---|---|
| E0 — native floor import and oracle | Build the real floor adapter/review path from a small hand-checked, calibrated floor with walls, slab, hosted openings, zones, dimensions and an asymmetric supported prop. Annotate the supplied image separately; record unknowns and tracing time. | Actual editable native content, correct scale/origin/pivot, visible source overlay, cancellation and one-step undo. No VLM or SAM dependency for this first proof. |
| E1 — CAD evidence into the importer | Feed DXF/SVG/vector PDF primitives and dimensions into the same shape/feature and floor-draft contracts. Compare source against native geometry; include block transforms and props. | Prove units/reference/host mapping and expose dimension conflicts. If this fails, adding models is not the remedy. |
| E2 — raster geometry and scale | Build marked shape/edge/landmark extraction and OCR. Include classical line/components **and a segmentation branch from the start**, not only after semantic models fail. Measure undimensioned spans against independently withheld dimensions. | Quantify boundary/scale error, fragmentation/merging and coverage by source quality. Neither segmentation scores nor satisfying calibration dimensions alone establishes accuracy. |
| E3 — frontier semantic grounding | Gemini 3.8 Flash and Astra independently label the same original+marked structural evidence and reference features for wall/opening/host relations. Evaluate OCR-to-space association in M2; defer furniture/fixture grouping and facing to optional M3. | Correct semantics and fewer corrections within each selected milestone. Compare both as interpreters; reject unsupported IDs and keep unknown states. |
| E4 — localization/grounding ablation | On the same small fixtures, compare each frontier model's raw-image coordinate/angle predictions, marked-shape semantic references with computed transforms, and those references with refined vector/mask/edge fits. Hold source resolution, calibration and native adapter constant. Separately test removal of the segmentation branch and SAM versus another extractor. | Measure centre/extent/boundary/yaw/host error and correction time. Establish whether geometry grounding beats direct Astra/Flash localization and whether SAM improves the geometry; do not attribute every gain to model quality. |
| E5 — validation ablation | Single interpreter versus independent frontier review plus targeted arbitration. Inspect original pixels, not only shared overlays; include wrong masks, merged props, misleading colored marks and ambiguous 180° facing. | Reviewer catches both label and extraction errors without inventing replacements. Measure avoided/introduced errors and additional cost; preserve correlated wrong agreement. |
| E6 — native/user acceptance by milestone | Automatic extraction→review→native construction for M1; source-grounded rooms for M2; optional resolved props for M3. Exercise correction, undo/redo, save/reload, 2D/3D/export and applicable asset orientation/pivot checks. Compare equivalent manual reconstruction. | Real editable content with measured coverage, visible unresolved objects and less total human work at equal accuracy. State the completed scope explicitly; no furnished-completion label for omitted requested props. |

### Corpus and split

Proposed pilot: **24 distinct layouts**, eight for development and sixteen held out. Include genuinely dimensioned vector originals, exported vector PDFs/SVGs, dense furniture/labels, different door/window symbols, sparse dimensions, rotated text, diagonals/curves, and degraded raster plans. Treat this as a feasibility corpus, not evidence of market-wide reliability.

Raster/vector/degraded versions of the same layout stay in the same split. Do not tune prompts on held-out failures and then report them as held out. Obtain source rights; public benchmark access is not automatic commercial permission. Independently annotate some dimensions withheld from the solver to avoid evaluating a fit against its own constraints. Extend to multi-page/multi-level drawings and unfamiliar regional conventions before a broad product claim; record unsupported content, never silently discard it.

### Measurements and proposed thresholds

| Measure | Proposed gate / interpretation |
|---|---|
| Source-dimension interpretation | Report text+unit accuracy **and correct feature association** separately. Every accepted critical dimension must have valid references; no known contradiction may be auto-accepted. |
| Constraint satisfaction | Residual within the accepted observation's tolerance; for an exact synthetic fixture use a separately declared numerical tolerance. This tests solving, not independent recognition accuracy. |
| Held-out metric error | On suitable dimensioned/vector oracles, aim for wall-face/opening-position **p95 ≤ 10 mm**. On high-resolution scaled raster oracles, aim for **p95 ≤ 30 mm** and report effective mm/pixel. Low-resolution preview fixtures get a separate uncertainty report, not a false 10 mm badge. |
| Topology and symbols | Aim for wall/opening precision and recall ≥ 95% using one-to-one object matching, host-aware opening matching and segmentation-invariant wall-chain comparison. Report exact counts and failure cases, not only an average. |
| Opening correctness | No out-of-span, orphaned or wrong-host openings in a released complete reconstruction. Report type/swing/hinge errors independently from positional accuracy. Human corrections count against automation. |
| Rooms and open areas | Enclosure/adjacency correctness and label assignment scored separately. No fabricated wall to divide a named open-plan region. |
| Props: identity and grouping | Score class/instance precision and recall, merged/split instances, room assignment and unmapped-asset counts separately. A correct label with a wrong footprint or missing item does not pass. |
| Props: placement and orientation | Measure centre/extent and transformed-footprint error in metres, plus yaw error modulo actual object symmetry. Check asymmetric fronts/backs and pivot offsets explicitly. Predeclare tolerances per source class/object use and report distributions; do not apply a building-dimension tolerance blindly to a symbolic furniture icon. |
| Inferred measurements | Evaluate distances withheld from calibration/solving against independent source truth; report uncertainty-bound coverage, systematic bias and failure cases. Separate calibration, boundary and source-symbol errors. |
| Coverage / abstention | Aim for ≥ 90% of in-scope walls/openings recovered before human correction; report unreviewed/rejected/unresolved items. Rejecting everything cannot pass an accuracy gate. |
| Native integrity | No invalid IDs/relations or duplicate application; correct wall cuts; one undo restores the prior scene; cancellation is a no-op; saved result is editable without the importer. |
| Dimension annotation integrity | Verified dimension chains appear on the native floor plan with correct units and feature associations. A subsequent wall edit updates the measured annotation and exposes disagreement with the unchanged source value; no cosmetic text override conceals error. |
| Human value | Target ≥ 50% median reduction in total human time versus manual tracing **at equal accepted geometric quality**, including upload, review and corrections. |
| Economics and reliability | Log cost per attempted plan and per accepted plan, correction minutes, p50/p95 latency, calls/retries, abstentions and failed runs. Cache-only replay must make zero provider calls. No cost/latency claim before measurement. |

Report metrics per source class and before/after human review. A small held-out set needs counts and uncertainty, not a production accuracy guarantee. A prettier reconstruction with worse dimensions fails.

## 10. Model and tool choices

The [source note](./FLOORPLAN-RECONSTRUCTION-SOURCES.md) owns dated model IDs, capabilities, pricing metadata and primary-source grounding methods. The public OpenRouter catalogue and ZDR endpoint list were checked for the selected models. Revalidate endpoint-specific support before paid execution; catalogue compatibility is not account-level availability.

- **Current testing profile:** **`google/gemini-3.8-flash` for both roles**, with low reasoning for interpretation and high reasoning for explicitly triggered review. The user replaced Astra after an upstream rate limit; review still rechecks original evidence in a separate request, but is not cross-model validation. Image input, structured output and compatible ZDR routes are listed for Flash. Astra, Sol and Mini remain optional controlled comparators, not runtime fallbacks; the multi-model experiments above remain proposals rather than the active profile. Compare original-only versus shape-grounded interpretation/localization with fixed evidence; floorplan performance remains unmeasured.
- **Segmentation/feature extraction:** a first-class source of spatial evidence in the raster experiments. Neutral marked shapes and feature IDs give VLM labels and relations precise referents; a deterministic layer computes geometry.
- **SAM 3:** one candidate segmentation backend, tested alongside vector/classical extraction rather than a mandatory infrastructure dependency. It does not supply metre scale, complete instance semantics or valid building topology by itself. CUDA/checkpoint prerequisites are documented. [M1]
- **SAM 3D:** outside the authoritative reconstruction path. Existing native assets/primitives provide 3D props from accepted semantics and pose; a generated object mesh cannot establish the source plan's dimensions or exact product identity.
- **CAD/PDF/SVG parsing and OCR:** choose maintained, license-compatible tools from the source note; retain source primitives and text boxes. Do not rasterize precise vector evidence unnecessarily.
- **Image generation:** outside the authoritative path. Optional presentation experiments must never alter the measured drawing or serve as geometric evidence.

Flash replaces the prior Sol interpreter profile for routine testing. Keep the existing output ceiling to avoid changing truncation behavior at the same time; measure actual usage rather than treating that ceiling as a charge. Stronger-model comparisons and review batches remain separately authorized experiments.

## 11. R&D versus plugin versus Studio

| Layer | Ownership recommendation |
|---|---|
| Separate R&D project | Native floor-import adapter/workbench first; then source normalization, shape/feature ledger, calibrated geometry, semantic/pose experiments and evaluation corpus. A proposed future sibling such as `pascal/plan-reconstruction` is not created by this planning task. |
| Studio/application | Authenticated jobs, credentials, upload/privacy consent, persistence, cancellation/resume, quotas, cost admission and eventual billing. These are not implied by the current node-plugin manifest. |
| Editor/plugin UI | Entry point, guide/source overlay, uncertainty decisions, native preview and accepted commit through public editor/core interfaces. Verify exact host-panel/extension gaps before packaging. |
| Pascal core/nodes | Existing level/surface/wall/door/window/zone/item kinds, asset/primitive facilities, host relations, rendering and dimensions. Missing general authoring contracts belong here rather than in a private geometry fork or deep-import shim. |

**Recommendation:** prove the native floor importer through the editor's selected-floor menu, then automate its evidence inputs; productize as a **Studio reconstruction feature with an editor entry point**. A local workbench supports engineering experiments, not a separate user journey. A node manifest does not supply secure long-running inference or billing. No MCP transport is necessary.

Do not couple the reconstruction module to Environment, use its runtime-only surroundings houses, or fork architectural geometry. This feature creates authoring content, not decorative neighborhood shells.

## 12. Cost, privacy and operational prerequisites

- Planning spends no model tokens through a user-provided provider account. No paid inference was performed in this task.
- For a first paid pilot, propose a **US$25 hard experiment ceiling**, subject to explicit approval and a fresh preflight estimate. This is a spending limit, **not a prediction of cost**; stop before the next call if its reserved upper bound exceeds the remainder. Price/token limits for a chosen model/provider must be known or the batch cannot be admitted.
- Start with a small development subset and bounded crops; escalate only disputed facts. Cache content-addressed results and preserve usage/provider receipts. Report unknown cost as unknown, not zero. Fresh variability evaluation intentionally bypasses replay and needs its own allowance.
- Supply an OpenRouter key later through an ignored local environment file or a host secret store, **never in chat, browser code, scene JSON or run artifacts**. Do not reuse credentials found in the topology rig or another project.
- An OpenRouter key is sufficient only for supported routed VLM calls. SAM compute, gated checkpoint access, permitted model licenses and any hosted segmentation credentials are separate prerequisites. Do not assume the current Apple workstation can execute a CUDA-only recipe unchanged.
- Drawings may expose addresses and client information. Disclose which crops/pages leave the machine, choose provider retention/training settings deliberately, and retain/delete artifacts under an explicit policy. Do not silently change provider or privacy policy on fallback.
- Treat PDFs/SVGs/DXF and drawing text as untrusted input; restrict file parsers, external references and model outputs. Models return data in a schema, not executable Python or scene-editing commands.

## 13. Milestones and first executable experiment

**Milestone A — integrated native floor import foundation:** E0 through the actual floor menu. Source overlay/calibration, hand-checked accepted draft, native creation and editing, including one grounded asymmetric prop. Exit with an editable floor and verified transform/undo behavior, not a model demo or an empty importer interface. The automatic user lifecycle remains the completion gate in the prototype draft, not this internal adapter proof.

**Milestone B — grounded evidence:** E1–E2. Vector and raster shape/feature extraction, neutral numbered overlays, scale checks, inferred measurements and uncertainty. Feed the existing adapter; report placement error before adding semantic-model complexity.

**Milestone C — frontier semantics and validation:** E3–E5. Gemini 3.8 Flash/Astra label shapes and feature relations, including props. Compare direct localization against computed placement and test segmentation/refinement/reviewer contribution independently.

**Milestone D — complete import/product proof:** E6. End-to-end extraction and human correction, native persistence/render/export, prop coverage and asset matching, then product packaging and pricing. Completion requires the native and recognition gates above.

First run after experiment approval:

1. Preserve the supplied image; use available source/vector or independently authored fixtures for metric truth. Confirm units/reference spans, while retaining unknown source dimensions explicitly.
2. Produce a hand-checked calibrated floor draft and exercise the **real native importer first**, including level/surface, walls, openings, named zones, dimensions and one asymmetric supported prop. Demonstrate edit/cancel/undo and source alignment without paid inference.
3. Generate source-aligned numbered shapes/features and compute the metric geometry, then inspect the raw and marked views together. Record candidate object groups and missing boundaries.
4. Under a separately approved inference cap, run Gemini 3.8 Flash and Astra on a small matched subset. Compare direct coordinate estimates with labels/feature references converted to placement by code; inspect failed masks as well as failed labels.
5. Review and import the inferred floor through the same adapter. Report printed versus inferred dimensions, prop coverage/matches, positional/orientation errors, human corrections and cost.

This revision specifies the implementation order; it does not claim the importer or recognition system has been built. Native adapter work needs no provider key. Paid model calls and a SAM deployment have separate credential/compute prerequisites; they do not block completing the plan or the later local adapter proof.

## Local evidence index

- **[P1] Reference upload:** [view-toggles.tsx](../../../editor/packages/editor/src/components/ui/action-menu/view-toggles.tsx), lines 24–27 and 94–127; [local-guide-image.ts](../../../editor/packages/editor/src/lib/local-guide-image.ts), lines 18–41; [reference-panel.tsx](../../../editor/packages/editor/src/components/ui/panels/reference-panel.tsx).
- **[P2] Existing AI path:** [analyze-floorplan-image.ts](../../../editor/packages/mcp/src/tools/vision/analyze-floorplan-image.ts), lines 21–57 and 121–186; [photo-to-scene.ts](../../../editor/packages/mcp/src/tools/photo-to-scene/photo-to-scene.ts), lines 161–214 and 231–429. [Tool registration](../../../editor/packages/mcp/src/tools/index.ts), lines 62–65, makes scene reconstruction conditional on a store. These are evidence only, not proposed dependencies.
- **[P3] Native model:** [node schemas architecture](../../../editor/wiki/architecture/node-schemas.md), [wall schema](../../../editor/packages/core/src/schema/nodes/wall.ts), and [vertical model](../../../editor/wiki/architecture/vertical-model.md), lines 18–39. Section 7 records the adapter mapping and qualifications.
- **[P4] Rooms:** [space-detection.ts](../../../editor/packages/core/src/lib/space-detection.ts), `extractRooms` and `detectSpacesForLevel`; [measurements architecture](../../../editor/wiki/architecture/measurements.md), lines 21–35, distinguishes enclosed spaces, manual zones and derived quantities.
- **[P5] Measurements:** [measurements.md](../../../editor/wiki/architecture/measurements.md), lines 37–69 and 71–96, documents metric semantic anchors and edit behavior.
- **[P6] Packaging:** [plugin-authoring.md](../../../editor/wiki/architecture/plugin-authoring.md), lines 9–54 and 85–105, and [plugin-panels.ts](../../../editor/packages/editor/src/lib/plugin-panels.ts), `EditorHostPanel`/`registerEditorHostPanel`; public-package-only authoring and a separate panel registration, not a supplied inference-job product.
- **[P7] Opening schemas:** [door.ts](../../../editor/packages/core/src/schema/nodes/door.ts), lines 58–120 and 154–161; [window.ts](../../../editor/packages/core/src/schema/nodes/window.ts), lines 39–107.
- **[P8] Rendered host/cutout:** [wall-system.tsx](../../../editor/packages/viewer/src/systems/wall/wall-system.tsx), lines 762–784 and 1291–1308.
- **[P9] Native mutation/history:** [node-actions.ts](../../../editor/packages/core/src/store/actions/node-actions.ts), lines 1275–1360; [history-control.ts](../../../editor/packages/core/src/store/history-control.ts), lines 252–278; public exports in [core index](../../../editor/packages/core/src/index.ts).
- **[P10] Opening limits:** [door placement](../../../editor/packages/nodes/src/door/tool.tsx), lines 462–495; [window placement](../../../editor/packages/nodes/src/window/tool.tsx), lines 522–557; [door floorplan](../../../editor/packages/nodes/src/door/floorplan.ts).
- **[P11] Native drawing dimensions:** [construction-dimension.ts](../../../editor/packages/core/src/schema/nodes/construction-dimension.ts), lines 63–105; [wall measurement features](../../../editor/packages/nodes/src/wall/measurement.ts), lines 39–114.
- **[P12] Native floor:** [level.ts](../../../editor/packages/core/src/schema/nodes/level.ts), lines 67–91; [slab.ts](../../../editor/packages/core/src/schema/nodes/slab.ts), lines 12–41.
- **[P13] Item pose and containment:** [item schema](../../../editor/packages/core/src/schema/nodes/item.ts), lines 98–131 and `getScaledDimensions`; [item renderer](../../../editor/packages/nodes/src/item/renderer.tsx), lines 456–468 and 694–705; [floorplan move](../../../editor/packages/nodes/src/item/floorplan-move.ts), lines 283–345.
- **[P14] Public catalog:** [editor package exports](../../../editor/packages/editor/package.json), lines 6–8; [catalog records](../../../editor/packages/editor/src/components/ui/item-catalog/catalog-items.tsx), lines 3–11, 57–84 and 448–490.
- **[P15] Native prop projections:** [item floorplan](../../../editor/packages/nodes/src/item/floorplan.ts), lines 34–45 and 232–307; [column floorplan](../../../editor/packages/nodes/src/column/floorplan.ts).
- **[P16] Native cabinet reuse:** [cabinet schemas](../../../editor/packages/core/src/schema/nodes/cabinet.ts), `CabinetNode` and `CabinetModuleNode`; [registered cabinet definition](../../../editor/packages/nodes/src/cabinet/definition.ts), lines 1924–1934 and 1973–1975.
- **[T1] Independent observations and selected arbitration:** [engine.py](../../../../topology-review-rig/pipeline/engine.py), lines 19–25, 1050–1068 and 1197–1249.
- **[T2] Cache identity:** [cache.py](../../../../topology-review-rig/pipeline/cache.py), lines 49–83. [Usage ledger](../../../../topology-review-rig/pipeline/usage.py) separates actual and replay accounting.
- **[T3] Review lineage:** [human_review_contracts.py](../../../../topology-review-rig/pipeline/human_review_contracts.py), [human_review_decisions.py](../../../../topology-review-rig/pipeline/human_review_decisions.py), and the private project's [README](../../../../topology-review-rig/README.md). Mechanisms inspected read-only; no private artifacts copied into the proposal.
- **[M1] SAM 3:** [official source](https://github.com/facebookresearch/sam3), model scope, prerequisites and checkpoint access; fuller external citations are in the [source note](./FLOORPLAN-RECONSTRUCTION-SOURCES.md).
