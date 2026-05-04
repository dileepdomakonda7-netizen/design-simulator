import { IconBase } from './iconBase'

// Box with an arrow piercing through the upper-right corner.
export function ExternalServiceIcon() {
  return (
    <IconBase>
      <path d="M5 9 H17 V27 H5 Z" />
      <path d="M14 18 L27 5" />
      <path d="M27 5 L21 5.5" />
      <path d="M27 5 L26.5 11" />
    </IconBase>
  )
}
