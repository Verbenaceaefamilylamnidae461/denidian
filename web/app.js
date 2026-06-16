// denidian frontend - talks to the Deno JSON API, renders Markdown with
// [[wikilinks]], and draws a force-directed graph of note connections.

const $ = (sel) => document.querySelector(sel);

const els = {
  list: $("#note-list"),
  search: $("#search"),
  newNote: $("#new-note"),
  title: $("#title"),
  editor: $("#editor"),
  preview: $("#preview"),
  togglePreview: $("#toggle-preview"),
  deleteNote: $("#delete-note"),
  editorView: $("#editor-view"),
  graphView: $("#graph-view"),
  viewEditor: $("#view-editor"),
  viewGraph: $("#view-graph"),
  graph: $("#graph"),
  zoomIn: $("#zoom-in"),
  zoomOut: $("#zoom-out"),
  zoomReset: $("#zoom-reset"),
};

const state = {
  notes: [], // [{ name, links }]
  current: null, // active note name
  filter: "",
  preview: false,
  saveTimer: null,
};

// --------------------------------------------------------------------------
// API
// --------------------------------------------------------------------------
const api = {
  list: () => fetch("/api/notes").then((r) => r.json()),
  get: (name) =>
    fetch(`/api/notes/${encodeURIComponent(name)}`).then((r) =>
      r.ok ? r.json() : null
    ),
  put: (name, content) =>
    fetch(`/api/notes/${encodeURIComponent(name)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    }).then((r) => r.json()),
  del: (name) =>
    fetch(`/api/notes/${encodeURIComponent(name)}`, { method: "DELETE" }),
};

async function refreshNotes() {
  state.notes = await api.list();
  renderList();
}

// --------------------------------------------------------------------------
// Sidebar
// --------------------------------------------------------------------------
function renderList() {
  const filter = state.filter.toLowerCase();
  els.list.innerHTML = "";
  for (const note of state.notes) {
    if (filter && !note.name.toLowerCase().includes(filter)) continue;
    const item = document.createElement("div");
    item.className = "note-item" + (note.name === state.current ? " active" : "");
    item.textContent = note.name;
    item.onclick = () => openNote(note.name);
    els.list.appendChild(item);
  }
}

// --------------------------------------------------------------------------
// Open / edit / save notes
// --------------------------------------------------------------------------
async function openNote(name) {
  flushSave();
  const note = await api.get(name);
  state.current = name;
  els.title.value = name;
  els.editor.value = note ? note.content : "";
  renderList();
  if (state.preview) renderPreview();
  showEditor();
}

function scheduleSave() {
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(flushSave, 400);
}

async function flushSave() {
  clearTimeout(state.saveTimer);
  if (!state.current) return;
  const content = els.editor.value;
  await api.put(state.current, content);
  // Update cached links so the graph stays current.
  const entry = state.notes.find((n) => n.name === state.current);
  if (entry) entry.links = parseLinks(content);
}

async function createNote(name) {
  name = (name || "Untitled").trim();
  // ensure unique
  let final = name, i = 1;
  while (state.notes.some((n) => n.name === final)) final = `${name} ${++i}`;
  await api.put(final, `# ${final}\n\n`);
  await refreshNotes();
  await openNote(final);
  els.editor.focus();
}

async function renameCurrent(newName) {
  newName = newName.trim();
  const old = state.current;
  if (!old || !newName || newName === old) {
    els.title.value = old ?? "";
    return;
  }
  if (state.notes.some((n) => n.name === newName)) {
    els.title.value = old; // refuse duplicate name
    return;
  }
  const content = els.editor.value;
  await api.put(newName, content);
  await api.del(old);
  state.current = newName;
  await refreshNotes();
  renderList();
}

async function deleteCurrent() {
  if (!state.current) return;
  if (!confirm(`Delete "${state.current}"?`)) return;
  await api.del(state.current);
  state.current = null;
  els.title.value = "";
  els.editor.value = "";
  els.preview.innerHTML = "";
  await refreshNotes();
}

// --------------------------------------------------------------------------
// Markdown rendering (minimal) + wikilinks
// --------------------------------------------------------------------------
function parseLinks(content) {
  const out = new Set();
  for (const m of content.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)) {
    const t = m[1].trim();
    if (t) out.add(t);
  }
  return [...out];
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function inline(text) {
  let s = escapeHtml(text);
  // wikilinks: [[Target]] or [[Target|Label]]
  s = s.replace(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (_, target, label) => {
    const t = target.trim();
    const exists = state.notes.some((n) => n.name === t);
    const cls = "wikilink" + (exists ? "" : " missing");
    return `<a class="${cls}" data-link="${escapeHtml(t)}">${
      escapeHtml((label || t).trim())
    }</a>`;
  });
  // [text](url)
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
  // bold, italic, inline code
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  return s;
}

function renderMarkdown(md) {
  const lines = md.split("\n");
  let html = "";
  let inList = false;
  let inCode = false;
  let codeBuf = [];

  const closeList = () => {
    if (inList) { html += "</ul>"; inList = false; }
  };

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      if (inCode) {
        html += `<pre><code>${escapeHtml(codeBuf.join("\n"))}</code></pre>`;
        codeBuf = []; inCode = false;
      } else {
        closeList(); inCode = true;
      }
      continue;
    }
    if (inCode) { codeBuf.push(line); continue; }

    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) { closeList(); html += `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`; continue; }

    if (/^\s*[-*]\s+/.test(line)) {
      if (!inList) { html += "<ul>"; inList = true; }
      html += `<li>${inline(line.replace(/^\s*[-*]\s+/, ""))}</li>`;
      continue;
    }
    closeList();

    if (/^\s*>\s?/.test(line)) {
      html += `<blockquote>${inline(line.replace(/^\s*>\s?/, ""))}</blockquote>`;
      continue;
    }
    if (line.trim() === "") { continue; }
    html += `<p>${inline(line)}</p>`;
  }
  closeList();
  if (inCode) html += `<pre><code>${escapeHtml(codeBuf.join("\n"))}</code></pre>`;
  return html;
}

