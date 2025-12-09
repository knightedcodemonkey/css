/**
 * Ambient declaration for loader query imports like "./file.js?knighted-css".
 * The loader appends a named export `knightedCss` containing the compiled CSS.
 */
declare module '*?knighted-css*' {
  export const knightedCss: string
}
