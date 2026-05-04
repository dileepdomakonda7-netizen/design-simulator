import { useDesignStore } from '@/store/designStore'
import { EdgeForm } from './forms/EdgeForm'

export function EdgeInspector({ edgeId }: { edgeId: string }) {
  const edge = useDesignStore((s) => s.design.edges.find((e) => e.id === edgeId))
  if (!edge) return null
  return <EdgeForm edge={edge} />
}
