import { IconBase } from './iconBase'

// Hub with radial spokes.
export function PubSubIcon() {
  return (
    <IconBase>
      <circle cx="16" cy="16" r="3.2" />
      <path d="M16 12 L16 6" />
      <path d="M16 20 L16 26" />
      <path d="M12 16 L6 16" />
      <path d="M20 16 L26 16" />
      <path d="M13.4 13.4 L9 9" />
      <path d="M18.6 13.4 L23 9" />
      <path d="M13.4 18.6 L9 23" />
      <path d="M18.6 18.6 L23 23" />
    </IconBase>
  )
}
