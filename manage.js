"use strict";

const MAX_FILES = 100;
const MAX_SEND_BYTES = 4 * 1000 * 1000;
const COMPRESS_TARGET = 3_800_000;
const EXT_MIME = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

const loginView = document.getElementById("login-view");
const dashboardView = document.getElementById("dashboard-view");
const loginForm = document.getElementById("login-form");
const passwordInput = document.getElementById("password");
const loginError = document.getElementById("login-error");
const loginSubmit = document.getElementById("login-submit");
const logoutButton = document.getElementById("logout");
const dropzone = document.getElementById("dropzone");
const dropzoneHint = document.getElementById("dropzone-hint");
const fileInput = document.getElementById("file-input");
const selection = document.getElementById("selection");
const selectionCount = document.getElementById("selection-count");
const previewGrid = document.getElementById("preview-grid");
const progressWrap = document.getElementById("progress-wrap");
const progressLabel = document.getElementById("progress-label");
const progressCount = document.getElementById("progress-count");
const progressBar = document.getElementById("progress-bar");
const summary = document.getElementById("summary");
const uploadForm = document.getElementById("upload-form");
const uploadButton = document.getElementById("upload-button");
const retryButton = document.getElementById("retry-button");
const clearButton = document.getElementById("clear");

const state = {
  items: [],
  reserved: new Set(),
  active: false,
  sequence: 0,
  maxFiles: MAX_FILES,
  maxFileBytes: MAX_SEND_BYTES,
};

class AuthError extends Error {}

function extension(name) {
  const index = String(name).lastIndexOf(".");
  return index < 0 ? "" : String(name).slice(index).toLowerCase();
}

function replaceExtension(name, newExtension) {
  const ext = extension(name);
  return `${name.slice(0, name.length - ext.length)}${newExtension}`;
}

function mimeForFile(file) {
  return EXT_MIME[extension(file.name)] || String(file.type || "").toLowerCase();
}

async function api(path, options) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  return { ok: response.ok, status: response.status, data };
}

function showLogin(message) {
  loginView.hidden = false;
  dashboardView.hidden = true;
  logoutButton.hidden = true;
  if (message) {
    loginError.textContent = message;
    loginError.hidden = false;
  }
}

function showDashboard() {
  loginView.hidden = true;
  dashboardView.hidden = false;
  logoutButton.hidden = false;
  loginError.hidden = true;
  passwordInput.value = "";
  applyLimits();
  render();
}

function applyLimits() {
  state.maxFiles = Math.min(MAX_FILES, Number(state.maxFiles) || MAX_FILES);
  state.maxFileBytes = Math.min(MAX_SEND_BYTES, Number(state.maxFileBytes) || MAX_SEND_BYTES);
  dropzoneHint.textContent = `JPEG, PNG or WebP. Up to ${state.maxFiles} photos.`;
}

function showSummary(message, kind) {
  summary.textContent = message;
  summary.classList.toggle("is-error", kind === "error");
  summary.classList.toggle("is-success", kind === "success");
  summary.hidden = false;
}

function hideSummary() {
  summary.hidden = true;
  summary.textContent = "";
  summary.classList.remove("is-error", "is-success");
}

function showProgress(label, count, percent) {
  progressWrap.hidden = false;
  progressLabel.textContent = label;
  progressCount.textContent = count || "";
  progressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
}

function hideProgress() {
  progressWrap.hidden = true;
  progressBar.style.width = "0%";
}

function statusLabel(item) {
  switch (item.status) {
    case "preparing": return "Preparing";
    case "uploading": return "Uploading";
    case "uploaded": return "Uploaded";
    case "done": return "Added";
    case "failed": return "Failed";
    default: return "Ready";
  }
}

function statusClass(item) {
  if (item.status === "preparing" || item.status === "uploading") return "is-uploading";
  if (item.status === "uploaded") return "is-uploaded";
  if (item.status === "done") return "is-uploaded";
  if (item.status === "failed") return "is-failed";
  return "";
}

function makePreviewItem(item) {
  const li = document.createElement("li");
  li.className = "preview-item";

  const thumb = document.createElement("span");
  thumb.className = "preview-thumb";
  const image = document.createElement("img");
  image.src = item.previewUrl;
  image.alt = "";
  image.loading = "lazy";
  thumb.append(image);

  const meta = document.createElement("div");
  meta.className = "preview-meta";
  const name = document.createElement("span");
  name.className = "preview-name";
  name.textContent = item.displayName;
  name.title = item.displayName;
  const status = document.createElement("span");
  status.className = `preview-status ${statusClass(item)}`.trim();
  status.textContent = statusLabel(item);
  if (item.message) status.title = item.message;
  meta.append(name, status);

  const remove = document.createElement("button");
  remove.className = "preview-remove";
  remove.type = "button";
  remove.textContent = "×";
  remove.setAttribute("aria-label", `Remove ${item.displayName}`);
  remove.hidden = !(item.status === "ready" || item.status === "failed");
  remove.addEventListener("click", () => removeItem(item.id));

  li.append(thumb, meta, remove);
  return li;
}

