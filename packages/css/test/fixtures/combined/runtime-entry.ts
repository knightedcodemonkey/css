export type CombinedRuntimeCardProps = {
  label?: string
}

export default function CombinedRuntimeCard(
  props: CombinedRuntimeCardProps = {},
): string {
  const label = props.label ?? 'Knighted CSS'
  return `Runtime card for ${label}`
}

export function CombinedRuntimeDetails(): string {
  return 'details rendered from combined runtime entry'
}

export const runtimeFeatureFlag = true

export const runtimeMeta = Object.freeze({
  tone: 'violet',
  tags: ['combined', 'types'] as const,
})
