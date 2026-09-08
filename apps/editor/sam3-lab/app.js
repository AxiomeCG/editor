const SVG_NS = 'http://www.w3.org/2000/svg'
const OBJECT_ID = 1
const MAX_POINTS = 100
const MAX_BOXES = 10
const MIN_MASKS = 1
const MAX_MASKS = 32

const elements = {
  sourceName: document.querySelector('#source-name'),
  keyStatus: document.querySelector('#key-status'),
  budgetStatus: document.querySelector('#budget-status'),
  busyStatus: document.querySelector('#busy-status'),
  pointForm: document.querySelector('#point-form'),
  boxForm: document.querySelector('#box-form'),
  promptList: document.querySelector('#prompt-list'),
  promptEmpty: document.querySelector('#prompt-empty'),
  promptCount: document.querySelector('#prompt-count'),
  undoButton: document.querySelector('#undo-button'),
  clearButton: document.querySelector('#clear-button'),
  maxMasks: document.querySelector('#max-masks'),
  requestPreview: document.querySelector('#request-preview'),
  paidConsent: document.querySelector('#paid-consent'),
  runButton: document.querySelector('#run-button'),
  runExplanation: document.querySelector('#run-explanation'),
  sourceSvg: document.querySelector('#source-svg'),
  sourceImage: document.querySelector('#source-image'),
  resultImage: document.querySelector('#result-image'),
  promptOverlay: document.querySelector('#prompt-overlay'),
  draftOverlay: document.querySelector('#draft-overlay'),
  canvasViewport: document.querySelector('#canvas-viewport'),
  canvasFrame: document.querySelector('#canvas-frame'),
  canvasEmpty: document.querySelector('#canvas-empty'),
  canvasMessage: document.querySelector('#canvas-message'),
  coordinateReadout: document.querySelector('#coordinate-readout'),
  staleNotice: document.querySelector('#stale-notice'),
  zoomRange: document.querySelector('#zoom-range'),
  zoomReadout: document.querySelector('#zoom-readout'),
  requestNotice: document.querySelector('#request-notice'),
  runList: document.querySelector('#run-list'),
  runsEmpty: document.querySelector('#runs-empty'),
  runCount: document.querySelector('#run-count'),
  detailEmpty: document.querySelector('#detail-empty'),
  detailContent: document.querySelector('#detail-content'),
  runMetadata: document.querySelector('#run-metadata'),
  candidateCount: document.querySelector('#candidate-count'),
  candidateList: document.querySelector('#candidate-list'),
  candidateEmpty: document.querySelector('#candidate-empty'),
  candidateDetail: document.querySelector('#candidate-detail'),
  candidateMetadata: document.querySelector('#candidate-metadata'),
  artifactList: document.querySelector('#artifact-list'),
  warningList: document.querySelector('#warning-list'),
  runWarningSection: document.querySelector('#run-warning-section'),
  runWarningList: document.querySelector('#run-warning-list'),
  runErrorSection: document.querySelector('#run-error-section'),
  runError: document.querySelector('#run-error'),
}

const state = {
  source: null,
  sessionLoaded: false,
  keyConfigured: false,
  serverBusy: false,
  submitting: false,
  requestsUsed: null,
  maxRequests: null,
  points: [],
  boxes: [],
  geometryHistory: [],
  runs: [],
  selectedRunId: null,
  selectedMaskIndex: null,
  viewMode: 'source',
  zoom: 1,
  draftBox: null,
  pointerId: null,
}

function textElement(tag, text, className) {
  const element = document.createElement(tag)
  if (className) element.className = className
  element.textContent = text
  return element
}

function setChildren(parent, children) {
  parent.replaceChildren(...children)
}

function createSvgElement(tag, attributes) {
  const element = document.createElementNS(SVG_NS, tag)
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, String(value))
  }
  return element
}

function currentTool() {
  return document.querySelector('input[name="draw-tool"]:checked')?.value || 'positive'
}

function currentPayload() {
  const maxMasks = Number(elements.maxMasks.value)
  return {
    prompt: '',
    point_prompts: state.points.map((point) => ({
      x: point.x,
      y: point.y,
      label: point.label,
      object_id: OBJECT_ID,
    })),
    box_prompts: state.boxes.map((box) => ({
      x_min: box.x_min,
      y_min: box.y_min,
      x_max: box.x_max,
      y_max: box.y_max,
      object_id: OBJECT_ID,
    })),
    max_masks: Number.isInteger(maxMasks) ? maxMasks : null,
  }
}

function payloadFingerprint(payload) {
  return JSON.stringify(payload)
}

function selectedRun() {
  return state.runs.find((run) => run && run.id === state.selectedRunId) || null
}

