// @ts-expect-error - typescript doesnt support template literal types in ambient modules
import { stableSelectors } from './demo.css.ts?knighted-css&types&stableNamespace=acme'

void stableSelectors
