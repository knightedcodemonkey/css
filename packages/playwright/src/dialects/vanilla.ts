import type { KnightedCssCombinedModule } from '@knighted/css/loader'
import * as VanillaStylesCombined from './vanilla.css.js?knighted-css&combined'

type VanillaStylesModule = KnightedCssCombinedModule<typeof import('./vanilla.css.js')>

const VanillaStyles = VanillaStylesCombined as unknown as VanillaStylesModule
const { vanillaBadgeClass, vanillaCardClass, vanillaTokenClass } = VanillaStyles

export const className = vanillaCardClass
export const badgeClass = vanillaBadgeClass
export const tokenClass = vanillaTokenClass

export default function renderLabel() {
  return 'vanilla-extract'
}
