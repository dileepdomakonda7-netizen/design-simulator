import type { Node } from '@/schema/types'
import { useDesignStore } from '@/store/designStore'
import { Section } from './fields/Section'
import { CommonNodeFields } from './fields/CommonNodeFields'
import { NotesField } from './fields/NotesField'

import { ClientParamsForm } from './forms/ClientParamsForm'
import { LoadBalancerParamsForm } from './forms/LoadBalancerParamsForm'
import { ApiGatewayParamsForm } from './forms/ApiGatewayParamsForm'
import { AppServerParamsForm } from './forms/AppServerParamsForm'
import { CacheParamsForm } from './forms/CacheParamsForm'
import { DatabaseParamsForm } from './forms/DatabaseParamsForm'
import { QueueParamsForm } from './forms/QueueParamsForm'
import { PubSubParamsForm } from './forms/PubSubParamsForm'
import { CdnParamsForm } from './forms/CdnParamsForm'
import { ObjectStorageParamsForm } from './forms/ObjectStorageParamsForm'
import { ExternalServiceParamsForm } from './forms/ExternalServiceParamsForm'

function ParamsFormFor({ node }: { node: Node }) {
  // Discriminated dispatch — each form receives a narrowed Node variant.
  switch (node.type) {
    case 'client':
      return <ClientParamsForm node={node} />
    case 'load_balancer':
      return <LoadBalancerParamsForm node={node} />
    case 'api_gateway':
      return <ApiGatewayParamsForm node={node} />
    case 'app_server':
      return <AppServerParamsForm node={node} />
    case 'cache':
      return <CacheParamsForm node={node} />
    case 'database':
      return <DatabaseParamsForm node={node} />
    case 'queue':
      return <QueueParamsForm node={node} />
    case 'pub_sub':
      return <PubSubParamsForm node={node} />
    case 'cdn':
      return <CdnParamsForm node={node} />
    case 'object_storage':
      return <ObjectStorageParamsForm node={node} />
    case 'external_service':
      return <ExternalServiceParamsForm node={node} />
  }
}

export function NodeInspector({ nodeId }: { nodeId: string }) {
  const node = useDesignStore((s) => s.design.nodes.find((n) => n.id === nodeId))
  if (!node) return null
  return (
    <>
      <Section title="Common">
        <CommonNodeFields node={node} />
      </Section>
      <Section title="Parameters">
        <ParamsFormFor node={node} />
      </Section>
      <Section title="Notes" defaultOpen={false}>
        <NotesField node={node} />
      </Section>
    </>
  )
}
