export const WEBPACK_LIT_REACT_TEST_ID = 'webpack-lit-react-host'
export const WEBPACK_SASS_TEST_ID = 'webpack-card-sass'
export const WEBPACK_LESS_TEST_ID = 'webpack-card-less'
export const WEBPACK_VANILLA_TEST_ID = 'webpack-card-vanilla'

export const WEBPACK_CARD_TEST_IDS = {
  sass: WEBPACK_SASS_TEST_ID,
  less: WEBPACK_LESS_TEST_ID,
  vanilla: WEBPACK_VANILLA_TEST_ID,
} as const

export type WebpackCardKind = keyof typeof WEBPACK_CARD_TEST_IDS

export const WEBPACK_HOST_TAG = 'webpack-react-bridge'
