# Floorplan SAM3 isolation evidence

Measured 2026-09-08. These are observations on **one drawing and one wall partition**, not SAM3 accuracy or generalization guarantees. No Pascal reconstruction or VLM call was made.

## Decision

Use a **spatial-only human-guided prototype**: foreground click or box, inspect the raw mask and source overlay, then add targeted background clicks when necessary. The browser always sends `prompt: ""`; the terminal retains text mode only for deliberately requested diagnostics. Do not retry the user's already unsuccessful whole-plan text workflow by default.

Text/concept grounding and interactive instance segmentation are distinct tasks. This experiment demonstrates useful click-guided extraction on an abstract drawing; it does not establish that text can reliably discover every wall, that all abstract shapes will work, or that the model produces construction-ready boundaries.

## Fixed source and request controls

- Source: `floorplan-experiment.jpg`, from `~/Downloads/floorplan-inspection.json`.
- Uploaded source: PNG, **567 × 916**; no cropping or resizing between runs.
- Uploaded PNG SHA-256: `17fea94f5a57bbfaafa90a189fbac5efbccbb8d4e5ac2137fd0afe081fc5e204`.
- Target: horizontal partition between Bedroom 3 and Bedroom 2.
- Positive point **(150, 270)**. The source pixel is RGB `(3,3,3)`.
- Endpoint: `https://fal.run/fal-ai/sam-3/image`.
- Every run used `prompt: ""`, `object_id: 1`, `max_masks: 3`, `apply_mask: false`, `sync_mode: true`, `output_format: "png"`, `return_multiple_masks: true`, `include_scores: true`, `include_boxes: true`.
- Headers: `X-Fal-Store-IO: 0`, `X-Fal-No-Retry: 1`, `x-app-fal-disable-fallback: true`. No client retry. The storage header is not a zero-data-retention guarantee.
- Four direct terminal calls, then one explicit browser Run action. **Five requests total**, within the six-request experiment cap. Published-price arithmetic: **$0.025** at $0.005/request. Actual billed cost was not returned or checked.
- Existing reported text failures were not rerun. This is not a fresh text-versus-click benchmark.

## Results

Every call returned HTTP 200 and one source-sized PNG mask. Bounding boxes below are locally measured source-pixel `[minX, minY, maxXExclusive, maxYExclusive]`, not provider boxes.

| Run directory | Guidance in addition to positive (150,270) | Foreground pixels | Local bbox | Provider score | Duration |
|---|---|---:|---|---:|---:|
| `wall-point` | None | 1,401 | `[73,263,232,321]` | 0.63671875 | 1,156 ms |
| `wall-point-negative` | Background (150,245), a white source pixel | 960 | `[81,263,229,273]` | 0.62890625 | 1,974 ms |
| `wall-point-box` | Box `[75,256,233,285]` | 1,600 | `[77,263,232,286]` | 0.859375 | 2,025 ms |
| `wall-exclude-return` | Background (225,305), near the return | 1,173 | `[79,262,230,275]` | 0.328125 | 979 ms |
| `6abef569-bd8f-4f38-b669-6a878f05971b` | Background **(228,305)**, verified inside the original unwanted return | 1,158 | `[79,262,230,275]` | 0.3671875 | 1,022 ms |

### Visual and pixel evidence

- The initial positive click selected the intended horizontal partition **plus a partial vertical return** at its right end.
- Background guidance narrowed the candidate to the horizontal strip. The box-guided result retained a short corner/return despite its higher score. A box is guidance, not a guaranteed hard clip.
- The near-return point `(225,305)` was **already outside** the baseline mask. Its successful exclusion count therefore did not prove removal of a previously selected pixel. This was caught by inspecting the actual mask pixels, not by accepting the metric.
- The final browser experiment used `(228,305)`, confirmed inside the baseline. Pixel transitions were:

| Source coordinate | Positive-only mask | Exact-negative mask |
|---|---:|---:|
| Positive `(150,270)` | 255, included | 255, included |
| Unwanted return `(228,305)` | 255, included | 0, excluded |

- The final overlay was visually inspected in the actual lab UI. It isolates the horizontal partition more closely than the initial L-shaped selection, but the boundary remains imperfect and needs human acceptance.
- **Do not rank these runs by confidence alone.** The highest score (0.859375) did not best match the requested straight-wall extent. No calibrated accuracy, precision/recall, or ground-truth IoU was measured.
- Each condition was sampled once. Provider variance and repeatability remain unmeasured.

## Raw response observations and inspection convention

Observed keys: `image`, `masks`, `metadata`, `scores`, `boxes`. Masks came through `data:image/png;base64,...`; metadata scores aligned with the returned candidate. Provider `boxes` entries and `metadata[].box` were null despite `include_boxes: true`.

The local inspector preserves raw PNGs. For visualization/metrics it converts to RGBA, uses alpha if any pixel is not fully opaque, otherwise luminance, then thresholds at 128. It performs no dilation, erosion, vectorization, snapping, or resizing. The measured masks had no intermediate-valued pixels. This interpretation matched the visible foreground on this source; the provider does not guarantee the same polarity/channel semantics for every response.

