//! Live2D model import: ingest a dropped folder or archive of one or more
//! models, archiving each under the canonical `models/<id>/runtime/` layout.
//!
//! Archives are extracted into a temp dir first (via `hm_mcp::archive`); folders
//! are used directly. Every discovered model3.json is archived. A conflict (same
//! id already present) is resolved by content hash: identical -> "same" (skipped),
//! different -> suffixed `(1)`/`(2)`.

use super::compare::{copy_dir, models_identical};
use super::meta::{load_meta, mark_imported};
use super::{ImportedModel, ModelInfo};
use serde::Deserialize;
use std::path::{Path, PathBuf};

/// Minimal model3.json shape — only what we need to validate an import.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Model3 {
    #[serde(default)]
    version: serde_json::Value,
    #[serde(default)]
    file_references: FileReferences,
}

#[derive(Debug, Default, Deserialize)]
struct FileReferences {
    #[serde(default, rename = "Moc")]
    moc: Option<String>,
}

/// Import one or more Live2D models from a dropped folder or archive.
/// Archives are extracted into a temp dir first; folders are used directly.
/// Every discovered model3.json is archived under `models/<id>/runtime/`,
/// duplicating `existing`/`same` models instead of overwriting.
pub fn import_model(assets_dir: &Path, source: &Path) -> std::io::Result<Vec<ImportedModel>> {
    let work_root;
    let work_dir: PathBuf;
    if source.is_file() {
        let tmp = std::env::temp_dir().join(format!("hm-import-{}", std::process::id()));
        std::fs::create_dir_all(&tmp)?;
        let dir = tmp.join(stem_or_name(source));
        std::fs::create_dir_all(&dir)?;
        hm_mcp::archive::extract_archive(source, &dir)
            .map_err(|e| std::io::Error::other(format!("extract: {e}")))?;
        work_root = Some(tmp);
        work_dir = dir;
    } else if source.is_dir() {
        work_root = None;
        work_dir = source.to_path_buf();
    } else {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "source is neither a file nor a directory",
        ));
    }

    let model3s = find_model3_files(&work_dir);
    if model3s.is_empty() {
        if let Some(tmp) = &work_root {
            let _ = std::fs::remove_dir_all(tmp);
        }
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "not a Live2D model: no .model3.json found",
        ));
    }

    let mut out = Vec::with_capacity(model3s.len());
    for m3 in &model3s {
        match import_one(assets_dir, m3) {
            Ok(im) => out.push(im),
            Err(e) => tracing::warn!(error = %e, "skipping model3.json during import"),
        }
    }

    if let Some(tmp) = &work_root {
        let _ = std::fs::remove_dir_all(tmp);
    }

    if out.is_empty() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "no valid Live2D model found (invalid model3.json)",
        ));
    }
    Ok(out)
}

/// Archive a single model3.json under its resolved id.
fn import_one(assets_dir: &Path, model3: &Path) -> std::io::Result<ImportedModel> {
    let models_root = assets_dir.join("models");
    let text = std::fs::read_to_string(model3)?;
    let parsed: Model3 = serde_json::from_str(&text).map_err(|e| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("invalid model3.json: {e}"),
        )
    })?;
    if parsed.version == serde_json::Value::Null {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "invalid model3.json: missing Version",
        ));
    }
    let src_runtime = model3.parent().unwrap_or_else(|| Path::new("."));
    if let Some(moc) = &parsed.file_references.moc {
        if !src_runtime.join(moc).is_file() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("model3.json references missing Moc: {moc}"),
            ));
        }
    }

    // Derive the id from the model3.json's grandparent (the model dir) when the
    // layout is `<id>/runtime/<name>.model3.json`; fall back to the parent, then
    // to the file stem, then to a generic "model".
    let raw_id = [2usize, 1]
        .into_iter()
        .map_while(|n| model3.ancestors().nth(n))
        .find_map(|p| p.file_name())
        .and_then(|n| n.to_str())
        .filter(|s| !s.is_empty() && *s != "runtime")
        .unwrap_or_else(|| {
            model3
                .file_stem()
                .and_then(|s| s.to_str())
                .map(|s| s.trim_end_matches(".model3"))
                .unwrap_or("model")
        });
    let base = if sanitize_id(raw_id).is_empty() {
        "model".to_string()
    } else {
        sanitize_id(raw_id)
    };

    let (id, status) = resolve_target_id(&models_root, &base, model3);
    if status == "same" {
        let info = info_for(assets_dir, &id, model3);
        return Ok(ImportedModel { info, status });
    }

    let target_dir = models_root.join(&id);
    let target_runtime = target_dir.join("runtime");
    if target_runtime.exists() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            format!("target exists: {}", target_runtime.display()),
        ));
    }
    std::fs::create_dir_all(&target_runtime)?;
    copy_dir(src_runtime, &target_runtime)?;

    // Promote creator readmes / license notes to <id>/ per the archive layout.
    promote_readmes(&target_dir, &target_runtime);

    // Record the imported flag so the user can later delete this model.
    mark_imported(assets_dir, &id);

    let info = info_for(assets_dir, &id, model3);
    Ok(ImportedModel {
        info,
        status: "new".to_string(),
    })
}

