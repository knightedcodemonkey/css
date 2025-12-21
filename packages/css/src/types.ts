export type CssResolver = (
  specifier: string,
  ctx: { cwd: string; from?: string },
) => string | Promise<string | undefined>
