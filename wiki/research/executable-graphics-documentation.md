# Executable graphics documentation: source synthesis

## Scope

This note extracts implementation-relevant findings for a production-path graphics review lab. It separates what the cited projects and the current Pascal repository demonstrate from recommendations for Pascal; it is not a history of test maps and does not treat an existing screenshot as an oracle.

## Observed in the sources

### Discoverable spatial examples

Robin-Yann Storm distinguishes three practical forms: a **gym** for exercising interaction and metric boundaries, a **zoo** for comparing assets at scale and in context, and a **museum** for explaining systems through live examples. The article also shows why combinations can be valuable when the workflow is relational (for example, selecting zoo items and immediately operating them in a gym), while noting that one giant combined space is often less useful than focused exhibits. Its recurring usability properties are labels, scale references, teleport/direct access, contextual notes, and links to deeper documentation ([Storm, “Gyms, Zoos, and Museums”](https://rystorm.com/blog/gyms-zoos-museums-your-documentation-should-be-in-game)).

Epic's Content Examples are organized as separate feature levels with numbered stands. Some examples require play mode, and users are explicitly encouraged to open and modify an example to learn how it was assembled. The useful pattern is not merely a gallery: category-level navigation leads to small, numbered, executable stations ([Epic Content Examples](https://dev.epicgames.com/documentation/en-us/unreal-engine/content-examples-sample-project-for-unreal-engine)).

Epic's Game Animation Sample is a navigable obstacle course with locomotion, ledge, and vault interactions. It includes in-world entry points for read-me material and controls, destination buttons for moving directly between sections, runtime feature toggles, debug views, timescale/framerate controls, and still-camera behavior. This demonstrates an interactive gym with direct navigation and observation controls rather than a static sample scene ([Epic Game Animation Sample](https://dev.epicgames.com/documentation/en-us/unreal-engine/game-animation-sample-project-in-unreal-engine)).

Valve's commentary implementation gives contextual nodes a number and total node count, optional view targets/positions, teleport behavior, pre/post commands, and started/stopped outputs. Its stop path restores view state, removes temporary view entities, resets activity/playback state, cancels queued events, and clears the active node. The transferable finding is that contextual explanation needs a real activation lifecycle and cleanup, not just a marker and a text blob ([Valve CommentarySystem.cpp](https://raw.githubusercontent.com/ValveSoftware/source-sdk-2013/master/src/game/server/CommentarySystem.cpp)).

### Generated and curated content have different lifecycles

AssetPlacer can generate a temporary asset zoo from a library so assets can be browsed together in 3D and compared by size. The generated scene is temporary and overwritten unless the user deliberately saves a copy. Its library keeps references rather than copies; moved or deleted assets invalidate those references. Preview reload and asset-zoo generation are distinct operations ([AssetPlacer adding-assets documentation](https://raw.githubusercontent.com/CookieBadger/assetplacer-docs/main/adding_assets.rst)).

Khronos' glTF Sample Assets repository is a curated collection organized by intended use: showcase, complete, testing, core-only, tutorials, PBR tests, and known-issue lists. The generated browse lists include a name, screenshot, interactive-viewer link, description, and license/credit data. This demonstrates that one asset identity can join catalog discovery, interactive viewing, documentation, provenance, and testing intent without making every showcased asset a golden test ([Khronos glTF-Sample-Assets](https://github.com/KhronosGroup/glTF-Sample-Assets)).

### Reproducible rendering needs explicit state and readiness

Three.js's end-to-end harness reuses example screenshots as review thumbnails and pixel-test inputs. Its deterministic injection replaces randomness and clocks, controls `requestAnimationFrame`, freezes videos while preserving explicit seeks, and waits for decoded frames. The runner waits for network idle, video readiness, and a render-completion signal before capture ([Three.js E2E directory](https://github.com/mrdoob/three.js/tree/dev/test/e2e)).

Google's model-viewer render-fidelity tests define named scenarios with a model, lighting, orbit/target, dimensions, skybox choice, renderer exclusions, references, and thresholds. The suite parameterizes the conditions that determine an image instead of relying on a default camera and implicit environment. A scenario can compare configured outputs from multiple renderers, so the scenario identity is separate from any one executable or golden ([model-viewer render-fidelity tests](https://github.com/google/model-viewer/tree/master/packages/render-fidelity-tools/test)).

Playwright generates and compares screenshots only after two consecutive captures agree. Its snapshot names include browser/platform context, and its documentation warns that OS, browser version, settings, hardware, power source, and headless mode can change rendering. It recommends generating and comparing in the same environment and requires baseline changes to be reviewed and committed ([Playwright visual comparisons](https://playwright.dev/docs/test-snapshots)).

Across these sources, explicitly controlled or recorded inputs include randomness, clocks/frame progression, asset/video/render readiness, camera and output dimensions, renderer scenario, and browser/platform baseline identity. None of the cited material treats an application renderer class name as proof of a particular hardware adapter, translation layer, or software rasterizer.

## Observed in Pascal

At the 2026-09-09 research baseline, the repository had usable seeds but no general review-lab runner:

- `packages/core/src/schema/__fixtures__/node-fixtures.ts` and `packages/mcp/src/templates/` provide schema-native/generated scene starting points. `packages/mcp/examples/coordinate-conventions-demo.json` is a runnable, spatial example built through the MCP API and paired with focused explanatory notes.
- `packages/viewer/src/components/viewer/index.tsx` accepts host-injected children and exposes scene-readiness callbacks. It waits for a committed scene root and pending build work to settle before reporting ready, with a host-selectable wall-clock cap for headless cadence.
- `packages/viewer/src/components/viewer/viewer-presentations.tsx` provides registered presentation subtrees and an optional host persistence seam with snapshot, restore, reset, and subscription operations. Presentation state is explicitly separate from the semantic scene graph.
- Item assets in `packages/core/src/schema/nodes/item.ts` carry `[width, height, depth]` dimensions and scale, which can drive a true-scale asset zoo.
- `packages/viewer/src/lib/snapshot-pipeline.ts` already owns capture modes and the standard 1920×1080 WebP path.
- At that baseline, `apps/editor/components/scene-loader.tsx` composed the normal editor scene host. Its thumbnail callback posted no captured blob to an explicitly stubbed endpoint, and a focused repository search found no generic case catalog/runner to repurpose. The Environment lab created by this work can supersede that gap; this statement is intentionally historical.

These are dated observations of source inspected before the Environment lab implementation, not a claim that the pieces already formed executable documentation or that the gap remains.

## Recommendations for Pascal

### One host, one case identity

Add the review lab at the application/embedder layer. Keep `packages/core` free of UI/rendering concepts and keep `packages/viewer` free of editor tools. Reuse the production `Editor`, `Viewer`, node registry, systems, presentations, loaders, and scene schemas. Plugin-owned cases may be exported through a narrow lab descriptor entry, but the host should own catalog/search/routing and scratch persistence.

Give every case a stable `caseId` shared by its catalog entry, deep link, fixture, exhibit, notes, source links, cameras, reset contract, capture metadata, and optional verification evidence. This is enough structure; Pascal does not need a standalone renderer or a new general-purpose documentation framework.

### Exhaustive, honest inventory

Inventory every user-visible Environment feature family from authoritative plugin registrations, definitions, panels/tools, and catalog data. Map each family to one or more cases, including combined cases when a relationship is the behavior being reviewed. Map isolated cases where causal diagnosis matters. Any family that cannot run in the lab remains searchable with an explicit unsupported reason and impact. “Not shown” must not be mistaken for “supported.”

### Mode-specific behavior

- **Zoo:** lay out catalog assets using production dimensions and ordinary transforms, include a metre/familiar scale reference, shared lighting, identity/source data, search/focus, and visible missing/stale references. Regeneration updates generated rows deterministically while preserving curated vignettes, cameras, and notes.
- **Gym:** drive the actual editor placement, selection, handles, toggles, and state transitions. Where the interaction contract applies to both plan and perspective views, exercise the same case in 2D and 3D and expose divergence. Reset semantic scene, editor tool/selection, presentation, camera, supported time/random controls, and temporary resources.
- **Museum:** use numbered/directly navigable stations, run the actual system, and co-locate concise why/how/do/don't guidance with source links. Activation and route exit restore camera, controls, overlays, subscriptions, timers, and modified state.
- **Combined cases:** use them for Environment relationships such as terrain/surroundings/atmosphere/wind interactions; retain small isolated cases for attribution and captures.

### Reproduction, capture, and acceptance

Run cases in an unmistakably disposable scratch project/scene namespace so reset and regeneration cannot overwrite user work. Version generated sources separately from curated overlays and report stale dependencies before regeneration.

Classify each animated case as repeatable semantic-state, live-observation, or deterministic-capture. All three reset a canonical semantic state and record the time/random controls they actually support. Live-observation cases keep production clocks and state their limits. Only deterministic-capture cases require a seeded stream and logical clock controlling every relevant source; an unmet determinism requirement remains explicitly blocked or unsupported. For captures, record fixture fingerprint, camera, viewport, DPR, browser/OS, requested render path, actual adapter/backend evidence, assets, and readiness outcome. Extend viewer readiness with case-specific asset/presentation readiness and require a presented frame; use timeout only to report a blocker.

Treat current lab output as documentation and observation. Only the independent criteria owner may promote a case to a permanent test, select a golden/reference, define thresholds and platforms, or approve a baseline update. Use the existing `gfx-quality`/`work-hygiene` roles for that acceptance. Add performance work only after an observed slow/unstable frame, exceeded budget, large population, or repeated resource cost; a review lab does not itself justify profiling.

Blender, apprenticeship workflows, heavy spatial worlds, and custom frameworks are not prerequisites. Introduce one only when a specific feature or approved requirement demands it.