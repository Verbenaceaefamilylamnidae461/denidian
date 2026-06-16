// denidian - a tiny Obsidian clone built on `deno desktop`.
//
// Architecture (per the deno desktop model): the app is a normal Deno HTTP
// server. `deno desktop` opens a native window and points an embedded webview
// at the local server. The same code runs in a browser via
// `deno run -A main.ts` for development.
//
//   deno task dev        # desktop window, hot reload
//   deno task start      # desktop window
//   deno run -A main.ts  # plain browser dev at the printed URL

const HOME = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE") ?? ".";
const VAULT = `${HOME}/Denidian`;
const WEB = new URL("./web/", import.meta.url);

await Deno.mkdir(VAULT, { recursive: true });

// ---------------------------------------------------------------------------
// Note storage - one `.md` file per note inside the vault directory.
// ---------------------------------------------------------------------------

/** Turn a user-facing note title into a safe bare filename (no extension). */
function safeName(name: string): string {
  return name
    .replace(/\.md$/i, "")
    .replace(/[\/\\:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function notePath(name: string): string {
  return `${VAULT}/${safeName(name)}.md`;
}

/** Extract `[[wikilink]]` targets from a note body. */
function parseLinks(content: string): string[] {
  const out = new Set<string>();
  for (const m of content.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)) {
    const t = m[1].trim();
    if (t) out.add(t);
  }
  return [...out];
}

async function listNotes() {
  const notes: { name: string; links: string[] }[] = [];
  for await (const entry of Deno.readDir(VAULT)) {
    if (!entry.isFile || !entry.name.endsWith(".md")) continue;
    const name = entry.name.replace(/\.md$/i, "");
    let content = "";
    try {
      content = await Deno.readTextFile(`${VAULT}/${entry.name}`);
    } catch { /* ignore unreadable file */ }
    notes.push({ name, links: parseLinks(content) });
  }
  notes.sort((a, b) => a.name.localeCompare(b.name));
  return notes;
}

async function readNote(name: string): Promise<string | null> {
  try {
    return await Deno.readTextFile(notePath(name));
  } catch {
    return null;
  }
}

async function writeNote(name: string, content: string) {
  await Deno.writeTextFile(notePath(name), content);
}

async function deleteNote(name: string) {
  try {
    await Deno.remove(notePath(name));
  } catch { /* already gone */ }
}

// Starter vault: one big "JavaScript core" cluster (45 notes) plus five
// satellite clusters of JS/Web-dev topics (11 each = 55) that orbit it. Each
// satellite attaches to the core through a single bridge edge, so the Graph
// view shows one dense hub surrounded by five smaller communities.
const CORE = [
  "JavaScript", "Variables", "Functions", "Closures", "Promises",
  "Async Await", "Event Loop", "Prototypes", "Classes", "Modules",
  "Destructuring", "Spread Operator", "Arrow Functions", "Generators",
  "Iterators", "Symbols", "Proxies", "Garbage Collection", "Hoisting", "Scope",
  "This Keyword", "Callbacks", "JSON", "Regular Expressions", "Error Handling",
  "Map and Set", "WeakMap", "Typed Arrays", "Strings", "Numbers", "Booleans",
  "Arrays", "Objects", "DOM", "Events", "Fetch API", "Local Storage",
  "Web Components", "Service Workers", "WebSockets", "History API", "Canvas",
  "Web Workers", "Template Literals", "Optional Chaining",
];

const SATELLITES: { name: string; items: string[] }[] = [
  { name: "Frameworks", items: ["React", "Vue", "Svelte", "Angular", "SolidJS", "Preact", "Qwik", "Astro", "NextJS", "Remix", "Nuxt"] },
  { name: "Build Tools", items: ["Vite", "Webpack", "esbuild", "Rollup", "Babel", "Parcel", "Turbopack", "SWC", "npm", "pnpm", "Deno"] },
  { name: "TypeScript", items: ["Types", "Interfaces", "Generics", "Enums", "Type Guards", "Decorators", "Utility Types", "Type Inference", "Tuples", "Namespaces", "Declaration Files"] },
  { name: "CSS and Styling", items: ["Flexbox", "Grid", "Animations", "Media Queries", "Tailwind", "CSS Variables", "Transitions", "Pseudo Classes", "Box Model", "Specificity", "Sass"] },
  { name: "Testing", items: ["Jest", "Vitest", "Playwright", "Cypress", "ESLint", "Prettier", "Testing Library", "Mocking", "Coverage", "Snapshot Testing", "CI Pipelines"] },
];

async function seedVault() {
  for await (const entry of Deno.readDir(VAULT)) {
    if (entry.isFile && entry.name.endsWith(".md")) return; // not empty
  }

  const write = async (name: string, cluster: string, links: Set<string>) => {
    links.delete(name);
    const body = [
      `# ${name}`,
      "",
      `A note in the **${cluster}** cluster.`,
      "",
      "See also: " + [...links].map((l) => `[[${l}]]`).join(", ") + ".",
      "",
    ].join("\n");
    await Deno.writeTextFile(`${VAULT}/${name}.md`, body);
  };

  // Core: a dense circulant mesh (each note links two steps ahead and seven
  // ahead) so the 45 notes read as one big blob rather than a star.
  const C = CORE.length;
  for (let i = 0; i < C; i++) {
    const links = new Set<string>([CORE[(i + 1) % C], CORE[(i + 7) % C]]);
    await write(CORE[i], "JavaScript core", links);
  }

  // Satellites: a ring plus a hub, with the hub bridging to a spread-out point
  // on the core so the five clusters orbit the centre at different angles.
  for (let j = 0; j < SATELLITES.length; j++) {
    const { name: cluster, items } = SATELLITES[j];
    const M = items.length;
    for (let k = 0; k < M; k++) {
      const links = new Set<string>([items[(k + 1) % M]]);
      if (k !== 0) links.add(items[0]); // satellite hub
      else links.add(CORE[(j * 9) % C]); // bridge into the core
      await write(items[k], cluster, links);
    }
  }
}

// ---------------------------------------------------------------------------
// Static assets
// ---------------------------------------------------------------------------

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

async function serveStatic(pathname: string): Promise<Response> {
  const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  try {
    const data = await Deno.readFile(new URL(rel, WEB));
    const ext = rel.slice(rel.lastIndexOf("."));
    return new Response(data, {
      headers: {
        "content-type": CONTENT_TYPES[ext] ?? "application/octet-stream",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

// ---------------------------------------------------------------------------
// HTTP handler - static UI + a small JSON API for notes.
// ---------------------------------------------------------------------------

await seedVault();

// In a `deno desktop` build, adopt the startup window to set its title and a
// sensible default size. Guarded so plain `deno run` (browser dev) still works.
const WIN_W = 2000, WIN_H = 1000;
type DesktopWindow = {
  setSize?: (w: number, h: number) => void;
  setTitle?: (t: string) => void;
  setApplicationMenu?: (menu: unknown[]) => void;
  executeJs?: (code: string) => Promise<unknown>;
  addEventListener?: (
    type: string,
    cb: (e: { detail?: { id?: string } }) => void,
  ) => void;
};
const desktop = Deno as unknown as {
  BrowserWindow?: new (opts: Record<string, unknown>) => DesktopWindow;
};

function applicationMenu() {
  const item = (label: string, id: string, accelerator?: string) => ({
    item: { label, id, accelerator, enabled: true },
  });
  const role = (r: string) => ({ role: { role: r } });
  return [
    { submenu: { label: "denidian", items: [role("quit")] } },
    {
      submenu: {
        label: "File",
        items: [
          item("New Note", "new-note", "CmdOrCtrl+N"),
          item("Delete Note", "delete-note", "CmdOrCtrl+Backspace"),
        ],
      },
    },
    {
      submenu: {
        label: "Edit",
        items: [
          role("undo"),
          role("redo"),
          "separator",
          role("cut"),
          role("copy"),
          role("paste"),
        ],
      },
    },
    {
      submenu: {
        label: "View",
        items: [
          item("Toggle Read Mode", "toggle-read", "CmdOrCtrl+E"),
          item("Toggle Graph", "toggle-graph", "CmdOrCtrl+G"),
        ],
      },
    },
  ];
}

if (desktop.BrowserWindow) {
  const win = new desktop.BrowserWindow({
    title: "denidian",
    width: WIN_W,
    height: WIN_H,
  });
  // The first construction adopts the already-open startup window; set the size
  // explicitly, and once more after launch in case the backend restores a
  // previous frame.
  const size = () => win.setSize?.(WIN_W, WIN_H);
  size();
  win.setTitle?.("denidian");
  setTimeout(size, 250);

  // Native menu bar: Quit (Cmd+Q) plus standard Edit roles and app actions.
  // Custom items are forwarded to the webview via a small global it exposes.
  win.setApplicationMenu?.(applicationMenu());
  win.addEventListener?.("menuclick", (e) => {
    const id = e.detail?.id;
    const calls: Record<string, string> = {
      "new-note": "globalThis.denidian?.newNote()",
      "delete-note": "globalThis.denidian?.deleteNote()",
      "toggle-read": "globalThis.denidian?.toggleRead()",
      "toggle-graph": "globalThis.denidian?.toggleGraph()",
    };
    if (id && calls[id]) win.executeJs?.(calls[id]);
  });
}

Deno.serve(async (req) => {
  const { pathname } = new URL(req.url);

  if (pathname === "/api/notes" && req.method === "GET") {
    return Response.json(await listNotes());
  }

  if (pathname.startsWith("/api/notes/")) {
    const name = decodeURIComponent(pathname.slice("/api/notes/".length));
    if (!name) return new Response("Bad request", { status: 400 });

    if (req.method === "GET") {
      const content = await readNote(name);
      if (content === null) return new Response("Not found", { status: 404 });
      return Response.json({ name, content });
    }
    if (req.method === "PUT") {
      const { content } = await req.json();
      await writeNote(name, typeof content === "string" ? content : "");
      return Response.json({ name: safeName(name), ok: true });
    }
    if (req.method === "DELETE") {
      await deleteNote(name);
      return Response.json({ ok: true });
    }
    return new Response("Method not allowed", { status: 405 });
  }

  return serveStatic(pathname);
});
