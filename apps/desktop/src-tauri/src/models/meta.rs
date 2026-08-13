//! Per-model metadata persistence (`assets/models/.meta.json`).
//!
//! Stores overrides the filesystem can't infer: a custom display name and the
//! `imported` flag (which gates deletion). Built-in models (wanko/miku) default
//! to `imported = false`.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub(crate) struct ModelMeta {
    #[serde(default)]
    pub models: std::collections::BTreeMap<String, ModelEntry>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub(crate) struct ModelEntry {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default)]
    pub imported: bool,
}

const META_FILE: &str = ".meta.json";

fn meta_path(assets_dir: &Path) -> PathBuf {
    assets_dir.join("models").join(META_FILE)
}

pub(crate) fn load_meta(assets_dir: &Path) -> ModelMeta {
    std::fs::read_to_string(meta_path(assets_dir))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_meta(assets_dir: &Path, meta: &ModelMeta) {
    if let Ok(s) = serde_json::to_string_pretty(meta) {
        let _ = std::fs::write(meta_path(assets_dir), s);
    }
}

/// Mark a model id as imported in the metadata, persisting it.
pub(crate) fn mark_imported(assets_dir: &Path, id: &str) {
    let mut meta = load_meta(assets_dir);
    meta.models.entry(id.to_string()).or_default().imported = true;
    save_meta(assets_dir, &meta);
}

/// Set/override a model's display name, persisting it. `None` clears it.
pub(crate) fn set_model_name(assets_dir: &Path, id: &str, name: Option<&str>) {
    let mut meta = load_meta(assets_dir);
    let entry = meta.models.entry(id.to_string()).or_default();
    entry.name = name.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    save_meta(assets_dir, &meta);
}

/// Permanently delete an imported model's directory and its metadata entry.
/// Refuses built-in (non-imported) models.
pub(crate) fn delete_imported_model(assets_dir: &Path, id: &str) -> std::io::Result<()> {
    let mut meta = load_meta(assets_dir);
    let imported = meta.models.get(id).map(|e| e.imported).unwrap_or(false);
    if !imported {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "only imported models can be deleted",
        ));
    }
    let dir = assets_dir.join("models").join(id);
    if dir.exists() {
        std::fs::remove_dir_all(&dir)?;
    }
    meta.models.remove(id);
    save_meta(assets_dir, &meta);
    Ok(())
}
