use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::ipc::Channel;
use tauri::Manager;
use walkdir::WalkDir;

// ---------- settings (registered root folders) ----------

#[derive(Serialize, Deserialize, Default, Clone)]
struct Settings {
    #[serde(default)]
    roots: Vec<String>,
}

fn settings_path(app: &tauri::AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_config_dir()
        .expect("resolve app config dir");
    let _ = fs::create_dir_all(&dir);
    dir.join("settings.json")
}

#[tauri::command]
fn get_settings(app: tauri::AppHandle) -> Settings {
    let p = settings_path(&app);
    fs::read_to_string(&p)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

#[tauri::command]
fn save_settings(app: tauri::AppHandle, settings: Settings) -> Result<(), String> {
    let p = settings_path(&app);
    let s = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(&p, s).map_err(|e| e.to_string())
}

// ---------- scanning ----------

#[derive(Serialize)]
struct EnvFile {
    path: String,
    name: String,
    dir: String,
    short_dir: String,
    keys: Vec<String>,
    project: String,   // git repo root folder name (real project), or last dir segment
    subpath: String,   // path from worktree/repo root to the .env's dir (e.g. "web")
    branch: String,    // current branch (empty if not a git repo)
    worktree: bool,    // true if the .env lives in a linked git worktree
    repo_root: String, // grouping key: main repo root (worktrees fold into their main repo)
}

struct GitMeta {
    project: String,
    subpath: String,
    branch: String,
    worktree: bool,
    root: String,
}

fn dir_name(p: &Path) -> String {
    p.file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default()
}

// Read the current branch from a gitdir's HEAD; detached -> short sha.
fn read_branch(gitdir: &Path) -> Option<String> {
    let head = fs::read_to_string(gitdir.join("HEAD")).ok()?;
    let head = head.trim();
    if let Some(b) = head.strip_prefix("ref: refs/heads/") {
        Some(b.to_string())
    } else if head.len() >= 7 {
        Some(head[..7].to_string())
    } else {
        None
    }
}

// A linked worktree's .git is a file: "gitdir: <path>/.git/worktrees/NAME".
// The path may be relative to the .git file's directory — resolve it to absolute
// so HEAD reads and main-repo extraction work.
fn resolve_worktree_gitdir(dotgit_file: &Path) -> Option<PathBuf> {
    let content = fs::read_to_string(dotgit_file).ok()?;
    let line = content.lines().find(|l| l.starts_with("gitdir:"))?;
    let raw = line.trim_start_matches("gitdir:").trim();
    let p = PathBuf::from(raw);
    let joined = if p.is_absolute() {
        p
    } else {
        dotgit_file.parent()?.join(p)
    };
    Some(fs::canonicalize(&joined).unwrap_or(joined))
}

// From a worktree gitdir ".../MAIN/.git/worktrees/NAME", recover the MAIN repo root.
fn worktree_main_root(gitdir: &Path) -> Option<PathBuf> {
    let s = gitdir.to_string_lossy();
    s.find("/.git/worktrees/")
        .map(|idx| PathBuf::from(&s[..idx]))
}

// Common "role" folder names that are not the project itself — when a repo root
// (or a git-less leaf) is one of these, the real project is its parent folder.
fn is_role_dir(n: &str) -> bool {
    const ROLES: &[&str] = &[
        "backend",
        "frontend",
        "web",
        "api",
        "server",
        "client",
        "mobile",
        "www",
        "apps",
        "packages",
        "gateway",
        "worker",
        "app",
        "desktop",
        "admin",
        "service",
    ];
    ROLES.contains(&n)
}

// If `root`'s folder name is a role dir, promote the parent to be the project
// (so siblings like backend/frontend group together). Returns (group_root, project_name).
fn promote_role(root: &Path) -> (PathBuf, String) {
    let name = dir_name(root);
    if is_role_dir(&name) {
        if let Some(parent) = root.parent() {
            let pname = dir_name(parent);
            if !pname.is_empty() {
                return (parent.to_path_buf(), pname);
            }
        }
    }
    (root.to_path_buf(), name)
}

// Walk up from the .env's directory to find the git repo root and derive
// project name (repo folder), subpath, branch, and whether it's a worktree.
fn git_meta(dir: &Path) -> GitMeta {
    // 1) find the nearest git root, its branch, worktree-ness, and checkout root
    let mut found: Option<(PathBuf, String, bool, PathBuf)> = None; // (main_root, branch, worktree, checkout)
    let mut cur = Some(dir);
    while let Some(c) = cur {
        let dotgit = c.join(".git");
        if dotgit.exists() {
            let worktree = dotgit.is_file();
            let gitdir = if worktree {
                resolve_worktree_gitdir(&dotgit)
            } else {
                Some(dotgit.clone())
            };
            let branch = gitdir
                .as_ref()
                .and_then(|g| read_branch(g))
                .unwrap_or_default();
            // worktrees fold under their main repo
            let main_root = if worktree {
                gitdir.as_ref().and_then(|g| worktree_main_root(g))
            } else {
                None
            };
            let root_path = main_root.unwrap_or_else(|| c.to_path_buf());
            found = Some((root_path, branch, worktree, c.to_path_buf()));
            break;
        }
        cur = c.parent();
    }

    let (base_root, branch, worktree, checkout) =
        found.unwrap_or_else(|| (dir.to_path_buf(), String::new(), false, dir.to_path_buf()));

    // 2) promote role dirs (backend/web/…) so siblings share a project header
    let (group_root, project) = promote_role(&base_root);

    // 3) subpath shown under the header: for worktrees use the checkout root so it
    //    stays short (e.g. "web", not ".claude/worktrees/NAME/web")
    let subpath_base = if worktree { &checkout } else { &group_root };
    let subpath = dir
        .strip_prefix(subpath_base)
        .ok()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    GitMeta {
        project,
        subpath,
        branch,
        worktree,
        root: group_root.to_string_lossy().to_string(),
    }
}

const EXCLUDE_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    "dist",
    "build",
    ".next",
    "target",
    "vendor",
    ".venv",
    "venv",
    "__pycache__",
    ".cache",
    "coverage",
    ".turbo",
    "out",
    ".svelte-kit",
    ".nuxt",
    "Pods",
];