function selectedMask() {
  const run = selectedRun()
  if (!run || !Array.isArray(run.masks)) return null
  return run.masks.find((mask) => mask && mask.index === state.selectedMaskIndex) || null
}

function snapshotGeometry() {
  state.geometryHistory.push({
    points: state.points.map((point) => ({ ...point })),
    boxes: state.boxes.map((box) => ({ ...box })),
  })
  if (state.geometryHistory.length > 100) state.geometryHistory.shift()
}

function mutateGeometry(callback) {
  snapshotGeometry()
  callback()
  renderPrompts()
  renderRequestState()
}

function announce(message, tone = '') {
  elements.requestNotice.textContent = message
  elements.requestNotice.className = `notice${tone ? ` ${tone}` : ''}`
  elements.requestNotice.hidden = false
}

function clearAnnouncement() {
  elements.requestNotice.hidden = true
  elements.requestNotice.textContent = ''
  elements.requestNotice.className = 'notice'
}

function integerWithin(value, minimum, maximum) {
  const number = Number(value)
  return Number.isInteger(number) && number >= minimum && number <= maximum ? number : null
}

function addPoint(x, y, label) {
  if (!state.source || state.points.length >= MAX_POINTS) {
    announce(
      state.points.length >= MAX_POINTS
        ? `Point limit reached (${MAX_POINTS}).`
        : 'Source dimensions are not available.',
      'warning',
    )
    return
  }
  const safeX = integerWithin(x, 0, state.source.width - 1)
  const safeY = integerWithin(y, 0, state.source.height - 1)
  if (safeX === null || safeY === null || (label !== 0 && label !== 1)) {
    announce('Point ignored: enter whole coordinates inside the source image.', 'warning')
    return
  }
  clearAnnouncement()
  mutateGeometry(() => state.points.push({ x: safeX, y: safeY, label }))
}

function addBox(candidate) {
  if (!state.source || state.boxes.length >= MAX_BOXES) {
    announce(
      state.boxes.length >= MAX_BOXES
        ? `Box limit reached (${MAX_BOXES}).`
        : 'Source dimensions are not available.',
      'warning',
    )
    return
  }
  const box = {
    x_min: integerWithin(candidate.x_min, 0, state.source.width),
    y_min: integerWithin(candidate.y_min, 0, state.source.height),
    x_max: integerWithin(candidate.x_max, 0, state.source.width),
    y_max: integerWithin(candidate.y_max, 0, state.source.height),
  }
  if (
    Object.values(box).some((value) => value === null) ||
    box.x_min >= box.x_max ||
    box.y_min >= box.y_max
  ) {
    announce('Box ignored: use whole, in-bounds coordinates with min smaller than max.', 'warning')
    return
  }
  clearAnnouncement()
  mutateGeometry(() => state.boxes.push(box))
}

function renderPrompts() {
  const items = []

  state.points.forEach((point, index) => {
    const item = document.createElement('li')
    item.className = 'prompt-row'
    const kind = point.label === 1 ? 'positive' : 'negative'
    const swatch = textElement('span', '', `prompt-swatch ${kind}`)
    swatch.setAttribute('aria-hidden', 'true')
    const label = point.label === 1 ? 'FG' : 'BG'
    const copy = textElement(
      'span',
      `${label} · (${point.x}, ${point.y}) · label ${point.label}`,
      'prompt-copy',
    )
    const remove = textElement('button', '×', 'remove-button')
    remove.type = 'button'
    remove.setAttribute(
      'aria-label',
      `Remove ${point.label === 1 ? 'foreground' : 'background'} point at ${point.x}, ${point.y}`,
    )
    remove.addEventListener('click', () => {
      mutateGeometry(() => state.points.splice(index, 1))
    })
    item.append(swatch, copy, remove)
    items.push(item)
  })

  state.boxes.forEach((box, index) => {
    const item = document.createElement('li')
    item.className = 'prompt-row'
    const swatch = textElement('span', '', 'prompt-swatch box')
    swatch.setAttribute('aria-hidden', 'true')
    const copy = textElement(
      'span',
      `BOX · (${box.x_min}, ${box.y_min}) → (${box.x_max}, ${box.y_max})`,
      'prompt-copy',
    )
    const remove = textElement('button', '×', 'remove-button')
    remove.type = 'button'
    remove.setAttribute(
      'aria-label',
      `Remove box from ${box.x_min}, ${box.y_min} to ${box.x_max}, ${box.y_max}`,
    )
    remove.addEventListener('click', () => {
      mutateGeometry(() => state.boxes.splice(index, 1))
    })
    item.append(swatch, copy, remove)
    items.push(item)
  })

  setChildren(elements.promptList, items)
  const total = state.points.length + state.boxes.length
  elements.promptCount.textContent = `${total} ${total === 1 ? 'prompt' : 'prompts'}`
  elements.promptEmpty.hidden = total > 0
  elements.undoButton.disabled = state.geometryHistory.length === 0
  elements.clearButton.disabled = total === 0
  renderSvgPrompts()
}

