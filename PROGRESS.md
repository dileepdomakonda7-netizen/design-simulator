# Phase 2 Progress

## Status: complete

`npm run dev` → http://localhost:5173  
`npm run typecheck` → 0 errors  
`npm run lint` → 0 errors, 0 warnings

## Acceptance criteria

| # | Criterion | Status |
|---|-----------|--------|
| 1 | App loads without console errors | ✅ |
| 2 | Mode toggle switches between three placeholder views | ✅ |
| 3 | Debug buttons add nodes to `design.nodes`; JSON dump visible in UI | ✅ |
| 4 | Editing name triggers auto-save to `localStorage` within ~500ms | ✅ |
| 5 | Undo/redo reverts/reapplies name changes; stack limit 100 | ✅ |
| 6 | Page refresh restores most-recently-updated design | ✅ |
| 7 | Export JSON downloads a valid `.design.json` file | ✅ |
| 8 | Import JSON loads design and clears undo history | ✅ |
| 9 | Load dialog lists designs; click loads; delete removes from both dialog and localStorage | ✅ |
| 10 | `typecheck` and `lint` pass clean | ✅ |
| 11 | Malformed JSON import shows `alert()` with error message, no crash | ✅ |
| 12 | Corrupted `localStorage['design:*']` on refresh falls back to fresh default | ✅ |

## Deviations from the prompt

**Toast → `window.alert()`** (criteria 11): The prompt explicitly defers toast notifications to a later phase. Import errors use `alert()` as a stand-in. No new dependency, no stub component. Replace in Prompt 4 when Toast is built.

**`src/hooks/` directory added**: Not in SPEC Section 14 directory listing but required for `useKeyboardShortcuts`. Natural addition, does not conflict with any specified directory.

**`updateNode` / `updateEdge` use `as Node` / `as Edge` cast**: `Partial<Omit<Node, 'id'>>` spread cannot be proven type-safe by TypeScript when `Node` is an intersection with a discriminated union. The cast is documented in the store; Prompt 3 will add properly-narrowed param update actions when the inspector is built.

**zod/exactOptionalPropertyTypes cast**: `z.string().optional()` infers `string | undefined`, which conflicts with `Edge.label?: string` under `exactOptionalPropertyTypes` (absent ≠ undefined). Fixed with `as Design` cast in the validate helpers — the cast is safe because zod validates structure correctly; only the inferred type is wider than the TypeScript interface.

## Commits

1. `scaffold` — Vite + TypeScript strict + Tailwind v4 + ESLint
2. `schema` — types.ts, defaults.ts, validators.ts
3. `stores` — designStore (temporal undo/redo), modeStore, simStore stub, useKeyboardShortcuts
4. `persistence` — localStorage CRUD, export, import, migrations stub
5. `app-shell` — Toolbar, ModeToggle, FileMenu, LoadDialog, placeholder views, .gitkeep stubs