fn is_env_file(name: &str) -> bool {
    name == ".env" || name.starts_with(".env.")
}

fn home() -> String {
    std::env::var("HOME").unwrap_or_default()
}

fn shorten(p: &str, home: &str) -> String {
    if !home.is_empty() && p.starts_with(home) {
        format!("~{}", &p[home.len()..])
    } else {
        p.to_string()
    }
}

fn build_env_file(path: &Path, h: &str) -> Option<EnvFile> {
    let name = path.file_name()?.to_string_lossy().to_string();
    if !is_env_file(&name) {
        return None;
    }
    let dirpath = path.parent().unwrap_or(path);
    let dir = dirpath.to_string_lossy().to_string();
    let short_dir = shorten(&dir, h);
    let keys = fs::read_to_string(path)
        .map(|c| {
            parse_env(&c)
                .into_iter()
                .filter(|l| l.kind == "pair")
                .map(|l| l.key)
                .collect()
        })
        .unwrap_or_default();
    let g = git_meta(dirpath);
    Some(EnvFile {
        path: path.to_string_lossy().to_string(),
        name,
        dir,
        short_dir,
        keys,
        project: g.project,
        subpath: g.subpath,
        branch: g.branch,
        worktree: g.worktree,
        repo_root: g.root,
    })
}

// Streams each .env file to the frontend as it's discovered, so the UI fills in
// progressively instead of freezing until the whole walk + git lookups finish.
#[tauri::command]
async fn scan_stream(
    app: tauri::AppHandle,
    on_event: Channel<EnvFile>,
) -> Result<(), String> {
    let settings = get_settings(app);
    let h = home();
    tauri::async_runtime::spawn_blocking(move || {
        for root in &settings.roots {
            let walker = WalkDir::new(root).follow_links(false).into_iter();
            for entry in walker.filter_entry(|e| {
                if e.file_type().is_dir() {
                    if let Some(n) = e.file_name().to_str() {
                        if EXCLUDE_DIRS.contains(&n) {
                            return false;
                        }
                    }
                }
                true
            }) {
                let entry = match entry {
                    Ok(e) => e,
                    Err(_) => continue,
                };
                if !entry.file_type().is_file() {
                    continue;
                }
                if let Some(ef) = build_env_file(entry.path(), &h) {
                    let _ = on_event.send(ef);
                }
            }
        }
    })
    .await
    .map_err(|e| e.to_string())
}

