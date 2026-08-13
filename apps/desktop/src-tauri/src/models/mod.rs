//! Live2D model discovery, metadata, and import.
//!
//! [`list_models`] scans `assets/models/<id>/runtime/*.model3.json` and returns
//! [`ModelInfo`] (`path` is relative to `assets/` so the frontend can load
//! `/assets/<path>`). [`import::import_model`] ingests a dropped folder or
//! archive of one or more models, archiving each under the canonical
//! `models/<id>/runtime/` layout; [`rename_model`] / [`delete_model`] manage
//! custom names and imported-model deletion.
//!
//! Submodules:
//! - [`meta`]    `.meta.json` persistence (custom name + imported flag)
//! - [`import`]  drop ingestion, conflict resolution, archive layout
//! - [`compare`] directory copy + content-hash identity comparison
//! - [`hash`]    SHA-256 (no external dep)

mod compare;
mod hash;
mod import;
mod meta;

use serde::{Deserialize, Serialize};
use std::path::Path;

#[cfg(test)]
mod tests;

/// A bundled Live2D model discovered under `assets/models/`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    /// Stable id = the model directory name (e.g. "wanko", "miku").
    pub id: String,
    /// Display name = the model3.json filename stem (e.g. "wanko_touch").
    pub name: String,
    /// Path relative to `assets/` (e.g. "models/wanko/runtime/wanko_touch.model3.json").
    pub path: String,
    /// `true` if the model was imported via drag-drop (user can delete it).
    #[serde(default)]
    pub imported: bool,
}

/// Result of importing a single model from a drop.
#[derive(Debug, Clone, Serialize)]
pub struct ImportedModel {
    #[serde(flatten)]
    pub info: ModelInfo,
    /// "new" | "same" (already present, identical) | "dup" (id taken by a
    /// different model, archived under a suffixed id instead).
    pub status: String,
}

/// Scan `assets_dir/models/*/runtime/*.model3.json` and list every model.
/// Applies `.meta.json` overrides (custom name, imported flag).
pub fn list_models(assets_dir: &Path) -> Vec<ModelInfo> {
    let models_root = assets_dir.join("models");
    let meta = meta::load_meta(assets_dir);
    let mut out = Vec::new();

    let Ok(entries) = std::fs::read_dir(&models_root) else {
        return out;
    };
    for entry in entries.flatten() {
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }
        let id = dir
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default()
            .to_string();
        let runtime = dir.join("runtime");
        let Ok(files) = std::fs::read_dir(&runtime) else {
            continue;
        };
        let entry_meta = meta.models.get(&id);
        let imported = entry_meta.map(|e| e.imported).unwrap_or(false);
        for f in files.flatten() {
            let p = f.path();
            let is_model = p
                .file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.ends_with(".model3.json"));
            if !is_model {
                continue;
            }
            let default_name = p
                .file_stem()
                .and_then(|s| s.to_str())
                .map(|s| s.trim_end_matches(".model3").to_string())
                .unwrap_or_else(|| id.clone());
            let name = entry_meta
                .and_then(|e| e.name.clone())
                .unwrap_or(default_name);
            // path relative to assets/, always with forward slashes.
            let rel = Path::new("models")
                .join(&id)
                .join("runtime")
                .join(p.file_name().expect("model3.json has a filename"));
            out.push(ModelInfo {
                id: id.clone(),
                name,
                path: rel.to_string_lossy().replace('\\', "/"),
                imported,
            });
        }
    }
    out
}

/// Import Live2D model(s) from a dropped folder or archive. See [`import`].
pub fn import_model(assets_dir: &Path, source: &Path) -> std::io::Result<Vec<ImportedModel>> {
    import::import_model(assets_dir, source)
}

/// Set a custom display name for a model (any model). Empty/None clears it,
/// restoring the model3.json filename stem. Returns the updated ModelInfo, or
/// an error if the model doesn't exist.
pub fn rename_model(assets_dir: &Path, id: &str, name: Option<&str>) -> std::io::Result<ModelInfo> {
    let models_root = assets_dir.join("models");
    let dir = models_root.join(id);
    if !dir.is_dir() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("model not found: {id}"),
        ));
    }
    meta::set_model_name(assets_dir, id, name);
    list_models(assets_dir)
        .into_iter()
        .find(|m| m.id == id)
        .ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::NotFound,
                format!("model not found: {id}"),
            )
        })
}

/// Permanently delete an imported model (directory + metadata entry). Refuses
/// built-in (non-imported) models.
pub fn delete_model(assets_dir: &Path, id: &str) -> std::io::Result<()> {
    meta::delete_imported_model(assets_dir, id)
}
