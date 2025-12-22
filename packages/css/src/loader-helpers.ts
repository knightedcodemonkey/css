import type { KnightedCssCombinedModule } from './loader.js'

// Keep helper side-effect free so bundlers can safely tree-shake it into web targets.
type KnightedCssCombinedExtras = Readonly<Record<string, unknown>>

export function asKnightedCssCombinedModule<
  TModule,
  TExtras extends KnightedCssCombinedExtras = Record<never, never>,
>(module: unknown): KnightedCssCombinedModule<TModule, TExtras> {
  return module as KnightedCssCombinedModule<TModule, TExtras>
}