function renderSvgPrompts() {
  const markers = []
  if (!state.source) {
    setChildren(elements.promptOverlay, markers)
    return
  }
  const radius = Math.max(3, Math.min(state.source.width, state.source.height) / 220)
  const arm = radius * 1.45

  state.boxes.forEach((box) => {
    markers.push(
      createSvgElement('rect', {
        x: box.x_min,
        y: box.y_min,
        width: box.x_max - box.x_min,
        height: box.y_max - box.y_min,
        rx: Math.max(1, radius / 2),
        class: 'box-marker marker-shape',
      }),
    )
  })

  state.points.forEach((point) => {
    const className = point.label === 1 ? 'positive-marker' : 'negative-marker'
    markers.push(
      createSvgElement('circle', {
        cx: point.x,
        cy: point.y,
        r: radius,
        class: `${className} marker-shape`,
      }),
    )
    markers.push(
      createSvgElement('line', {
        x1: point.x - arm,
        y1: point.y,
        x2: point.x + arm,
        y2: point.y,
        class: `${className} marker-cross`,
      }),
    )
    markers.push(
      createSvgElement('line', {
        x1: point.x,
        y1: point.y - arm,
        x2: point.x,
        y2: point.y + arm,
        class: `${className} marker-cross`,
      }),
    )
  })

  setChildren(elements.promptOverlay, markers)
}

function renderDraftBox() {
  if (!state.draftBox) {
    elements.draftOverlay.replaceChildren()
    return
  }
  const x = Math.min(state.draftBox.start.x, state.draftBox.end.x)
  const y = Math.min(state.draftBox.start.y, state.draftBox.end.y)
  const width = Math.abs(state.draftBox.end.x - state.draftBox.start.x)
  const height = Math.abs(state.draftBox.end.y - state.draftBox.start.y)
  setChildren(elements.draftOverlay, [
    createSvgElement('rect', {
      x,
      y,
      width,
      height,
      class: 'draft-marker marker-shape',
    }),
  ])
}

function validatePayload(payload) {
  if (!state.source) return 'Source is unavailable.'
  if (
    !Number.isInteger(payload.max_masks) ||
    payload.max_masks < MIN_MASKS ||
    payload.max_masks > MAX_MASKS
  ) {
    return `Maximum masks must be a whole number from ${MIN_MASKS} to ${MAX_MASKS}.`
  }
  if (payload.point_prompts.length > MAX_POINTS || payload.box_prompts.length > MAX_BOXES) {
    return 'Prompt count exceeds the local safety limit.'
  }
  if (
    payload.box_prompts.length === 0 &&
    !payload.point_prompts.some((point) => point.label === 1)
  ) {
    return 'Add at least one foreground point or a box. Background points refine that target.'
  }
  return null
}

function budgetExhausted() {
  return (
    Number.isInteger(state.requestsUsed) &&
    Number.isInteger(state.maxRequests) &&
    state.requestsUsed >= state.maxRequests
  )
}

function availabilityReason(payload) {
  const invalid = validatePayload(payload)
  if (invalid) return invalid
  if (!state.keyConfigured) return 'FAL_KEY is not configured on the server.'
  if (state.serverBusy || state.submitting) return 'A SAM3 request is already in progress.'
  if (budgetExhausted())
    return `Session request budget exhausted (${state.requestsUsed}/${state.maxRequests}).`
  if (!elements.paidConsent.checked) return 'Confirm the paid request to enable Run SAM3.'
  return 'Ready for exactly one paid request. Reported cost may be unavailable.'
}

function renderRequestState() {
  const payload = currentPayload()
  elements.requestPreview.textContent = JSON.stringify(payload, null, 2)
  const invalidMasks =
    !Number.isInteger(payload.max_masks) ||
    payload.max_masks < MIN_MASKS ||
    payload.max_masks > MAX_MASKS
  elements.maxMasks.setAttribute('aria-invalid', String(invalidMasks))
  const reason = availabilityReason(payload)
  elements.runExplanation.textContent = reason
  elements.runButton.disabled =
    Boolean(validatePayload(payload)) ||
    !state.sessionLoaded ||
    !state.keyConfigured ||
    state.serverBusy ||
    state.submitting ||
    budgetExhausted() ||
    !elements.paidConsent.checked
  const busy = state.serverBusy || state.submitting
  elements.runButton.textContent = busy ? 'SAM3 request in progress' : 'Run SAM3 · paid, no retry'
  elements.runButton.setAttribute('aria-busy', String(busy))
  renderSessionStatus()
  renderStaleState()
}

