import { type TransformOptions as LightningTransformOptions } from 'lightningcss'

import type {
  LightningStyleRule,
  LightningStyleRuleReturn,
  LightningVisitor,
} from './types.js'

export type SpecificitySelector = string | RegExp

export type { LightningVisitor }

export type SpecificityStrategy =
  | { type: 'append-where'; token: string }
  | { type: 'repeat-class'; times?: number }

export function buildSpecificityVisitor(boost?: {
  visitor?: LightningVisitor
  strategy?: SpecificityStrategy
  match?: SpecificitySelector[]
}): LightningVisitor | undefined {
  if (!boost) return undefined
  if (boost.visitor) return boost.visitor
  if (!boost.strategy) return undefined

  const matchers = (boost.match ?? []).map(m =>
    typeof m === 'string' ? new RegExp(`^${escapeRegex(m)}$`) : m,
  )
  const shouldApply = (selectorStr: string): boolean =>
    matchers.length === 0 ? true : matchers.some(rx => rx.test(selectorStr))

  if (boost.strategy.type === 'repeat-class') {
    const times = Math.max(1, boost.strategy.times ?? 1)
    const visitor: LightningVisitor = {
      Rule: {
        style(rule: LightningStyleRule): LightningStyleRuleReturn {
          const candidate = rule as { selectors?: unknown } | null | undefined
          if (!candidate || !Array.isArray(candidate.selectors)) {
            return rule as LightningStyleRuleReturn
          }
          const newSelectors = candidate.selectors.map((sel: unknown) => {
            if (!Array.isArray(sel)) return sel
            const selectorStr = serializeSelector(
              sel as Parameters<typeof serializeSelector>[0],
            )
            if (!shouldApply(selectorStr)) return sel
            const lastClassName = findLastClassName(selectorStr)
            if (!lastClassName) return sel
            const repeats = Array.from({ length: times }, () => ({
              type: 'class',
              value: lastClassName,
            }))
            return [...sel, ...repeats]
          })
          return {
            ...candidate,
            selectors: newSelectors,
          } as unknown as LightningStyleRuleReturn
        },
      },
    }
    return visitor
  }

  if (boost.strategy.type === 'append-where') {
    const token = boost.strategy.token
    const visitor: LightningTransformOptions<never>['visitor'] = {
      Rule: {
        style(rule: LightningStyleRule): LightningStyleRuleReturn {
          const candidate = rule as { selectors?: unknown } | null | undefined
          if (!candidate || !Array.isArray(candidate.selectors)) {
            return rule as LightningStyleRuleReturn
          }
          const newSelectors = candidate.selectors.map((sel: unknown) => {
            if (!Array.isArray(sel)) return sel
            const selectorStr = serializeSelector(
              sel as Parameters<typeof serializeSelector>[0],
            )
            if (!shouldApply(selectorStr)) return sel
            return [
              ...sel,
              {
                type: 'pseudo-class',
                kind: 'where',
                selectors: [[{ type: 'class', value: token.replace(/^\./, '') }]],
              },
            ]
          })
          return {
            ...candidate,
            selectors: newSelectors,
          } as unknown as LightningStyleRuleReturn
        },
      },
    }
    return visitor
  }

  return undefined
}

export function serializeSelector(
  sel: Array<{ type: string; value?: string; name?: string; kind?: string }>,
): string {
  return sel
    .map(node => {
      if (node.type === 'class') return `.${node.value ?? node.name ?? ''}`
      if (node.type === 'id') return `#${node.value ?? node.name ?? ''}`
      if (node.type === 'type') return node.name ?? ''
      if (node.type === 'pseudo-class') return `:${node.kind ?? ''}`
      if (node.type === 'combinator') return ` ${node.value ?? ''} `
      return ''
    })
    .join('')
    .trim()
}

export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function findLastClassName(selector: string): string | undefined {
  let match: RegExpExecArray | null
  let last: string | undefined
  const rx = /\.([A-Za-z0-9_-]+)/g
  while ((match = rx.exec(selector)) !== null) {
    last = match[1]
  }
  return last
}

export function applyStringSpecificityBoost(
  css: string,
  boost: {
    strategy?: SpecificityStrategy
    match?: SpecificitySelector[]
  },
): string {
  if (!boost.strategy) return css
  const matchers = (boost.match ?? []).map(m =>
    typeof m === 'string' ? new RegExp(`\\.${escapeRegex(m)}(?![\\w-])`, 'g') : m,
  )
  const applyAll = matchers.length === 0

  if (boost.strategy.type === 'repeat-class') {
    const times = Math.max(1, boost.strategy.times ?? 1)
    const duplicate = (cls: string) => cls + cls.repeat(times)
    if (applyAll) {
      return css.replace(/\.[A-Za-z0-9_-]+/g, m => duplicate(m))
    }
    let result = css
    for (const rx of matchers) {
      result = result.replace(rx, m => duplicate(m))
    }
    return result
  }

  if (boost.strategy.type === 'append-where') {
    const token = boost.strategy.token.replace(/^\./, '')
    const suffix = `:where(.${token})`
    if (applyAll) {
      return css.replace(/\.[A-Za-z0-9_-]+/g, m => `${m}${suffix}`)
    }
    let result = css
    for (const rx of matchers) {
      result = result.replace(rx, m => `${m}${suffix}`)
    }
    return result
  }

  return css
}
