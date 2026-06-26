import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { invoke, Channel } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  FolderPlus,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  Save,
  RefreshCw,
  FileText,
  X,
  Search,
  FolderOpen,
  GitBranch,
  ChevronRight,
  Copy,
  ClipboardCopy,
  Braces,
  Table2,
} from "lucide-react";
import "./styles.css";

interface EnvFile {
  path: string;
  name: string;
  dir: string;
  short_dir: string;
  keys: string[];
  project: string;
  subpath: string;
  branch: string;
  worktree: boolean;
  repo_root: string;
}

interface FileHit {
  f: EnvFile;
  hits: string[];
}

interface Worktree {
  branch: string;
  items: FileHit[];
}

interface Group {
  project: string;
  root: string;
  mainItems: FileHit[];
  worktrees: Worktree[];
}

type LineKind = "pair" | "comment" | "blank";

interface EnvLine {
  kind: LineKind;
  key: string;
  value: string;
  export: boolean;
  quote: string;
  raw: string;
}

interface Settings {
  roots: string[];
}

type ViewMode = "table" | "json";

const EMPTY_PAIR: EnvLine = {
  kind: "pair",
  key: "",
  value: "",
  export: false,
  quote: "",
  raw: "",
};

// ".env" -> "env", ".env.local" -> "local", ".env.production" -> "production"
const envLabel = (name: string) =>
  name === ".env" ? "env" : name.replace(/^\.env\./, "");

// template/example files hold no real values — flag them for a distinct badge
const isExample = (name: string) =>
  /\.(example|sample|template|dist|tmpl)$/i.test(name);

