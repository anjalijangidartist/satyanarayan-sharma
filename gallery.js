const BATCH = 20;
const ROOT_MARGIN = 1600;

const gallery = document.getElementById("gallery");
const sentinel = document.getElementById("sentinel");
const endCap = document.getElementById("end-cap");
const workCount = document.getElementById("work-count");
const viewerEl = document.getElementById("viewer");
const viewerImg = document.getElementById("viewer-img");
const viewerFrame = document.getElementById("viewer-frame");
const viewerCount = document.getElementById("viewer-count");
const viewerCaption = document.getElementById("viewer-caption");

const state = {
  works: [],
  rendered: 0,
  columns: [],
  heights: [],
  columnsCount: 0,
};

function columnTarget() {
  const width = window.innerWidth;
  if (width < 640) return 1;
  if (width < 1024) return 2;
  if (width < 1440) return 3;
  return 4;
}

function setupColumns(count) {
  gallery.replaceChildren();
  gallery.style.setProperty("--cols", count);
  state.columns = [];
  state.heights = [];
  for (let i = 0; i < count; i += 1) {
    const column = document.createElement("div");
    column.className = "gallery-col";
    gallery.append(column);
    state.columns.push(column);
    state.heights.push(0);
  }
  state.columnsCount = count;
}

function shortestColumn() {
  let target = 0;
  for (let i = 1; i < state.heights.length; i += 1) {
    if (state.heights[i] < state.heights[target]) target = i;
  }
  return target;
}

function createCard(work, index) {
  const figure = document.createElement("figure");
  figure.className = "work";
  const width = Number(work.width) || 4;
  const height = Number(work.height) || 5;

  const button = document.createElement("button");
  button.className = "work-open";
  button.type = "button";
  button.setAttribute("aria-label", `Open ${work.title}`);
  button.setAttribute("aria-haspopup", "dialog");
  button.style.aspectRatio = `${width} / ${height}`;
  if (work.color) button.style.setProperty("--work-color", work.color);

  const img = document.createElement("img");
  img.src = work.thumb || work.src;
  img.alt = work.alt || work.title;
  img.width = width;
  img.height = height;
  img.loading = "lazy";
  img.decoding = "async";
  img.draggable = false;

  const reveal = () => img.classList.add("is-loaded");
  img.addEventListener("load", reveal, { once: true });
  img.addEventListener("error", reveal, { once: true });
  if (img.complete) reveal();

  const caption = document.createElement("figcaption");
  const number = document.createElement("span");
  number.className = "work-index";
  number.textContent = String(index + 1).padStart(2, "0");
  number.setAttribute("aria-hidden", "true");
  const title = document.createElement("span");
  title.className = "work-title";
  title.textContent = work.title;
  caption.append(number, title);

  button.append(img);
  button.addEventListener("click", () => openViewer(index));
  figure.append(button, caption);
  return figure;
}

function addWork(work, index) {
  const columnIndex = shortestColumn();
  state.columns[columnIndex].append(createCard(work, index));
  const width = Number(work.width) || 4;
  const height = Number(work.height) || 5;
  state.heights[columnIndex] += height / width + 0.17;
}

function renderBatch() {
  const end = Math.min(state.rendered + BATCH, state.works.length);
  while (state.rendered < end) {
    addWork(state.works[state.rendered], state.rendered);
    state.rendered += 1;
  }
  if (state.rendered >= state.works.length) finish();
}

function finish() {
  sentinel.hidden = true;
  endCap.hidden = false;
  endCap.textContent = `All ${state.works.length} works`;
  observer.disconnect();
}

function loadMore() {
  if (state.rendered >= state.works.length) {
    finish();
    return;
  }
  renderBatch();
  requestAnimationFrame(() => {
    if (state.rendered >= state.works.length) return;
    const box = sentinel.getBoundingClientRect();
    if (box.top < window.innerHeight + ROOT_MARGIN) loadMore();
  });
}

const observer = new IntersectionObserver(
  (entries) => {
    if (entries.some((entry) => entry.isIntersecting)) loadMore();
  },
  { rootMargin: `${ROOT_MARGIN}px 0px` },
);

function rebuild() {
  const target = columnTarget();
  if (target === state.columnsCount) return;
  const painted = state.rendered;
  setupColumns(target);
  for (let i = 0; i < painted; i += 1) addWork(state.works[i], i);
}

function handleResize() {
  if (state.works.length === 0) return;
  rebuild();
}

function showMessage(message, isError) {
  const note = document.createElement("p");
  note.className = "notice";
  if (isError) note.setAttribute("role", "alert");
  note.textContent = message;
  gallery.replaceChildren(note);
  sentinel.hidden = true;
}

