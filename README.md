# Varix

Figma plugin that exports selected local variable collections into an Xcode-ready asset catalog ZIP and uploads it to the GuruApps CMS.

## What it does

1. Opens a UI when the plugin starts.
2. Reads all local variable collections in the current Figma file.
3. Lets the user select one, many, or all collections.
4. Requires the user to choose both a Product and a Target (`Main`, `Extension`, or `iWatch`).
5. Exports color variables into a `.xcassets` structure.
6. Uploads the ZIP to the selected Product and Target in the CMS.

## Output shape

The exported ZIP contains:

- `<Figma File Name>.xcassets/Contents.json`
- `<AssetName>.colorset/Contents.json` for every exported color token

Each `Contents.json` follows Xcode color asset syntax with:

- `colors`
- `info.author = "xcode"`
- `info.version = 1`
- `appearances` for dark mode when the collection includes a mode whose name contains `dark`

## Files

- `manifest.json`
- `code.js`
- `ui.html`

## How to load in Figma

1. Open Figma Desktop.
2. Go to `Plugins` -> `Development` -> `Import plugin from manifest...`
3. Select [manifest.json](/Users/user/Desktop/2026/Varix-plugin/manifest.json)

## Notes

- This version exports only color variables, because Xcode color assets do not support number, string, or boolean variables.
- Alias color variables are resolved to actual RGBA values before export.
- This version exports local variables from the current file. It does not pull variables from published team libraries.
- Product and Target intentionally start at `Select` on every launch to avoid accidental overwrites.