/// Build the ModelInfo for an archived model rooted at `models_root/<id>`.
fn info_for(assets_dir: &Path, id: &str, model3: &Path) -> ModelInfo {
    let name = display_name(model3);
    let meta = load_meta(assets_dir);
    let entry = meta.models.get(id);
    let name = entry.and_then(|e| e.name.clone()).unwrap_or(name);
    let imported = entry.map(|e| e.imported).unwrap_or(false);
    let rel = Path::new("models")
        .join(id)
        .join("runtime")
        .join(model3.file_name().unwrap_or_default());
    ModelInfo {
        id: id.to_string(),
        name,
        path: rel.to_string_lossy().replace('\\', "/"),
        imported,
    }
}

/// Pick a non-conflicting target id under `models_root`. Same content as an
/// existing id -> ("same", existing). Different content -> suffix `(1)`,`(2)`.
fn resolve_target_id(models_root: &Path, base: &str, model3_src: &Path) -> (String, String) {
    let base_dir = models_root.join(base);
    if !base_dir.exists() {
        return (base.to_string(), "new".to_string());
    }
    let existing_runtime = base_dir.join("runtime");
    if models_identical(model3_src, &existing_runtime) {
        return (base.to_string(), "same".to_string());
    }
    let mut i = 1;
    loop {
        let cand = format!("{base}({i})");
        let cand_dir = models_root.join(&cand);
        if !cand_dir.exists() {
            return (cand, "new".to_string());
        }
        if models_identical(model3_src, &cand_dir.join("runtime")) {
            return (cand, "same".to_string());
        }
        i += 1;
    }
}

/// Recursively find every `*.model3.json` under `root`, sorted for stable order.
fn find_model3_files(root: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for e in entries.flatten() {
            let p = e.path();
            if p.is_dir() {
                walk(&p, out);
            } else if p
                .file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.ends_with(".model3.json"))
            {
                out.push(p);
            }
        }
    }
    walk(root, &mut out);
    out.sort();
    out
}

/// Sanitize a raw id: lowercase, non `[a-z0-9_-]` -> `-`, trimmed/colapsed.
pub(super) fn sanitize_id(raw: &str) -> String {
    let s: String = raw
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    s.trim_matches('-').to_string()
}

/// Derive the display name from a model3.json path: the `.model3` stem.
fn display_name(model3: &Path) -> String {
    model3
        .file_stem()
        .and_then(|s| s.to_str())
        .map(|s| s.trim_end_matches(".model3").to_string())
        .unwrap_or_default()
}

/// Move creator `ReadMe.txt` / license / instruction notes from `runtime/` up
/// to the model root `<id>/`, matching the bundled wanko/miku layout. Files
/// already at the root are left untouched.
fn promote_readmes(root: &Path, runtime: &Path) {
    let Ok(entries) = std::fs::read_dir(runtime) else {
        return;
    };
    for e in entries.flatten() {
        let p = e.path();
        if !p.is_file() {
            continue;
        }
        let Some(name) = p.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        let lower = name.to_lowercase();
        let is_note = lower.ends_with(".txt")
            && (lower.contains("readme") || lower.contains("license") || lower.contains("说明"));
        if !is_note {
            continue;
        }
        let dst = root.join(name);
        if dst.exists() {
            continue;
        }
        let _ = std::fs::rename(&p, &dst);
    }
}

fn stem_or_name(path: &Path) -> String {
    if let Some(s) = path.file_stem().and_then(|s| s.to_str()) {
        return s.to_string();
    }
    path.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("import")
        .to_string()
}
