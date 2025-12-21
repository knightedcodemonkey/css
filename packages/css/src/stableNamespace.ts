const DEFAULT_STABLE_NAMESPACE = 'knighted'

export function resolveStableNamespace(optionNamespace?: string): string {
  if (typeof optionNamespace === 'string') {
    return optionNamespace
  }
  return DEFAULT_STABLE_NAMESPACE
}

export { DEFAULT_STABLE_NAMESPACE }
