import { transform as lightningTransform } from 'lightningcss'

import { escapeRegex, serializeSelector } from './helpers.js'

export interface StableSelectorsLiteralResult {
  literal: string
  selectorMap: Map<string, string>
}

type StableSelectorsLiteralTarget = 'ts' | 'js'

export function buildStableSelectorsLiteral(options: {
  css: string
  namespace: string
  resourcePath: string
  emitWarning: (message: string) => void
  target?: StableSelectorsLiteralTarget
}): StableSelectorsLiteralResult {
  const target: StableSelectorsLiteralTarget = options.target ?? 'ts'
  const trimmedNamespace = options.namespace.trim()
  if (!trimmedNamespace) {
    options.emitWarning(
      `stableSelectors requested for ${options.resourcePath} but "stableNamespace" resolved to an empty value.`,
    )
    return finalizeLiteral(new Map<string, string>(), target)
  }

  const selectorMap = collectStableSelectors(
    options.css,
    trimmedNamespace,
    options.resourcePath,
  )
  if (selectorMap.size === 0) {
    options.emitWarning(
      `stableSelectors requested for ${options.resourcePath} but no selectors matched namespace "${trimmedNamespace}".`,
    )
  }
  return finalizeLiteral(selectorMap, target)
}

function finalizeLiteral(
  selectorMap: Map<string, string>,
  target: StableSelectorsLiteralTarget,
): StableSelectorsLiteralResult {
  const formatted = formatStableSelectorMap(selectorMap)
  const suffix = target === 'ts' ? ' as const' : ''
  return {
    literal: `export const stableSelectors = ${formatted}${suffix};\n`,
    selectorMap,
  }
}

export function collectStableSelectors(
  css: string,
  namespace: string,
  filename?: string,
): Map<string, string> {
  if (!namespace) return new Map<string, string>()
  const astResult = collectStableSelectorsFromAst(css, namespace, filename)
  if (astResult) {
    return astResult
  }
  return collectStableSelectorsByRegex(css, namespace)
}

function collectStableSelectorsFromAst(
  css: string,
  namespace: string,
  filename?: string,
): Map<string, string> | undefined {
  try {
    const tokens = new Map<string, string>()
    const escaped = escapeRegex(namespace)
    const pattern = new RegExp(`\\.${escaped}-([A-Za-z0-9_-]+)`, 'g')
    lightningTransform({
      filename: filename ?? 'knighted-types-probe.css',
      code: Buffer.from(css),
      minify: false,
      visitor: {
        Rule: {
          style(rule: any) {
            const target = Array.isArray(rule?.selectors)
              ? rule
              : rule?.value && Array.isArray(rule.value.selectors)
                ? rule.value
                : undefined
            if (!target) return rule
            for (const selector of target.selectors) {
              const selectorStr = serializeSelector(selector as any)
              pattern.lastIndex = 0
              let match: RegExpExecArray | null
              while ((match = pattern.exec(selectorStr)) !== null) {
                const token = match[1]
                if (!token) continue
                tokens.set(token, `${namespace}-${token}`)
              }
            }
            return rule
          },
        },
      },
    })
    return tokens
  } catch {
    return undefined
  }
}

function collectStableSelectorsByRegex(
  css: string,
  namespace: string,
): Map<string, string> {
  const escaped = escapeRegex(namespace)
  const pattern = new RegExp(`\\.${escaped}-([A-Za-z0-9_-]+)`, 'g')
  const tokens = new Map<string, string>()
  let match: RegExpExecArray | null
  while ((match = pattern.exec(css)) !== null) {
    const token = match[1]
    if (!token) continue
    tokens.set(token, `${namespace}-${token}`)
  }
  return tokens
}

export function formatStableSelectorMap(map: Map<string, string>): string {
  if (map.size === 0) {
    return 'Object.freeze({})'
  }
  const entries = Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b))
  const lines = entries.map(([token, selector]) => {
    return `  ${JSON.stringify(token)}: ${JSON.stringify(selector)}`
  })
  return `Object.freeze({\n${lines.join(',\n')}\n})`
}

export const __stableSelectorsLiteralInternals = {
  collectStableSelectors,
  collectStableSelectorsByRegex,
  formatStableSelectorMap,
}
