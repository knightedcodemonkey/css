const DEFAULT_NAMESPACE = 'knighted'

export interface StableSelectorOptions {
  namespace?: string
}

export interface StableClassNameOptions extends StableSelectorOptions {
  token?: string
  join?: (values: string[]) => string
}

const defaultJoin = (values: string[]) => values.filter(Boolean).join(' ')

const normalizeToken = (token: string): string => {
  const sanitized = token
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return sanitized.length ? sanitized : 'stable'
}

export function stableToken(token: string, options?: StableSelectorOptions): string {
  const normalized = normalizeToken(token)
  const namespace = options?.namespace?.trim() ?? DEFAULT_NAMESPACE
  if (!namespace) {
    return normalized
  }
  return `${namespace}-${normalized}`
}

export function stableClass(token: string, options?: StableSelectorOptions): string {
  return stableToken(token, options)
}

export function stableSelector(token: string, options?: StableSelectorOptions): string {
  return `.${stableToken(token, options)}`
}

export function createStableClassFactory(options?: StableSelectorOptions) {
  return (token: string) => stableClass(token, options)
}

export function stableClassName<T extends Record<string, string>>(
  styles: T,
  key: keyof T | string,
  options?: StableClassNameOptions,
): string {
  const hashed = styles[key as keyof T] ?? ''
  const token = options?.token ?? String(key)
  const stable = stableClass(token, options)
  const join = options?.join ?? defaultJoin
  return join([hashed, stable])
}

export const stableClassFromModule = stableClassName
