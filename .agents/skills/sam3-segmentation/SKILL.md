---
name: sam3-segmentation
description: Run and debug isolated SAM 3 image segmentation with text, foreground/background points, or boxes; use for direct fal SAM3 API experiments, prompt-coordinate problems, mask interpretation, and human click-guided floorplan segmentation. Stop at segmentation evidence—Pascal geometry, floorplan reconstruction, and VLM retries are outside this skill.
user_invocable: true
---

# SAM 3 segmentation lab

Use the isolated `apps/editor/sam3-lab` tool to answer one question at a time: **which mask best represents the human-selected target on one frozen image?** Keep provider facts, project-derived diagnostics, and human judgement distinct.

When prompt semantics, coordinates, output encoding, retention, retries, pricing, or SAM 3.1 are material, read [`references/official-sources.md`](references/official-sources.md) before acting. For measured local runs, read [`references/experiment-results.md`](references/experiment-results.md). Keep those project observations separate from model and provider facts.

## Guardrails

- Work only in `apps/editor/sam3-lab` and its run workspace. Do not connect this experiment to the existing floorplan importer, Pascal geometry, or VLM settings.
- The floorplan prototype is spatial-only: foreground/background clicks and boxes, with `prompt: ""`. Text and text-plus-spatial modes remain CLI diagnostics only when explicitly requested; do not propose more text retries as the default next step.
- That CLI diagnostic restriction is an agent workflow rule, not a separate command flag. The CLI enforces explicit `--execute`; the browser/server additionally enforce an empty text prompt.
- Treat every segmentation button or `segment --execute` invocation as one paid request. Preview first; execute only after explicit human confirmation. Never infer on image load, pointer movement, or draft edits.
- Keep `FAL_KEY` server-side in the process environment. Never print, persist, place in a URL, return through `/api/session`, or send it to browser JavaScript.
- Use a unique output directory for each call. Preserve failures and raw responses as evidence; do not retry implicitly.
- Keep the source fixed for a comparison. Any changed source bytes start a new comparison.
- The source image, prompt, and saved masks are potentially sensitive. `X-Fal-Store-IO: 0` only opts request/response JSON out of fal storage; it is not a zero-data-retention claim.

## Ordered workflow

### 1. Freeze the source

From `apps/editor`, choose exactly one source:

- `--image /absolute/path/source.png`, or
- `--inspection /absolute/path/floorplan-inspection.json` to use that inspection's frozen floorplan image.

Record the source filename, dimensions, and SHA-256 from the CLI dry-run or saved run metadata. Reuse that exact source and hash for all controls. Do not crop, rescale, redraw, or re-export it mid-comparison.

Completion: every candidate run can be tied to the same source dimensions and hash.

### 2. Select one guidance mode

For floorplans, start with a positive point or a tight box. The UI has no text control. The CLI retains the provider's other modes for explicitly requested diagnostic comparisons:

| Mode | Prompt JSON | What it tests |
|---|---|---|
| Text-only | short concrete `prompt`; empty point/box arrays | open-vocabulary concept detection, potentially multiple instances |
| Point-only | `prompt: ""`; one or more points | human-selected instance without intended text guidance |
| Box-only | `prompt: ""`; one box | a human-localized target region |
| Combined | text plus points and/or box | documented fal wrapper refinement of a text-detected object |

Important distinctions:

- fal defaults an omitted `prompt` to `"wheel"`; spatial-only requests therefore carry an **explicit** empty string. fal does not document empty-string semantics. Consult the saved project evidence, then treat point-only behavior as source-specific rather than a provider guarantee.
- A point label is `1` for foreground and `0` for background.
- All points and boxes for the single GUI target use `object_id: 1`. Repeated points with the same ID refine that target. Do not multiplex unrelated floorplan objects into one call.
- Start with a positive point well inside the intended region. Add a negative point only to reject a specific leaked region. Use a box when the target is easier to enclose than name.
- Meta's native concept exemplar-box API and native SAM 1/2 point predictor are separate interfaces. The fal endpoint is a wrapper that exposes text, points, and boxes in one schema; do not copy native normalized-box inputs into the wrapper request.

Completion: the run has one named mode and one target; every prompt contributes to that question.

### 3. Capture source-pixel coordinates

The local prompt contract uses integer source-image pixels with origin at the source's top-left: x increases rightward, y downward.

For an external display, map from the **rendered image content rectangle**, not the surrounding canvas:

```text
u = (pointerClientX - imageContentLeft) / imageContentWidth
v = (pointerClientY - imageContentTop)  / imageContentHeight
x = floor(u * sourceWidth)
y = floor(v * sourceHeight)
```

Clamp to source bounds. Account for letterboxing before applying the formula. For a dragged box, transform both corners, then reorder them into `x_min < x_max` and `y_min < y_max`. Prefer the lab UI's displayed source coordinates to hand transcription.

Do not normalize coordinates for fal. Meta's native concept processor normalizes exemplar boxes to `cxcywh`; Meta's native interactive predictor accepts source pixels and transforms internally. Neither is the fal request shape.

Completion: the preview reports integers inside the frozen source bounds and a non-degenerate box, if present.

### 4. Write the exact prompt file

The local JSON shape is exactly:

```json
{
  "prompt": "",
  "point_prompts": [
    { "x": 812, "y": 466, "label": 1, "object_id": 1 },
    { "x": 900, "y": 466, "label": 0, "object_id": 1 }
  ],
  "box_prompts": [],
  "max_masks": 3
}
```

Boxes use:

```json
{ "x_min": 740, "y_min": 400, "x_max": 940, "y_max": 590, "object_id": 1 }
```