function renderSessionStatus() {
  if (!state.sessionLoaded) {
    elements.keyStatus.textContent = 'Key unknown'
    elements.keyStatus.className = 'status-chip'
    elements.budgetStatus.textContent = 'Budget unknown'
    elements.budgetStatus.className = 'status-chip'
    elements.busyStatus.textContent = 'Checking session'
    elements.busyStatus.className = 'status-chip'
    return
  }
  elements.keyStatus.textContent = state.keyConfigured ? 'Server key ready' : 'Server key missing'
  elements.keyStatus.className = `status-chip ${state.keyConfigured ? 'good' : 'bad'}`

  elements.budgetStatus.textContent = `Budget ${state.requestsUsed}/${state.maxRequests}`
  elements.budgetStatus.className = `status-chip ${budgetExhausted() ? 'bad' : 'good'}`

  const busy = state.serverBusy || state.submitting
  elements.busyStatus.textContent = busy ? 'SAM3 busy' : 'SAM3 idle'
  elements.busyStatus.className = `status-chip ${busy ? 'warn' : 'good'}`
}

function renderStaleState() {
  const run = selectedRun()
  const stale =
    Boolean(run?.input) && payloadFingerprint(currentPayload()) !== payloadFingerprint(run.input)
  elements.staleNotice.hidden = !stale
  if (run && stale) {
    elements.canvasMessage.textContent = 'Showing a saved result from a different prompt request.'
  } else if (run) {
    elements.canvasMessage.textContent = `Showing saved run ${run.id}.`
  } else if (state.source) {
    elements.canvasMessage.textContent = 'Click to add a point, or drag with the box tool.'
  }
}

function updateCanvasSize() {
  if (!state.source) return
  const availableWidth = Math.max(240, elements.canvasViewport.clientWidth - 40)
  const availableHeight = Math.max(240, elements.canvasViewport.clientHeight - 40)
  const fitScale = Math.min(
    availableWidth / state.source.width,
    availableHeight / state.source.height,
    1,
  )
  const scale = fitScale * state.zoom
  const width = Math.max(1, Math.round(state.source.width * scale))
  const height = Math.max(1, Math.round(state.source.height * scale))
  elements.canvasFrame.style.width = `${width}px`
  elements.canvasFrame.style.height = `${height}px`
}

function pointFromPointer(event) {
  if (!state.source) return null
  let x
  let y
  const matrix = elements.sourceSvg.getScreenCTM()
  if (matrix) {
    try {
      const transformed = new DOMPoint(event.clientX, event.clientY).matrixTransform(
        matrix.inverse(),
      )
      x = transformed.x
      y = transformed.y
    } catch {
      x = undefined
    }
  }
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    const rect = elements.sourceSvg.getBoundingClientRect()
    if (!rect.width || !rect.height) return null
    x = ((event.clientX - rect.left) / rect.width) * state.source.width
    y = ((event.clientY - rect.top) / rect.height) * state.source.height
  }
  if (x < 0 || y < 0 || x >= state.source.width || y >= state.source.height) return null
  return {
    x: Math.floor(x),
    y: Math.floor(y),
  }
}

function updatePointerReadout(event) {
  const point = pointFromPointer(event)
  elements.coordinateReadout.textContent = point ? `x ${point.x} · y ${point.y}` : 'x — · y —'
  return point
}

function handlePointerDown(event) {
  if (event.button !== 0 || !state.source) return
  const point = pointFromPointer(event)
  if (!point) return
  const tool = currentTool()
  if (tool === 'positive' || tool === 'negative') {
    addPoint(point.x, point.y, tool === 'positive' ? 1 : 0)
    return
  }
  state.pointerId = event.pointerId
  state.draftBox = { start: point, end: point }
  elements.sourceSvg.setPointerCapture(event.pointerId)
  renderDraftBox()
}

function handlePointerMove(event) {
  const point = updatePointerReadout(event)
  if (state.pointerId !== event.pointerId || !state.draftBox || !point) return
  state.draftBox.end = point
  renderDraftBox()
}

function finishBox(event, cancelled = false) {
  if (state.pointerId !== event.pointerId || !state.draftBox) return
  const draft = state.draftBox
  state.pointerId = null
  state.draftBox = null
  if (elements.sourceSvg.hasPointerCapture(event.pointerId))
    elements.sourceSvg.releasePointerCapture(event.pointerId)
  renderDraftBox()
  if (cancelled) return
  const end = pointFromPointer(event)
  if (!end) return
  const candidate = {
    x_min: Math.min(draft.start.x, end.x),
    y_min: Math.min(draft.start.y, end.y),
    x_max: Math.max(draft.start.x, end.x),
    y_max: Math.max(draft.start.y, end.y),
  }
  addBox(candidate)
}

