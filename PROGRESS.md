# Progress

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
