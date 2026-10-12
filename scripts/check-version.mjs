// Fails `npm run dist` if package.json version != the newest CHANGELOG version.
// Catches "forgot to rename [Unreleased]" before a dmg ships.
import { readFileSync } from 'fs'
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)))
const cl = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')
const top = (cl.match(/^## \[(\d+\.\d+\.\d+)\]/m) || [])[1]
if (top !== pkg.version) {
  console.error(`\n✖ Version mismatch: package.json is ${pkg.version} but the newest CHANGELOG entry is ${top ?? '(none)'}.`)
  console.error(`  Rename the CHANGELOG "[Unreleased]" heading to "[${pkg.version}] - <date>" before packaging.\n`)
  process.exit(1)
}
console.log(`✓ version check: ${pkg.version} matches CHANGELOG`)
