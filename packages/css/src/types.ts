import type { TransformOptions as LightningTransformOptions } from 'lightningcss'

export type CssResolver = (
  specifier: string,
  ctx: { cwd: string; from?: string },
) => string | Promise<string | undefined>

export type LightningVisitor = LightningTransformOptions<Record<string, never>>['visitor']

type LightningRuleVisitors = Extract<
  NonNullable<LightningVisitor>['Rule'],
  { style?: unknown }
>

export type LightningStyleRuleVisitor = NonNullable<LightningRuleVisitors['style']>
export type LightningStyleRule = Parameters<LightningStyleRuleVisitor>[0]
export type LightningStyleRuleReturn = ReturnType<LightningStyleRuleVisitor>
