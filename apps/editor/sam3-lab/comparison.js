;(() => {
  'use strict'

  const UNKNOWN = 'Unknown'

  const elements = {
    status: document.querySelector('#comparison-status'),
    content: document.querySelector('#comparison-content'),
    assessment: document.querySelector('#comparison-assessment'),
    assessmentRecommendation: document.querySelector('#assessment-recommendation'),
    assessmentMethod: document.querySelector('#assessment-method'),
    sourceMeta: document.querySelector('#comparison-source-meta'),
    variantCount: document.querySelector('#variant-count'),
    assessmentColumnHeading: document.querySelector('#assessment-column-heading'),
    variantsBody: document.querySelector('#variants-table-body'),
    variantsWrap: document.querySelector('#variants-table-wrap'),
    variantsEmpty: document.querySelector('#variants-empty'),
    selectedSection: document.querySelector('#selected-variant-section'),
    selectedHeading: document.querySelector('#selected-variant-heading'),
    selectedPipeline: document.querySelector('#selected-pipeline'),
    evidenceImage: document.querySelector('#comparison-evidence-image'),
    evidenceEmpty: document.querySelector('#comparison-evidence-empty'),
    evidenceViewLabel: document.querySelector('#evidence-view-label'),
    evidenceCaption: document.querySelector('#evidence-caption'),
    previewForm: document.querySelector('#native-preview-form'),
    metersPerPixel: document.querySelector('#meters-per-pixel'),
    wallHeight: document.querySelector('#wall-height'),
    generateButton: document.querySelector('#generate-native-preview'),
    previewImage: document.querySelector('#native-preview-image'),
    previewEmpty: document.querySelector('#native-preview-empty'),
    previewLabel: document.querySelector('#native-preview-label'),
    previewCaption: document.querySelector('#native-preview-caption'),
    previewStatus: document.querySelector('#native-preview-status'),
    downloadButton: document.querySelector('#download-native-json'),
    extractionDiagnostics: document.querySelector('#extraction-diagnostics'),
    nodeCounts: document.querySelector('#node-counts'),
    nodeCountsEmpty: document.querySelector('#node-counts-empty'),
    mappingCount: document.querySelector('#mapping-count'),
    mappingsWrap: document.querySelector('#mappings-table-wrap'),
    mappingsBody: document.querySelector('#mappings-table-body'),
    mappingsEmpty: document.querySelector('#mappings-empty'),
    nativeIssues: document.querySelector('#native-issues'),
    nativeIssuesEmpty: document.querySelector('#native-issues-empty'),
    nativeAssumptions: document.querySelector('#native-assumptions'),
    nativeAssumptionsEmpty: document.querySelector('#native-assumptions-empty'),
    qualityOptions: document.querySelector('#quality-options'),
    qualityOptionsEmpty: document.querySelector('#quality-options-empty'),
    caveats: document.querySelector('#comparison-caveats'),
    caveatsEmpty: document.querySelector('#comparison-caveats-empty'),
    calibrationStage: document.querySelector('#calibration-stage'),
    calibrationOverlay: document.querySelector('#calibration-overlay'),
    calibrationPick: document.querySelector('#calibration-pick'),
    calibrationDistance: document.querySelector('#calibration-distance'),
    calibrationStatus: document.querySelector('#calibration-status'),
    pointInputs: ['x1', 'y1', 'x2', 'y2'].map((id) => document.querySelector(`#calibration-${id}`)),
    native3dHost: document.querySelector('#native-3d-host'),
    native3dControls: document.querySelector('#native-3d-controls'),
    native3dStatus: document.querySelector('#native-3d-status'),
    view2d: document.querySelector('#native-view-2d'),
    view3d: document.querySelector('#native-view-3d'),
  }

  const state = {
    manifest: null,
    selectedVariantId: null,
    preview: null,
    previewVariantId: null,
    calibration: null,
    calibrationPoints: [],
    calibrationCursor: null,
    picking: false,
    native3d: null,
    previewVersion: 0,
  }

  function createElement(tag, text, className) {
    const element = document.createElement(tag)
    if (text !== undefined) element.textContent = text
    if (className) element.className = className
    return element
  }

  function renderCalibration() {
    const source = state.manifest?.source
    if (!source) return
    const image = elements.evidenceImage,
      overlay = elements.calibrationOverlay
    overlay.setAttribute('viewBox', `0 0 ${source.width} ${source.height}`)
    Object.assign(overlay.style, {
      left: `${image.offsetLeft}px`,
      top: `${image.offsetTop}px`,
      width: `${image.clientWidth}px`,
      height: `${image.clientHeight}px`,
    })
    overlay.replaceChildren()
    const svg = (tag, attributes) => {
      const element = document.createElementNS('http://www.w3.org/2000/svg', tag)
      for (const [key, value] of Object.entries(attributes))
        element.setAttribute(key, String(value))
      overlay.append(element)
      return element
    }
    if (state.calibrationPoints.length === 2) {
      const [a, b] = state.calibrationPoints
      svg('line', {
        x1: a[0],
        y1: a[1],
        x2: b[0],
        y2: b[1],
        stroke: '#2166d1',
        'stroke-width': 2,
        'vector-effect': 'non-scaling-stroke',
      })
    }
    state.calibrationPoints.forEach((point, index) => {
      svg('circle', {
        cx: point[0],
        cy: point[1],
        r: 6,
        fill: '#2166d1',
        stroke: '#ffffff',
        'stroke-width': 2,
      })
      const text = svg('text', {
        x: point[0] + 10,
        y: point[1] - 8,
        fill: '#154b9b',
        'font-size': 16,
        'font-weight': 700,
      })
      text.textContent = String(index + 1)
    })
    if (state.picking && state.calibrationCursor) {
      const [x, y] = state.calibrationCursor
      svg('path', {
        d: `M ${x - 8} ${y} H ${x + 8} M ${x} ${y - 8} V ${y + 8}`,
        stroke: '#2166d1',
        'stroke-width': 1.5,
      })
    }
    elements.calibrationStage.dataset.picking = String(state.picking)
    elements.calibrationPick.setAttribute('aria-pressed', String(state.picking))
  }

  function updateCalibration() {
    state.calibration = null
    clearNativePreview('Scale changed. Generate the native preview again.')
    setNotice(elements.previewStatus, 'Scale changed; regenerate locally to update the native graph.', 'warning')
    const distance = Number(elements.calibrationDistance.value)
    if (state.calibrationPoints.length !== 2 || !Number.isFinite(distance) || distance <= 0) {
      elements.metersPerPixel.value = '0.015'
      elements.calibrationStatus.textContent = `${state.calibrationPoints.length}/2 points selected. Enter the real distance in metres.`
      renderCalibration()
      return
    }
    const [start, end] = state.calibrationPoints
    const pixels = Math.hypot(end[0] - start[0], end[1] - start[1])
    const scale = distance / pixels
    if (pixels < 1 || scale < 0.0001 || scale > 1) {
      elements.metersPerPixel.value = '0.015'
      elements.calibrationStatus.textContent =
        'Choose distinct endpoints and a distance giving 0.0001–1 m per pixel.'
      renderCalibration()
      return
    }
    state.calibration = { start: [...start], end: [...end], distanceMeters: distance }
    elements.metersPerPixel.value = String(scale)
    elements.calibrationStatus.textContent = `Calibrated: ${pixels.toFixed(2)} px = ${distance} m · ${scale.toFixed(6)} m/px.`
    renderCalibration()
  }

  function pickCalibrationPoint(point) {
    if (!state.picking || !state.manifest) return
    if (state.calibrationPoints.length === 2) state.calibrationPoints = []
    state.calibrationPoints.push(point)
    const values = state.calibrationPoints.flat()
    elements.pointInputs.forEach((input, index) => {
      input.value = values[index] === undefined ? '' : values[index].toFixed(2)
    })
    if (state.calibrationPoints.length === 2) state.picking = false
    updateCalibration()
  }

  async function showNativeView(mode) {
    const preview = state.preview
    if (mode === '3d' && !preview?.scene?.meshes?.length) return
    elements.previewImage.hidden = mode === '3d' || !preview
    elements.native3dHost.hidden = mode !== '3d'
    elements.native3dControls.hidden = mode !== '3d'
    elements.view2d.setAttribute('aria-pressed', String(mode === '2d'))
    elements.view3d.setAttribute('aria-pressed', String(mode === '3d'))
    if (mode !== '3d' || state.native3d) return
    elements.native3dStatus.textContent = 'Loading the local 3D inspector…'
    try {
      const { mountNativePreview } = await import('/native-3d.js')
      if (state.preview !== preview || elements.native3dHost.hidden || state.native3d) return
      state.native3d = mountNativePreview(elements.native3dHost, preview.scene, (text) => {
        elements.native3dStatus.textContent = text
      })
      state.native3d.cutaway(document.querySelector('#native-3d-cutaway').checked)
    } catch (error) {
      elements.native3dStatus.textContent = `3D preview failed: ${error.message}`
    }
  }

  function replaceChildren(parent, children) {
    parent.replaceChildren(...children)
  }

  function setNotice(element, message, tone = '') {
    element.textContent = message
    element.className = `notice${element === elements.status ? ' comparison-status' : ''}${tone ? ` ${tone}` : ''}`
  }

  function selectedVariant() {
    return (
      state.manifest?.variants.find((variant) => variant.id === state.selectedVariantId) || null
    )
  }
  function variantAssessment(variantId) {
    return (
      state.manifest?.assessment?.variants.find((variant) => variant.variantId === variantId) ||
      null
    )
  }

  function formatInteger(value) {
    return Number.isFinite(value) && value >= 0
      ? Math.round(value).toLocaleString('en-US')
      : UNKNOWN
  }

  function formatCost(value) {
    return Number.isFinite(value) && value >= 0 ? `$${value.toFixed(4)} recorded` : UNKNOWN
  }

  function formatDuration(value) {
    return Number.isFinite(value) && value >= 0
      ? `${Math.round(value).toLocaleString('en-US')} ms`
      : UNKNOWN
  }

  function usageTokenText(usage) {
    return `Input ${formatInteger(usage?.inputTokens)} · output ${formatInteger(usage?.outputTokens)}`
  }

  function usageCostText(usage) {
    return `${formatCost(usage?.costUsd)} · ${formatDuration(usage?.durationMs)}`
  }

  function appendUnknownClass(element, values) {
    if (
      values.some(
        (value) =>
          value === UNKNOWN || value.startsWith(`${UNKNOWN} ·`) || value.endsWith(`· ${UNKNOWN}`),
      )
    ) {
      element.classList.add('unknown-value')
    }
  }

  function safeLocalUrl(rawUrl) {
    if (typeof rawUrl !== 'string' || rawUrl.length === 0) return null
    try {
      const url = new URL(rawUrl, window.location.href)
      return url.origin === window.location.origin ? url.href : null
    } catch {
      return null
    }
  }

  function setImageSource(image, empty, url, alt, emptyMessage) {
    if (!url) {
      image.hidden = true
      image.removeAttribute('src')
      image.alt = ''
      empty.textContent = emptyMessage
      empty.hidden = false
      return false
    }

    image.alt = alt
    image.src = url
    image.hidden = false
    empty.hidden = true
    return true
  }

  function candidateCounts(variant) {
    const counts = { wall: 0, door: 0, window: 0 }
    for (const candidate of variant.candidates) {
      if (Object.hasOwn(counts, candidate.class)) counts[candidate.class] += 1
    }
    return counts
  }

  function unresolvedCandidates(variant) {
    return variant.candidates.filter((candidate) => {
      const decision = candidate.decision
      return (
        !decision || decision.action === 'needs_repair' || decision.correctedClass === 'uncertain'
      )
    })
  }

  function renderSourceMetadata() {
    const source = state.manifest.source
    const items = [
      `Source · ${source.name}`,
      `Pixels · ${formatInteger(source.width)} × ${formatInteger(source.height)}`,
      `SHA-256 · ${source.sha256}`,
    ]
    replaceChildren(
      elements.sourceMeta,
      items.map((item) => createElement('span', item)),
    )
  }
  function renderAssessment() {
    const assessment = state.manifest.assessment
    elements.assessment.hidden = !assessment
    elements.assessmentRecommendation.textContent = assessment?.recommendation || ''
    elements.assessmentMethod.textContent = assessment?.method || ''
  }

  function renderVariants() {
    elements.assessmentColumnHeading.hidden = !state.manifest.assessment
    const rows = state.manifest.variants.map((variant) => {
      const row = document.createElement('tr')
      const choiceCell = document.createElement('th')
      choiceCell.scope = 'row'
      const choice = createElement('label', undefined, 'variant-choice')
      const radio = document.createElement('input')
      radio.type = 'radio'
      radio.name = 'comparison-variant'
      radio.value = variant.id
      radio.checked = variant.id === state.selectedVariantId
      radio.addEventListener('change', () => selectVariant(variant.id))
      const label = createElement('span', undefined, 'variant-label')
      label.append(
        createElement('strong', variant.label),
        createElement('span', variant.id, 'variant-id'),
      )
      choice.append(radio, label)
      choiceCell.append(choice)

      const pipelineCell = document.createElement('td')
      const pipeline = createElement('span', undefined, 'table-stack')
      pipeline.append(
        createElement('span', `Extractor · ${variant.extractor}`),
        createElement(
          'small',
          variant.reviewer ? `Reviewer · ${variant.reviewer}` : 'Reviewer · None recorded',
        ),
      )
      pipelineCell.append(pipeline)

      const counts = candidateCounts(variant)
      const countsCell = createElement(
        'td',
        `${counts.wall} / ${counts.door} / ${counts.window}`,
        'tabular',
      )

      const unresolved = unresolvedCandidates(variant).length
      const diagnosticCell = createElement(
        'td',
        `${unresolved} unresolved / ${variant.missingFeatures.length} missing`,
        'tabular',
      )
      const assessment = variantAssessment(variant.id)
      const assessmentCell = document.createElement('td')
      assessmentCell.className = 'assessment-cell'
      if (assessment) {
        const assessmentStack = createElement('span', undefined, 'table-stack')
        assessmentStack.append(
          createElement('strong', 'Observed door locations'),
          createElement('span', assessment.doors),
          createElement('strong', 'Source-checked verdict'),
          createElement('span', assessment.verdict),
        )
        assessmentCell.append(assessmentStack)
      }

      const tokenText = usageTokenText(variant.usage)
      const tokenCell = createElement('td', tokenText, 'tabular')
      appendUnknownClass(tokenCell, [
        formatInteger(variant.usage?.inputTokens),
        formatInteger(variant.usage?.outputTokens),
      ])

      const costCell = document.createElement('td')
      const costStack = createElement('span', undefined, 'table-stack tabular')
      const costLine = createElement('span', usageCostText(variant.usage))
      appendUnknownClass(costLine, [
        formatCost(variant.usage?.costUsd),
        formatDuration(variant.usage?.durationMs),
      ])
      costStack.append(
        costLine,
        createElement('small', variant.usage?.basis || 'Usage basis · Unknown'),
      )
      costCell.append(costStack)

      const cells = [choiceCell, pipelineCell, countsCell, diagnosticCell]
      if (state.manifest.assessment) cells.push(assessmentCell)
      cells.push(tokenCell, costCell)
      row.append(...cells)
      return row
    })

    replaceChildren(elements.variantsBody, rows)
    elements.variantCount.textContent = `${rows.length} variant${rows.length === 1 ? '' : 's'}`
    elements.variantsWrap.hidden = rows.length === 0
    elements.variantsEmpty.hidden = rows.length !== 0
  }

  function diagnosticItem(title, detail, unresolved = true) {
    const item = createElement('li', undefined, unresolved ? 'unresolved' : '')
    item.append(createElement('strong', title))
    if (detail) item.append(createElement('small', detail))
    return item
  }

  function renderExtractionDiagnostics(variant) {
    const items = []

    for (const issue of variant.issues) {
      items.push(diagnosticItem('Recorded extraction issue', issue))
    }

    for (const proposal of variant.missingFeatures) {
      const region = Array.isArray(proposal.sourceRegion)
        ? proposal.sourceRegion.join(', ')
        : UNKNOWN
      items.push(
        diagnosticItem(
          `Missing ${proposal.kind} proposal · source box [${region}]`,
          `${proposal.evidence} Proposal only; this box is not native geometry.`,
        ),
      )
    }

    for (const candidate of unresolvedCandidates(variant)) {
      const decision = candidate.decision
      const repairNote =
        decision?.action === 'needs_repair'
          ? ' Flag only; required geometric correction is not completed.'
          : ''
      const detail = decision
        ? `${decision.action} · corrected class ${decision.correctedClass} · confidence ${decision.confidence}. ${decision.evidence}${repairNote}`
        : 'No semantic reviewer decision was recorded for this candidate.'
      items.push(
        diagnosticItem(`Unresolved ${candidate.class} candidate · ${candidate.id}`, detail),
      )
    }

    for (const candidate of variant.candidates) {
      const decision = candidate.decision
      if (
        !decision ||
        decision.action === 'keep' ||
        decision.action === 'needs_repair' ||
        decision.correctedClass === 'uncertain'
      )
        continue
      const title =
        decision.action === 'reject'
          ? `Rejected ${candidate.class} candidate · ${candidate.id}`
          : `Relabeled ${candidate.class} candidate · ${candidate.id}`
      items.push(
        diagnosticItem(
          title,
          `Corrected class ${decision.correctedClass} · confidence ${decision.confidence}. ${decision.evidence}`,
          decision.action === 'reject',
        ),
      )
    }

    if (items.length === 0) {
      items.push(
        diagnosticItem(
          'No extraction-stage omissions were recorded',
          'This only describes the saved record; it does not prove structural reconstruction is complete.',
          false,
        ),
      )
    }

    replaceChildren(elements.extractionDiagnostics, items)
  }

  function currentEvidenceMode() {
    return (
      document.querySelector('input[name="comparison-source-view"]:checked')?.value || 'overlay'
    )
  }

  function renderEvidence() {
    const variant = selectedVariant()
    if (!variant) {
      setImageSource(
        elements.evidenceImage,
        elements.evidenceEmpty,
        null,
        '',
        'No recorded variant is selected.',
      )
      return
    }

    const mode = currentEvidenceMode()
    const source = state.manifest.source
    const isOverlay = mode === 'overlay'
    const rawUrl = isOverlay ? variant.overlayUrl : source.url
    const url = safeLocalUrl(rawUrl)
    const label = isOverlay ? 'Saved overlay' : 'Original source'
    elements.evidenceViewLabel.textContent = label
    elements.evidenceCaption.textContent = isOverlay
      ? `${variant.label} overlay at ${source.width} × ${source.height} source pixels. Model output is evidence, not accepted geometry.`
      : `${source.name} at ${source.width} × ${source.height} pixels, preserving source orientation and scale.`

    setImageSource(
      elements.evidenceImage,
      elements.evidenceEmpty,
      url,
      isOverlay
        ? `Saved extraction overlay for ${variant.label}`
        : `Original floorplan source ${source.name}`,
      `${label} is unavailable because its recorded URL is missing or is not same-origin.`,
    )
    if (Number.isFinite(source.width) && source.width > 0)
      elements.evidenceImage.width = source.width
    if (Number.isFinite(source.height) && source.height > 0)
      elements.evidenceImage.height = source.height
  }

  function clearNativePreview(
    message = 'Generate a local preview to render only native nodes supported by the selected variant.',
  ) {
    state.previewVersion++
    state.preview = null
    state.previewVariantId = null
    state.native3d?.dispose()
    state.native3d = null
    elements.view3d.disabled = true
    elements.native3dHost.hidden = true
    elements.native3dControls.hidden = true
    elements.view2d.setAttribute('aria-pressed', 'true')
    elements.view3d.setAttribute('aria-pressed', 'false')
    elements.previewImage.hidden = true
    elements.previewImage.removeAttribute('src')
    elements.previewImage.alt = ''
    elements.previewEmpty.textContent = message
    elements.previewEmpty.hidden = false
    elements.previewLabel.textContent = 'Not generated'
    elements.previewCaption.textContent =
      'No native graph has been generated for this selection. Missing-feature boxes are diagnostics, never geometry.'
    elements.downloadButton.disabled = true
    elements.nodeCounts.hidden = true
    elements.nodeCountsEmpty.hidden = false
    replaceChildren(elements.nodeCounts, [])
    elements.mappingsWrap.hidden = true
    elements.mappingsEmpty.hidden = false
    elements.mappingCount.textContent = ''
    replaceChildren(elements.mappingsBody, [])
    replaceChildren(elements.nativeIssues, [])
    elements.nativeIssuesEmpty.hidden = false
    replaceChildren(elements.nativeAssumptions, [])
    elements.nativeAssumptionsEmpty.hidden = false
  }

  function selectVariant(variantId) {
    const variant = state.manifest.variants.find((candidate) => candidate.id === variantId)
    if (!variant) return

    state.selectedVariantId = variant.id
    for (const radio of document.querySelectorAll('input[name="comparison-variant"]')) {
      radio.checked = radio.value === variant.id
    }

    elements.selectedSection.hidden = false
    elements.selectedHeading.textContent = variant.label
    elements.selectedPipeline.textContent = `Extractor · ${variant.extractor} · Reviewer · ${variant.reviewer || 'None recorded'}`
    renderExtractionDiagnostics(variant)
    renderEvidence()
    clearNativePreview()
    setNotice(elements.previewStatus, 'Ready for local preview generation.')
  }

  function renderQualityOptions() {
    const items = state.manifest.qualityOptions.map((option) => {
      const item = document.createElement('li')
      item.append(
        createElement('strong', option.label),
        createElement('span', option.stages, 'quality-stages'),
        createElement('small', option.tradeoff),
      )
      const usage = createElement(
        'span',
        `${usageTokenText(option.usage)} · ${usageCostText(option.usage)} · ${option.usage?.basis || 'Usage basis unknown'}`,
        'quality-usage',
      )
      appendUnknownClass(usage, [
        formatInteger(option.usage?.inputTokens),
        formatInteger(option.usage?.outputTokens),
        formatCost(option.usage?.costUsd),
        formatDuration(option.usage?.durationMs),
      ])
      item.append(usage)
      return item
    })

    replaceChildren(elements.qualityOptions, items)
    elements.qualityOptionsEmpty.hidden = items.length !== 0
  }

  function renderCaveats() {
    const items = state.manifest.caveats.map((caveat) => createElement('li', caveat))
    replaceChildren(elements.caveats, items)
    elements.caveatsEmpty.hidden = items.length !== 0
  }

  function countEntry(label, value) {
    const entry = document.createElement('div')
    entry.append(createElement('dt', label), createElement('dd', formatInteger(value)))
    return entry
  }

  function renderNodeCounts(preview) {
    const entries = [
      countEntry('Total nodes', Object.keys(preview.nodes || {}).length),
      countEntry('Walls', preview.counts?.walls),
      countEntry('Doors', preview.counts?.doors),
      countEntry('Windows', preview.counts?.windows),
      countEntry('Slabs', preview.counts?.slabs),
      countEntry('Zones', preview.counts?.zones),
      countEntry('Approximate props', preview.counts?.props),
    ]
    replaceChildren(elements.nodeCounts, entries)
    elements.nodeCounts.hidden = false
    elements.nodeCountsEmpty.hidden = true
  }

  function renderMappings(preview) {
    const mappings = Array.isArray(preview.mappings) ? preview.mappings : []
    const rows = mappings.map((mapping) => {
      const row = document.createElement('tr')
      const sourceCell = document.createElement('th')
      sourceCell.scope = 'row'
      sourceCell.textContent = mapping.sourceId
      const statusClass =
        mapping.status === 'converted'
          ? 'converted'
          : mapping.status === 'approximated'
            ? 'approximated'
            : 'unresolved'
      const statusCell = createElement('td', mapping.status, `mapping-status ${statusClass}`)
      const nodeIds =
        Array.isArray(mapping.nodeIds) && mapping.nodeIds.length > 0
          ? mapping.nodeIds.join(', ')
          : 'None'
      row.append(
        sourceCell,
        statusCell,
        createElement('td', nodeIds, 'mono'),
        createElement('td', mapping.detail),
      )
      return row
    })

    replaceChildren(elements.mappingsBody, rows)
    elements.mappingCount.textContent = `${rows.length} mapping${rows.length === 1 ? '' : 's'}`
    elements.mappingsWrap.hidden = rows.length === 0
    elements.mappingsEmpty.hidden = rows.length !== 0
    if (rows.length === 0)
      elements.mappingsEmpty.textContent = 'The converter returned no source mappings.'
  }

  function renderListWithEmpty(list, empty, values, title, unresolved = false) {
    const items = values.map((value) => diagnosticItem(title, value, unresolved))
    replaceChildren(list, items)
    empty.hidden = items.length !== 0
  }

  function renderNativePreview(preview, variant, options) {
    state.preview = preview
    state.previewVariantId = variant.id

    const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(preview.svg)}`
    setImageSource(
      elements.previewImage,
      elements.previewEmpty,
      svgDataUrl,
      `Read-only Pascal-native structural preview for ${variant.label}`,
      'The converter did not return a renderable native SVG.',
    )

    const bounds = preview.bounds
    const boundsText =
      bounds && [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)
        ? `Bounds ${bounds.width.toFixed(3)} × ${bounds.height.toFixed(3)} m at (${bounds.x.toFixed(3)}, ${bounds.y.toFixed(3)})`
        : 'Bounds unknown'
    elements.previewLabel.textContent = 'Local preview'
    elements.previewCaption.textContent = `${boundsText}. Source +Y maps to native +Z without flipping. Scale ${options.metersPerPixel} m/px; wall height ${options.wallHeight} m. Generated node counts are not reviewer accuracy or physical-opening totals.`
    elements.downloadButton.disabled = false
    elements.view3d.disabled = !preview.scene?.meshes?.length
    renderNodeCounts(preview)
    renderMappings(preview)
    elements.nativeIssuesEmpty.textContent = 'No unresolved native issues were returned.'
    elements.nativeAssumptionsEmpty.textContent = 'No converter assumptions were returned.'
    renderListWithEmpty(
      elements.nativeIssues,
      elements.nativeIssuesEmpty,
      Array.isArray(preview.issues) ? preview.issues : [],
      'Unresolved native issue',
      true,
    )
    renderListWithEmpty(
      elements.nativeAssumptions,
      elements.nativeAssumptionsEmpty,
      Array.isArray(preview.assumptions) ? preview.assumptions : [],
      'Preview assumption',
    )

    const unresolvedMappings = Array.isArray(preview.mappings)
      ? preview.mappings.filter((mapping) => mapping.status === 'unresolved').length
      : 0
    const issueCount = Array.isArray(preview.issues) ? preview.issues.length : 0
    setNotice(
      elements.previewStatus,
      `Local native preview generated · ${formatInteger(Object.keys(preview.nodes || {}).length)} nodes · ${unresolvedMappings} unresolved mappings · ${issueCount} issues. Counts describe generated nodes, not reviewer accuracy. No scene Apply occurred.`,
      unresolvedMappings > 0 || issueCount > 0 ? 'warning' : 'success',
    )
  }

  async function generateNativePreview() {
    const variant = selectedVariant()
    if (!variant) {
      setNotice(
        elements.previewStatus,
        'Select a recorded variant before generating a native preview.',
        'error',
      )
      return
    }

    const options = {
      metersPerPixel: Number(elements.metersPerPixel.value),
      wallHeight: Number(elements.wallHeight.value),
    }
    if (state.calibration) options.calibration = state.calibration
    const validMetersPerPixel =
      Number.isFinite(options.metersPerPixel) &&
      options.metersPerPixel >= 0.0001 &&
      options.metersPerPixel <= 1
    const validWallHeight =
      Number.isFinite(options.wallHeight) && options.wallHeight >= 0.5 && options.wallHeight <= 12
    if (!validMetersPerPixel || !validWallHeight) {
      setNotice(
        elements.previewStatus,
        'Metres per pixel must be 0.0001–1 and wall height must be 0.5–12 metres.',
        'error',
      )
      return
    }
    clearNativePreview('Generating the updated native graph…')
    const version = state.previewVersion

    elements.previewForm.setAttribute('aria-busy', 'true')
    elements.generateButton.disabled = true
    elements.metersPerPixel.disabled = true
    elements.wallHeight.disabled = true
    elements.downloadButton.disabled = true
    setNotice(elements.previewStatus, `Generating a local native preview for ${variant.label}…`)

    try {
      const response = await fetch('/api/comparisons/preview', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variantId: variant.id, ...options }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(
          typeof data?.error === 'string'
            ? data.error
            : `Preview request failed with HTTP ${response.status}`,
        )
      }
      if (
        !data ||
        typeof data !== 'object' ||
        typeof data.svg !== 'string' ||
        data.svg.trim().length === 0 ||
        !data.nodes ||
        !data.counts
      ) {
        throw new Error('The local preview response is incomplete.')
      }
      if (state.selectedVariantId !== variant.id || state.previewVersion !== version) return
      renderNativePreview(data, variant, options)
    } catch (error) {
      if (state.selectedVariantId !== variant.id || state.previewVersion !== version) return
      clearNativePreview('The local native preview could not be generated.')
      setNotice(
        elements.previewStatus,
        error instanceof Error ? error.message : 'The local native preview failed.',
        'error',
      )
    } finally {
      elements.previewForm.setAttribute('aria-busy', 'false')
      elements.generateButton.disabled = false
      elements.metersPerPixel.disabled = false
      elements.wallHeight.disabled = false
    }
  }

  function downloadNativeJson() {
    if (!state.preview || !state.previewVariantId) return
    const blob = new Blob([`${JSON.stringify(state.preview, null, 2)}\n`], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const safeId = state.previewVariantId.replace(/[^a-z0-9_-]+/gi, '-')
    link.href = url
    link.download = `${safeId || 'native-preview'}.native-preview.json`
    document.body.append(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  async function loadComparisons() {
    setNotice(elements.status, 'Loading recorded comparisons…')
    try {
      const response = await fetch('/api/comparisons', {
        credentials: 'same-origin',
        cache: 'no-store',
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(
          typeof data?.error === 'string'
            ? data.error
            : `Comparison manifest failed with HTTP ${response.status}`,
        )
      }
      if (
        !data ||
        typeof data !== 'object' ||
        !data.source ||
        !Array.isArray(data.variants) ||
        !Array.isArray(data.qualityOptions) ||
        !Array.isArray(data.caveats)
      ) {
        throw new Error('The comparison manifest is incomplete.')
      }

      state.manifest = data
      state.selectedVariantId = data.variants[0]?.id || null
      renderSourceMetadata()
      renderAssessment()
      renderVariants()
      renderQualityOptions()
      renderCaveats()
      elements.content.hidden = false

      if (state.selectedVariantId) selectVariant(state.selectedVariantId)
      else elements.selectedSection.hidden = true

      setNotice(
        elements.status,
        data.variants.length > 0
          ? `${data.variants.length} recorded variant${data.variants.length === 1 ? '' : 's'} ready to compare.`
          : 'No recorded comparison variants are available.',
        data.variants.length > 0 ? 'success' : 'warning',
      )
    } catch (error) {
      state.manifest = null
      elements.assessment.hidden = true
      elements.content.hidden = true
      setNotice(
        elements.status,
        error instanceof Error ? error.message : 'Recorded comparisons could not be loaded.',
        'error',
      )
    }
  }

  elements.calibrationPick.addEventListener('click', () => {
    state.picking = !state.picking
    if (state.picking) {
      state.calibrationPoints = []
      state.calibration = null
      clearNativePreview('Choose a measured scale, then regenerate the native graph.')
      state.calibrationCursor = [state.manifest.source.width / 2, state.manifest.source.height / 2]
      elements.calibrationStatus.textContent =
        'Select the first endpoint, then the second. Arrow keys move the cursor; Enter selects.'
      elements.calibrationStage.focus()
    }
    renderCalibration()
  })
  document.querySelector('#calibration-reset').addEventListener('click', () => {
    state.calibrationPoints = []
    state.calibration = null
    state.picking = false
    elements.pointInputs.forEach((input) => {
      input.value = ''
    })
    elements.metersPerPixel.value = '0.015'
    updateCalibration()
  })
  elements.calibrationDistance.addEventListener('input', updateCalibration)
  elements.pointInputs.forEach((input) =>
    input.addEventListener('input', () => {
      const values = elements.pointInputs.map((input) =>
        input.value === '' ? NaN : Number(input.value),
      )
      const source = state.manifest?.source
      if (
        !source ||
        values.some((value) => !Number.isFinite(value) || value < 0) ||
        values[0] > source.width ||
        values[2] > source.width ||
        values[1] > source.height ||
        values[3] > source.height
      )
        return
      state.calibrationPoints = [
        [values[0], values[1]],
        [values[2], values[3]],
      ]
      state.picking = false
      updateCalibration()
    }),
  )
  elements.calibrationStage.addEventListener('click', (event) => {
    if (!state.picking) return
    const source = state.manifest.source,
      rect = elements.evidenceImage.getBoundingClientRect()
    const scale = Math.min(rect.width / source.width, rect.height / source.height)
    const x = (event.clientX - rect.left - (rect.width - source.width * scale) / 2) / scale
    const y = (event.clientY - rect.top - (rect.height - source.height * scale) / 2) / scale
    if (x >= 0 && y >= 0 && x <= source.width && y <= source.height) pickCalibrationPoint([x, y])
  })
  elements.calibrationStage.addEventListener('keydown', (event) => {
    if (!state.picking) return
    const source = state.manifest.source,
      point = state.calibrationCursor,
      step = event.shiftKey ? 10 : 1
    if (event.key.startsWith('Arrow')) {
      event.preventDefault()
      point[0] = Math.max(
        0,
        Math.min(
          source.width,
          point[0] + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0),
        ),
      )
      point[1] = Math.max(
        0,
        Math.min(
          source.height,
          point[1] + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0),
        ),
      )
      renderCalibration()
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      pickCalibrationPoint([...point])
    } else if (event.key === 'Escape') {
      state.picking = false
      renderCalibration()
    }
  })
  new ResizeObserver(renderCalibration).observe(elements.calibrationStage)
  elements.evidenceImage.addEventListener('load', renderCalibration)
  elements.view2d.addEventListener('click', () => showNativeView('2d'))
  elements.view3d.addEventListener('click', () => showNativeView('3d'))
  document
    .querySelector('#native-3d-reset')
    .addEventListener('click', () => state.native3d?.reset())
  document
    .querySelector('#native-3d-top')
    .addEventListener('click', () => state.native3d?.reset(true))
  document
    .querySelector('#native-3d-cutaway')
    .addEventListener('change', (event) => state.native3d?.cutaway(event.target.checked))
  document.querySelectorAll('input[name="comparison-source-view"]').forEach((radio) => {
    radio.addEventListener('change', renderEvidence)
  })
  ;[elements.metersPerPixel, elements.wallHeight].forEach((input) => {
    input.addEventListener('input', () => {
      if (!state.preview) return
      clearNativePreview('Preview assumptions changed. Generate again to update the native graph.')
      setNotice(
        elements.previewStatus,
        'Preview assumptions changed; regenerate locally to update the native output.',
        'warning',
      )
    })
  })
  elements.previewForm.addEventListener('submit', (event) => {
    event.preventDefault()
    generateNativePreview()
  })
  elements.downloadButton.addEventListener('click', downloadNativeJson)
  elements.evidenceImage.addEventListener('error', () => {
    elements.evidenceImage.hidden = true
    elements.evidenceEmpty.textContent = 'This recorded evidence image could not be loaded.'
    elements.evidenceEmpty.hidden = false
  })
  elements.previewImage.addEventListener('error', () => {
    elements.previewImage.hidden = true
    elements.previewEmpty.textContent =
      'The returned native SVG could not be displayed as an image.'
    elements.previewEmpty.hidden = false
    setNotice(
      elements.previewStatus,
      'The native graph was returned, but its SVG image could not be displayed. The JSON download remains available.',
      'warning',
    )
  })

  loadComparisons()
})()