function safeRunArtifactUrl(run, rawValue) {
  if (typeof rawValue !== 'string' || !rawValue) return null
  try {
    const url = new URL(rawValue, window.location.origin)
    const runPrefix = `/runs/${encodeURIComponent(String(run.id))}/`
    if (url.origin !== window.location.origin || !url.pathname.startsWith(runPrefix)) return null
    return `${url.pathname}${url.search}`
  } catch {
    return null
  }
}

function formatDate(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Unknown time' : date.toLocaleString()
}

function formatDuration(value) {
  return Number.isFinite(value) && value >= 0 ? `${Math.round(value)} ms` : 'Unknown'
}

function formatScore(value) {
  return Number.isFinite(value) ? value.toFixed(3) : 'Not reported'
}

function formatCoverage(value) {
  if (!Number.isFinite(value)) return 'Unknown'
  const percent = value <= 1 ? value * 100 : value
  return `${percent.toFixed(percent < 1 ? 2 : 1)}%`
}

function replaceDefinitionList(list, entries) {
  const children = []
  entries.forEach(([term, description]) => {
    children.push(textElement('dt', term))
    children.push(textElement('dd', description))
  })
  setChildren(list, children)
}

function renderRuns() {
  const runItems = state.runs.map((run) => {
    const item = document.createElement('li')
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `run-button-row${run.id === state.selectedRunId ? ' selected' : ''}`
    button.setAttribute('aria-pressed', String(run.id === state.selectedRunId))
    const line = textElement('span', '', 'run-line')
    line.append(
      textElement('span', String(run.id ?? 'Unknown run'), 'run-id'),
      textElement(
        'span',
        String(run.status ?? 'unknown'),
        `run-status ${run.status === 'completed' ? 'completed' : 'failed'}`,
      ),
    )
    const maskCount = Array.isArray(run.masks) ? run.masks.length : 0
    const meta = textElement(
      'span',
      `${formatDate(run.createdAt)} · ${maskCount} ${maskCount === 1 ? 'mask' : 'masks'}`,
      'run-meta',
    )
    button.append(line, meta)
    button.addEventListener('click', () => selectRun(run.id))
    item.append(button)
    return item
  })
  setChildren(elements.runList, runItems)
  elements.runsEmpty.hidden = state.runs.length > 0
  elements.runCount.textContent = `${state.runs.length} ${state.runs.length === 1 ? 'run' : 'runs'}`
  renderRunDetail()
}

function selectRun(runId) {
  state.selectedRunId = runId
  const run = selectedRun()
  state.selectedMaskIndex =
    Array.isArray(run?.masks) && run.masks.length ? run.masks[0].index : null
  if (state.selectedMaskIndex === null) setViewMode('source')
  renderRuns()
  renderCanvasMode()
  renderStaleState()
}

function selectMask(maskIndex) {
  state.selectedMaskIndex = maskIndex
  renderRunDetail()
  renderCanvasMode()
}

