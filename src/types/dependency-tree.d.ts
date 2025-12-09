declare module 'dependency-tree' {
  export interface DependencyTreeOptions {
    filename: string
    directory: string
    filter?: (path: string) => boolean
    [key: string]: unknown
  }

  const dependencyTree: {
    toList(options: DependencyTreeOptions): string[]
  }

  export default dependencyTree
}