Keep all four top-level fields, including empty arrays and an explicit prompt. `max_masks` must be an integer from `1` through `32`. Let the local tool reject unknown fields, fractional/out-of-bounds coordinates, invalid labels/IDs, and malformed boxes before any network request.

Completion: the prompt file is deterministic, locally valid, and describes one intended target.

### 5. Preview the exact paid request

Dry-run is the default:

```bash
bun sam3-lab/cli.ts segment \
  --image /absolute/path/source.png \
  --prompts /absolute/path/prompt.json \
  --out /absolute/path/runs/001-point-positive
```

Inspection source alternative:

```bash
bun sam3-lab/cli.ts segment \
  --inspection /absolute/path/floorplan-inspection.json \
  --prompts /absolute/path/prompt.json \
  --out /absolute/path/runs/001-point-positive
```

Read the entire preview. Confirm:

1. endpoint is exactly `https://fal.run/fal-ai/sam-3/image`;
2. the source name, dimensions, and hash match the frozen source;
3. prompt arrays and coordinates match the intended mode;
4. provider flags are `apply_mask:false`, `sync_mode:true`, `output_format:"png"`, `return_multiple_masks:true`, `include_scores:true`, and `include_boxes:true`;
5. use `bun --env-file=../../.env.local sam3-lab/cli.ts doctor` for the separate key-presence check; it reports only configured/not configured, not authentication validity;
6. the output directory is new;
7. the request includes no automatic retry and no equivalent-model fallback.

fal's wrapper requires `image_url`; the tool may preview a redacted data-URI descriptor rather than dumping source base64. That redaction is expected.

Completion: the human can state exactly what one paid request will send without seeing a secret or base64 payload.

### 6. Execute one explicit paid call

After explicit confirmation, add `--execute` to the already reviewed command. Do not change the source, prompt file, or output directory between preview and execution.

```bash
bun sam3-lab/cli.ts segment \
  --image /absolute/path/source.png \
  --prompts /absolute/path/prompt.json \
  --out /absolute/path/runs/001-point-positive \
  --execute
```

One invocation permits exactly one model request. A failure is evidence: inspect the saved failed run before deciding with the human whether another paid attempt is justified.

Completion: one completed or failed `SamRun` exists for the previewed input; no hidden follow-up call occurred.

### 7. Inspect every candidate

Use the run inspector:

```bash
bun sam3-lab/cli.ts inspect --run /absolute/path/runs/001-point-positive
jq '{metadata, scores, boxes}' /absolute/path/runs/001-point-positive/response.json
```

For every returned index, inspect together:

- raw provider PNG;
- normalized binary mask;
- source overlay;
- provider score; inspect optional provider normalized `cxcywh` boxes in `response.json`, not the local bbox or `SamRun`/UI (the measured runs returned null provider boxes);
- local coverage and source-pixel bbox;
- positive/negative prompt-hit counts;
- warnings, request ID, HTTP status, duration, and error details.

Do not select from score alone. Check whether the overlay contains the intended region, excludes known negatives, avoids unrelated rooms/background, and preserves the boundary needed by the human. Scores are uncalibrated and may not be comparable across prompt modes. Coverage, hit counts, normalized masks, overlays, and source-space boxes are project-derived diagnostics, not fal claims.

The fal schema does not guarantee PNG polarity, alpha/channel layout, dimensions, or complete alignment among masks/scores/boxes. Keep raw artifacts and surface warnings instead of silently guessing.

Completion: every returned mask is accounted for and the human has accepted one, rejected all, or identified one precise correction.

### 8. Compare controls deliberately

A useful floorplan comparison changes one factor at a time while preserving the source hash and target:

1. one positive point;
2. that same positive point plus one targeted negative verified inside an unwanted part of the first mask;
3. a tight box, optionally compared with that box plus the same positive point.

Do not spend a call repeating a reported failed text prompt. Text or combined-mode experiments require an explicit diagnostic question, not a hope that another wording will fix segmentation.

Each numbered control is a separate paid request. Run only the controls the human explicitly authorizes and stay within the session's displayed request budget. Compare saved overlays and local diagnostics side by side; do not overwrite a run or treat a new draft as a continuation of provider state.

Record conclusions with exact run IDs and qualifiers such as “for this source and prompt.” Do not generalize one floorplan result into a model guarantee.

Completion: the preferred mask has a saved evidence trail and the comparison did not conflate source or prompt changes.

### 9. Use the human-guided UI when clicks are the task

Start the loopback-only lab from `apps/editor`:

```bash
bun --env-file=../../.env.local sam3-lab/cli.ts serve \
  --inspection /absolute/path/floorplan-inspection.json \
  --out /absolute/path/sam3-workspace \
  --port 3117
```

Use the spatial-only UI to place foreground/background points and boxes on the frozen source. It always sends `prompt: ""`. Verify the exact request preview before each paid button press. Draft edits make the currently shown result “previous”; they never trigger inference or alter the saved run. The default session budget is six requests, one in flight at a time.

The browser talks only to the loopback server. It must not supply provider URLs, output filenames, or credentials. Close the server when the guided session ends.

Completion: the accepted run is saved under the workspace and every provider request corresponds to one confirmed button invocation.

### 10. Stop at segmentation evidence

Return:

- frozen source name, dimensions, and hash;
- run IDs and exact guidance modes compared;
- accepted mask index, or “none”;
- concise visual reason and relevant warnings;
- unresolved provider behavior exposed by the run;
- request count and published-cost basis, clearly labeled rather than inferred from billing.

Then stop. Hand the selected mask and evidence back to the human. Do not launch Pascal reconstruction, derive walls/geometry, alter the importer, or initiate a VLM retry.