// ---------- .env parsing / serialization (format-preserving) ----------

#[derive(Serialize, Deserialize, Default, Clone)]
struct EnvLine {
    kind: String, // "pair" | "comment" | "blank"
    #[serde(default)]
    key: String,
    #[serde(default)]
    value: String,
    #[serde(default)]
    export: bool,
    #[serde(default)]
    quote: String, // "" | "\"" | "'"
    #[serde(default)]
    raw: String, // original text for comment/blank lines
}

fn unescape_double(s: &str) -> String {
    let mut out = String::new();
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some('n') => out.push('\n'),
                Some('r') => out.push('\r'),
                Some('t') => out.push('\t'),
                Some('"') => out.push('"'),
                Some('\\') => out.push('\\'),
                Some('$') => out.push('$'),
                Some(other) => {
                    out.push('\\');
                    out.push(other);
                }
                None => out.push('\\'),
            }
        } else {
            out.push(c);
        }
    }
    out
}

fn escape_double(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
        .replace('\t', "\\t")
}

fn unquote(s: &str) -> (String, String) {
    if s.len() >= 2 {
        let bytes = s.as_bytes();
        let first = bytes[0];
        let last = bytes[s.len() - 1];
        if first == b'"' && last == b'"' {
            return (unescape_double(&s[1..s.len() - 1]), "\"".to_string());
        }
        if first == b'\'' && last == b'\'' {
            return (s[1..s.len() - 1].to_string(), "'".to_string());
        }
    }
    (s.to_string(), String::new())
}

fn needs_quote(v: &str) -> bool {
    !v.is_empty()
        && v.chars()
            .any(|c| matches!(c, ' ' | '\t' | '#' | '"' | '\'' | '\n' | '\r' | '$' | '`'))
}

fn serialize_value(value: &str, quote: &str) -> String {
    match quote {
        "'" => {
            // single quotes can't escape; if value contains one, fall back to double quotes
            if value.contains('\'') {
                format!("\"{}\"", escape_double(value))
            } else {
                format!("'{}'", value)
            }
        }
        "\"" => format!("\"{}\"", escape_double(value)),
        _ => {
            if needs_quote(value) {
                format!("\"{}\"", escape_double(value))
            } else {
                value.to_string()
            }
        }
    }
}

fn parse_env(content: &str) -> Vec<EnvLine> {
    let mut lines = Vec::new();
    for raw_line in content.split('\n') {
        let line = raw_line.strip_suffix('\r').unwrap_or(raw_line);
        let trimmed = line.trim_start();

        if trimmed.is_empty() {
            lines.push(EnvLine {
                kind: "blank".into(),
                raw: line.to_string(),
                ..Default::default()
            });
            continue;
        }
        if trimmed.starts_with('#') {
            lines.push(EnvLine {
                kind: "comment".into(),
                raw: line.to_string(),
                ..Default::default()
            });
            continue;
        }

        let (export, rest) = if let Some(r) = trimmed.strip_prefix("export ") {
            (true, r.trim_start())
        } else {
            (false, trimmed)
        };

        if let Some(eq) = rest.find('=') {
            let key = rest[..eq].trim().to_string();
            let valid_key = !key.is_empty()
                && key
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.');
            if valid_key {
                let (value, quote) = unquote(rest[eq + 1..].trim());
                lines.push(EnvLine {
                    kind: "pair".into(),
                    key,
                    value,
                    export,
                    quote,
                    raw: String::new(),
                });
                continue;
            }
        }

        // unrecognized line — preserve verbatim
        lines.push(EnvLine {
            kind: "comment".into(),
            raw: line.to_string(),
            ..Default::default()
        });
    }
    lines
}