export default function App() {
  const [roots, setRoots] = useState<string[]>([]);
  const [files, setFiles] = useState<EnvFile[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [lines, setLines] = useState<EnvLine[]>([]);
  const [dirty, setDirty] = useState(false);
  const [filter, setFilter] = useState("");
  const [showValues, setShowValues] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [toast, setToast] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [expandedWt, setExpandedWt] = useState<Set<string>>(new Set());
  const [view, setView] = useState<ViewMode>("table");
  const [, startTransition] = useTransition();

  const toggleGroup = (root: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(root)) next.delete(root);
      else next.add(root);
      return next;
    });

  // worktree sub-groups are collapsed by default; track which are expanded
  const toggleWt = (key: string) =>
    setExpandedWt((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const toastTimer = useRef<number | undefined>(undefined);
  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 1600);
  }, []);

  const doScan = useCallback(async () => {
    setScanning(true);
    setFiles([]);
    // buffer incoming files and flush once per animation frame so the list
    // fills in smoothly instead of re-rendering on every single message
    const buffer: EnvFile[] = [];
    let scheduled = false;
    const flush = () => {
      scheduled = false;
      const batch = buffer.splice(0, buffer.length);
      if (batch.length) {
        startTransition(() => setFiles((prev) => [...prev, ...batch]));
      }
    };
    const channel = new Channel<EnvFile>();
    channel.onmessage = (f) => {
      buffer.push(f);
      if (!scheduled) {
        scheduled = true;
        requestAnimationFrame(flush);
      }
    };
    try {
      await invoke("scan_stream", { onEvent: channel });
      flush();
    } catch (e) {
      flash(String(e));
    } finally {
      setScanning(false);
    }
  }, [flash]);

  useEffect(() => {
    (async () => {
      const s = await invoke<Settings>("get_settings");
      setRoots(s.roots ?? []);
      await doScan();
    })();
  }, [doScan]);

  const persistRoots = async (next: string[]) => {
    setRoots(next);
    await invoke("save_settings", { settings: { roots: next } });
    await doScan();
  };

  const addRoot = async () => {
    const picked = await open({
      directory: true,
      multiple: false,
      title: "Select a folder to scan",
    });
    if (typeof picked === "string" && !roots.includes(picked)) {
      await persistRoots([...roots, picked]);
    }
  };

  const removeRoot = (r: string) => persistRoots(roots.filter((x) => x !== r));

  const openFile = async (path: string) => {
    if (dirty && !window.confirm("You have unsaved changes. Discard them?")) {
      return;
    }
    try {
      const ls = await invoke<EnvLine[]>("read_env", { path });
      setSelected(path);
      setLines(ls);
      setDirty(false);
      setView("table");
    } catch (e) {
      flash(String(e));
    }
  };

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      flash(`${label} copied`);
    } catch {
      flash("Copy failed");
    }
  };

  const save = useCallback(async () => {
    if (!selected || !dirty) return;
    try {
      await invoke("write_env", { path: selected, lines });
      setDirty(false);
      flash("Saved");
    } catch (e) {
      flash(String(e));
    }
  }, [selected, dirty, lines, flash]);

  // Cmd/Ctrl+S to save
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [save]);

  const updatePair = (idx: number, field: "key" | "value", val: string) => {
    setLines((prev) =>
      prev.map((l, i) => (i === idx ? { ...l, [field]: val } : l))
    );
    setDirty(true);
  };

  const deletePair = (idx: number) => {
    setLines((prev) => prev.filter((_, i) => i !== idx));
    setDirty(true);
  };

  const addPair = () => {
    setLines((prev) => [...prev, { ...EMPTY_PAIR }]);
    setDirty(true);
  };

  const pairs = useMemo(
    () =>
      lines
        .map((l, i) => ({ line: l, idx: i }))
        .filter((x) => x.line.kind === "pair"),
    [lines]
  );
  const commentCount = useMemo(
    () => lines.filter((l) => l.kind === "comment").length,
    [lines]
  );

  // ".env"-formatted text (KEY=value lines) — pastes straight into Vercel etc.
  const buildDotenv = () =>
    lines
      .filter((l) => l.kind === "pair" && l.key)
      .map((l) => `${l.key}=${l.value}`)
      .join("\n");

  const jsonView = useMemo(() => {
    const obj: Record<string, string> = {};
    for (const l of lines) {
      if (l.kind === "pair" && l.key) obj[l.key] = l.value;
    }
    return JSON.stringify(obj, null, 2);
  }, [lines]);

  const copyAll = () =>
    view === "json"
      ? copyText(jsonView, "JSON")
      : copyText(buildDotenv(), ".env");

  const shownFiles = useMemo<FileHit[]>(() => {
    const q = filter.trim().toLowerCase();
    return files
      .map((f) => {
        const hits = q ? f.keys.filter((k) => k.toLowerCase().includes(q)) : [];
        const metaHit =
          !q ||
          f.name.toLowerCase().includes(q) ||
          f.project.toLowerCase().includes(q) ||
          f.subpath.toLowerCase().includes(q) ||
          f.short_dir.toLowerCase().includes(q);
        return { f, hits, show: metaHit || hits.length > 0 };
      })
      .filter((x) => x.show)
      .map(({ f, hits }) => ({ f, hits }));
  }, [files, filter]);

  const groups = useMemo<Group[]>(() => {
    const map = new Map<
      string,
      {
        project: string;
        root: string;
        main: FileHit[];
        wt: Map<string, FileHit[]>;
      }
    >();
    for (const it of shownFiles) {
      let g = map.get(it.f.repo_root);
      if (!g) {
        g = {
          project: it.f.project,
          root: it.f.repo_root,
          main: [],
          wt: new Map(),
        };
        map.set(it.f.repo_root, g);
      }
      if (it.f.worktree) {
        const key = it.f.branch || "worktree";
        const arr = g.wt.get(key) ?? [];
        arr.push(it);
        g.wt.set(key, arr);
      } else {
        g.main.push(it);
      }
    }
    const byPath = (a: FileHit, b: FileHit) =>
      a.f.path.localeCompare(b.f.path);
    return Array.from(map.values())
      .map((g) => ({
        project: g.project,
        root: g.root,
        mainItems: g.main.sort(byPath),
        worktrees: Array.from(g.wt.entries())
          .map(([branch, items]) => ({ branch, items: items.sort(byPath) }))
          .sort((a, b) => a.branch.localeCompare(b.branch)),
      }))
      .sort((a, b) => a.project.localeCompare(b.project));
  }, [shownFiles]);

  const selectedFile = files.find((f) => f.path === selected);

  // shared renderer for a file row (deep = inside a worktree sub-group)
  const renderFile = ({ f, hits }: FileHit, deep = false) => (
    <button
      key={f.path}
      className={
        "file-item " +
        (deep ? "deep" : "nested") +
        (f.path === selected ? " active" : "")
      }
      onClick={() => openFile(f.path)}
      title={f.path}
    >
      <FileText size={14} className="muted file-icon" />
      <span className="file-meta">
        <span className="file-top">
          <span className="file-proj">{f.subpath ? "/" + f.subpath : "./"}</span>
          <span
            className={"file-badge" + (isExample(f.name) ? " example" : "")}
          >
            {envLabel(f.name)}
          </span>
        </span>
        {hits.length > 0 && (
          <span className="file-hits">
            {hits.slice(0, 4).map((k) => (
              <span key={k} className="hit-chip">
                {k}
              </span>
            ))}
            {hits.length > 4 && (
              <span className="hit-more">+{hits.length - 4}</span>
            )}
          </span>
        )}
      </span>
    </button>
  );

  return (
    <div className="app">
      {/* ---------------- sidebar ---------------- */}
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">=</span>
          <span className="brand-name">Easyenv</span>
        </div>

        <div className="section">
          <div className="section-head">
            <span>Root folders</span>
            <button className="icon-btn" title="Add folder" onClick={addRoot}>
              <FolderPlus size={15} />
            </button>
          </div>
          {roots.length === 0 ? (
            <div className="hint">
              Add a folder to scan (e.g. ~/projects)
            </div>
          ) : (
            <ul className="root-list">
              {roots.map((r) => (
                <li key={r} className="root-item" title={r}>
                  <FolderOpen size={13} className="muted" />
                  <span className="root-path">{r.replace(/^.*\//, "")}</span>
                  <button
                    className="icon-btn tiny"
                    title="Remove"
                    onClick={() => removeRoot(r)}
                  >
                    <X size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="search-box">
          <Search size={14} className="muted" />
          <input
            placeholder="Search files & keys"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <button
            className="icon-btn"
            title="Rescan"
            onClick={doScan}
            disabled={scanning}
          >
            <RefreshCw size={14} className={scanning ? "spin" : ""} />
          </button>
        </div>

        <div className="file-list">
          {groups.length === 0 ? (
            <div className="hint pad">
              {scanning ? "Scanning…" : "No .env files found"}
            </div>
          ) : (
            groups.map((g) => {
              const isCollapsed = !filter && collapsed.has(g.root);
              const total =
                g.mainItems.length +
                g.worktrees.reduce((n, w) => n + w.items.length, 0);
              return (
                <div className="group" key={g.root}>
                  <button
                    className="group-head"
                    onClick={() => toggleGroup(g.root)}
                    title={g.root}
                  >
                    <ChevronRight
                      size={14}
                      className={"chevron" + (isCollapsed ? "" : " open")}
                    />
                    <span className="group-name">{g.project}</span>
                    <span className="group-count">{total}</span>
                  </button>
                  {!isCollapsed && (
                    <>
                      {g.mainItems.map((it) => renderFile(it))}
                      {g.worktrees.map((w) => {
                        const wtKey = g.root + "::" + w.branch;
                        const wtOpen = !!filter || expandedWt.has(wtKey);
                        return (
                          <div className="wt-group" key={wtKey}>
                            <button
                              className="wt-head"
                              onClick={() => toggleWt(wtKey)}
                              title={`worktree · ${w.branch}`}
                            >
                              <ChevronRight
                                size={12}
                                className={"chevron" + (wtOpen ? " open" : "")}
                              />
                              <span className="wt-branch">
                                <GitBranch size={11} />
                                {w.branch}
                              </span>
                              <span className="wt-count">{w.items.length}</span>
                            </button>
                            {wtOpen && w.items.map((it) => renderFile(it, true))}
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* ---------------- editor ---------------- */}
      <main className="editor">
        {!selectedFile ? (
          <div className="empty">
            <FileText size={40} className="muted" />
            <p>Select a .env file on the left</p>
          </div>
        ) : (
          <>
            <header className="editor-head">
              <div className="file-title">
                <span className="file-title-top">
                  <span className="file-title-proj">
                    {selectedFile.project}
                    {selectedFile.subpath && (
                      <span className="file-sub">/{selectedFile.subpath}</span>
                    )}
                  </span>
                  <span
                    className={
                      "file-badge" +
                      (isExample(selectedFile.name) ? " example" : "")
                    }
                  >
                    {envLabel(selectedFile.name)}
                  </span>
                  {selectedFile.worktree && (
                    <span
                      className="wt-badge"
                      title={
                        selectedFile.branch
                          ? `worktree · ${selectedFile.branch}`
                          : "worktree"
                      }
                    >
                      <GitBranch size={11} />
                      {selectedFile.branch || "worktree"}
                    </span>
                  )}
                </span>
                <span className="file-title-dir">{selectedFile.short_dir}</span>
              </div>
              <div className="actions">
                <button
                  className="btn ghost"
                  onClick={() => setView((v) => (v === "table" ? "json" : "table"))}
                  title={view === "table" ? "View as JSON" : "View as table"}
                >
                  {view === "table" ? (
                    <Braces size={15} />
                  ) : (
                    <Table2 size={15} />
                  )}
                  {view === "table" ? "JSON" : "Table"}
                </button>
                <button
                  className="btn ghost"
                  onClick={copyAll}
                  title={
                    view === "json"
                      ? "Copy all as JSON"
                      : "Copy all as .env (paste into Vercel etc.)"
                  }
                >
                  <Copy size={15} />
                  {view === "json" ? "Copy JSON" : "Copy .env"}
                </button>
                {view === "table" && (
                  <button
                    className="btn ghost"
                    onClick={() => setShowValues((v) => !v)}
                    title={showValues ? "Hide values" : "Show values"}
                  >
                    {showValues ? <EyeOff size={15} /> : <Eye size={15} />}
                    {showValues ? "Hide" : "Show"}
                  </button>
                )}
                <button
                  className="btn ghost"
                  onClick={() => openFile(selectedFile.path)}
                  title="Reload from disk"
                >
                  <RefreshCw size={15} />
                </button>
                <button
                  className={"btn primary" + (dirty ? "" : " disabled")}
                  onClick={save}
                  disabled={!dirty}
                >
                  <Save size={15} />
                  Save
                </button>
              </div>
            </header>

            {view === "json" ? (
              <div className="kv">
                <pre className="json-view">{jsonView}</pre>
              </div>
            ) : (
              <div className="kv">
                <div className="kv-head">
                  <span>KEY</span>
                  <span>VALUE</span>
                  <span />
                </div>
                {pairs.length === 0 ? (
                  <div className="hint pad">
                    No keys yet. Add one with the button below.
                  </div>
                ) : (
                  pairs.map(({ line, idx }) => (
                    <div className="kv-row" key={idx}>
                      <div className="kv-cell">
                        <input
                          className="kv-key"
                          value={line.key}
                          spellCheck={false}
                          placeholder="KEY"
                          onChange={(e) => updatePair(idx, "key", e.target.value)}
                        />
                        <button
                          className="cell-copy"
                          title="Copy key"
                          tabIndex={-1}
                          onClick={() => copyText(line.key, "Key")}
                        >
                          <Copy size={13} />
                        </button>
                      </div>
                      <div className="kv-cell">
                        <input
                          className="kv-value"
                          value={line.value}
                          spellCheck={false}
                          placeholder="value"
                          type={showValues ? "text" : "password"}
                          onChange={(e) =>
                            updatePair(idx, "value", e.target.value)
                          }
                        />
                        <button
                          className="cell-copy"
                          title="Copy value"
                          tabIndex={-1}
                          onClick={() => copyText(line.value, "Value")}
                        >
                          <Copy size={13} />
                        </button>
                      </div>
                      <div className="kv-actions">
                        <button
                          className="icon-btn"
                          title="Copy KEY=value"
                          tabIndex={-1}
                          onClick={() =>
                            copyText(`${line.key}=${line.value}`, "Pair")
                          }
                        >
                          <ClipboardCopy size={15} />
                        </button>
                        <button
                          className="icon-btn danger"
                          title="Delete this key"
                          onClick={() => deletePair(idx)}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  ))
                )}

                <button className="btn add" onClick={addPair}>
                  <Plus size={15} />
                  Add entry
                </button>

                {commentCount > 0 && (
                  <div className="preserve-note">
                    {commentCount} comment line{commentCount > 1 ? "s" : ""}{" "}
                    preserved on save
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
