import * as styles from './css-modules-card.module.css'

export const CSS_MODULES_TEST_ID = 'dialect-css-modules'

export function CssModulesCard() {
  return (
    <div
      className={`${styles['css-modules-badge']} css-modules-badge`}
      data-testid={CSS_MODULES_TEST_ID}
    >
      <span className={`${styles['css-modules-token']} css-modules-token`}>
        css modules
      </span>
      <span className={`${styles['css-modules-label']} css-modules-label`}>
        Stable selectors keep Lit-hosted styles in sync with hashed class names.
      </span>
    </div>
  )
}
