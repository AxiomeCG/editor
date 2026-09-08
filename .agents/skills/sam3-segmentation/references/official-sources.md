# SAM 3 official-source reference

Checked 2026-09-08 against Meta repository `main` at tree `660a5e9e1b8b4c02c0ad97229b88a09a6e4ff5b7` and the live fal documentation. Re-check the linked schemas before changing a provider contract.

This file deliberately separates **first-party facts** from **Pascal lab policy and observations**. Do not turn a project observation into a model or provider guarantee.

## Meta: model and native Python interfaces

### Capability and scope

- Meta describes SAM 3 as a unified image/video model for text, exemplar, and visual prompting. A text prompt or exemplar asks for all matching instances of an open-vocabulary concept; positive/negative clicks support interactive instance refinement.
- Meta's project page describes text guidance as words and short phrases. Treat a short concrete noun phrase as the default; an instruction-following sentence is a different, MLLM-agent use case.
- The image model is a detector plus segmentation head; its tracker inherits SAM 2-style interactive behavior. This explains why the repository exposes two materially different image APIs rather than one interchangeable prompt function.

### Concept grounding: `Sam3Processor`

The official image predictor notebook uses:

1. `processor.set_image(image)` once to cache the source image features.
2. `processor.set_text_prompt(..., prompt="shoe")` for concept grounding.
3. Or `processor.add_geometric_prompt(...)` for an **exemplar box**.

Native exemplar boxes are normalized `[center_x, center_y, width, height]`, not pixel `xyxy`. The notebook starts from pixel `[x, y, width, height]`, converts to center form, then divides x/width by source width and y/height by source height. Positive and negative exemplar boxes can be accumulated. With no text features, the processor internally uses the text token `"visual"` for box-only concept grounding.

Native concept output processing:

- The processor multiplies the sigmoid detection score by a sigmoid presence score, then filters against its configurable confidence threshold (default `0.5`).
- Boxes are converted from normalized `cxcywh` to source-pixel `xyxy`.
- Mask logits are bilinearly resized to source dimensions and thresholded at `0.5`.
- These details describe Meta's native processor. They do **not** prove that a hosted wrapper uses the same thresholds, ranking, or post-processing.

### Interactive SAM 1/2 task: `predict_inst`

Interactive image prediction is a separate path and requires building the image model with `enable_inst_interactivity=True`. The official SAM 1 task notebook uses `model.predict_inst(...)` with:

- points in absolute source-image `(x, y)` pixels;
- labels `1` foreground and `0` background;
- boxes in source-pixel `[x_min, y_min, x_max, y_max]`;
- optional prior low-resolution mask logits for a later native refinement iteration.

With the default `normalize_coords=True`, the native predictor divides x by source width and y by source height, then scales both to the model's square input resolution. It resizes the image to a square; callers still supply source-image pixels. Output masks are resized back to the original image size.

The notebook recommends multimask output for an ambiguous single click, then selection by the model's predicted mask-quality score. For multiple unambiguous prompts, it demonstrates a single mask and optional prior mask logits. A score is a model estimate, not a calibrated probability or a geometric accuracy guarantee.

### SAM 3.1 scope

Meta released SAM 3.1 on 2026-03-27. Its headline change is **Object Multiplex**, shared-memory joint multi-object video tracking, plus new checkpoints and inference optimizations. The release notes' speed claim is specifically about dense multi-object tracking (for example, 128 objects on an H100), not a blanket image-segmentation or floorplan-accuracy claim.

The current Meta builder defaults the ordinary image model to the `sam3` checkpoint. SAM 3.1 is selected for the multiplex video builder/predictor. fal separately publishes `fal-ai/sam-3-1/image`, but that is a different endpoint and price from this lab's `fal-ai/sam-3/image`. Never relabel a base-endpoint result as SAM 3.1.

### Native prerequisites

The current Meta README specifies Python 3.12+, PyTorch 2.7+, a CUDA-compatible GPU, and CUDA 12.6+. Its current example pins a CUDA PyTorch wheel, and checkpoint access requires approval/authentication through Meta's Hugging Face repository. This Pascal lab uses hosted fal inference; these native prerequisites matter only if explicitly evaluating a local Meta installation.