Raw request/response JSON, source PNG, masks, overlays, and `run.json` are under the gitignored `editor/.sam3-lab/runs/<run-directory>/`. `request-headers.json` is also saved for runs made after the explicit header-provenance addition (including the final browser run). Credentials are never written. These local artifacts contain the source drawing and must not be committed or published casually.

## Reproduce inspection, not another paid request

From `editor/apps/editor`:

```bash
bun sam3-lab/cli.ts inspect --run ../../.sam3-lab/runs/6abef569-bd8f-4f38-b669-6a878f05971b

bun --env-file=../../.env.local sam3-lab/cli.ts serve \
  --inspection ~/Downloads/floorplan-inspection.json \
  --out ../../.sam3-lab/runs \
  --port 3117 \
  --max-requests 6
```

Open `http://127.0.0.1:3117`. This starts no inference. Select saved runs and switch between source, provider raw, binary mask, and overlay. Existing runs consume the displayed session cap; raising the cap must be explicit.

Browser checks exercised foreground/background payload labels, source-pixel mapping, numeric keyboard input, 400% zoom with scrolling and box dragging, undo, rejection of negative-only guidance, prior-result indication, and a single consented live request. The final layout was inspected at 1440 × 1100 and 390 × 844, without horizontal page overflow. The served source PNG hash matched the uploaded run source. Draft edits and inspection did not increase the request count. The server rejected an unauthenticated paid POST (403) and a same-origin text-guided request (400), without consuming another request.

Scoped strict TypeScript checking and Biome passed for the lab code. A temporary no-network smoke check verified rejection of out-of-bounds points, negative-only prompts, reversed boxes, and an existing output directory; its fetch counter stayed zero. That temporary script was removed; saved experiment evidence remains.

## What remains unproven

- Other walls, thin partitions, doors, windows, dimensions, furniture, and disconnected components.
- Different image scales, scan quality, rotations, and floorplans.
- Box-only behavior, multiple objects, combined text/object-index semantics, and multi-candidate ranking (these calls returned only one candidate).
- Exact hosted checkpoint/revision and score calibration.
- A reliable human-accepted mask set suitable for Pascal reconstruction.

Continue with human-selected targets and saved evidence. Do not turn this single-wall result into automated whole-plan reconstruction or another VLM retry.

Official model, wrapper, notebook, and retention references: [official-sources.md](official-sources.md).

## Alternative: `ton731/floorplan-recognition`

