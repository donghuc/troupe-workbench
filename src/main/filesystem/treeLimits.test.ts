import { describe, it, expect } from 'vitest'
import { dirSkipReason, isWatchIgnored, TREE_MAX_DEPTH, TREE_MAX_ENTRIES } from './treeLimits'

describe('dirSkipReason', () => {
  it('walks ordinary folders', () => {
    expect(dirSkipReason('research', 1, 10)).toBeNull()
    expect(dirSkipReason('builds', 1, 10)).toBeNull()
  })
  it('does not open generated folders and bundles', () => {
    for (const n of ['node_modules', 'DerivedData', 'build', 'Pods', 'Atlas.xcodeproj', 'Assets.xcassets', 'Troupe.app', 'en.lproj']) {
      expect(dirSkipReason(n, 1, 0)).toBe('heavy')
    }
  })
  it('stops at the depth and entry caps', () => {
    expect(dirSkipReason('a', TREE_MAX_DEPTH, 0)).toBe('depth')
    expect(dirSkipReason('a', 1, TREE_MAX_ENTRIES)).toBe('limit')
  })
})

describe('isWatchIgnored', () => {
  const root = '/Users/me/Library/CloudStorage/Dropbox/Proj'
  it('never ignores the root or ordinary files, even under ~/Library', () => {
    expect(isWatchIgnored(root, root)).toBe(false)
    expect(isWatchIgnored(root, `${root}/notes/a.md`)).toBe(false)
    expect(isWatchIgnored(root, `${root}/builds/x.md`)).toBe(false)
  })
  it('ignores heavy, VCS and app folders at any depth', () => {
    for (const p of ['node_modules/x/y.js', 'dist/mac-arm64/Troupe.app/Contents/Info.plist', 'a/build/out.o', '.git/HEAD', '.workbench/collab/r/STATUS.md', 'ios/Pods/A/b.h', 'x/.DS_Store']) {
      expect(isWatchIgnored(root, `${root}/${p}`)).toBe(true)
    }
  })
  it('watches a heavy folder itself but not what is inside it', () => {
    expect(isWatchIgnored(root, `${root}/dist`)).toBe(false)
    expect(isWatchIgnored(root, `${root}/ios/Pods`)).toBe(false)
    expect(isWatchIgnored(root, `${root}/dist/app.js`)).toBe(true)
    expect(isWatchIgnored(root, `${root}/.git`)).toBe(true)
  })
  it('does not ignore paths outside the root', () => {
    expect(isWatchIgnored(root, '/elsewhere/node_modules/x')).toBe(false)
    expect(isWatchIgnored(root, `${root}2/node_modules/x`)).toBe(false)
  })
})
