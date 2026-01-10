// Extensionless to exercise the exact attribute-only path.
import './attr-import' with { type: 'css' }

export const ATTR_IMPORT_TEST_ID = 'dialect-attr-import'

export function AttrImportCard() {
  return (
    <span className="pw-attr-import" data-testid={ATTR_IMPORT_TEST_ID}>
      Import attribute CSS
    </span>
  )
}
