# Specificity boost via Lightning CSS visitor

You can raise specificity for targeted selectors by supplying a Lightning CSS visitor through `specificityBoost`. Example: duplicate the last class for selected selectors (a simple “repeat-class” strategy). You can also use the built-in `strategy` option (`append-where` or `repeat-class`); `visitor` is the escape hatch for full control.

```ts
import type { LightningVisitor } from 'lightningcss'
import { css } from '@knighted/css'

const repeatClassVisitor: LightningVisitor = {
  Rule: {
    style(rule) {
      // Only adjust selectors that have at least one class.
      const newSelectors = rule.selectors.map(sel => {
        const lastClass = [...sel].reverse().find(node => node.type === 'class')
        if (!lastClass) return sel
        // Append another instance of the last class to bump specificity.
        return [
          ...sel,
          { type: 'combinator', value: '' },
          { type: 'class', value: lastClass.value },
        ]
      })
      return { ...rule, selectors: newSelectors }
    },
  },
}

const styles = await css('./src/entry.ts', {
  specificityBoost: { visitor: repeatClassVisitor },
  lightningcss: { minify: true },
})
```

You can plug any Lightning CSS visitor into `specificityBoost.visitor`; it runs after the built-in `strategy` helpers. Keep the match as narrow as possible to avoid unexpected cascade shifts.