function renderPreview() {
  els.preview.innerHTML = renderMarkdown(els.editor.value);
}

function setPreview(on) {
  state.preview = on;
  els.preview.classList.toggle("hidden", !on);
  els.editor.classList.toggle("hidden", on);
  els.togglePreview.textContent = on ? "Edit" : "Read";
  if (on) renderPreview();
}

// Click a wikilink in the preview -> open (creating if missing).
els.preview.addEventListener("click", async (e) => {
  const a = e.target.closest(".wikilink");
  if (!a) return;
  e.preventDefault();
  const name = a.dataset.link;
  if (!state.notes.some((n) => n.name === name)) {
    await api.put(name, `# ${name}\n\n`);
    await refreshNotes();
  }
  setPreview(false);
  await openNote(name);
});

// --------------------------------------------------------------------------
// View switching
// --------------------------------------------------------------------------
function showEditor() {
  els.editorView.classList.remove("hidden");
  els.graphView.classList.add("hidden");
  els.viewEditor.classList.add("active");
  els.viewGraph.classList.remove("active");
}

function showGraph() {
  flushSave();
  els.editorView.classList.add("hidden");
  els.graphView.classList.remove("hidden");
  els.viewEditor.classList.remove("active");
  els.viewGraph.classList.add("active");
  drawGraph();
}

// --------------------------------------------------------------------------
// Force-directed graph (vanilla SVG)
// --------------------------------------------------------------------------
let graphAnim = null;

// Pan / zoom state persists across redraws.
const view = { scale: 0.5, tx: 0, ty: 0, init: false };