function render() {
  selection.hidden = state.items.length === 0;
  selectionCount.textContent = state.items.length ? String(state.items.length) : "";

  previewGrid.replaceChildren(...state.items.map(makePreviewItem));

  const readyCount = state.items.filter((item) => item.status === "ready" || item.status === "failed").length;
  const canRetry = state.items.some((item) => item.status === "failed" || item.status === "uploaded");

  uploadButton.disabled = state.active || readyCount === 0;
  uploadButton.textContent = state.active
    ? "Working…"
    : readyCount > 0
      ? `Upload ${readyCount} photo${readyCount === 1 ? "" : "s"}`
      : "Upload photos";

  retryButton.hidden = state.active || !canRetry;
  retryButton.disabled = state.active;
  retryButton.textContent = state.items.some((item) => item.status === "failed")
    ? "Retry failed"
    : "Try saving again";

  clearButton.disabled = state.active;
  logoutButton.disabled = state.active;
}

function sanitizeBaseName(name) {
  const ext = extension(name);
  const stem = String(name)
    .slice(0, name.length - ext.length)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 80)
    .replace(/-+$/g, "");
  const normalizedExt = ext === ".jpeg" ? ".jpg" : ext;
  return `${stem || "artwork"}${normalizedExt}`;
}

function suffixName(filename, number) {
  const ext = extension(filename);
  return `${filename.slice(0, filename.length - ext.length)}-${number}${ext}`;
}

function takeName(base) {
  let candidate = base;
  let number = 2;
  while (state.reserved.has(candidate.toLowerCase())) {
    candidate = suffixName(base, number);
    number += 1;
  }
  state.reserved.add(candidate.toLowerCase());
  return candidate;
}

function releaseName(name) {
  if (name) state.reserved.delete(name.toLowerCase());
}

function addFiles(fileList) {
  if (state.active) return;
  const files = Array.from(fileList || []);
  let rejectedType = 0;
  let rejectedCount = 0;

  for (const file of files) {
    if (state.items.length >= state.maxFiles) {
      rejectedCount += 1;
      continue;
    }
    if (!EXT_MIME[extension(file.name)]) {
      rejectedType += 1;
      continue;
    }
    state.sequence += 1;
    const previewUrl = URL.createObjectURL(file);
    state.items.push({
      id: state.sequence,
      file,
      displayName: file.name,
      previewUrl,
      status: "ready",
      message: "",
      uploaded: null,
    });
  }

  hideSummary();
  hideProgress();
  render();

  const notes = [];
  if (rejectedType > 0) notes.push(`${rejectedType} file${rejectedType === 1 ? " was" : "s were"} skipped. Use JPEG, PNG or WebP.`);
  if (rejectedCount > 0) notes.push(`Only ${state.maxFiles} photos can be added at a time.`);
  if (notes.length > 0) showSummary(notes.join(" "), "error");
}

function removeItem(id) {
  if (state.active) return;
  const index = state.items.findIndex((item) => item.id === id);
  if (index < 0) return;
  const item = state.items[index];
  if (!(item.status === "ready" || item.status === "failed")) return;
  URL.revokeObjectURL(item.previewUrl);
  if (item.uploaded) releaseName(item.uploaded.path.split("/").pop());
  state.items.splice(index, 1);
  hideSummary();
  render();
}

function clearAll() {
  if (state.active) return;
  for (const item of state.items) URL.revokeObjectURL(item.previewUrl);
  state.items = [];
  state.reserved.clear();
  hideSummary();
  hideProgress();
  render();
}

function loadImageSource(file) {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(file).catch(() => loadImageElement(file));
  }
  return loadImageElement(file);
}

function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("This photo could not be read."));
    };
    image.src = url;
  });
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

