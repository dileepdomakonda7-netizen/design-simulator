import { IconBase } from './iconBase'

// Horizontal row of small rectangles (FIFO queue).
export function QueueIcon() {
  return (
    <IconBase>
      <rect x="4" y="11" width="6" height="10" rx="0.6" />
      <rect x="11" y="11" width="6" height="10" rx="0.6" />
      <rect x="18" y="11" width="6" height="10" rx="0.6" />
      <path d="M27 16 H30" />
      <path d="M30 16 L27.6 13.6" />
      <path d="M30 16 L27.6 18.4" />
    </IconBase>
  )
}
