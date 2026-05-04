import type { Node as RFNode, Edge as RFEdge } from '@xyflow/react'
import type { Node, Edge } from '@/schema/types'

/**
 * Schema → React Flow conversion. We pass the entire schema node through
 * `data.schemaNode` so per-type custom node components can read narrowed
 * params without React Flow having to know about discriminated unions.
 */
export function toRFNode(node: Node): RFNode<{ schemaNode: Node }> {
  return {
    id: node.id,
    type: node.type, // dispatches to the matching nodeTypes entry
    position: node.position,
    data: { schemaNode: node },
  }
}

export function toRFEdge(edge: Edge): RFEdge<{ schemaEdge: Edge }> {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: 'sketchy', // single custom edge type for all kinds in v1
    data: { schemaEdge: edge },
  }
}

// Reverse-direction adapters intentionally absent: when React Flow emits
// position changes, we extract { id, position } and call updateNodePosition.
// We never reconstruct a full schema Node from an RFNode.