async function compressImage(file) {
  const source = await loadImageSource(file);
  const sourceWidth = source.width || source.naturalWidth;
  const sourceHeight = source.height || source.naturalHeight;
  if (!sourceWidth || !sourceHeight) throw new Error("This photo could not be read.");

  const originalMime = mimeForFile(file);
  let outputType = originalMime === "image/jpeg" ? "image/jpeg" : "image/webp";
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This photo could not be prepared.");

  let best = null;
  for (const maxDimension of [2600, 2000, 1600, 1200]) {
    const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    canvas.width = width;
    canvas.height = height;
    context.clearRect(0, 0, width, height);
    if (outputType === "image/jpeg") {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
    }
    context.drawImage(source, 0, 0, width, height);

    for (const quality of [0.92, 0.86, 0.8, 0.72, 0.64]) {
      const blob = await canvasBlob(canvas, outputType, quality);
      if (blob && (!best || blob.size < best.size)) best = blob;
      if (blob && blob.size <= COMPRESS_TARGET) {
        best = blob;
        break;
      }
    }
    if (best && best.size <= COMPRESS_TARGET) break;
  }

  if (source.close) source.close();

  if (!best || best.size > MAX_SEND_BYTES) {
    throw new Error("This photo is too large. Please use a smaller file.");
  }

  const finalType = best.type || outputType;
  const newExtension = finalType === "image/png" ? ".png" : finalType === "image/webp" ? ".webp" : ".jpg";
  return {
    blob: best,
    name: replaceExtension(file.name, newExtension),
    mime: finalType,
  };
}

async function prepareUpload(item) {
  if (item.file.size <= MAX_SEND_BYTES) {
    return {
      blob: item.file,
      name: item.file.name,
      mime: mimeForFile(item.file),
    };
  }
  return compressImage(item.file);
}

