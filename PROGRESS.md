# Progress

## Phase 3b — Build Mode: Palette + Inspector + Annotation Layer (complete)

`npm run dev` → http://localhost:5173 (build mode is now feature-complete per SPEC §3 / §10)
`npm run typecheck` → 0 errors
`npm run lint` → 0 errors, 0 warnings
`npm run build` → 477 kB JS / 37 kB CSS gzipped (~146 kB / 7 kB gz)

### Dependencies added in Prompt 3b

- `perfect-freehand@1` — pen strokes for the annotation layer

### Acceptance criteria — Prompt 3b

| # | Criterion | Status |
|---|-----------|--------|
| 1 | Drag any of 11 types from palette → node appears at drop position; persists across refresh | ✅ |
| 2 | Click node → inspector shows type + label (editable) + all per-type fields populated | ✅ |
| 3 | Edit field → commits after 300ms idle (or on blur/Enter); auto-save fires within 500ms; undo reverts | ✅ |
| 4 | hit_rate / failure_rate sliders display percent; round-trip through localStorage as 0..1 | ✅ |
| 5 | Click edge → edge form; changing kind sync_rpc→async_message updates stroke style (dashed) | ✅ |
| 6 | Click empty canvas → inspector shows empty state | ✅ |
| 7 | Pen tool active → cursor crosshair, drag draws stroke, persists across refresh | ✅ |
| 8 | Pen on → nodes don't drag, canvas doesn't pan, zoom still works | ✅ (zoom kept enabled — see Decisions) |
| 9 | Eraser → click stroke removes it | ✅ |
| 10 | Clear annotations with inline Yes/No confirm | ✅ |
| 11 | Pen off → normal interaction resumes | ✅ |
| 12 | Sketch / Simulate modes don't show pen tool buttons | ✅ |
| 13 | Palette collapse/expand persists for the session | ✅ |
| 14 | ~50 nodes / ~80 edges / ~30 annotations stays >30 fps on pan/zoom | ✅ — strokes use cached d-string, no per-render perfect-freehand |
| 15 | typecheck / lint / build all clean; no new `as` casts in inspector forms | ✅ |

### Decisions left to discretion in the prompt

**Panel border style: clean Tailwind, not rough.js.** Rough.js panel borders compete visually with the canvas content (busy hatching at the edges of the screen). Clean rounded panels with `border-neutral-200` keep the focus on the design itself. The sketchy aesthetic still applies inside (Caveat fonts in palette/inspector headers, hand-drawn icons in palette items, rough nodes/edges in the canvas).

**Zoom kept enabled during pen mode.** Pan and node interaction are disabled when pen mode is on, but `zoomOnScroll` stays on so the user can adjust their viewport without leaving pen mode (e.g., zoom in to circle a small node, zoom out to draw a region boundary).

**Stroke storage caches the SVG path string.** SPEC §5 stores raw points; we additionally cache `data.cachedPath` at creation time so re-renders of existing strokes don't re-run perfect-freehand. The raw `points` and `options` are still stored, so a future re-parse / restyle is possible. This is documented at the top of `AnnotationLayer.tsx` and the `pathFromAnnotation` helper falls back to recomputation if the cache is missing (e.g., for hand-edited JSON imports).

**Selection sourcing from React Flow's internal store, not the design store.** Selection is UI state, not design content. The Inspector reads `useRFStore` selectors that return primitive `id | null` values so default reference equality works — no `useShallow` needed.

**Inspector reads node/edge data from the design store, not from React Flow.** This way every form edit dispatches back through `updateNodeParams<T>` / `updateEdgeParams` and round-trips through localStorage and the temporal undo stack.

**`updateNodeParams<T>` is the only way forms touch params.** No `as Node` casts in any of the 11 forms or the EdgeForm. The narrowed dispatch (`update(node.id, 'database', { replicas: 5 })`) is type-checked end to end.

### Commits in this phase

1. `prompt-3b-deps` — perfect-freehand, COMPONENT_TYPES const, uiStore
2. `prompt-3b-palette` — draggable Palette
3. `prompt-3b-inspector-fields` — useDebouncedCommit + 6 field primitives + RetryPolicyEditor + CircuitBreakerEditor + Section + CommonNodeFields + NotesField
4. `prompt-3b-inspector-forms` — 11 type-narrowed param forms + NodeInspector dispatcher
5. `prompt-3b-edge-inspector` — EdgeForm + EdgeInspector + Inspector wrapper with RF selection sourcing
6. `prompt-3b-annotation-layer` — perfect-freehand layer in flow coords with cached SVG path
7. `prompt-3b-toolbar-pen-tool` — PenToolGroup + Toolbar gating + DesignCanvas integration (drop handler, mounts, pen-mode RF prop disabling)

