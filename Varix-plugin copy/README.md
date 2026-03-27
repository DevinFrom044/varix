# Varix

First version of a Figma plugin that exports selected local variable collections into an Xcode-ready asset catalog ZIP.

## What it does

1. Opens a UI when the plugin starts.
2. Reads all local variable collections in the current Figma file.
3. Lets the user select one, many, or all collections.
4. Exports color variables into a `.xcassets` structure.
5. Packs that structure into one `.zip` archive for download or save.
6. Uses the current Figma file name for the suggested export file name.

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
- `ui.js`

## How to load in Figma

1. Open Figma Desktop.
2. Go to `Plugins` -> `Development` -> `Import plugin from manifest...`
3. Select [manifest.json](/Users/user/Desktop/figma-variable-json-exporter/manifest.json)

## Notes

- The plugin tries to use a native Save dialog first with `showSaveFilePicker`.
- If that API is unavailable in the current Figma environment, it falls back to downloading the ZIP archive.
- This version exports only color variables, because Xcode color assets do not support number, string, or boolean variables.
- Alias color variables are resolved to actual RGBA values before export.
- This version exports local variables from the current file. It does not pull variables from published team libraries.