function renderRunDetail() {
  const run = selectedRun()
  elements.detailEmpty.hidden = Boolean(run)
  elements.detailContent.hidden = !run
  if (!run) return

  const requestId =
    typeof run.provider?.requestId === 'string' && run.provider.requestId
      ? run.provider.requestId
      : 'Not reported'
  const httpStatus = Number.isInteger(run.provider?.httpStatus)
    ? String(run.provider.httpStatus)
    : 'Not reported'
  const reportedCost = Number.isFinite(run.provider?.reportedCostUsd)
    ? `$${run.provider.reportedCostUsd.toFixed(6)} reported`
    : 'Unknown / not reported'
  replaceDefinitionList(elements.runMetadata, [
    ['Run', String(run.id ?? 'Unknown')],
    ['Status', String(run.status ?? 'Unknown')],
    ['Created', formatDate(run.createdAt)],
    ['Duration', formatDuration(run.durationMs)],
    ['Request ID', requestId],
    ['HTTP', httpStatus],
    ['Cost', reportedCost],
    ['Source SHA', typeof run.image?.sha256 === 'string' ? run.image.sha256 : 'Unknown'],
  ])

  const masks = Array.isArray(run.masks) ? run.masks : []
  elements.candidateCount.textContent = `${masks.length} returned`
  elements.candidateEmpty.hidden = masks.length > 0
  const candidateItems = masks.map((mask) => {
    const item = document.createElement('li')
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `candidate-button${mask.index === state.selectedMaskIndex ? ' selected' : ''}`
    button.setAttribute('aria-pressed', String(mask.index === state.selectedMaskIndex))
    button.setAttribute(
      'aria-label',
      `Select mask candidate ${mask.index + 1}, score ${formatScore(mask.score)}. Score is not ground truth.`,
    )
    const line = textElement('span', '', 'candidate-line')
    line.append(
      textElement('span', `Candidate ${mask.index + 1}`),
      textElement('span', formatScore(mask.score), 'candidate-score'),
    )
    const positiveMisses = Math.max(
      0,
      Number(mask.positiveCount || 0) - Number(mask.positiveHits || 0),
    )
    const negativeMisses = Math.max(
      0,
      Number(mask.negativeCount || 0) - Number(mask.negativeHits || 0),
    )
    const meta = textElement(
      'span',
      `Coverage ${formatCoverage(mask.coverage)} · FG hit ${mask.positiveHits}/${mask.positiveCount}, miss ${positiveMisses} · BG hit ${mask.negativeHits}/${mask.negativeCount}, miss ${negativeMisses}`,
      'candidate-meta',
    )
    button.append(line, meta)
    button.addEventListener('click', () => selectMask(mask.index))
    item.append(button)
    return item
  })
  setChildren(elements.candidateList, candidateItems)

  const mask = selectedMask()
  elements.candidateDetail.hidden = !mask
  if (mask) renderCandidateDetail(run, mask)

  const runWarnings = Array.isArray(run.warnings) ? run.warnings : []
  elements.runWarningSection.hidden = runWarnings.length === 0
  setChildren(
    elements.runWarningList,
    runWarnings.map((warning) => textElement('li', String(warning))),
  )

  const hasError = typeof run.error === 'string' && run.error.length > 0
  elements.runErrorSection.hidden = !hasError
  elements.runError.textContent = hasError ? run.error : ''
}

function renderCandidateDetail(run, mask) {
  const bbox =
    Array.isArray(mask.bbox) && mask.bbox.length === 4 ? mask.bbox.join(', ') : 'None reported'
  const positiveMisses = Math.max(
    0,
    Number(mask.positiveCount || 0) - Number(mask.positiveHits || 0),
  )
  const negativeMisses = Math.max(
    0,
    Number(mask.negativeCount || 0) - Number(mask.negativeHits || 0),
  )
  replaceDefinitionList(elements.candidateMetadata, [
    ['Score', `${formatScore(mask.score)} (ranking signal, not truth)`],
    ['Coverage', formatCoverage(mask.coverage)],
    ['Dimensions', `${mask.width ?? '?'} × ${mask.height ?? '?'}`],
    ['Bounding box', bbox],
    ['Foreground', `${mask.positiveHits}/${mask.positiveCount} hit · ${positiveMisses} miss`],
    [
      'Background',
      `${mask.negativeHits}/${mask.negativeCount} hit mask · ${negativeMisses} miss mask`,
    ],
  ])

  const artifacts = [
    ['Provider raw', mask.rawUrl, `sam3-${run.id}-candidate-${mask.index + 1}-raw.png`],
    ['Mask', mask.maskUrl, `sam3-${run.id}-candidate-${mask.index + 1}-mask.png`],
    ['Overlay', mask.overlayUrl, `sam3-${run.id}-candidate-${mask.index + 1}-overlay.png`],
  ]
  const links = []
  artifacts.forEach(([label, rawUrl, filename]) => {
    const href = safeRunArtifactUrl(run, rawUrl)
    if (!href) return
    const item = document.createElement('li')
    const link = textElement('a', label)
    link.href = href
    link.download = filename
    item.append(link)
    links.push(item)
  })
  setChildren(elements.artifactList, links)

  const warnings = Array.isArray(mask.warnings) ? mask.warnings : []
  setChildren(
    elements.warningList,
    warnings.map((warning) => textElement('li', String(warning))),
  )
}

function setViewMode(mode) {
  state.viewMode = mode
  const radio = document.querySelector(`input[name="view-mode"][value="${mode}"]`)
  if (radio) radio.checked = true
  renderCanvasMode()
}

