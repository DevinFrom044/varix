const state = {
  fileName: "Untitled",
  suggestedFileName: "figma-file.xcassets.zip",
  collections: [],
  pendingSaveHandle: null
};

const textEncoder = new TextEncoder();
const statusEl = document.getElementById("status");
const fileNameEl = document.getElementById("file-name");
const collectionsEl = document.getElementById("collections");
const exportBtn = document.getElementById("export-btn");
const selectAllBtn = document.getElementById("select-all-btn");
const clearAllBtn = document.getElementById("clear-all-btn");
const closeBtn = document.getElementById("close-btn");

function showStatus(message, tone) {
  statusEl.textContent = message;
  statusEl.className = `status ${tone}`;
}

function clearStatus() {
  statusEl.textContent = "";
  statusEl.className = "status";
}

function getSelectedCollectionIds() {
  return Array.from(
    collectionsEl.querySelectorAll('input[type="checkbox"][data-collection-id]:checked')
  ).map((input) => input.getAttribute("data-collection-id"));
}

function updateExportState() {
  exportBtn.disabled = getSelectedCollectionIds().length === 0 || state.collections.length === 0;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function createCollectionItem(collection) {
  const label = document.createElement("label");
  label.className = "collection";

  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = true;
  input.setAttribute("data-collection-id", collection.id);
  input.addEventListener("change", updateExportState);

  const info = document.createElement("div");
  const modes = collection.modes.map((mode) => mode.name).join(", ");
  info.innerHTML = `
    <div class="collection-title">${escapeHtml(collection.name)}</div>
    <div class="collection-meta">${collection.variableCount} variables</div>
    <div class="collection-meta">Modes: ${escapeHtml(modes || "None")}</div>
  `;

  label.appendChild(input);
  label.appendChild(info);
  return label;
}

function renderCollections() {
  collectionsEl.innerHTML = "";

  if (state.collections.length === 0) {
    collectionsEl.innerHTML =
      '<div class="empty">No local variable collections were found in this file.</div>';
    updateExportState();
    return;
  }

  for (const collection of state.collections) {
    collectionsEl.appendChild(createCollectionItem(collection));
  }

  updateExportState();
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

async function pickSaveHandle(suggestedFileName) {
  if (typeof window.showSaveFilePicker !== "function") {
    return null;
  }

  return window.showSaveFilePicker({
    suggestedName: suggestedFileName,
    excludeAcceptAllOption: false,
    types: [
      {
        description: "ZIP archive",
        accept: {
          "application/zip": [".zip"]
        }
      }
    ]
  });
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

function buildZip(files) {
  const now = new Date();
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  for (const file of files) {
    const fileNameBytes = textEncoder.encode(file.path);
    const contentBytes = textEncoder.encode(file.content);
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

  return new Blob([localDirectory, centralDirectory, endOfCentralDirectory], {
    type: "application/zip"
  });
}

async function saveZip(blob, suggestedFileName) {
  if (state.pendingSaveHandle) {
    const writable = await state.pendingSaveHandle.createWritable();
    await writable.write(blob);
    await writable.close();
    state.pendingSaveHandle = null;
    return "saved";
  }

  downloadBlob(blob, suggestedFileName);
  return "downloaded";
}

async function handleExportClick() {
  const collectionIds = getSelectedCollectionIds();
  if (collectionIds.length === 0) {
    showStatus("Select at least one collection before exporting.", "error");
    return;
  }

  clearStatus();
  exportBtn.disabled = true;
  selectAllBtn.disabled = true;
  clearAllBtn.disabled = true;

  try {
    state.pendingSaveHandle = await pickSaveHandle(state.suggestedFileName);
  } catch (error) {
    if (error && error.name === "AbortError") {
      state.pendingSaveHandle = null;
      updateExportState();
      selectAllBtn.disabled = false;
      clearAllBtn.disabled = false;
      return;
    }

    state.pendingSaveHandle = null;
    showStatus(
      "Native save dialog was not available, so the plugin will download a ZIP archive instead.",
      "info"
    );
  }

  if (state.pendingSaveHandle) {
    showStatus("Building Xcode asset catalog and writing the ZIP archive…", "info");
  } else {
    showStatus("Building Xcode asset catalog. A ZIP download will start when ready.", "info");
  }

  parent.postMessage(
    {
      pluginMessage: {
        type: "export",
        collectionIds
      }
    },
    "*"
  );
}

window.onmessage = async (event) => {
  const message = event.data.pluginMessage;
  if (!message) {
    return;
  }

  if (message.type === "collections-loaded") {
    state.fileName = message.fileName || "Untitled";
    state.suggestedFileName = message.suggestedFileName || "figma-file.xcassets.zip";
    state.collections = Array.isArray(message.collections) ? message.collections : [];
    fileNameEl.textContent = `Figma file: ${state.fileName}`;
    clearStatus();
    renderCollections();
    return;
  }

  if (message.type === "export-ready") {
    try {
      const zipBlob = buildZip(message.payload.files || []);
      const result = await saveZip(zipBlob, message.payload.archiveName || state.suggestedFileName);
      const summary = message.payload.summary || {};
      const skippedText =
        summary.skippedNonColorVariables || summary.skippedUnsupportedColorVariables
          ? ` Exported ${summary.exportedColorTokens || 0} color assets, skipped ${summary.skippedNonColorVariables || 0} non-color variables and ${summary.skippedUnsupportedColorVariables || 0} unsupported color variables.`
          : ` Exported ${summary.exportedColorTokens || 0} color assets.`;

      if (result === "saved") {
        showStatus(`Xcode asset catalog ZIP saved successfully.${skippedText}`, "success");
      } else {
        showStatus(`Xcode asset catalog ZIP downloaded successfully.${skippedText}`, "success");
      }
    } catch (error) {
      showStatus(
        error instanceof Error ? error.message : "The ZIP archive could not be created.",
        "error"
      );
    } finally {
      state.pendingSaveHandle = null;
      selectAllBtn.disabled = false;
      clearAllBtn.disabled = false;
      updateExportState();
    }
    return;
  }

  if (message.type === "error") {
    state.pendingSaveHandle = null;
    showStatus(message.message || "Export failed.", "error");
    selectAllBtn.disabled = false;
    clearAllBtn.disabled = false;
    updateExportState();
  }
};

selectAllBtn.addEventListener("click", () => {
  for (const input of collectionsEl.querySelectorAll('input[type="checkbox"][data-collection-id]')) {
    input.checked = true;
  }
  clearStatus();
  updateExportState();
});

clearAllBtn.addEventListener("click", () => {
  for (const input of collectionsEl.querySelectorAll('input[type="checkbox"][data-collection-id]')) {
    input.checked = false;
  }
  clearStatus();
  updateExportState();
});

exportBtn.addEventListener("click", handleExportClick);

closeBtn.addEventListener("click", () => {
  parent.postMessage({ pluginMessage: { type: "close" } }, "*");
});
