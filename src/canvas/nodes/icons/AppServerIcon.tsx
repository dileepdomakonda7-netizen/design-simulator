import { IconBase } from './iconBase'

// Three stacked rectangles representing instances.
export function AppServerIcon() {
  return (
    <IconBase>
      <rect x="5" y="6" width="22" height="6" rx="1" />
      <rect x="5" y="13.5" width="22" height="6" rx="1" />
      <rect x="5" y="21" width="22" height="6" rx="1" />
      <circle cx="8.4" cy="9" r="0.7" fill="#1a1a1a" />
      <circle cx="8.4" cy="16.5" r="0.7" fill="#1a1a1a" />
      <circle cx="8.4" cy="24" r="0.7" fill="#1a1a1a" />
    </IconBase>
  )
}
