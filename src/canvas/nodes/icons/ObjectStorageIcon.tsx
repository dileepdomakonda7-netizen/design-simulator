import { IconBase } from './iconBase'

// Bucket: trapezoidal body with a slight lid.
export function ObjectStorageIcon() {
  return (
    <IconBase>
      <ellipse cx="16" cy="8" rx="10" ry="2.4" />
      <path d="M6 8 L8 26 Q8 28 16 28 Q24 28 24 26 L26 8" />
      <path d="M9 14 H23" />
      <path d="M9.5 19 H22.5" />
    </IconBase>
  )
}
