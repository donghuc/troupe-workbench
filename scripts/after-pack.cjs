// electron-builder afterPack hook: (1) Electron fuses, (2) ad-hoc signing on the Mac (2.2.1).
//
// Fuses (security review #10): switches baked into the Electron binary that turn off ways to
// make Troupe run code it didn't ship — NODE_OPTIONS, --inspect, loading an app from outside
// app.asar, and (on the Mac) running as plain Node. Windows keeps RunAsNode: the `troupe`
// command and the PDF text helper run Troupe.exe as Node (D-120). Flipping fuses edits the
// binary, so it happens before signing.
//
// Signing — why: with `identity: null` the app is left unsigned after electron-builder edits the
// bundle (asar, Info.plist, icon), which breaks the Electron binary's original signature.
// A local build runs fine, but once the dmg is DOWNLOADED (quarantine flag set), Apple
// silicon refuses an invalid signature outright: "Troupe is damaged and can't be opened".
// An ad-hoc signature ("-", no Apple certificate) makes the bundle valid again, so macOS
// shows the normal "unidentified developer" prompt that Privacy & Security ▸ Open Anyway
// clears. Notarisation would still need an Apple Developer ID; this only fixes "damaged".
const { execFileSync } = require('child_process')
const { join } = require('path')
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses')

exports.default = async function afterPack(context) {
  const mac = context.electronPlatformName === 'darwin'
  const name = context.packager.appInfo.productFilename
  const binary = join(context.appOutDir, mac ? `${name}.app` : `${name}.exe`)
  if (mac || context.electronPlatformName === 'win32') {
    await flipFuses(binary, {
      version: FuseVersion.V1,
      resetAdHocDarwinSignature: mac,
      [FuseV1Options.RunAsNode]: !mac,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.OnlyLoadAppFromAsar]: true
    })
    console.log(`  • fuses set on ${binary}`)
  }
  if (!mac) return
  const app = binary
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' })
  console.log(`  • ad-hoc signed ${app}`)
}