## fal: hosted `fal-ai/sam-3/image` wrapper

### Endpoint and pricing

- Direct inference endpoint: `https://fal.run/fal-ai/sam-3/image`
- Model ID: `fal-ai/sam-3/image`
- Published price at the check date: `$0.005` per request.
- `prompt` is optional in OpenAPI but defaults to `"wheel"`. A spatial-only experiment must send an explicit empty string under the Pascal lab contract; whether the hosted endpoint actually treats `""` as point-only is an experiment result, not a documented guarantee.

### Nested input schema

The live OpenAPI schema accepts:

```text
PointPrompt = {
  x?: integer,
  y?: integer,
  label?: 0 | 1,          # 1 foreground, 0 background
  object_id?: integer,
  frame_index?: integer
}

BoxPrompt = {
  x_min?: integer,
  y_min?: integer,
  x_max?: integer,
  y_max?: integer,
  object_id?: integer,
  frame_index?: integer
}
```

OpenAPI makes these nested fields nullable/optional even though useful prompts need coordinates and labels. Validate them locally rather than relying on a provider error. The image endpoint docs name x/y coordinates but do not formally state normalization; fal's image examples and contract expose integers, while the Pascal lab intentionally sends source-pixel integers and records the exact payload so this can be tested.

fal documents grouping as follows:

- points sharing `object_id` refine the same object;
- boxes sharing `object_id` refine the same object;
- when text is also supplied, a point's `object_id` selects which detected object it refines.

This is wrapper behavior; it is not the same interface as Meta's native concept processor or native `predict_inst`. The Pascal GUI intentionally uses one target object and `object_id: 1` per call.

Other relevant fields:

- `max_masks`: integer `1..32`, default `3`;
- `apply_mask`: default `true`;
- `sync_mode`: when true, media is returned as a data URI;
- `output_format`: `jpeg | png | webp`;
- `return_multiple_masks`, `include_scores`, and `include_boxes`: default false.

### Output schema and interpretation limits

`masks` is the only required result field: an array of image descriptors with a required `url` (which may be a data URI in sync mode) and optional content type, filename, size, width, and height. The response can also contain:

- `image`: optional primary preview;
- `scores`: optional per-mask numbers;
- `boxes`: optional per-mask normalized `[center_x, center_y, width, height]`;
- `metadata`: optional records `{index, score?, box?}` where box is also normalized `cxcywh`.

Do not assume mask order is score order; use metadata indices where present and preserve raw ordering. The schema does not specify PNG channel layout, foreground color/polarity, alpha semantics, threshold, or whether returned dimensions always equal source dimensions. Inspect each raw mask and the lab's normalized mask/overlay. Provider scores are called confidence scores but their calibration and comparability across text/point/box modes are undocumented.

### Provider request example used by this lab

The local tool supplies `image_url` as a data URI derived from the frozen source; do not paste its base64 into notes.

```json
{
  "image_url": "data:image/png;base64,<frozen-source-bytes>",
  "prompt": "",
  "point_prompts": [
    { "x": 812, "y": 466, "label": 1, "object_id": 1 },
    { "x": 900, "y": 466, "label": 0, "object_id": 1 }
  ],
  "box_prompts": [],
  "apply_mask": false,
  "sync_mode": true,
  "output_format": "png",
  "return_multiple_masks": true,
  "max_masks": 3,
  "include_scores": true,
  "include_boxes": true
}
```

The key belongs only in the server process's `FAL_KEY` environment variable. fal recommends a server-side proxy for browser/GUI clients.

### Platform behavior distinct from model inputs

- `X-Fal-Store-IO: 0` prevents storage of request/response **JSON payloads**, which are otherwise retained for 30 days. It does not control input uploads or generated CDN media and is not, by itself, a zero-data-retention guarantee.
- `X-Fal-No-Retry: 1` disables fal's documented automatic retry behavior. Without it, queue-based requests may be attempted up to ten times for server, timeout, or connection errors.
- fal may route to an equivalent fallback by default; `x-app-fal-disable-fallback: true` disables that behavior when exact endpoint execution matters.
- Media lifetime and access use the separate `X-Fal-Object-Lifecycle-Preference` header. In this lab, `sync_mode:true` avoids depending on a hosted output URL, but it does not change the scope of `X-Fal-Store-IO`.

