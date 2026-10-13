// electron-builder afterPack hook (2.2.1): ad-hoc sign the packaged app.
//
// Why: with `identity: null` the app is left unsigned after electron-builder edits the
// bundle (asar, Info.plist, icon), which breaks the Electron binary's original signature.
// A local build runs fine, but once the dmg is DOWNLOADED (quarantine flag set), Apple
// silicon refuses an invalid signature outright: "Troupe is damaged and can't be opened".
// An ad-hoc signature ("-", no Apple certificate) makes the bundle valid again, so macOS
// shows the normal "unidentified developer" prompt that Privacy & Security ▸ Open Anyway
// clears. Notarisation would still need an Apple Developer ID; this only fixes "damaged".
const { execFileSync } = require('child_process')
const { join } = require('path')

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' })
  console.log(`  • ad-hoc signed ${app}`)
}
