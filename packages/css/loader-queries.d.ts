/**
 * Ambient declaration for loader query imports like "./file.js?knighted-css".
 * The loader appends a named export `knightedCss` containing the compiled CSS.
 */
declare module '*?knighted-css' {
  export const knightedCss: string
}

type KnightedCssStableSelectorMap = Readonly<Record<string, string>>

declare module '*?knighted-css&types' {
  export const knightedCss: string
  export const stableSelectors: KnightedCssStableSelectorMap
}

/**
 * Ambient declaration for combined loader imports (e.g. "./file.tsx?knighted-css&combined").
 * These modules behave like the original module with an additional `knightedCss` export.
 * TypeScript cannot infer the underlying module automatically, so consumers can
 * import the default export and narrow it with `KnightedCssCombinedModule<typeof import('./file')>`.
 */
type KnightedCssCombinedModule<TModule> = TModule & { knightedCss: string }

declare module '*?knighted-css&combined' {
  const combined: KnightedCssCombinedModule<Record<string, unknown>>
  export default combined
  export const knightedCss: string
}

declare module '*?knighted-css&combined&named-only' {
  const combined: KnightedCssCombinedModule<Record<string, unknown>>
  export default combined
  export const knightedCss: string
}

declare module '*?knighted-css&combined&no-default' {
  const combined: KnightedCssCombinedModule<Record<string, unknown>>
  export default combined
  export const knightedCss: string
}

declare module '*?knighted-css&combined&types' {
  const combined: KnightedCssCombinedModule<Record<string, unknown>>
  export default combined
  export const knightedCss: string
  export const stableSelectors: KnightedCssStableSelectorMap
}

declare module '*?knighted-css&combined&named-only&types' {
  const combined: KnightedCssCombinedModule<Record<string, unknown>>
  export default combined
  export const knightedCss: string
  export const stableSelectors: KnightedCssStableSelectorMap
}

declare module '*?knighted-css&combined&no-default&types' {
  const combined: KnightedCssCombinedModule<Record<string, unknown>>
  export default combined
  export const knightedCss: string
  export const stableSelectors: KnightedCssStableSelectorMap
}