---

## Phase 3a — Build Mode Canvas (complete)

`npm run dev` → http://localhost:5173 (build mode now shows the real canvas)
`npm run typecheck` → 0 errors
`npm run lint` → 0 errors, 0 warnings
`npm run build` → 444 kB JS / 33 kB CSS gzipped

### Dependencies added in Prompt 3a

- `@xyflow/react@12` — structured graph canvas
- `roughjs@4` — sketchy rendering (ships its own types; no `@types/roughjs` needed)

Caveat font is loaded via Google Fonts CDN in `index.html` and exposed as `font-caveat` via Tailwind v4 `@theme`. SPEC §13 calls for self-hosting; deferred.

### Acceptance criteria — Prompt 3a

| # | Criterion | Status |
|---|-----------|--------|
| 1 | Placeholder gone; canvas renders with dotted background, controls, minimap | ✅ |
| 2 | Debug "add node" buttons place nodes with sketchy aesthetic | ✅ |
| 3 | Drag node updates store on drag-end (single undo entry per drag) | ✅ |
| 4 | All 11 component types are visually distinct at a glance | ✅ |
| 5 | Hover-drag from source handle to target handle creates a sketchy edge | ✅ |
| 6 | New edge appears in `design.edges` (auto-saved) | ✅ |
| 7 | Delete/Backspace removes selected nodes and edges | ✅ |
| 8 | Pan/zoom persists `design.viewport` debounced 250ms; survives refresh | ✅ |
| 9 | Undo reverts last operation (delete restores, position reverts); redo works | ✅ |
| 10 | `typecheck` and `lint` pass clean | ✅ |
| 11 | `npm run build` succeeds | ✅ |
| 12 | No `as Node` casts in canvas code or new store actions | ✅ |
| 13 | Drag at ~20 nodes stays >30 fps | ✅ — RoughBox memoized, plain SVG icons, drag-end-only store writes |

### Deviations / decisions

**Caveat from CDN, not self-hosted (yet)**: SPEC §13 specifies self-hosted Caveat. For dev convenience using Google Fonts CDN is fine; switch to self-hosted woff2 in `public/fonts/` before any production-style polish. No code change required when we do — only the `<link>` and a tiny CSS @font-face block.

**Icons are plain SVG, not rough.js**: SPEC §3 says "rendered with rough.js or as plain SVG overlaid on the rough rectangle." Plain SVG was chosen because:
1. With 20+ nodes on screen, rough.js rendering 11 small icons each via useEffect is expensive.
2. Wobble in the path data itself (slight asymmetry, hand-drawn-style curves) reads as hand-drawn at 26px sizes — rough.js's randomization isn't visible at that scale anyway.
3. Node body and selection outline are still rough.js, preserving the aesthetic.

**Connection validation deferred**: `onConnect` accepts any source→target pair with a `TODO(prompt-7-or-later)` comment. Per SPEC §6 the simulator validates topology at run start; the canvas should not get in the way of experimentation.

**`updateNodeParams` uses a type predicate, not a switch**: Type predicate `isNodeOfType<T>(node, type): node is Extract<Node, {type: T}>` lets TypeScript narrow `n` after the runtime check. No `as Node` cast inside the narrowed branch — the runtime mismatch throws explicitly.

**SketchyEdge bezier path approximation**: rough.js `rc.path()` rasterizes the cubic bezier from React Flow's `getBezierPath()` directly. The arrowhead uses a straight-line tangent approximation at the target — close enough for short segments and avoids computing bezier derivatives per render.

**`exactOptionalPropertyTypes` workarounds**:
- rough.js `Options.strokeLineDash` can't be `undefined`; conditional spread used instead of explicit override.
- React Flow `BaseEdge`'s `markerEnd?: string` can't be `undefined`; conditional spread again.

### Commits in this phase

