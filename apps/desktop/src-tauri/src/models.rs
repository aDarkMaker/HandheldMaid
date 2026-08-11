//! Live2D model discovery.
//!
//! Scans `assets/models/<id>/runtime/*.model3.json` and returns a list of
//! [`ModelInfo`]. The frontend loads a model from `/assets/<path>` (served by
//! the Vite middleware in dev, bundled in prod), so `path` is relative to the
//! `assets/` directory.

use serde::{Deserialize, Serialize};
use std::path::Path;

/// A bundled Live2D model discovered under `assets/models/`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    /// Stable id = the model directory name (e.g. "wanko", "miku").
    pub id: String,
    /// Display name = the model3.json filename stem (e.g. "wanko_touch").
    pub name: String,
    /// Path relative to `assets/` (e.g. "models/wanko/runtime/wanko_touch.model3.json").
    pub path: String,
}

/// Scan `assets_dir/models/*/runtime/*.model3.json` and list every model.
pub fn list_models(assets_dir: &Path) -> Vec<ModelInfo> {
    let models_root = assets_dir.join("models");
    let mut out = Vec::new();

    let Ok(entries) = std::fs::read_dir(&models_root) else {
        return out;
    };
    for entry in entries.flatten() {
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }
        let id = dir.file_name().and_then(|n| n.to_str()).unwrap_or_default().to_string();
        let runtime = dir.join("runtime");
        let Ok(files) = std::fs::read_dir(&runtime) else {
            continue;
        };
        for f in files.flatten() {
            let p = f.path();
            let is_model = p
                .file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.ends_with(".model3.json"));
            if !is_model {
                continue;
            }
            let name = p
                .file_stem()
                .and_then(|s| s.to_str())
                .map(|s| s.trim_end_matches(".model3").to_string())
                .unwrap_or_else(|| id.clone());
            // path relative to assets/, always with forward slashes.
            let rel = Path::new("models")
                .join(&id)
                .join("runtime")
                .join(p.file_name().expect("model3.json has a filename"));
            out.push(ModelInfo {
                id: id.clone(),
                name,
                path: rel.to_string_lossy().replace('\\', "/"),
            });
        }
    }
    out
}
