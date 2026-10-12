import { defineConfig } from 'vitest/config'

// Unit tests (D-060 item 2). Pure modules are tested directly. Repos and other
// DB-backed code run against an in-memory SQLite with every migration applied
// (src/main/testing/memoryDb.ts, D-091), with `electron` and `../database/db` mocked.
// UI and process paths are covered by the GUI verification recorded in DECISIONS.md.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    clearMocks: true
  }
})