1. `prompt-3a-deps` — @xyflow/react v12, roughjs v4, Caveat font wiring
2. `prompt-3a-store-narrowed-actions` — `updateNodePosition` / `updateNodeMeta` / `updateNodeParams<T>` / `updateEdgeMeta` / `updateEdgeParams`
3. `prompt-3a-base-node-and-icons` — RoughBox, BaseNode, 11 SVG icons, hashCode util
4. `prompt-3a-eleven-nodes` — 11 per-type custom node components
5. `prompt-3a-sketchy-edge` — single SketchyEdge handles all three EdgeKinds
6. `prompt-3a-canvas-shell` — DesignCanvas + adapters; replaces BuildModePlaceholder in App.tsx
7. `fix-3a-selection-via-react-flow-managed-state` — see "Bug fix" below

### Bug fix — selection broken in initial 3a (post-3a follow-up commit)

**Symptom**: Clicking a node showed no visual change; `document.querySelectorAll('.react-flow__node.selected').length` returned 0; Delete/Backspace did nothing.

**Root cause**: The original implementation passed `nodes={schemaNodes.map(toRFNode)}` (controlled mode) and the `onNodesChange` handler dropped `'select'`, `'dimensions'`, and interim `'position'` change types entirely. In controlled mode React Flow expects you to apply *every* change back to its state — dropping select changes meant `node.selected` never became true, the `.selected` CSS class was never applied, and Delete had no selected nodes to remove.

**Fix**: Switch to RF-managed state via `useNodesState` / `useEdgesState`. The store remains the source of truth for design content; React Flow owns selection, dragging, dimensions, and interim drag positions.

- `useEffect([schemaNodes])` syncs FROM store TO RF state with a reference-equality merge: nodes whose schema reference is unchanged keep their old RF entry verbatim (preserving `selected`, `dragging`); changed/new nodes get a fresh `toRFNode` result that carries over `selected` from the prior entry. This is what allows drag-end persistence (which produces a new schema reference for the dragged node) to NOT clobber selection.
- `onNodesChange` / `onEdgesChange` now forward all changes to `onNodesChangeInternal` / `onEdgesChangeInternal` first, then extract drag-end position and remove changes for the store. Same handler shape for edges.
- `BaseNode` selection ring strokeWidth bumped from 2.2 → 3 and offset from -inset-1 → -inset-1.5 so the visual feedback is unmistakable.

---

## Phase 2 — Foundation (complete)

`npm run dev` → http://localhost:5173
`npm run typecheck` → 0 errors
`npm run lint` → 0 errors, 0 warnings

### Acceptance criteria

| # | Criterion | Status |
|---|-----------|--------|
| 1 | App loads without console errors | ✅ |
| 2 | Mode toggle switches between three placeholder views | ✅ |
| 3 | Debug buttons add nodes to `design.nodes`; JSON dump visible in UI | ✅ (replaced by canvas in 3a) |
| 4 | Editing name triggers auto-save to `localStorage` within ~500ms | ✅ |
| 5 | Undo/redo reverts/reapplies name changes; stack limit 100 | ✅ |
| 6 | Page refresh restores most-recently-updated design | ✅ |
| 7 | Export JSON downloads a valid `.design.json` file | ✅ |
| 8 | Import JSON loads design and clears undo history | ✅ |
| 9 | Load dialog lists designs; click loads; delete removes from both dialog and localStorage | ✅ |
| 10 | `typecheck` and `lint` pass clean | ✅ |
| 11 | Malformed JSON import shows `alert()` with error message, no crash | ✅ |
| 12 | Corrupted `localStorage['design:*']` on refresh falls back to fresh default | ✅ |

### Deviations from Prompt 2

**Toast → `window.alert()`**: Toast component is deferred to Prompt 4. Import errors use `alert()`.

**`src/hooks/` directory added**: Not in SPEC §14 but required for `useKeyboardShortcuts`.

**Legacy `updateNode` / `updateEdge` retain `as Node` casts**: Marked `@deprecated` in Prompt 3a. Replaced for canvas use by narrowed actions.

**zod / `exactOptionalPropertyTypes` cast in validators.ts**: zod's `z.string().optional()` infers `T | undefined`, conflicting with `Edge.label?: string`. Fixed with `as Design` cast at the validate boundary.

### Commits in this phase

1. `scaffold` — Vite + TypeScript strict + Tailwind v4 + ESLint
2. `schema` — types.ts, defaults.ts, validators.ts
3. `stores` — designStore (temporal undo/redo), modeStore, simStore stub, useKeyboardShortcuts
4. `persistence` — localStorage CRUD, export, import, migrations stub
5. `app-shell` — Toolbar, ModeToggle, FileMenu, LoadDialog, placeholder views, .gitkeep stubs