async function uploadItem(item, prepared) {
  const base = sanitizeBaseName(prepared.name);
  let candidate = takeName(base);

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await fetch(`/api/portal/upload?name=${encodeURIComponent(candidate)}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/octet-stream" },
      body: prepared.blob,
    });

    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }

    if (response.status === 401) throw new AuthError("Session expired.");
    if (response.status === 409) {
      releaseName(candidate);
      candidate = takeName(base);
      continue;
    }
    if (!response.ok) {
      releaseName(candidate);
      throw new Error(data && data.error ? data.error : "This photo could not be uploaded. Please try again.");
    }

    let finalName = data && data.path ? data.path.split("/").pop() : candidate;
    const finalKey = finalName.toLowerCase();
    if (finalKey !== candidate.toLowerCase()) {
      releaseName(candidate);
      if (state.reserved.has(finalKey)) {
        finalName = takeName(finalName);
        const directory = data.path.slice(0, data.path.lastIndexOf("/") + 1);
        data.path = `${directory}${finalName}`;
      } else {
        state.reserved.add(finalKey);
      }
    }
    item.displayName = finalName;
    return data;
  }

  releaseName(candidate);
  throw new Error("This photo name is already in use. Rename the file and try again.");
}

async function commitUploads(uploaded) {
  const response = await api("/api/portal/commit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      files: uploaded.map((item) => ({
        path: item.uploaded.path,
        sha: item.uploaded.sha,
        width: item.uploaded.width,
        height: item.uploaded.height,
      })),
    }),
  });

  if (response.status === 401) throw new AuthError("Session expired.");
  if (!response.ok) {
    const error = new Error(
      response.data && response.data.error
        ? response.data.error
        : "The photos could not be saved. Please try again.",
    );
    error.conflicts = response.data && Array.isArray(response.data.conflicts)
      ? response.data.conflicts
      : [];
    throw error;
  }
  return response.data;
}

function describeFailures() {
  const failed = state.items.filter((item) => item.status === "failed");
  if (failed.length === 0) return "";
  const lines = failed.slice(0, 5).map((item) => `${item.displayName}: ${item.message || "Upload failed."}`);
  if (failed.length > 5) lines.push(`and ${failed.length - 5} more.`);
  return ` Not added: ${lines.join(" ")}`;
}

function finishForAuth() {
  state.active = false;
  for (const item of state.items) {
    if (item.status === "preparing" || item.status === "uploading") {
      item.status = "failed";
      item.message = "Please sign in again and retry.";
    }
  }
  showLogin("Your session expired. Sign in again to continue.");
  render();
}

async function handleUpload() {
  if (state.active) return;
  const queue = state.items.filter((item) => item.status === "ready" || item.status === "failed");
  const alreadyUploaded = state.items.filter((item) => item.status === "uploaded");
  if (queue.length === 0 && alreadyUploaded.length === 0) return;

  state.active = true;
  hideSummary();
  render();

  const total = queue.length;
  let done = 0;
  if (total > 0) showProgress("Preparing photos…", `0 / ${total}`, 0);

  for (const item of queue) {
    item.status = "preparing";
    item.message = "";
    render();

    try {
      const prepared = await prepareUpload(item);
      item.status = "uploading";
      render();
      const uploaded = await uploadItem(item, prepared);
      item.uploaded = uploaded;
      item.status = "uploaded";
    } catch (error) {
      if (error instanceof AuthError) {
        finishForAuth();
        return;
      }
      item.status = "failed";
      item.message = error && error.message ? error.message : "This photo could not be uploaded.";
    }

    done += 1;
    const percent = (done / total) * 100;
    showProgress(done < total ? "Uploading photos…" : "Saving photos…", `${done} / ${total}`, percent);
    render();
  }

  const uploaded = state.items.filter((item) => item.status === "uploaded");
  let added = 0;

  if (uploaded.length > 0) {
    showProgress("Saving photos…", total > 0 ? `${total} / ${total}` : "", 100);
    try {
      const result = await commitUploads(uploaded);
      added = result.count;
      for (const item of uploaded) {
        item.status = "done";
        item.message = "";
      }
      showProgress("Done", "", 100);
    } catch (error) {
      if (error instanceof AuthError) {
        finishForAuth();
        return;
      }
      if (Array.isArray(error.conflicts) && error.conflicts.length > 0) {
        const conflicts = new Set(error.conflicts.map((value) => String(value).toLowerCase()));
        for (const item of uploaded) {
          if (item.uploaded && conflicts.has(String(item.uploaded.path).toLowerCase())) {
            item.status = "failed";
            item.message = "This name is already in use. Retry to rename it automatically.";
          }
        }
      }
    }
  }

  state.active = false;

  const failedCount = state.items.filter((item) => item.status === "failed").length;
  const uploadedWaiting = state.items.filter((item) => item.status === "uploaded").length;

  if (added > 0) {
    const suffix = failedCount > 0
      ? ` ${failedCount} photo${failedCount === 1 ? "" : "s"} failed and can be retried below.`
      : "";
    showSummary(
      `${added} photo${added === 1 ? "" : "s"} added. The website will update in a few minutes.${suffix}${describeFailures()}`,
      failedCount > 0 ? "error" : "success",
    );
  } else if (uploadedWaiting > 0) {
    showSummary(
      "The photos were uploaded but could not be saved yet. Check your connection and press “Try saving again”.",
      "error",
    );
  } else if (failedCount > 0) {
    showSummary(`No photos were added.${describeFailures()}`, "error");
  }

  render();
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.hidden = true;
  loginSubmit.disabled = true;
  loginSubmit.textContent = "Signing in…";

  try {
    const response = await api("/api/portal/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: passwordInput.value }),
    });

    if (response.ok) {
      if (response.data) {
        state.maxFiles = response.data.maxBatchFiles || MAX_FILES;
        state.maxFileBytes = response.data.maxFileBytes || MAX_SEND_BYTES;
      }
      showDashboard();
    } else {
      loginError.textContent = response.data && response.data.error
        ? response.data.error
        : "Sign in failed. Please try again.";
      loginError.hidden = false;
      passwordInput.select();
    }
  } catch {
    loginError.textContent = "Could not connect. Check your internet and try again.";
    loginError.hidden = false;
  } finally {
    loginSubmit.disabled = false;
    loginSubmit.textContent = "Sign in";
  }
});

logoutButton.addEventListener("click", async () => {
  logoutButton.disabled = true;
  try {
    await api("/api/portal/logout", { method: "POST" });
  } catch {
    // Clearing the page state below is enough even if the request fails.
  }
  clearAll();
  showLogin("You have signed out.");
  logoutButton.disabled = false;
});

dropzone.addEventListener("click", () => {
  if (!state.active) fileInput.click();
});

dropzone.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    if (!state.active) fileInput.click();
  }
});

fileInput.addEventListener("change", () => {
  addFiles(fileInput.files);
  fileInput.value = "";
});

for (const type of ["dragenter", "dragover"]) {
  dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    dropzone.classList.add("is-dragging");
  });
}

for (const type of ["dragleave", "drop"]) {
  dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    dropzone.classList.remove("is-dragging");
  });
}

dropzone.addEventListener("drop", (event) => {
  if (event.dataTransfer && event.dataTransfer.files) addFiles(event.dataTransfer.files);
});

uploadForm.addEventListener("submit", (event) => {
  event.preventDefault();
  handleUpload();
});

retryButton.addEventListener("click", handleUpload);
clearButton.addEventListener("click", clearAll);

window.addEventListener("beforeunload", (event) => {
  if (state.active) {
    event.preventDefault();
    event.returnValue = "";
  }
});

async function init() {
  try {
    const response = await api("/api/portal/session");
    if (response.ok && response.data && response.data.authenticated) {
      state.maxFiles = response.data.maxBatchFiles || MAX_FILES;
      state.maxFileBytes = response.data.maxFileBytes || MAX_SEND_BYTES;
      showDashboard();
      return;
    }
    if (response.status === 503) {
      showLogin("This portal is not available right now.");
      return;
    }
    showLogin("");
  } catch {
    showLogin("Could not connect. Check your internet and try again.");
  }
}

init();
