import { IconBase } from './iconBase'

// Stack of disks with a lightning bolt overlay.
export function CacheIcon() {
  return (
    <IconBase>
      <ellipse cx="14" cy="8" rx="9" ry="2.4" />
      <path d="M5 8 V13 Q5 15.4 14 15.4 Q23 15.4 23 13 V8" />
      <path d="M5 13 V18 Q5 20.4 14 20.4 Q23 20.4 23 18 V13" />
      <path d="M21 14 L18 22 L22 22 L19 28" />
    </IconBase>
  )
}