function drawGraph() {
  cancelAnimationFrame(graphAnim);
  const svg = els.graph;
  svg.innerHTML = "";
  const ns = "http://www.w3.org/2000/svg";
  const rect = svg.getBoundingClientRect();
  const W = rect.width || 800;
  const H = rect.height || 600;
  const cx = W / 2, cy = H / 2;

  // Everything lives inside a viewport group we translate + scale.
  const viewport = document.createElementNS(ns, "g");
  svg.appendChild(viewport);
  const applyView = () =>
    viewport.setAttribute("transform", `translate(${view.tx},${view.ty}) scale(${view.scale})`);
  if (!view.init) { // centre the graph the first time we open it
    view.tx = cx - cx * view.scale;
    view.ty = cy - cy * view.scale;
    view.init = true;
  }
  applyView();
  els.graph._applyView = applyView; // let the toolbar buttons reuse it
  els.graph._view = view;
  els.graph._center = { cx, cy };

  const names = state.notes.map((n) => n.name);
  const index = new Map(names.map((n, i) => [n, i]));

  // Even initial spread via a golden-angle spiral, so the layout settles fast.
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  const nodes = state.notes.map((n, i) => {
    const r = 50 + 48 * Math.sqrt(i);
    return {
      name: n.name,
      x: cx + Math.cos(i * GOLDEN) * r,
      y: cy + Math.sin(i * GOLDEN) * r,
      vx: 0,
      vy: 0,
    };
  });

  // Edges from existing links to existing targets (dedup undirected).
  const edgeSet = new Set();
  const edges = [];
  for (const n of state.notes) {
    for (const link of n.links) {
      if (!index.has(link) || link === n.name) continue;
      const a = index.get(n.name), b = index.get(link);
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (edgeSet.has(key)) continue;
      edgeSet.add(key);
      edges.push([a, b]);
    }
  }

  const edgeEls = edges.map(() => {
    const line = document.createElementNS(ns, "line");
    line.setAttribute("class", "edge");
    viewport.appendChild(line);
    return line;
  });

  const nodeEls = nodes.map((node) => {
    const g = document.createElementNS(ns, "g");
    g.setAttribute("class", "node" + (node.name === state.current ? " active" : ""));
    const c = document.createElementNS(ns, "circle");
    c.setAttribute("r", "8");
    const label = document.createElementNS(ns, "text");
    label.setAttribute("dy", "-14");
    label.textContent = node.name;
    g.appendChild(c);
    g.appendChild(label);
    viewport.appendChild(g);

    g.addEventListener("mousedown", (e) => startNodeDrag(e, node));
    g.addEventListener("click", (e) => {
      if (g.dataset.dragged === "1") { g.dataset.dragged = "0"; return; }
      e.stopPropagation();
      showEditor();
      openNote(node.name);
    });
    return g;
  });

  // Screen -> graph coordinates, accounting for the current pan/zoom.
  const toGraph = (e) => {
    const r = svg.getBoundingClientRect();
    return {
      x: (e.clientX - r.left - view.tx) / view.scale,
      y: (e.clientY - r.top - view.ty) / view.scale,
    };
  };

  // Node dragging.
  let dragging = null;
  function startNodeDrag(e, node) {
    e.preventDefault();
    e.stopPropagation();
    dragging = node;
    node.fixed = true;
    runSim(); // re-balance neighbours live while dragging
  }

  // Background panning.
  let panning = null;
  svg.addEventListener("mousedown", (e) => {
    if (e.target.closest(".node")) return;
    panning = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
    svg.style.cursor = "grabbing";
  });

  svg.addEventListener("mousemove", (e) => {
    if (dragging) {
      const p = toGraph(e);
      dragging.x = p.x;
      dragging.y = p.y;
      dragging.vx = dragging.vy = 0;
      const g = nodeEls[nodes.indexOf(dragging)];
      if (g) g.dataset.dragged = "1";
    } else if (panning) {
      view.tx = panning.tx + (e.clientX - panning.x);
      view.ty = panning.ty + (e.clientY - panning.y);
      applyView();
    }
  });

  const endDrag = () => {
    if (dragging) dragging.fixed = false;
    dragging = null;
    panning = null;
    svg.style.cursor = "grab";
  };
  svg.addEventListener("mouseup", endDrag);
  svg.addEventListener("mouseleave", endDrag);

  // Wheel zoom, anchored at the cursor.
  svg.addEventListener("wheel", (e) => {
    e.preventDefault();
    const r = svg.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    const gx = (sx - view.tx) / view.scale, gy = (sy - view.ty) / view.scale;
    const factor = Math.exp(-e.deltaY * 0.0015);
    view.scale = Math.max(0.15, Math.min(5, view.scale * factor));
    view.tx = sx - gx * view.scale;
    view.ty = sy - gy * view.scale;
    applyView();
  }, { passive: false });

  // One physics step (no DOM writes).
  function step() {
    const k = 0.04; // spring
    const rest = 95; // spring rest length
    const rep = 52000; // repulsion strength
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      if (a.fixed) continue;
      for (let j = 0; j < nodes.length; j++) {
        if (i === j) continue;
        const b = nodes[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        const d2 = dx * dx + dy * dy || 0.01;
        const d = Math.sqrt(d2);
        const f = (rep / d2) * 0.002;
        a.vx += (dx / d) * f;
        a.vy += (dy / d) * f;
      }
      // gentle centering keeps the whole graph on screen
      a.vx += (cx - a.x) * 0.0004;
      a.vy += (cy - a.y) * 0.0004;
    }
    for (const [ai, bi] of edges) {
      const a = nodes[ai], b = nodes[bi];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const force = (d - rest) * k;
      const fx = (dx / d) * force, fy = (dy / d) * force;
      if (!a.fixed) { a.vx += fx; a.vy += fy; }
      if (!b.fixed) { b.vx -= fx; b.vy -= fy; }
    }
    for (const n of nodes) {
      if (n.fixed) continue;
      n.vx *= 0.9; n.vy *= 0.9;
      n.x += n.vx; n.y += n.vy;
    }
  }

  function paint() {
    edges.forEach(([ai, bi], i) => {
      const a = nodes[ai], b = nodes[bi];
      edgeEls[i].setAttribute("x1", a.x);
      edgeEls[i].setAttribute("y1", a.y);
      edgeEls[i].setAttribute("x2", b.x);
      edgeEls[i].setAttribute("y2", b.y);
    });
    nodes.forEach((n, i) => {
      nodeEls[i].setAttribute("transform", `translate(${n.x},${n.y})`);
    });
  }

  // Settle the whole layout up front so the graph appears stable immediately,
  // then paint once. (O(n^2) per step, but trivial for a few hundred nodes.)
  for (let i = 0; i < 400; i++) step();
  paint();

  // Run the live simulation only while interacting, with a short cooldown so a
  // dragged node re-settles, then stop to keep the view perfectly still.
  let cooldown = 0;
  function runSim() {
    cancelAnimationFrame(graphAnim);
    cooldown = 40;
    const loop = () => {
      step();
      paint();
      cooldown = dragging ? 40 : cooldown - 1;
      if (cooldown > 0) graphAnim = requestAnimationFrame(loop);
    };
    graphAnim = requestAnimationFrame(loop);
  }
}

