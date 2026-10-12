#!/bin/sh
# Compile build/Troupe.icon (Icon Composer bundle) into build/Assets.car so macOS 26
# draws the app on its own glass squircle instead of shrinking the legacy .icns.
# Needs Xcode 26+ command-line tools (actool). Run once per icon change, then `npm run dist`.
set -e
cd "$(dirname "$0")/.."
OUT=build/icon-compiled
rm -rf "$OUT" && mkdir -p "$OUT"
xcrun actool build/Troupe.icon --compile "$OUT" \
  --output-format human-readable-text --notices --warnings --errors \
  --output-partial-info-plist "$OUT/partial.plist" \
  --app-icon Troupe --include-all-app-icons \
  --enable-on-demand-resources NO \
  --development-region en \
  --target-device mac \
  --minimum-deployment-target 26.0 \
  --platform macosx
cp "$OUT/Assets.car" build/Assets.car
echo "✓ build/Assets.car written ($(du -h build/Assets.car | cut -f1))"