function renderCanvasMode() {
  const run = selectedRun()
  const mask = selectedMask()
  document.querySelectorAll('input[name="view-mode"]').forEach((radio) => {
    radio.disabled = radio.value !== 'source' && !mask
  })
  let href = null
  if (run && mask && state.viewMode !== 'source') {
    const key =
      state.viewMode === 'raw' ? 'rawUrl' : state.viewMode === 'mask' ? 'maskUrl' : 'overlayUrl'
    href = safeRunArtifactUrl(run, mask[key])
  }
  if (!href && state.viewMode !== 'source') {
    state.viewMode = 'source'
    const sourceRadio = document.querySelector('input[name="view-mode"][value="source"]')
    if (sourceRadio) sourceRadio.checked = true
  }
  if (state.viewMode === 'source' || !href) {
    elements.sourceImage.setAttribute('visibility', 'visible')
    elements.resultImage.setAttribute('visibility', 'hidden')
    elements.resultImage.removeAttribute('href')
  } else if (state.viewMode === 'overlay') {
    elements.sourceImage.setAttribute('visibility', 'visible')
    elements.resultImage.setAttribute('href', href)
    elements.resultImage.setAttribute('opacity', '1')
    elements.resultImage.setAttribute('visibility', 'visible')
  } else {
    elements.sourceImage.setAttribute('visibility', 'hidden')
    elements.resultImage.setAttribute('href', href)
    elements.resultImage.setAttribute('opacity', '1')
    elements.resultImage.setAttribute('visibility', 'visible')
  }
}

function normalizeSession(data) {
  if (!data || typeof data !== 'object' || !data.source || typeof data.source !== 'object') {
    throw new Error('Session response is missing its source descriptor.')
  }
  const width = Number(data.source.width)
  const height = Number(data.source.height)
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new Error('Session source dimensions are invalid.')
  }
  const requestsUsed = Number(data.requestsUsed)
  const maxRequests = Number(data.maxRequests)
  if (
    !Number.isInteger(requestsUsed) ||
    requestsUsed < 0 ||
    !Number.isInteger(maxRequests) ||
    maxRequests < 1
  ) {
    throw new Error('Session request budget is invalid.')
  }
  state.source = {
    name: typeof data.source.name === 'string' ? data.source.name : 'floorplan source',
    width,
    height,
  }
  state.sessionLoaded = true
  state.keyConfigured = data.keyConfigured === true
  state.serverBusy = data.busy === true
  state.requestsUsed = requestsUsed
  state.maxRequests = maxRequests
  state.runs = Array.isArray(data.runs)
    ? data.runs.filter((run) => run && typeof run.id === 'string')
    : []
  if (state.selectedRunId && !state.runs.some((run) => run.id === state.selectedRunId))
    state.selectedRunId = null
}

async function loadSession({ preserveNotice = false } = {}) {
  if (!preserveNotice) clearAnnouncement()
  try {
    const response = await fetch('/api/session', {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })
    if (!response.ok) throw new Error(`Session read failed with HTTP ${response.status}.`)
    normalizeSession(await response.json())
    configureSource()
    renderRuns()
    renderRequestState()
  } catch (error) {
    state.source = null
    state.sessionLoaded = false
    state.keyConfigured = false
    state.serverBusy = false
    state.requestsUsed = null
    state.maxRequests = null
    elements.canvasEmpty.hidden = false
    elements.sourceName.textContent = 'Source unavailable'
    elements.canvasMessage.textContent = 'Could not load the local inspection session.'
    announce(
      error instanceof Error ? error.message : 'Could not load the local inspection session.',
      'error',
    )
    renderRequestState()
  }
}

function configureSource() {
  if (!state.source) return
  elements.sourceName.textContent = `${state.source.name} · ${state.source.width} × ${state.source.height}`
  elements.sourceSvg.setAttribute('viewBox', `0 0 ${state.source.width} ${state.source.height}`)
  for (const image of [elements.sourceImage, elements.resultImage]) {
    image.setAttribute('width', String(state.source.width))
    image.setAttribute('height', String(state.source.height))
  }
  if (elements.sourceImage.getAttribute('href') !== '/api/source') {
    elements.sourceImage.setAttribute('href', '/api/source')
  }
  document.querySelector('#point-x').max = String(state.source.width - 1)
  document.querySelector('#point-y').max = String(state.source.height - 1)
  document.querySelector('#box-x-min').max = String(state.source.width)
  document.querySelector('#box-x-max').max = String(state.source.width)
  document.querySelector('#box-y-min').max = String(state.source.height)
  document.querySelector('#box-y-max').max = String(state.source.height)
  updateCanvasSize()
  renderSvgPrompts()
  renderCanvasMode()
  renderStaleState()
}