## Pascal lab contract and observations

These are project rules, not official Meta/fal claims:

- Keep the source image and its hash fixed across a comparison.
- Coordinates in prompt JSON are validated source-image integers. One GUI request targets one object with `object_id: 1`.
- A provider call uses `apply_mask:false`, `sync_mode:true`, PNG output, multiple masks, scores, and boxes.
- Dry-run is the default. A paid call requires the explicit `--execute` path or `confirmPaid:true` in the loopback UI.
- Every returned candidate is saved as raw mask, normalized mask, overlay, and derived diagnostics. Coverage, source-space bbox, prompt-hit counts, and warnings are local diagnostics, not provider metadata.
- New clicks alter a draft. They do not mutate an old saved run or silently issue another request.
- Comparisons change one guidance variable at a time and remain within the explicit session request budget.
- Segmentation evidence stops at mask selection. It does not trigger Pascal floorplan reconstruction or any VLM/pipeline retry.

Measured floorplan runs belong in [`experiment-results.md`](experiment-results.md), not in this official-source reference. Promote none of those source-specific observations into a model guarantee.

## Unresolved facts to test, not assume

1. Whether the measured `prompt: ""` point-only behavior generalizes across images, image sizes, and box-only requests.
2. Whether fal interprets point/box coordinates exactly as source pixels at arbitrary source sizes.
3. How a text result's instance numbering maps to `object_id` during combined guidance.
4. Raw PNG polarity/channel/alpha conventions under `apply_mask:false` and `sync_mode:true`.
5. Whether masks, `scores`, `boxes`, and `metadata` are always cardinality-aligned, and how null entries are used.
6. Whether hosted confidence scores are comparable across modes or only rank candidates inside one response.
7. Which exact Meta checkpoint/revision and post-processing implementation backs the base fal endpoint.

## First-party links

### Meta

- [SAM 3 repository and README](https://github.com/facebookresearch/sam3)
- [Meta SAM 3 project page](https://ai.meta.com/research/sam3/)
- [SAM 3.1 release notes](https://github.com/facebookresearch/sam3/blob/main/RELEASE_SAM3p1.md)
- [Concept/text/exemplar image notebook](https://github.com/facebookresearch/sam3/blob/main/examples/sam3_image_predictor_example.ipynb)
- [Interactive SAM 1 task notebook](https://github.com/facebookresearch/sam3/blob/main/examples/sam3_for_sam1_task_example.ipynb)
- [Interactive text/box widget notebook](https://github.com/facebookresearch/sam3/blob/main/examples/sam3_image_interactive.ipynb)
- [`Sam3Processor` source](https://github.com/facebookresearch/sam3/blob/main/sam3/model/sam3_image_processor.py)
- [Interactive predictor source](https://github.com/facebookresearch/sam3/blob/main/sam3/model/sam1_task_predictor.py)
- [Interactive coordinate transforms](https://github.com/facebookresearch/sam3/blob/main/sam3/model/utils/sam1_utils.py)
- [Model builder and checkpoint selection](https://github.com/facebookresearch/sam3/blob/main/sam3/model_builder.py)

### fal

- [SAM 3 image model docs](https://fal.ai/models/fal-ai/sam-3/image/llms.txt)
- [SAM 3 image OpenAPI](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/sam-3/image)
- [SAM 3 image API tutorial](https://fal.ai/models/fal-ai/sam-3/image/api)
- [Platform headers](https://fal.ai/docs/documentation/model-apis/common-parameters)
- [Payload and media retention](https://fal.ai/docs/documentation/model-apis/media-expiration)
- [fal CDN and data URI guidance](https://fal.ai/docs/documentation/model-apis/fal-cdn)
- [Separate SAM 3.1 image endpoint](https://fal.ai/models/fal-ai/sam-3-1/image/llms.txt)