fn serialize_env(lines: &[EnvLine]) -> String {
    let parts: Vec<String> = lines
        .iter()
        .map(|l| match l.kind.as_str() {
            "pair" => {
                let prefix = if l.export { "export " } else { "" };
                format!(
                    "{}{}={}",
                    prefix,
                    l.key,
                    serialize_value(&l.value, &l.quote)
                )
            }
            _ => l.raw.clone(),
        })
        .collect();
    parts.join("\n")
}

#[tauri::command]
fn read_env(path: String) -> Result<Vec<EnvLine>, String> {
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    Ok(parse_env(&content))
}

#[tauri::command]
fn write_env(path: String, lines: Vec<EnvLine>) -> Result<(), String> {
    let out = serialize_env(&lines);
    // write atomically: temp file in same dir, then rename over the original
    let tmp = format!("{}.easyenv.tmp", path);
    fs::write(&tmp, out).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        e.to_string()
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn roundtrip(input: &str) -> String {
        serialize_env(&parse_env(input))
    }

    #[test]
    fn preserves_comments_blanks_and_order() {
        let input = "# top comment\n\nFOO=bar\n# mid\nBAZ=qux\n";
        assert_eq!(roundtrip(input), input);
    }

    #[test]
    fn preserves_export_prefix() {
        let input = "export TOKEN=abc123";
        assert_eq!(roundtrip(input), input);
    }

    #[test]
    fn preserves_quote_styles() {
        let input = "A=\"hello world\"\nB='single'\nC=plain";
        assert_eq!(roundtrip(input), input);
    }

    #[test]
    fn preserves_trailing_newline_presence() {
        assert_eq!(roundtrip("X=1\n"), "X=1\n");
        assert_eq!(roundtrip("X=1"), "X=1");
    }

    #[test]
    fn empty_value_stays_unquoted() {
        assert_eq!(roundtrip("EMPTY="), "EMPTY=");
    }

    #[test]
    fn editing_a_value_keeps_everything_else() {
        let mut lines = parse_env("# keep me\nKEY=old\n\nOTHER=2\n");
        for l in lines.iter_mut() {
            if l.key == "KEY" {
                l.value = "new value".into(); // now needs quoting
            }
        }
        assert_eq!(
            serialize_env(&lines),
            "# keep me\nKEY=\"new value\"\n\nOTHER=2\n"
        );
    }

    #[test]
    fn double_quote_escapes_roundtrip() {
        let input = "MSG=\"a \\\"quote\\\" and $var\"";
        // value is decoded then re-encoded identically
        assert_eq!(roundtrip(input), input);
    }

    #[test]
    fn unrecognized_line_preserved_verbatim() {
        let input = "this is not valid env\nGOOD=1";
        assert_eq!(roundtrip(input), input);
    }

    #[test]
    fn env_file_detection() {
        assert!(is_env_file(".env"));
        assert!(is_env_file(".env.local"));
        assert!(is_env_file(".env.production"));
        assert!(!is_env_file("env"));
        assert!(!is_env_file("foo.env"));
    }

    #[test]
    fn worktree_main_root_extraction() {
        // a linked worktree's gitdir points into the MAIN repo's .git/worktrees/
        let gitdir = Path::new("/home/user/projects/acme/.git/worktrees/feature");
        assert_eq!(
            worktree_main_root(gitdir),
            Some(PathBuf::from("/home/user/projects/acme"))
        );
        // a normal (non-worktree) gitdir yields nothing to fold
        assert_eq!(worktree_main_root(Path::new("/repo/.git")), None);
    }

    #[test]
    fn role_dir_promotes_to_parent() {
        // backend is a role dir -> project becomes the parent (acme)
        let (root, proj) = promote_role(Path::new("/home/user/projects/acme/backend"));
        assert_eq!(proj, "acme");
        assert_eq!(root, PathBuf::from("/home/user/projects/acme"));

        // a normal project name is kept as-is
        let (root2, proj2) = promote_role(Path::new("/home/user/projects/myapp"));
        assert_eq!(proj2, "myapp");
        assert_eq!(root2, PathBuf::from("/home/user/projects/myapp"));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            scan_stream,
            read_env,
            write_env
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