Initial read-only assessment of the [user-supplied Replicate URL](https://replicate.com/ton731/floorplan-recognition?prediction=rwnwye51xdrmy0d0g8xvg8a9s8). No inference was started during that assessment; the later authorized same-source run is recorded below.

### Evidence identity

The unauthenticated playground displayed prediction `pbk667f299rmw0cwf8xaeb8qgw`, **not** the requested `rwnwye51xdrmy0d0g8xvg8a9s8`. Its [public source drawing](https://replicate.delivery/pbxt/OcXvPD6NQxXXMgMQIwVIqQLNwiIJB8SVN4MLh7raQqBbtpEn/4.jpg) is a different, 1200 × 958 apartment plan. The requested prediction's direct page returned 404; authenticated browser access timed out. This does not establish whether that prediction is private, expired, or otherwise unavailable. `REPLICATE_API_TOKEN` and `REPLICATE_API_KEY` were not configured in the lab environment.

The inspected example and current [published version](https://replicate.com/ton731/floorplan-recognition/versions/6d9285b49483724cfa20294f80f711ca32fc1c488bb98ca01f0499651d966773) both identify `6d9285b49483724cfa20294f80f711ca32fc1c488bb98ca01f0499651d966773`. Its saved metrics report 6.196 seconds prediction time and 33.205 seconds total time. The [model page](https://replicate.com/ton731/floorplan-recognition) quotes approximately $0.0029 per run, varying with inputs; this assessment incurred no new inference charge.

### Observed contract and geometry

The [playground/API schema](https://replicate.com/ton731/floorplan-recognition/api) accepts only `image` and declares output as a string. Parsing the example output string yields:

- Three connected wall contours, not three individual architectural walls.
- Seven door contours, one entry-door contour, two window contours, and one kitchen contour.
- Door, entry-door, and window centerlines. No wall centerlines, raw masks, confidence fields, physical units, room graph, or opening-to-wall associations in this observed output.
- No exposed foreground/background clicks or box prompts in this version's input schema.

The returned coordinates were rendered directly over the original example image, without scaling, snapping, simplification, or deduplication. Visual inspection showed wall contours following the exterior and internal partition, and door/window contours aligned with visible openings. The two door centerlines `[487,417] → [601,417]` and `[488,415] → [600,415]` nearly overlap across the same closet opening: these cannot be blindly treated as independent architectural openings.

Local evidence is retained under `editor/.sam3-lab/comparisons/floorplan-recognition/`: `public-example.json` records the requested/displayed identities, version, input, metrics, and output string; `public-example-overlay.svg` embeds the source and unmodified-coordinate geometry.

### Initial replacement decision, before the paired-source run

**Inference:** this specialized wall/opening contract is a more appropriate candidate for automatic floorplan extraction than generic prompted masks. **Not established:** better performance on the frozen 567 × 916 SAM source. The public example is not a paired benchmark, and no accuracy or topology metric was measured.

The model page has no README or linked implementation provenance; the published commit was not found by a public GitHub commit search. Training data, exact underlying checkpoint, applicable license, and post-processing remain unverified. Do not attribute this wrapper to another floorplan project based on a similar name.

Do not change the existing importer or remove the SAM lab based on this example alone. The next bounded comparison needs either the requested prediction's exported input/output or an explicitly authorized run on the frozen source with Replicate access. Judge walls, junctions, openings, missed/false geometry, and correction effort against the source. Reconstruction remains outside the segmentation evaluation.

## Authorized Replicate run on the frozen source

The user subsequently supplied API access and authorized a controlled comparison. Exactly one prediction-creation POST was submitted to `https://api.replicate.com/v1/predictions`, with no creation retries, `Prefer: wait=60`, and `Cancel-After: 120s`. The credential was passed through the short-lived process environment, not saved in the repository or result artifacts. The token was disclosed in chat; it should be revoked/rotated, not reused as a permanent integration credential.

| Evidence | Observed value |
| --- | --- |
| Prediction | `dvd3fj5f7hrmy0d0g94ambqxt8` |
| Model version | `6d9285b49483724cfa20294f80f711ca32fc1c488bb98ca01f0499651d966773` |
| Source | The exact 567 × 916 PNG used for SAM, SHA-256 `17fea94f5a57bbfaafa90a189fbac5efbccbb8d4e5ac2137fd0afe081fc5e204` |
| Input | Image only; no clicks, boxes, text, resizing, or preprocessing added locally |
| API result | HTTP 201, `succeeded`; one creation request, zero status polls |
| Timing | 8.632 seconds provider inference; 28.313 seconds provider total; 29.901 seconds observed request duration |
| Returned geometry | 11 wall contours, 5 door contours, 1 entry-door contour, 10 window contours, 1 kitchen contour, and opening centerlines |
| Actual billed cost | Not reported in the response; the public price estimate is not an invoice |

Artifacts are under `editor/.sam3-lab/comparisons/floorplan-recognition/same-source/`: source PNG/hash metadata, request and nonsecret headers, original response, parsed `geometry.json`, `summary.json`, `inspection.json`, and `comparison.svg`. The SVG places the frozen source beside the returned geometry over that same source, without coordinate correction, snapping, simplification, or deduplication. All returned coordinates were finite and inside the source grid.

### Visual result and limits

- Wall contours follow the exterior and internal partitions across the drawing, including the Bedroom 3/Bedroom 2 partition targeted in the SAM experiment. This is a useful automatic whole-plan candidate, not a demonstrated accuracy score.
- The porch entrance is incorrectly classified as a window: the returned window contour spans source bounds `[309,761,370,772]`.
- A window centerline `[309,766] → [501,766]` merges that entrance span with the neighbouring window across intervening wall geometry.
- The bottom-left Bedroom 1 window contour has irregular leakage into the room. Returned entity counts are not ground-truth counts.
- The SAM experiment requested one selected wall; this model requests the entire floorplan. Those outputs are not interchangeable accuracy benchmarks. In particular, SAM's negative click on the adjoining wall return is not a valid rejection criterion for a whole-plan wall mask.
- One condition was sampled once. No ground-truth wall/opening labels, quantitative segmentation score, topology validation, or cross-plan reliability was measured.

**Decision:** prefer the existing hosted floorplan-specific model for the next automatic-extraction prototype, with human review/correction. Do not treat its geometry as safe for automatic Pascal reconstruction. No importer, production provider, or SAM lab replacement was implemented by this investigation.

Replicate's [prediction API guide](https://replicate.com/docs/topics/predictions/create-a-prediction) documents the versioned community endpoint, synchronous wait, and cancellation deadline. Its [retention policy](https://replicate.com/docs/topics/predictions/data-retention) says API inputs, outputs, files, and logs are removed after one hour by default; local copies are required for durable evidence. This is not a zero-retention claim.

## Custom-hosting candidate: `ozturkoktay/floor-plan-room-segmentation`

Audited [repository notebook](https://github.com/ozturkoktay/floor-plan-room-segmentation/blob/d62d587ac1489e0455b4910760eb58acbdb5b4af/seg_sem.ipynb), commit `d62d587ac1489e0455b4910760eb58acbdb5b4af`. This was source inspection, not execution or independent reproduction.

### What the source actually establishes

- Captured class mapping in cells 8 and 11: `background`, `dimensions`, `floorplan`, `rooms`. There are no separate wall, door, or window labels in that recorded run, despite the broader README description.
- Cell 12 selects a one-channel `segmentation_models_pytorch.Unet` with a ResNet-101 encoder and four output channels.
- Cell 26 argmaxes the semantic output, extracts class 3, and returns connected-component room bounding boxes. Its `confidence` field is a placeholder sampled with `np.random.uniform(0.5, 1.0)`, not a model confidence. It does not expose wall/opening geometry.
- Inference/visualization cells load `/content/unet_floorplan_multiclass_batch16_1701_training.pth`. The [published tree](https://api.github.com/repos/ozturkoktay/floor-plan-room-segmentation/git/trees/d62d587ac1489e0455b4910760eb58acbdb5b4af?recursive=1) contains only the notebook, README, license, and two output PNGs; [GitHub Releases](https://api.github.com/repos/ozturkoktay/floor-plan-room-segmentation/releases) were empty. No checkpoint, dataset, class CSV, dependency lockfile, or inference service is supplied there. This does not prove the author has no artifacts elsewhere.
- The displayed “93.59% mAP” comes from cell 35. That code computes IoU and loops IoU thresholds but does not use either in matching or scoring; it repeatedly integrates pixel precision/recall from hard room masks. The retained input is the first test batch, not a full test-set evaluation. It is not evidence of standard mAP50–95 or of wall/opening accuracy.
- The code has an [MIT license](https://github.com/ozturkoktay/floor-plan-room-segmentation/blob/d62d587ac1489e0455b4910760eb58acbdb5b4af/LICENSE). Availability and licensing of the absent training data and weights remain separate prerequisites.

### Hosting choice and the user's required guide

The user's [Replicate push-a-model guide](https://replicate.com/docs/guides/build/push-a-model) is the correct custom-hosting path. It explicitly starts with a trained model and its weights. A token alone cannot supply this repository's missing checkpoint or train additional semantic classes.

If a suitable custom wall/opening model is selected later, follow that guide: obtain provenance-verified compatible weights and labels; pin dependencies in `cog.yaml`; load once in `Predictor.setup()` and expose real image inference through `predict.py`; preserve source-coordinate transforms; verify a local `cog predict`; then create the intended private/public Replicate model and push it with `cog push`. Do not publish a randomly initialized model, synthetic confidence, or notebook scaffold as a working endpoint.

For the present task, the already-hosted model is the better next experiment/prototype choice: it ran on the actual source and produced relevant wall/opening geometry. Owning an application API does not require owning/training the underlying model. Packaging this particular room notebook would be a separate model-development effort, not a better deployment of the demonstrated wall extractor.

## Local WebGPU inference assessment

The user proposed the [Transformers.js WebGPU guide](https://huggingface.co/docs/transformers.js/en/guides/webgpu) for local floorplan extraction. This separates two questions: a browser execution backend, and a trained model with the correct semantic labels.

### Local capability actually exercised

In the local Chromium 150 session on `http://127.0.0.1:3117`, the page was a secure context, `navigator.gpu` was available, and `requestAdapter()` returned a non-fallback Apple / `metal-3` adapter with `shader-f16`. A device, compute pipeline, storage buffer, and readback buffer were created. A GPU dispatch of `2*x+1` on `[1,2,3,4]` returned `[3,5,7,9]`; resources were destroyed afterward.

The result is saved in `editor/.sam3-lab/comparisons/webgpu-capability.json`. **This proves local WebGPU compute/readback only. No Transformers.js pipeline, ONNX Runtime session, or local floorplan model was executed.** It is not a latency benchmark or a Safari/mobile compatibility result. No additional paid inference or drawing upload was made for this check.

### Runtime choice

- [Transformers.js](https://github.com/huggingface/transformers.js) uses ONNX Runtime, supports image segmentation, and can request `device: "webgpu"` for compatible models. Its current supported-architecture list includes SegFormer and SAM families; that does not turn a custom PyTorch checkpoint into a drop-in Transformers.js model.
- For a custom ResNet–U-Net, [ONNX Runtime Web's WebGPU provider](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html) is the more direct candidate: import `onnxruntime-web/webgpu` and create a session with `executionProviders: ["webgpu"]`, supplying our verified preprocessing and postprocessing.
- Neither runtime supplies missing weights, corrects wrong classes, or reproduces the hosted `ton731` model merely from its API token. Its exact downloadable model/processing implementation remains unverified.
- Browser inference can keep drawings local and avoid hosted per-request inference charges, but requires initial model/runtime downloads, local GPU memory/compute, and supported ONNX operators. Offline/private operation requires controlling the application and asset-loading paths, not just selecting WebGPU. Never put a Replicate token in browser code.

### Public model candidates found, not benchmarked locally

1. **[`Yytsi/floorplan-to-3d-walls`](https://huggingface.co/Yytsi/floorplan-to-3d-walls)** has `best.safetensors` (97,851,168 bytes) and `config.yaml` at revision `68843a3ab7b12aa03b23c36f955a0d8099b4e2ee`. Its [source project](https://github.com/Yytsi/floorplan-to-3d) supplies model/inference code, and [`labels.py`](https://github.com/Yytsi/floorplan-to-3d/blob/main/src/buildingcv/labels.py) explicitly defines `floor`, `wall`, `door`, `window`. The card describes ResNet-34/U-Net and 512×512 aspect-preserving letterboxing. No ONNX file is published in the inspected model repository. This is a more relevant custom-model candidate than the room notebook because weights and the required classes are present—not proof of better accuracy. Its reported 0.983 validation mIoU is author-reported, not independently verified or comparable to our unlabeled drawing. The supplied server/demo path expects SVG/CubiCasa input; arbitrary PNG inference still needs correct adaptation and evaluation.
2. **[`JessiP23/cubicasa-segformer-v2`](https://huggingface.co/JessiP23/cubicasa-segformer-v2)** does publish `model.onnx` plus an approximately 99 MB external weight file, at revision `f3594c60e9fe5f6be4cb3af62764ab8d7a2cd5cc`. Its inference source maps 18 classes including walls/doors/windows. However, its own `metrics.json` reports mean IoU 0.12186, wall IoU 0.30026, and room score 0; no license was declared in the inspected card metadata. ONNX availability alone is not a reason to select it as the quality baseline. These metrics were inspected, not reproduced.

**Recommended sequence:** retain the successful hosted run as an evaluation baseline; test a relevant downloadable checkpoint locally in its native inference path on the same frozen PNG; inspect raw semantic masks and opening errors; only then export and validate ONNX/WebGPU against that native result. For an eventual cloud-hosted custom model, use the user's Cog deployment guide with the same verified model contract. Do not port an unsuitable model solely because browser execution is possible.

## Native Yytsi test on the frozen floorplan

This follow-on experiment supersedes the earlier “not benchmarked locally” status for Yytsi only. It does not validate ONNX or browser inference.

- Source code pinned to [`ccc19723d98b097b521b8289287c5143e535df0d`](https://github.com/Yytsi/floorplan-to-3d/tree/ccc19723d98b097b521b8289287c5143e535df0d); downloaded modules verified against Git blob hashes.
- Hugging Face checkpoint revision `68843a3ab7b12aa03b23c36f955a0d8099b4e2ee`; `best.safetensors` verified as 97,851,168 bytes with SHA-256 `d7f6a0fd06e2931aecfc8c4849192c5e153701578026efc78d9a6246731a8d6c`.
- Same frozen 567×916 PNG and SHA-256 as the SAM/Replicate experiments. No source text, furniture, fixtures, or annotations removed.
- An isolated environment under `editor/.sam3-lab/comparisons/yytsi-native/.venv` used Python 3.11.15, PyTorch 2.14.0, torchvision 0.29.0, segmentation-models-pytorch 0.5.0, and safetensors 0.8.0. No project dependencies changed.
- Used the upstream model builder with `encoder_weights=None`, safe checkpoint loading, and strict state-dict matching. Checkpoint metadata reported epoch 26.
- Replaced the SVG input stage with RGB PNG decoding and bilinear downscaling. Retained the checkpoint's ImageNet normalization and zero-normalized letterbox: 512×512 network input, content rectangle `[97, 0, 317, 512]`. This preserves aspect ratio but is not the SVG semantic-cleaning pipeline.
- One float32 forward pass on local PyTorch `mps`; finite logits of shape `[1, 4, 512, 512]`. First forward took 1,598.77 ms, synchronized on MPS, with no warmup. Model load/input transfer took 418.97 ms. The full Python command took 20.41 seconds including process/import/setup/output work. These timings are not directly comparable to hosted request latency.
- Saved the normalized input tensor, logits, network/source-coordinate labels, raw color mask, overlays, and comparison crops. No remote inference requests or new paid predictions.

### Compare both raw masks and the author's final polygons

Raw output recovers major wall runs but predicts door/window pixels on several room names. To avoid judging only pre-cleanup noise, the same saved mask was also passed through the pinned author's pure polygon functions, selected unchanged with Python AST. OpenCV 5.0.0.93 applied the upstream defaults: 3×3 closing, 1.5-pixel simplification, and 30-pixel minimum polygon area. No additional model inference or manual geometry correction was performed.

The cleanup removes some false positives, but the final polygon output still includes false door/window geometry on `BEDROOM 2`, `KITCHEN`, and `LIVING AREA` text, plus wall geometry on the sink and coffee table. Real windows fragment into door/window classes. The porch entrance is not recovered as a door; some door-leaf lines become walls. Conversely, the bottom-left facade window is more regular than Replicate's leaking contour. Replicate also has errors, including the porch entrance/window merge and some coffee-table wall geometry.

This is qualitative evidence on one drawing, not a ground-truth accuracy benchmark. **Yytsi is a runnable, relevant candidate for owning/localizing the model, but this test does not establish it as better than Replicate for automatic wall/opening reconstruction from our PNG. Neither output is ready for unreviewed Pascal import.**

Evidence directory: `editor/.sam3-lab/comparisons/yytsi-native/`.

- `provenance.json`, `weights/`, and `source/`: verified checkpoint and source identities.
- `same-source/summary.json`, `postprocess-summary.json`, `inspection.json`: execution and visual findings.
- `same-source/comparison.png`: original, raw Yytsi mask overlay, hosted output.
- `same-source/comparison-processed.png`: original, default Yytsi polygons, hosted output.
- `same-source/model-input.npy`, `logits.npy`, `mask-network-labels.png`, `geometry-network.json`, and `geometry-source.json`: intermediate evidence.

### Training input mismatch: a material qualification

The pinned [`svg_render.py`](https://github.com/Yytsi/floorplan-to-3d/blob/ccc19723d98b097b521b8289287c5143e535df0d/src/buildingcv/svg_render.py) removes SVG subtrees tagged as furniture, fixtures, dimensions, labels, and other annotations **before rendering the model input**. Its input is therefore not an ordinary annotated floorplan PNG. The class tags required for that filtering are unavailable in our raster source.

[INFERENCE] The observed text/fixture errors are consistent with this domain mismatch. No cleaning ablation has yet measured its causal contribution; the author's reported validation score should not be treated as expected accuracy on our drawing.

## Proposed cleaning and label-recovery experiment

The user suggested a cleaned GPT Image rerender, with labels recovered through OCR/VLM. Separating structural geometry from semantic labels is a useful hypothesis, but a whole-plan generative redraw must not become the geometric source of truth.

The [official GPT Image guide](https://developers.openai.com/api/docs/guides/image-generation#edit-an-image-using-a-mask) says masks guide generation but may not be followed with exact precision. Its limitations also note difficulty with precise placement in layout-sensitive compositions. High input fidelity is not a pixel-coordinate or topology guarantee.

Proposed workflow, not implemented:

1. Retain the original as immutable evidence. Extract OCR text, bounding boxes, room labels, units, and dimensions **from the original before cleaning**. Use a VLM for semantic interpretation and ambiguous associations, not as an authoritative coordinate estimator.
2. Produce a coordinate-aligned structural copy. First remove only isolated text with explicit masks and deterministic background restoration. Preserve door swings/leaves, window bars, wall junctions, and all structural strokes. Text overlapping structure requires review rather than blanket rectangle erasure.
3. Evaluate a separate text-plus-furniture cleanup variant. GPT Image can propose masked repairs where deterministic cleanup is insufficient, but composite accepted edits only inside approved masks onto the original. This can guarantee unchanged pixels outside the masks; it cannot guarantee correct geometry inside them.
4. Run the same pinned checkpoint/settings on each variant. Compare against the current untouched baseline for retained text/fixture false positives, real door/window recovery, and preserved wall geometry. Validate against fixed, manually checked structural landmarks—not only a visually cleaner result or agreement with Replicate.
5. Associate saved labels with recovered room regions in the original coordinate frame. Record every resize/pad transform explicitly; OCR/VLM metadata must not be recovered solely from a generated drawing.

Controlled comparison: **A** = unchanged source (completed); **B** = text-only removal (not run); **C** = text-plus-furniture removal (not run). A generative variant is a separate experimental input, not a replacement reference. No GPT Image, OCR, or VLM preprocessing call was made in this assessment.

## Gemini semantic correction: cleanup is not door recovery

Reviewed the same 61 default Yytsi polygons (17 wall, 25 door, 19 window), assigning stable candidate IDs and supplying the unchanged source, existing overlay, and three candidate contact sheets. Gemini could keep, relabel, reject, or flag a footprint for repair; missing-feature boxes were proposals only. Applied geometry always comes from the original full-precision polygons, not generated coordinates.

Two explicit OpenRouter attempts used the existing environment credential and no automatic request retries. `google/gemini-3.8-flash` returned an upstream 429 with no usable correction and reported cost zero. A separately selected `google/gemini-3.1-pro-preview` request succeeded through Google in 93.671 seconds: 16,321 input tokens, 12,845 output tokens including 9,021 reasoning tokens, and reported cost **$0.186782**. Both used `require_parameters: true`, `allow_fallbacks: false`, `data_collection: deny`, and `zdr: true`; credential values were not persisted.

The validated Pro response contained **21 keep, 15 relabel, 18 reject, and 7 needs-repair** decisions, plus five missing-feature boxes. These counts describe actions, not accuracy. Of 14 predeclared nonstructural review candidates, 13 were rejected and the sink was flagged but retained. Nine of 11 provisional window checkpoints were relabeled from door to window; the other two became wall and require jamb/frame boundary inspection.

Visual inspection exposed material failures:

- `DO22`, the kitchen/dirty-kitchen doorway, became a window with high confidence. The same response proposed a missing door over most of that candidate's bounds: an internal semantic conflict, also contradicted by the visible swing.
- Rejecting `DO02`, `WI01`, and `WI03` removed portions of the visible bottom Bedroom 1 glazing. `WI03` is a mixed contour including a return; wholesale rejection still discards real glazing.
- A proposed missing window lies over the solid left Bedroom 1 wall, rather than its bottom glazing. The box was not inserted into the masks.
- Only four door-class footprints remain, **all flagged for repair**; several trace a leaf rather than an aperture. The porch entrance remains unresolved. The cleaner overlay does not demonstrate recovered doors.

Artifacts: `editor/.sam3-lab/comparisons/gemini-correction/`. `run-01/` preserves the failure; `run-02/` contains the request/response, validated decisions, applied masks, unchanged-coordinate geometry, comparison image, review boxes, and `inspection.json`. No missing-feature boxes, hand corrections, or generated redraws were applied. No Pascal scene changed.

**Decision:** a useful semantic-review candidate, not an independent authority or import-ready result. Measure preserved/recovered apertures and harmful changes, not only removed noise or model agreement. Proposed missing doors still require source-pixel jamb/host-wall fitting and review before becoming masks.

### Pascal reconstruction boundary

Current `packages/editor/src/lib/floorplan-import/native.ts` already maps a reviewed, calibrated `FloorplanDraft` to level-owned `WallNode`, `SlabNode`, and `ZoneNode` objects, with `DoorNode`/`WindowNode` parented to their host wall. Reuse `inspectFloorplanImport`, `prepareFloorplanPreview`, and `applyFloorplanImport`; do not create a parallel importer from these contours.

At this correction-only checkpoint, the artifacts lacked reviewed straight wall axes/thickness, opening hosts and jamb spans, floor/room boundaries, calibration, and explicit vertical assumptions. `pascal-readiness.json` records the source-inspected prerequisites; that file is not an executed preview. The later isolated native-preview experiment is recorded below. Source +Y maps to native +Z, and pixel quantities require `metersPerPixel`. GPT Image remains an unrun, separately controlled cleanup experiment; generated pixels must not replace the original geometric reference.

## Matched Yytsi / Replicate correction comparison

The same frozen 567 × 916 drawing was reviewed with Gemini 3.1 Pro, Sol, and Astra for both extractors. Replicate's saved `ton731/floorplan-recognition` prediction was reused; no second extraction charge was incurred. Its 27 structural candidates comprise 11 walls, six doors (including normalized `entry_door`), and ten windows. The kitchen region remains in the original response but is outside this matched structural contract.

**Observed recommendation: Replicate + Astra.** This is a source-inspected result on one drawing, not a general accuracy benchmark. Gemini received a single API request per extractor; Sol and Astra used tool-assisted reviews, so latency and billing are not directly comparable.

### Door evidence and reviewer ranking

Seven visible swing-door locations were inspected: Bedroom 3, Bedroom 2, both bathrooms, the lower central doorway, kitchen/dirty-kitchen, and porch. Counts below mean locations with door-labelled evidence, including partial or repair-flagged candidates—not fitted apertures or native nodes.

| Extractor | Raw | Gemini | Sol | Astra |
|---|---|---|---|---|
| Yytsi | 2/7; one incomplete fragment | 1/7; fragment repair-flagged | 2/7; fragment repair-flagged | 2/7; one incomplete fragment |
| Replicate | 6/7; seventh exists as a window mask | 7/7 | 7/7 | 7/7 |

- **Replicate has materially better initial aperture coverage.** `DO01`–`DO06` cover six real doors; all reviewers correctly relabel porch candidate `WI10` as the seventh. No new mask is needed for that semantic fix. Its supplied `WI10` centerline lies far outside its polygon and must not be trusted merely because the label is corrected.
- **Astra is the strongest inspected reviewer.** On Yytsi it preserves `DO22`, removes sink/bed/appliance noise, preserves genuine bottom glazing, and identifies five missing door regions. It does not recover five masks, and its kept `DO11` remains geometrically incomplete. On Replicate it rejects false coffee-table wall `WA02` and flags six mixed contours: `WA01`, `WA06`, `WA07`, `WI01`, `WI03`, `WI07`.
- **Sol ranks second.** On Replicate it fixes the porch, rejects `WA02`, and flags `WA06`/`WI01`, but misses additional sofa/sink contamination. On Yytsi it preserves the kitchen door but treats bed/appliance strokes as possible doors and proposes a spurious Bedroom 1 door.
- **Gemini ranks third here.** On Replicate it fixes the porch but keeps every other candidate, including known false/mixed geometry. Its Yytsi failures include changing the genuine kitchen door to a window and deleting genuine Bedroom 1 glazing.

| Extractor / reviewer | Keep | Relabel | Reject | Needs repair |
|---|---:|---:|---:|---:|
| Yytsi / Gemini | 21 | 15 | 18 | 7 |
| Yytsi / Sol | 26 | 13 | 18 | 4 |
| Yytsi / Astra | 25 | 13 | 20 | 3 |
| Replicate / Gemini | 26 | 1 | 0 | 0 |
| Replicate / Sol | 23 | 1 | 1 | 2 |
| Replicate / Astra | 19 | 1 | 1 | 6 |

Action counts are not accuracy scores. Repair flags preserve the original overlay footprint. The initial strict converter excluded flagged candidates; the later source-supported reconstructor below repairs them approximately instead of discarding entire mixed wall components.

### Measured cost and workflow choices

| Review request | Input tokens | Output tokens | Wall time | Reported cost |
|---|---:|---:|---:|---:|
| Yytsi → Gemini 3.1 Pro | 16,321 | 12,845 | 93.671 s | $0.186782 |
| Replicate → Gemini 3.1 Pro | 12,729 | 10,583 | 78.851 s | $0.152454 |

Output includes reasoning tokens. The two successful Gemini reviews total **$0.339236**, excluding extraction. The earlier Flash 429 produced no usable correction and reported zero cost. Replicate GPU billing was not reported. Sol/Astra production API usage and price remain unknown; a zero entry in a local Codex model catalog is not a free production price.

Workflow choices: local Yytsi avoids another hosted inference charge but needs substantial semantic repair; raw Replicate has stronger door coverage with separately billed GPU inference; one semantic review provides label/noise triage. Replicate → Astra → local source-supported reconstruction is now implemented for the retained sample, as described below. Production inference cost and accuracy across other drawings remain unmeasured. GPT Image was not run.

Evidence under `editor/.sam3-lab/comparisons/`: `all-variants.png`, `door-and-error-comparison.png`, `source-inspected-regions.json`, `comparison-assessment.json`, and each review's original correction JSON and rendered overlays. Region boxes are review crops only, not replacement geometry.

### Source-supported reconstruction and native import

The workbench at `http://127.0.0.1:3117/#comparison-workbench` compares all eight retained variants. Generation is local and read-only: actual Pascal plan builders and native 3D primitives render the resulting graph; JSON can be downloaded without changing a scene.

The reconstructor restores full-precision extractor rings, preserves substantial walls inside mixed/repair-flagged contours, fits polygon cross-sections, regularizes dominant directions, preserves short returns and genuine oblique angles, and snaps nearby junctions. Apertures can imply bounded host-wall spans; nearby door/window supports bridge only bounded gaps. Door swing evidence comes from source arcs. Source-supported window rails can recover a proposed aperture, and corner glazing can produce two separately hosted windows. A review box alone never becomes a wall or opening.

OCR labels from the unchanged drawing name approximate native zones. Source evidence supports approximate prop blocks. Open-plan partitions and inferred footprints are not surveyed geometry; native object counts are not accuracy scores.

The executed eight-variant replay at **0.015 m/px, 2.5 m wall height** produced:

| Variant | Walls | Doors | Windows | Zones | Props |
|---|---:|---:|---:|---:|---:|
| Yytsi raw | 63 | 24 | 11 | 10 | 1 |
| Yytsi + Gemini | 53 | 4 | 17 | 10 | 2 |
| Yytsi + Sol | 44 | 5 | 19 | 10 | 2 |
| Yytsi + Astra | 43 | 3 | 17 | 10 | 4 |
| Replicate raw | 34 | 6 | 11 | 9 | 1 |
| Replicate + Gemini | 34 | 7 | 10 | 9 | 1 |
| Replicate + Sol | 34 | 7 | 11 | 9 | 3 |
| Replicate + Astra | 34 | 7 | 11 | 10 | 3 |

Yytsi's extra objects include text/fixture false positives. Replicate + Astra remains the strongest source-inspected combination on this drawing. Compared with the initial strict preview's 22 walls, four doors and three windows, source-supported reconstruction retains all seven inspected swing-door locations and the bottom-left corner glazing. This is not a labeled generalization benchmark.

#### Curated editor flow

On an empty floor, **Actions → Import from floorplan…** opens the Replicate + Astra sample. `apps/editor/public/floorplans/replicate-astra.{json,png}` retain the graph and original raster; `floorplan-reconstruction-client.ts` regenerates native primitive meshes locally at the selected floor height. The previous hosted SAM/interpreter/reviewer application route and client/server were removed. The isolated historical comparison lab remains available.

The prepared sample uses the verified 7 m reference: source endpoints `[98.53846153846155,48.387259615384615]` and `[498.40769230769234,49.075360576923075]`, giving **0.017505697105882432 m/px**. At this scale it contains **34 walls, seven doors, 11 windows, 10 named zones and seven approximate props**. The editor adds 10 editable zone-floor slabs. Two-point recalibration remains available.

The translucent image can be dragged in 2D or 3D, positioned numerically, rotated and faded. Preview geometry uses the same level-local pivot/yaw as commit and rises from the selected floor, not world Y=0. The 280 ms ease-out starts after the first GPU frame; reduced motion and keyboard generation skip the rise. Confirm retains the raster as an editable guide and commits native geometry in one history step. Cancel makes no authored scene changes.

Verification:

- **29 focused tests passed, 138 assertions** for reconstruction, feature extraction and native import, including short/oblique walls, wall hosts, rotated aperture ownership, scaled slab holes, atomic undo/redo and cancellation during source retention.
- Chromium verified two-point calibration, stale-response suppression, source/overlay switching, native JSON download, and rendered mobile 3D at 390 px without document overflow.
- Live editor verification on **Floor 1** exercised 2D image dragging, 90° rotation, signed numeric coordinates, opacity, generation, cancel, confirm and undo. Confirmation at `(2, -1.5)`, yaw 90°, created one reference plus the native graph; one undo removed the entire import while preserving the existing scene.
- No new model inference was made; the saved SAM request ledger remained at five entries.
- Final application typechecking reports only the linked Environment error in `surroundings/neighborhood-shadows.tsx:38` (union complexity). No importer or reconstructor type errors were reported; that unrelated file was not modified.

Proof: `editor/.sam3-lab/comparisons/reconstruction/` contains each replay JSON/SVG/PNG, native mesh snapshots, calibration/browser evidence, mobile 3D and confirmed-import screenshots. Original extraction and correction evidence is unchanged.