// Zoom around the viewport centre (used by the toolbar buttons).
function zoomGraph(factor) {
  const svg = els.graph;
  const view = svg._view, apply = svg._applyView, c = svg._center;
  if (!view || !apply || !c) return;
  if (factor === 0) { // reset
    view.scale = 0.5;
    view.tx = c.cx - c.cx * view.scale;
    view.ty = c.cy - c.cy * view.scale;
  } else {
    const gx = (c.cx - view.tx) / view.scale, gy = (c.cy - view.ty) / view.scale;
    view.scale = Math.max(0.15, Math.min(5, view.scale * factor));
    view.tx = c.cx - gx * view.scale;
    view.ty = c.cy - gy * view.scale;
  }
  apply();
}

// --------------------------------------------------------------------------
// Events
// --------------------------------------------------------------------------
els.editor.addEventListener("input", () => {
  scheduleSave();
  if (state.preview) renderPreview();
});
els.title.addEventListener("change", () => renameCurrent(els.title.value));
els.title.addEventListener("keydown", (e) => {
  if (e.key === "Enter") els.title.blur();
});
els.search.addEventListener("input", () => {
  state.filter = els.search.value;
  renderList();
});
els.newNote.addEventListener("click", () => createNote("Untitled"));
els.deleteNote.addEventListener("click", deleteCurrent);
els.togglePreview.addEventListener("click", () => setPreview(!state.preview));
els.viewEditor.addEventListener("click", showEditor);
els.viewGraph.addEventListener("click", showGraph);
els.zoomIn.addEventListener("click", () => zoomGraph(1.25));
els.zoomOut.addEventListener("click", () => zoomGraph(0.8));
els.zoomReset.addEventListener("click", () => zoomGraph(0));

document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "n") {
    e.preventDefault();
    createNote("Untitled");
  }
});

window.addEventListener("beforeunload", flushSave);

// --------------------------------------------------------------------------
// Boot
// --------------------------------------------------------------------------
(async function init() {
  await refreshNotes();
  if (state.notes.length) await openNote(state.notes[0].name);
})();
