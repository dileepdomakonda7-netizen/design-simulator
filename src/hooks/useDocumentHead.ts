import { useEffect } from 'react'

/**
 * Per-route document head — updates `<title>`, the canonical link, and the
 * OG/Twitter meta tags as the user navigates between landing and demo pages.
 *
 * v1 ships a single SPA bundle, so without this hook every route would share
 * `index.html`'s static head and Slack/Twitter previews would all look the
 * same. This is a small client-side patch — for crawlers that don't run JS,
 * the static OG tags in index.html still cover the homepage.
 *
 * Pass `pathAndQuery` (e.g. `/app?demo=cache-stampede`) so the canonical /
 * og:url include the query that picks the demo scenario.
 */
export interface DocumentHeadOptions {
  title: string
  description?: string
  pathAndQuery: string // e.g. '/' or '/app?demo=cache-stampede'
}

const SITE_ORIGIN = 'https://sysdraw.vercel.app'

function setMeta(selector: string, attr: 'content' | 'href', value: string): void {
  const el = document.head.querySelector(selector) as HTMLMetaElement | HTMLLinkElement | null
  if (el) {
    el.setAttribute(attr, value)
    return
  }
  // Create the element if missing — happens once for `<link rel=canonical>`.
  if (selector.startsWith('link')) {
    const link = document.createElement('link')
    link.setAttribute('rel', 'canonical')
    link.setAttribute('href', value)
    document.head.appendChild(link)
  }
}

export function useDocumentHead({ title, description, pathAndQuery }: DocumentHeadOptions): void {
  useEffect(() => {
    const url = `${SITE_ORIGIN}${pathAndQuery}`
    document.title = title
    setMeta('meta[property="og:title"]', 'content', title)
    setMeta('meta[name="twitter:title"]', 'content', title)
    setMeta('meta[property="og:url"]', 'content', url)
    setMeta('link[rel="canonical"]', 'href', url)
    if (description) {
      setMeta('meta[name="description"]', 'content', description)
      setMeta('meta[property="og:description"]', 'content', description)
      setMeta('meta[name="twitter:description"]', 'content', description)
    }
  }, [title, description, pathAndQuery])
}
