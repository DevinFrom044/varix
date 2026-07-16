figma.showUI(__html__, {
  width: 460,
  height: 565,
  themeColors: true
});

const BASE_URL = "https://cms.universeapps.limited";
const DEFAULT_API_KEY = "9ab6830f-366d-4a34-8767-27b1cf239e60";
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const APP_IDS = new Set([
  "cleaner-guru",
  "keep-clean",
  "notee",
  "reroom-ai",
  "scan-guru",
  "visify"
]);
const SETTINGS_KEY = "varix-upload-settings";

function sanitizeBaseName(value) {
  return (value || "figma-file")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function toPascalCase(value) {
  return String(value || "")
    .split(/[^a-zA-Z0-9]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function normalizeNamePart(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function singularize(value) {
  return value.endsWith("s") ? value.slice(0, -1) : value;
}

function startsWithCollectionFamily(variableName, collectionName) {
  const firstSegment = String(variableName || "").split("/").filter(Boolean)[0] || "";
  const normalizedFirst = singularize(normalizeNamePart(firstSegment));
  const normalizedCollection = singularize(normalizeNamePart(collectionName));
  return normalizedFirst !== "" && normalizedFirst === normalizedCollection;
}

function sanitizeAssetName(collectionName, variableName) {
  const name = startsWithCollectionFamily(variableName, collectionName)
    ? toPascalCase(variableName)
    : `${toPascalCase(collectionName)}${toPascalCase(variableName)}`;
  return name.slice(0, 120);
}

function channelToString(value) {
  return Math.max(0, Math.min(1, value)).toFixed(3);
}

function rgbaToXcodeComponents(value) {
  return {
    red: channelToString(value.r),
    green: channelToString(value.g),
    blue: channelToString(value.b),
    alpha: channelToString(value.a == null ? 1 : value.a)
  };
}

async function getLocalCollections() {
  if (typeof figma.variables.getLocalVariableCollectionsAsync === "function") {
    return figma.variables.getLocalVariableCollectionsAsync();
  }

  return figma.variables.getLocalVariableCollections();
}

async function getVariableById(id) {
  if (typeof figma.variables.getVariableByIdAsync === "function") {
    return figma.variables.getVariableByIdAsync(id);
  }

  return figma.variables.getVariableById(id);
}

async function getCollectionsWithVariables(selectedCollectionIds) {
  const collections = await getLocalCollections();
  const selectedSet = selectedCollectionIds ? new Set(selectedCollectionIds) : null;
  const targetCollections = selectedSet
    ? collections.filter((collection) => selectedSet.has(collection.id))
    : collections;
  const variablesById = new Map();
  const variableIds = new Set();

  for (const collection of targetCollections) {
    for (const variableId of collection.variableIds) {
      variableIds.add(variableId);
    }
  }

  const variables = await Promise.all(
    Array.from(variableIds).map(async (variableId) => {
      const variable = await getVariableById(variableId);
      return [variableId, variable];
    })
  );

  for (const [variableId, variable] of variables) {
    if (variable) {
      variablesById.set(variableId, variable);
    }
  }

  return { collections, variablesById };
}

async function getCollectionsSummary() {
  const collections = await getLocalCollections();
  return collections.map((collection) => ({
    id: collection.id,
    name: collection.name,
    variableCount: collection.variableIds.length,
    modes: collection.modes.map((mode) => ({
      id: mode.modeId,
      name: mode.name
    }))
  }));
}

function isColorValue(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof value.r === "number" &&
      typeof value.g === "number" &&
      typeof value.b === "number"
  );
}

function pickModeForAlias(aliasVariable, requestedModeName, collectionsById) {
  const aliasCollection = collectionsById.get(aliasVariable.variableCollectionId);
  if (!aliasCollection) {
    return null;
  }

  const matchingMode = aliasCollection.modes.find((mode) => mode.name === requestedModeName);
  if (matchingMode) {
    return matchingMode.modeId;
  }

  return aliasCollection.defaultModeId;
}

function resolveColorValue(variable, modeId, modeName, variablesById, collectionsById, visited) {
  const visitKey = `${variable.id}:${modeId}`;
  if (visited.has(visitKey)) {
    return null;
  }

  visited.add(visitKey);
  const rawValue = variable.valuesByMode[modeId];

  if (isColorValue(rawValue)) {
    return rawValue;
  }

  if (rawValue && typeof rawValue === "object" && rawValue.type === "VARIABLE_ALIAS") {
    const aliasVariable = variablesById.get(rawValue.id);
    if (!aliasVariable || aliasVariable.resolvedType !== "COLOR") {
      return null;
    }

    const aliasModeId = pickModeForAlias(aliasVariable, modeName, collectionsById);
    if (!aliasModeId) {
      return null;
    }

    return resolveColorValue(aliasVariable, aliasModeId, modeName, variablesById, collectionsById, visited);
  }

  return null;
}

function buildColorSetContents(universalColor, darkColor) {
  const colors = [
    {
      idiom: "universal",
      color: {
        "color-space": "srgb",
        components: rgbaToXcodeComponents(universalColor)
      }
    }
  ];

  if (darkColor) {
    colors.push({
      idiom: "universal",
      appearances: [
        {
          appearance: "luminosity",
          value: "dark"
        }
      ],
      color: {
        "color-space": "srgb",
        components: rgbaToXcodeComponents(darkColor)
      }
    });
  }

  return {
    colors,
    info: {
      version: 1,
      author: "xcode"
    }
  };
}

function getPreferredUniversalMode(collection) {
  return (
    collection.modes.find((mode) => /light|default/i.test(mode.name)) ||
    collection.modes.find((mode) => mode.modeId === collection.defaultModeId) ||
    collection.modes[0] ||
    null
  );
}

function getDarkMode(collection) {
  return collection.modes.find((mode) => /dark/i.test(mode.name)) || null;
}

function buildRootContents() {
  return {
    info: {
      version: 1,
      author: "xcode"
    }
  };
}

function addUniqueFile(files, seenPaths, path, content) {
  let candidate = path;
  let counter = 2;

  while (seenPaths.has(candidate)) {
    const nextPath = candidate.replace(/\.colorset\/Contents\.json$/, `${counter}.colorset/Contents.json`);
    candidate = nextPath;
    counter += 1;
  }

  seenPaths.add(candidate);
  files.push({ path: candidate, content });
}

function makeExportSummary(selectedCollections, exportedCount, skippedNonColorCount, skippedUnsupportedCount) {
  return {
    selectedCollections: selectedCollections.map((collection) => collection.name),
    exportedColorTokens: exportedCount,
    skippedNonColorVariables: skippedNonColorCount,
    skippedUnsupportedColorVariables: skippedUnsupportedCount
  };
}

async function sendCollectionsToUI() {
  try {
    const collections = await getCollectionsSummary();
    const settings = (await figma.clientStorage.getAsync(SETTINGS_KEY)) || {};

    figma.ui.postMessage({
      type: "collections-loaded",
      fileName: figma.root.name || "Untitled",
      suggestedFileName: `${sanitizeBaseName(figma.root.name)}.xcassets.zip`,
      collections,
      settings: {
        appId: typeof settings.appId === "string" ? settings.appId : "reroom-ai"
      }
    });
  } catch (error) {
    figma.ui.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : "Failed to read local variable collections."
    });
  }
}

async function buildXcodeAssetExport(selectedCollectionIds) {
  const { collections, variablesById } = await getCollectionsWithVariables(selectedCollectionIds);
  const selectedSet = new Set(selectedCollectionIds);
  const selectedCollections = collections.filter((collection) => selectedSet.has(collection.id));

  if (selectedCollections.length === 0) {
    throw new Error("Select at least one collection before exporting.");
  }

  const collectionsById = new Map(collections.map((collection) => [collection.id, collection]));
  const assetCatalogName = "Colors";
  const files = [
    {
      path: `${assetCatalogName}/Contents.json`,
      content: JSON.stringify(buildRootContents(), null, 2)
    }
  ];
  const seenPaths = new Set(files.map((file) => file.path));
  let exportedCount = 0;
  let skippedNonColorCount = 0;
  let skippedUnsupportedCount = 0;

  for (const collection of selectedCollections) {
    const universalMode = getPreferredUniversalMode(collection);
    if (!universalMode) {
      continue;
    }

    const darkMode = getDarkMode(collection);

    for (const variableId of collection.variableIds) {
      const variable = variablesById.get(variableId);
      if (!variable) {
        continue;
      }

      if (variable.resolvedType !== "COLOR") {
        skippedNonColorCount += 1;
        continue;
      }

      const universalColor = resolveColorValue(
        variable,
        universalMode.modeId,
        universalMode.name,
        variablesById,
        collectionsById,
        new Set()
      );

      if (!universalColor) {
        skippedUnsupportedCount += 1;
        continue;
      }

      let darkColor = null;
      if (darkMode) {
        darkColor = resolveColorValue(
          variable,
          darkMode.modeId,
          darkMode.name,
          variablesById,
          collectionsById,
          new Set()
        );
      }

      const assetName = sanitizeAssetName(collection.name, variable.name);
      const filePath = `${assetCatalogName}/${assetName}.colorset/Contents.json`;
      const contents = JSON.stringify(buildColorSetContents(universalColor, darkColor), null, 2);
      addUniqueFile(files, seenPaths, filePath, contents);
      exportedCount += 1;
    }
  }

  if (exportedCount === 0) {
    throw new Error("No color variables could be exported for Xcode from the selected collections.");
  }

  return {
    archiveName: `${sanitizeBaseName(figma.root.name)}.xcassets.zip`,
    assetCatalogName,
    files,
    summary: makeExportSummary(
      selectedCollections,
      exportedCount,
      skippedNonColorCount,
      skippedUnsupportedCount
    )
  };
}

async function uploadVariables(appId, zipBytes) {
  if (!APP_IDS.has(appId)) {
    throw new Error("Select a valid product before exporting.");
  }

  const bytes = zipBytes instanceof Uint8Array ? zipBytes : new Uint8Array(zipBytes);
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new Error(`File too large. Maximum upload size is ${MAX_UPLOAD_BYTES} bytes.`);
  }

  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "application/zip" }), `${appId}.zip`);

  const response = await fetch(`${BASE_URL}/api/${appId}-variables/plugin-upload`, {
    method: "POST",
    headers: {
      Authorization: `service-accounts API-Key ${DEFAULT_API_KEY}`
    },
    body: form
  });

  let data = {};
  try {
    data = await response.json();
  } catch (error) {
    data = { error: "Upload failed" };
  }

  if (!response.ok) {
    throw new Error(`Upload failed (${response.status}): ${data.error || "Unknown error"}`);
  }

  return data;
}

figma.ui.onmessage = async (message) => {
  if (!message || typeof message !== "object") {
    return;
  }

  if (message.type === "export") {
    try {
      const payload = await buildXcodeAssetExport(message.collectionIds || []);
      figma.ui.postMessage({
        type: "export-ready",
        payload
      });
    } catch (error) {
      figma.ui.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : "Export failed."
      });
    }
    return;
  }

  if (message.type === "upload-variables") {
    try {
      await figma.clientStorage.setAsync(SETTINGS_KEY, {
        appId: message.appId
      });

      const result = await uploadVariables(message.appId, message.zipBytes);
      figma.ui.postMessage({
        type: "upload-ready",
        result,
        summary: message.summary || null
      });
    } catch (error) {
      figma.ui.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : "Upload failed."
      });
    }
    return;
  }

  if (message.type === "close") {
    figma.closePlugin();
  }
};

sendCollectionsToUI();