async function loadWorks() {
  try {
    const response = await fetch("api/works", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    const fallback = await fetch("works.json");
    if (!fallback.ok) throw error;
    return await fallback.json();
  }
}

async function start() {
  document.getElementById("year").textContent = String(new Date().getFullYear());
  setupColumns(columnTarget());

  try {
    state.works = await loadWorks();
  } catch (error) {
    console.error(error);
    showMessage("The collection could not load. Check your connection and refresh the page.", true);
    return;
  }

  if (!Array.isArray(state.works)) {
    showMessage("The collection could not load. Check your connection and refresh the page.", true);
    return;
  }

  if (state.works.length === 0) {
    showMessage("No works yet. Add images to the assets/work folder and refresh this page.", false);
    return;
  }

  workCount.textContent = `${state.works.length} works`;
  setupColumns(columnTarget());
  renderBatch();
  refreshViewerWorks();
  if (state.rendered < state.works.length) observer.observe(sentinel);
}

/* Viewer */

let viewerIndex = 0;
let requestToken = 0;
let pointerStart = null;

function preload(index) {
  const total = state.works.length;
  if (total < 2) return;
  for (const step of [1, -1]) {
    const work = state.works[(index + step + total) % total];
    const image = new Image();
    image.src = work.full || work.src;
  }
}

function paintViewer() {
  const total = state.works.length;
  const work = state.works[viewerIndex];
  if (!work) return;

  const token = (requestToken += 1);
  viewerCount.textContent = `${viewerIndex + 1} / ${total}`;
  viewerCaption.textContent = work.title;

  const done = () => {
    if (token !== requestToken) return;
    viewerImg.classList.add("is-loaded");
    viewerFrame.classList.add("is-loaded");
  };

  viewerFrame.classList.remove("is-loaded");
  viewerImg.classList.remove("is-loaded");
  viewerImg.alt = work.alt || work.title;
  viewerImg.onload = done;
  viewerImg.onerror = done;
  viewerImg.src = work.full || work.src;
  if (viewerImg.complete) done();

  preload(viewerIndex);
}

function openViewer(index) {
  viewerIndex = index;
  paintViewer();
  if (!viewerEl.open) {
    viewerEl.showModal();
    document.body.classList.add("is-locked");
  }
}

function stepViewer(delta) {
  const total = state.works.length;
  if (total === 0) return;
  viewerIndex = (viewerIndex + delta + total) % total;
  paintViewer();
}

function closeViewer() {
  if (viewerEl.open) viewerEl.close();
}

function refreshViewerWorks() {
  if (viewerEl.open && state.works.length > 0) {
    paintViewer();
  }
}

viewerEl.addEventListener("close", () => {
  document.body.classList.remove("is-locked");
  viewerImg.removeAttribute("src");
  viewerImg.classList.remove("is-loaded");
  viewerFrame.classList.remove("is-loaded");
  requestToken += 1;
});

viewerEl.addEventListener("click", (event) => {
  if (event.target.closest(".viewer-frame img, .viewer-nav, .viewer-close, .viewer-caption")) return;
  closeViewer();
});

viewerEl.addEventListener("keydown", (event) => {
  if (event.key === "ArrowRight") {
    event.preventDefault();
    stepViewer(1);
  } else if (event.key === "ArrowLeft") {
    event.preventDefault();
    stepViewer(-1);
  } else if (event.key === "Home") {
    event.preventDefault();
    viewerIndex = 0;
    paintViewer();
  } else if (event.key === "End") {
    event.preventDefault();
    viewerIndex = state.works.length - 1;
    paintViewer();
  }
});

viewerEl.addEventListener("pointerdown", (event) => {
  if (event.pointerType === "mouse") return;
  pointerStart = { x: event.clientX, y: event.clientY };
});

viewerEl.addEventListener("pointerup", (event) => {
  if (!pointerStart || event.pointerType === "mouse") return;
  const dx = event.clientX - pointerStart.x;
  const dy = event.clientY - pointerStart.y;
  pointerStart = null;
  if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy)) return;
  stepViewer(dx < 0 ? 1 : -1);
});

document.getElementById("viewer-prev").addEventListener("click", () => stepViewer(-1));
document.getElementById("viewer-next").addEventListener("click", () => stepViewer(1));
document.getElementById("viewer-close").addEventListener("click", closeViewer);

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const coarsePointer = window.matchMedia("(pointer: coarse)");

for (const link of document.querySelectorAll('a[href^="#"]')) {
  link.addEventListener("click", (event) => {
    const id = link.getAttribute("href").slice(1);
    const target = document.getElementById(id);
    if (!target) return;

    event.preventDefault();
    const behavior = reduceMotion.matches || coarsePointer.matches ? "auto" : "smooth";
    if (id === "top") {
      window.scrollTo({ top: 0, behavior });
    } else {
      target.scrollIntoView({ behavior, block: "start" });
    }
    history.replaceState(null, "", `#${id}`);
  });
}

let resizeTimer = 0;
window.addEventListener("resize", () => {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(handleResize, 180);
});

start();
