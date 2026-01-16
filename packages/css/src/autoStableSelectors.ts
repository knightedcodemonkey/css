import type { LightningVisitor } from './helpers.js'
import { serializeSelector } from './helpers.js'
import { stableClass } from './stableSelectors.js'

export interface AutoStableConfig {
  namespace?: string
  include?: RegExp
  exclude?: RegExp
}

export type AutoStableOption = boolean | AutoStableConfig
export type AutoStableVisitor = LightningVisitor

type SelectorNode = {
  type: string
  value?: string
  name?: string
  kind?: string
  selectors?: Selector | Selector[] | null
  [key: string]: unknown
}

type Selector = SelectorNode[]
type TransformResult = { selector: Selector; changed: boolean }

type RuleWithSelectors = {
  selectors?: unknown
  value?: {
    selectors?: unknown
  }
}

function isSelectorList(value: unknown): value is Selector[] {
  return Array.isArray(value)
}

function isRuleWithSelectors(rule: unknown): rule is RuleWithSelectors {
  return typeof rule === 'object' && rule !== null
}

function hasSelectorList(
  rule: RuleWithSelectors,
): rule is RuleWithSelectors & { selectors: Selector[] } {
  return isSelectorList(rule.selectors)
}

function hasValueSelectorList(
  rule: RuleWithSelectors,
): rule is RuleWithSelectors & { value: { selectors: Selector[] } } {
  return isSelectorList(rule.value?.selectors)
}

function getSelectors(rule: RuleWithSelectors | undefined): Selector[] | undefined {
  if (rule && hasSelectorList(rule)) return rule.selectors
  if (rule && hasValueSelectorList(rule)) return rule.value.selectors
  return undefined
}

function setSelectors<T extends RuleWithSelectors>(rule: T, selectors: Selector[]): T {
  if (hasSelectorList(rule)) {
    rule.selectors = selectors
    return rule
  }
  if (hasValueSelectorList(rule)) {
    rule.value.selectors = selectors
    return rule
  }
  return rule
}

export function normalizeAutoStableOption(option?: AutoStableOption) {
  if (!option) return undefined
  if (option === true) return {}
  return option
}

export function buildAutoStableVisitor(option?: AutoStableOption) {
  const config = normalizeAutoStableOption(option)
  if (!config) return undefined

  const visitor: LightningVisitor = {
    Rule: {
      style(rule) {
        if (!isRuleWithSelectors(rule)) return rule
        const baseSelectors = getSelectors(rule)
        if (!baseSelectors) return rule
        const seen = new Set(baseSelectors.map(sel => serializeSelector(sel)))
        const augmented: typeof baseSelectors = [...baseSelectors]

        for (const selector of baseSelectors) {
          const { selector: stableSelector, changed } = transformSelector(
            selector,
            config,
          )
          if (!changed) continue
          const key = serializeSelector(stableSelector)
          if (seen.has(key)) continue
          seen.add(key)
          augmented.push(stableSelector)
        }

        return setSelectors(rule, augmented)
      },
    },
  }

  return visitor
}

function transformSelector(
  selector: Selector,
  config: AutoStableConfig,
): TransformResult {
  let changed = false
  const next = selector.map(node => transformNode(node, config, () => (changed = true)))
  return { selector: next, changed }
}

function transformNode(
  node: SelectorNode,
  config: AutoStableConfig,
  markChanged: () => void,
) {
  if (!node || typeof node !== 'object') return node

  // Respect :global(...) scopes by leaving them untouched.
  if (node.type === 'pseudo-class' && node.kind === 'global') {
    return node
  }

  if (node.type === 'class') {
    const value = node.value ?? node.name ?? ''
    if (!shouldTransform(value, config)) {
      return node
    }
    const stable = stableClass(value, { namespace: config.namespace })
    if (!stable || stable === value) {
      return node
    }
    markChanged()
    return { ...node, value: stable, name: stable }
  }

  if (hasSelectors(node)) {
    const nestedSelectors = node.selectors.map(sel => {
      const nested = transformSelector(sel, config)
      if (nested.changed) {
        markChanged()
      }
      return nested.selector
    })
    return { ...node, selectors: nestedSelectors }
  }

  return node
}

function hasSelectors(
  node: SelectorNode,
): node is SelectorNode & { selectors: Selector[] } {
  return Array.isArray(node.selectors)
}

function shouldTransform(token: string, config: AutoStableConfig) {
  if (config.exclude && config.exclude.test(token)) {
    return false
  }
  if (config.include && !config.include.test(token)) {
    return false
  }
  return true
}
