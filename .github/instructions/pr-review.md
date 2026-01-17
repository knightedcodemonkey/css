---
name: PR review instructions
description: Guidance for Copilot when reviewing pull requests.
applyTo: '**/*'
---

When reviewing PRs in this repository:

- Focus on correctness, edge cases, and TypeScript type safety.
- Call out potential bugs, duplicated logic, and opportunities to simplify.
- Verify generated artifacts (dist, coverage, test-results, .knighted-css) are not modified.
- Prefer minimal, localized changes and preserve existing public APIs.
- Check for new or missing tests when behavior changes.
- Flag NodeNext/ESM import correctness, especially extension handling.
- Call out performance regressions in graph walking or CSS extraction.
- Note any security or path traversal risks in resolver or loader changes.
- Ensure docs/readme updates match behavior changes when user-facing.
- Summarize risks and required follow-ups clearly.
