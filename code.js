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
const TARGET_IDS = new Set(["main", "extension", "watchosapp"]);
const TARGET_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;

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

function concatUint8Arrays(chunks) {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }

  return output;
}

function createCrc32Table() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      if ((value & 1) === 1) {
        value = 0xedb88320 ^ (value >>> 1);
      } else {
        value >>>= 1;
      }
    }
    table[i] = value >>> 0;
  }
  return table;
}

const crc32Table = createCrc32Table();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = crc32Table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint16(view, offset, value) {
  view.setUint16(offset, value, true);
}

function writeUint32(view, offset, value) {
  view.setUint32(offset, value, true);
}

function getDosDateTime(date) {
  const safeDate = new Date(date);
  const year = Math.max(1980, safeDate.getFullYear());
  const dosTime =
    ((safeDate.getHours() & 0x1f) << 11) |
    ((safeDate.getMinutes() & 0x3f) << 5) |
    Math.floor(safeDate.getSeconds() / 2);
  const dosDate =
    (((year - 1980) & 0x7f) << 9) |
    (((safeDate.getMonth() + 1) & 0x0f) << 5) |
    (safeDate.getDate() & 0x1f);
  return { dosDate, dosTime };
}

function stringToBytes(value) {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    bytes[index] = value.charCodeAt(index) & 0xff;
  }
  return bytes;
}

function buildZipBytes(files) {
  const now = new Date();
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  for (const file of files) {
    const fileNameBytes = stringToBytes(file.path);
    const contentBytes = stringToBytes(file.content);
    const checksum = crc32(contentBytes);
    const { dosDate, dosTime } = getDosDateTime(now);

    const localHeader = new Uint8Array(30 + fileNameBytes.length);
    const localView = new DataView(localHeader.buffer);
    writeUint32(localView, 0, 0x04034b50);
    writeUint16(localView, 4, 20);
    writeUint16(localView, 6, 0);
    writeUint16(localView, 8, 0);
    writeUint16(localView, 10, dosTime);
    writeUint16(localView, 12, dosDate);
    writeUint32(localView, 14, checksum);
    writeUint32(localView, 18, contentBytes.length);
    writeUint32(localView, 22, contentBytes.length);
    writeUint16(localView, 26, fileNameBytes.length);
    writeUint16(localView, 28, 0);
    localHeader.set(fileNameBytes, 30);
    localParts.push(localHeader, contentBytes);

    const centralHeader = new Uint8Array(46 + fileNameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    writeUint32(centralView, 0, 0x02014b50);
    writeUint16(centralView, 4, 20);
    writeUint16(centralView, 6, 20);
    writeUint16(centralView, 8, 0);
    writeUint16(centralView, 10, 0);
    writeUint16(centralView, 12, dosTime);
    writeUint16(centralView, 14, dosDate);
    writeUint32(centralView, 16, checksum);
    writeUint32(centralView, 20, contentBytes.length);
    writeUint32(centralView, 24, contentBytes.length);
    writeUint16(centralView, 28, fileNameBytes.length);
    writeUint16(centralView, 30, 0);
    writeUint16(centralView, 32, 0);
    writeUint16(centralView, 34, 0);
    writeUint16(centralView, 36, 0);
    writeUint32(centralView, 38, 0);
    writeUint32(centralView, 42, localOffset);
    centralHeader.set(fileNameBytes, 46);
    centralParts.push(centralHeader);

    localOffset += localHeader.length + contentBytes.length;
  }

  const centralDirectory = concatUint8Arrays(centralParts);
  const localDirectory = concatUint8Arrays(localParts);
  const endOfCentralDirectory = new Uint8Array(22);
  const endView = new DataView(endOfCentralDirectory.buffer);
  writeUint32(endView, 0, 0x06054b50);
  writeUint16(endView, 4, 0);
  writeUint16(endView, 6, 0);
  writeUint16(endView, 8, files.length);
  writeUint16(endView, 10, files.length);
  writeUint32(endView, 12, centralDirectory.length);
  writeUint32(endView, 16, localDirectory.length);
  writeUint16(endView, 20, 0);

  return concatUint8Arrays([localDirectory, centralDirectory, endOfCentralDirectory]);
}

function buildMultipartBody(fileName, bytes, boundary) {
  const header = stringToBytes(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
      `Content-Type: application/zip\r\n\r\n`
  );
  const footer = stringToBytes(`\r\n--${boundary}--\r\n`);
  return concatUint8Arrays([header, bytes, footer]);
}

async function sendCollectionsToUI() {
  try {
    const collections = await getCollectionsSummary();

    figma.ui.postMessage({
      type: "collections-loaded",
      fileName: figma.root.name || "Untitled",
      suggestedFileName: `${sanitizeBaseName(figma.root.name)}.xcassets.zip`,
      collections
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

function normalizeTarget(target) {
  const normalized = String(target || "").trim().toLowerCase();
  if (!TARGET_IDS.has(normalized) || !TARGET_RE.test(normalized) || /^\d+$/.test(normalized)) {
    throw new Error("Select a valid target before exporting.");
  }
  return normalized;
}

async function uploadVariables(appId, target, zipBytes) {
  if (!APP_IDS.has(appId)) {
    throw new Error("Select a valid product before exporting.");
  }

  const normalizedTarget = normalizeTarget(target);

  const bytes = zipBytes instanceof Uint8Array ? zipBytes : new Uint8Array(zipBytes);
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new Error(`File too large. Maximum upload size is ${MAX_UPLOAD_BYTES} bytes.`);
  }

  const boundary = `----varix-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
  const body = buildMultipartBody(`${appId}.zip`, bytes, boundary);

  const uploadUrl =
    `${BASE_URL}/api/${appId}-variables/plugin-upload` +
    `?target=${encodeURIComponent(normalizedTarget)}`;
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `service-accounts API-Key ${DEFAULT_API_KEY}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`
    },
    body
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
      if (!APP_IDS.has(message.appId)) {
        throw new Error("Select a valid product before exporting.");
      }
      const target = normalizeTarget(message.target);
      const payload = await buildXcodeAssetExport(message.collectionIds || []);

      const zipBytes = buildZipBytes(payload.files);
      const result = await uploadVariables(message.appId, target, zipBytes);
      figma.ui.postMessage({
        type: "upload-ready",
        result,
        summary: payload.summary
      });
    } catch (error) {
      figma.ui.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : "Export failed."
      });
    }
    return;
  }

  if (message.type === "close") {
    figma.closePlugin();
  }
};

sendCollectionsToUI();