async function runSegmentation() {
  const payload = currentPayload()
  const reason = availabilityReason(payload)
  if (
    elements.runButton.disabled ||
    reason !== 'Ready for exactly one paid request. Reported cost may be unavailable.'
  )
    return

  state.submitting = true
  elements.paidConsent.checked = false
  clearAnnouncement()
  renderRequestState()
  announce('SAM3 request in progress. No retry will be attempted.')

  try {
    const response = await fetch('/api/segment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ ...payload, confirmPaid: true }),
    })
    let data
    try {
      data = await response.json()
    } catch {
      data = null
    }

    if (!response.ok) {
      if (data?.run && typeof data.run.id === 'string') {
        state.runs = [data.run, ...state.runs.filter((run) => run.id !== data.run.id)]
        state.selectedRunId = data.run.id
        state.selectedMaskIndex =
          Array.isArray(data.run.masks) && data.run.masks.length ? data.run.masks[0].index : null
      }
      const message =
        typeof data?.error === 'string'
          ? data.error
          : `SAM3 request failed with HTTP ${response.status}.`
      announce(message, 'error')
    } else if (!data || typeof data.id !== 'string') {
      announce('SAM3 returned an invalid run record.', 'error')
    } else {
      state.runs = [data, ...state.runs.filter((run) => run.id !== data.id)]
      state.selectedRunId = data.id
      state.selectedMaskIndex =
        Array.isArray(data.masks) && data.masks.length ? data.masks[0].index : null
      if (state.selectedMaskIndex !== null) setViewMode('overlay')
      const count = Array.isArray(data.masks) ? data.masks.length : 0
      announce(
        count
          ? `Run saved with ${count} mask ${count === 1 ? 'candidate' : 'candidates'}.`
          : 'Run completed, but no masks were returned.',
        count ? 'success' : 'warning',
      )
    }
  } catch (error) {
    announce(
      error instanceof Error
        ? error.message
        : 'SAM3 request failed before a response was received.',
      'error',
    )
  } finally {
    state.submitting = false
    renderRuns()
    renderCanvasMode()
    renderRequestState()
    await loadSession({ preserveNotice: true })
  }
}

elements.pointForm.addEventListener('submit', (event) => {
  event.preventDefault()
  const form = new FormData(elements.pointForm)
  const label = Number(document.querySelector('input[name="point-label"]:checked')?.value)
  addPoint(Number(form.get('x')), Number(form.get('y')), label)
})

elements.boxForm.addEventListener('submit', (event) => {
  event.preventDefault()
  const form = new FormData(elements.boxForm)
  addBox({
    x_min: Number(form.get('x_min')),
    y_min: Number(form.get('y_min')),
    x_max: Number(form.get('x_max')),
    y_max: Number(form.get('y_max')),
  })
})

elements.undoButton.addEventListener('click', () => {
  const snapshot = state.geometryHistory.pop()
  if (!snapshot) return
  state.points = snapshot.points
  state.boxes = snapshot.boxes
  clearAnnouncement()
  renderPrompts()
  renderRequestState()
})

elements.clearButton.addEventListener('click', () => {
  if (!state.points.length && !state.boxes.length) return
  mutateGeometry(() => {
    state.points = []
    state.boxes = []
  })
})

elements.maxMasks.addEventListener('input', renderRequestState)
elements.paidConsent.addEventListener('change', renderRequestState)
elements.runButton.addEventListener('click', runSegmentation)

document.querySelectorAll('input[name="draw-tool"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    elements.sourceSvg.className.baseVal = `mode-${currentTool()}`
    elements.canvasMessage.textContent =
      currentTool() === 'box'
        ? 'Drag across the source to add a bounding box.'
        : `Click the source to add a ${currentTool() === 'positive' ? 'foreground' : 'background'} point.`
  })
})

document.querySelectorAll('input[name="view-mode"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    if (radio.checked) {
      state.viewMode = radio.value
      renderCanvasMode()
    }
  })
})

elements.zoomRange.addEventListener('input', () => {
  state.zoom = Number(elements.zoomRange.value) / 100
  elements.zoomReadout.textContent = `${elements.zoomRange.value}%`
  updateCanvasSize()
})

elements.sourceSvg.addEventListener('pointerdown', handlePointerDown)
elements.sourceSvg.addEventListener('pointermove', handlePointerMove)
elements.sourceSvg.addEventListener('pointerup', (event) => finishBox(event))
elements.sourceSvg.addEventListener('pointercancel', (event) => finishBox(event, true))
elements.sourceSvg.addEventListener('pointerleave', () => {
  if (state.pointerId === null) elements.coordinateReadout.textContent = 'x — · y —'
})
elements.sourceSvg.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.draftBox && state.pointerId !== null) {
    finishBox({ pointerId: state.pointerId }, true)
  }
})

elements.sourceImage.addEventListener('load', () => {
  elements.canvasEmpty.hidden = true
  updateCanvasSize()
})
elements.sourceImage.addEventListener('error', () => {
  elements.canvasEmpty.hidden = false
  elements.canvasEmpty.firstElementChild.textContent = 'Source image could not be displayed'
  elements.canvasEmpty.lastElementChild.textContent =
    'Check the local source artifact and restart the inspection server.'
})

const resizeObserver = new ResizeObserver(updateCanvasSize)
resizeObserver.observe(elements.canvasViewport)

renderPrompts()
renderRequestState()
loadSession()
