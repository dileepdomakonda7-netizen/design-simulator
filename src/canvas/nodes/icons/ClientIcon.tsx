import { IconBase } from './iconBase'

// Browser-window glyph: rectangle + title bar + 3 dots.
export function ClientIcon() {
  return (
    <IconBase>
      <path d="M5 7 Q5 6 6 6 H26 Q27 6 27 7 V25 Q27 26 26 26 H6 Q5 26 5 25 Z" />
      <path d="M5.2 11.2 H26.8" />
      <circle cx="8" cy="8.6" r="0.8" />
      <circle cx="10.8" cy="8.6" r="0.8" />
      <circle cx="13.6" cy="8.6" r="0.8" />
    </IconBase>
  )
}
