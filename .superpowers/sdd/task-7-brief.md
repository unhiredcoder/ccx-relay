# Task 7: GitHub Actions CI/CD

## Context
ccx-relay is being prepared for public npm release. This task adds two GitHub Actions workflows:
one that runs tests on every PR/push, and one that auto-publishes to npm on version tags.

## Global Constraints
- Public repo → GitHub Actions is free (unlimited minutes)
- Tests run via `npm test` which is `node --test test/**/*.test.js`
- node-pty is a native module — on Windows it requires build tools; on Linux it builds fine with npm ci
- npm publish requires NPM_TOKEN secret in GitHub repo settings

## Requirements

### `.github/workflows/test.yml`

```yaml
name: Test

on:
  pull_request:
  push:
    branches: [main]

jobs:
  test:
    strategy:
      matrix:
        node: [18, 20, 22]
        os: [ubuntu-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
      - run: npm ci
      - run: npm test
```

### `.github/workflows/publish.yml`

```yaml
name: Publish

on:
  push:
    tags:
      - 'v*'

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          registry-url: 'https://registry.npmjs.org'
      - run: npm ci
      - run: npm test
      - run: npm publish --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

## Verification
After creating files:
1. Run `node --check` on both files (they're YAML, not JS — just verify they were created correctly)
2. Print the contents of both files to confirm they match the spec

## Commit message
`ci: add test matrix and npm publish workflows`

## Report
Write to: `.superpowers/sdd/task-7-report.md`

Return only: Status, commit hash, file contents confirmed, concerns.
