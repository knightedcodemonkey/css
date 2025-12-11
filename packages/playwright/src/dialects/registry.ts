import type { KnightedCssCombinedModule } from '@knighted/css/loader'

import Basic, { className as basicClass } from './basic.js'
import { knightedCss as basicCss } from './basic.js?knighted-css'

import Scss, { className as scssClass } from './scss.js'
import { knightedCss as scssCss } from './scss.js?knighted-css'

import SassIndented, { className as sassIndentedClass } from './sass-indented.js'
import { knightedCss as sassIndentedCss } from './sass-indented.js?knighted-css'

import LessComp, { className as lessClass } from './less.js'
import { knightedCss as lessCss } from './less.js?knighted-css'

import * as VanillaCombined from './vanilla.js?knighted-css&combined'

type VanillaModuleShape = KnightedCssCombinedModule<typeof import('./vanilla.js')>

const VanillaModule = VanillaCombined as unknown as VanillaModuleShape
const {
  default: VanillaComp,
  className: vanillaClass,
  badgeClass,
  tokenClass,
  knightedCss: vanillaCss,
} = VanillaModule

export type DialectSample = {
  className: string
  css: string
  label: string
  testId: string
}

export const dialects: DialectSample[] = [
  { label: Basic(), className: basicClass, css: basicCss, testId: 'dialect-basic' },
  { label: Scss(), className: scssClass, css: scssCss, testId: 'dialect-scss' },
  {
    label: SassIndented(),
    className: sassIndentedClass,
    css: sassIndentedCss,
    testId: 'dialect-sass-indented',
  },
  { label: LessComp(), className: lessClass, css: lessCss, testId: 'dialect-less' },
  {
    label: VanillaComp(),
    className: `${vanillaClass} ${badgeClass} ${tokenClass}`,
    css: vanillaCss,
    testId: 'dialect-vanilla',
  },
]
