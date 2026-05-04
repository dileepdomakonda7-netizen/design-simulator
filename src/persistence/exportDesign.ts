import type { Design } from '@/schema/types'

function sanitizeFilename(name: string): string {
  // Strip characters not safe in filenames across OS
  return name.replace(/[/\\?%*:|"<>]/g, '-').trim() || 'design'
}

export function exportDesignToFile(design: Design): void {
  const filename = `${sanitizeFilename(design.name)}.design.json`
  const content = JSON.stringify(design, null, 2)
  const blob = new Blob([content], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
