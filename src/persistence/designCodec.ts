/**
 * Round-3 R3-10 fix. The share-link payload is base64-encoded, lz-string
 * compressed JSON. For a 3-node design that's still ~1.3KB encoded —
 * brushing up against the URL-length limits Slack / email clients enforce.
 *
 * This module does the smallest legal compression: strip every node param
 * and edge param that equals the type's `createDefault*()` value, then
 * re-expand on load. The compressed-text size shrinks roughly proportional
 * to how many params the user left at default (typically: most of them).
 *
 * Round-trip contract:
 *   expand(minimize(design)) deeply equals design.
 * Property tested in src/persistence/__tests__/designCodec.test.ts.
 *
 * The minimized form is NOT the validated Design type — it has missing
 * required keys. urlShare.encodeDesignForUrl applies `minimizeDesign` BEFORE
 * stringify; decodeDesignFromUrl applies `expandDesign` BEFORE validate so
 * the rest of the system still sees a fully-typed Design.
 */
import type { ComponentType, Design } from '@/schema/types'
import {
  createDefaultEdge,
  createDefaultNode,
} from '@/schema/defaults'

// Frozen reference defaults — built once via the public factory so this
// module mirrors the canonical shape without duplicating it. Each
// per-type Params interface is structurally a string-keyed object;
// `as unknown as Record<...>` lets us treat them uniformly here without
// loosening the public types elsewhere.
function paramsAsRecord(p: unknown): Record<string, unknown> {
  return p as Record<string, unknown>
}

const NODE_DEFAULTS: Record<ComponentType, Record<string, unknown>> = {
  client: paramsAsRecord(createDefaultNode('client', { x: 0, y: 0 }).params),
  load_balancer: paramsAsRecord(createDefaultNode('load_balancer', { x: 0, y: 0 }).params),
  api_gateway: paramsAsRecord(createDefaultNode('api_gateway', { x: 0, y: 0 }).params),
  app_server: paramsAsRecord(createDefaultNode('app_server', { x: 0, y: 0 }).params),
  cache: paramsAsRecord(createDefaultNode('cache', { x: 0, y: 0 }).params),
  database: paramsAsRecord(createDefaultNode('database', { x: 0, y: 0 }).params),
  queue: paramsAsRecord(createDefaultNode('queue', { x: 0, y: 0 }).params),
  pub_sub: paramsAsRecord(createDefaultNode('pub_sub', { x: 0, y: 0 }).params),
  cdn: paramsAsRecord(createDefaultNode('cdn', { x: 0, y: 0 }).params),
  object_storage: paramsAsRecord(createDefaultNode('object_storage', { x: 0, y: 0 }).params),
  external_service: paramsAsRecord(
    createDefaultNode('external_service', { x: 0, y: 0 }).params,
  ),
}

const EDGE_DEFAULT_PARAMS: Record<string, unknown> = paramsAsRecord(
  createDefaultEdge('a', 'b').params,
)

function deepEqual(a: unknown, b: unknown): boolean {
  // JSON.stringify is sufficient here: param values are primitives, plain
  // objects (retry_policy, circuit_breaker), and plain numbers. Key order
  // is consistent because both sides come from the same default factory.
  return JSON.stringify(a) === JSON.stringify(b)
}

function stripDefaults(
  obj: Record<string, unknown>,
  defaults: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (k in defaults && deepEqual(v, defaults[k])) continue
    out[k] = v
  }
  return out
}

function fillDefaults(
  obj: Record<string, unknown> | undefined,
  defaults: Record<string, unknown>,
): Record<string, unknown> {
  return { ...defaults, ...(obj ?? {}) }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function minimizeDesign(design: Design): unknown {
  const nodes = design.nodes.map((n) => {
    const defaults = NODE_DEFAULTS[n.type as ComponentType]
    return {
      id: n.id,
      type: n.type,
      label: n.label,
      position: n.position,
      // Drop empty notes (default: '').
      ...(n.notes ? { notes: n.notes } : {}),
      params: stripDefaults(paramsAsRecord(n.params), defaults),
    }
  })
  const edges = design.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    kind: e.kind,
    ...(e.label ? { label: e.label } : {}),
    params: stripDefaults(paramsAsRecord(e.params), EDGE_DEFAULT_PARAMS),
  }))
  // Drop annotations / sketches if empty — saves another few bytes per share.
  const minimized: Record<string, unknown> = {
    schemaVersion: design.schemaVersion,
    id: design.id,
    name: design.name,
    createdAt: design.createdAt,
    updatedAt: design.updatedAt,
    nodes,
    edges,
    viewport: design.viewport,
  }
  if (design.annotations.length > 0) minimized['annotations'] = design.annotations
  if (design.sketches.length > 0) minimized['sketches'] = design.sketches
  if (design.chaosPlan && design.chaosPlan.length > 0) {
    minimized['chaosPlan'] = design.chaosPlan
  }
  return minimized
}

interface MinimizedNodeShape {
  id: string
  type: ComponentType
  label: string
  notes?: string
  position: { x: number; y: number }
  params: Record<string, unknown>
}

interface MinimizedEdgeShape {
  id: string
  source: string
  target: string
  kind: 'sync_rpc' | 'async_message' | 'replication'
  label?: string
  params: Record<string, unknown>
}

export function expandDesign(parsed: unknown): unknown {
  if (!parsed || typeof parsed !== 'object') return parsed
  const m = parsed as Record<string, unknown>
  const rawNodes = Array.isArray(m['nodes']) ? (m['nodes'] as MinimizedNodeShape[]) : []
  const rawEdges = Array.isArray(m['edges']) ? (m['edges'] as MinimizedEdgeShape[]) : []

  // Validators run on the expanded result, so we don't need to coerce all
  // the way back to the discriminated `Node`/`Edge` types here. Hand them
  // back as plain JSON-shaped objects.
  const nodes = rawNodes.map((n) => {
    const defaults = NODE_DEFAULTS[n.type] ?? {}
    return {
      id: n.id,
      type: n.type,
      label: n.label,
      notes: n.notes ?? '',
      position: n.position,
      params: fillDefaults(n.params, defaults),
    }
  })

  const edges = rawEdges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    kind: e.kind,
    ...(e.label !== undefined ? { label: e.label } : {}),
    params: fillDefaults(e.params, EDGE_DEFAULT_PARAMS),
  }))

  return {
    ...m,
    nodes,
    edges,
    annotations: Array.isArray(m['annotations']) ? m['annotations'] : [],
    sketches: Array.isArray(m['sketches']) ? m['sketches'] : [],
    chaosPlan: Array.isArray(m['chaosPlan']) ? m['chaosPlan'] : [],
  }
}
