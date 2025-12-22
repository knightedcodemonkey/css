const DEFAULT_NAMESPACE = 'knighted'

export interface StableSelectorOptions {
  namespace?: string
}

export interface StableClassNameOptions extends StableSelectorOptions {
  token?: string
  join?: (values: string[]) => string
}

export interface MergeStableClassSingleInput extends StableSelectorOptions {
  hashed: string | string[]
  selector?: string
  token: string
  join?: (values: string[]) => string
}

export interface MergeStableClassBatchInput<
  Hashed extends Record<string, string | string[]>,
  Selectors extends Record<string, string> | undefined = Record<string, string>,
> extends StableSelectorOptions {
  hashed: Hashed
  selectors?: Selectors
  join?: (values: string[]) => string
}

const defaultJoin = (values: string[]) => values.filter(Boolean).join(' ')

const toArray = (value: string | string[]): string[] =>
  Array.isArray(value) ? value : [value]

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

export function mergeStableClass(input: MergeStableClassSingleInput): string
export function mergeStableClass<Hashed extends Record<string, string | string[]>>(
  input: MergeStableClassBatchInput<Hashed>,
): { [Key in keyof Hashed]: string }
export function mergeStableClass(
  input:
    | MergeStableClassSingleInput
    | MergeStableClassBatchInput<Record<string, string | string[]>>,
): string | Record<string, string> {
  if ('token' in input) {
    return mergeSingle(input)
  }
  return mergeBatch(input)
}

function mergeSingle(input: MergeStableClassSingleInput): string {
  const join = input.join ?? defaultJoin
  const hashed = toArray(input.hashed)
  const stable = input.selector?.trim().length
    ? input.selector
    : stableClass(input.token, { namespace: input.namespace })
  return join([...hashed, stable])
}

function mergeBatch<Hashed extends Record<string, string | string[]>>(
  input: MergeStableClassBatchInput<Hashed>,
): Record<keyof Hashed, string> {
  const join = input.join ?? defaultJoin
  const output: Partial<Record<keyof Hashed, string>> = {}
  for (const key of Object.keys(input.hashed) as Array<keyof Hashed>) {
    const hashedValue = input.hashed[key]
    const selector = input.selectors?.[String(key)]
    const stable = selector?.trim().length
      ? selector
      : stableClass(String(key), { namespace: input.namespace })
    output[key] = join([...toArray(hashedValue), stable])
  }
  return output as Record<keyof Hashed, string>
}
