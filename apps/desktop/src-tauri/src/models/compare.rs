//! Directory copy + identity comparison for model imports.
//!
//! [`models_identical`] decides whether a dropped model3.json (relative to its
//! own dir) resolves to the same files as an already-archived runtime — the
//! basis for the "same" vs "dup" conflict resolution in [`super::import`].

use super::hash::file_hash;
use std::path::Path;

/// Recursively copy `src` into `dst` (created if missing).
pub(crate) fn copy_dir(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if from.is_dir() {
            copy_dir(&from, &to)?;
        } else if from.is_file() {
            std::fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

/// True if the model3.json at `model3_src` (relative to its own dir) resolves to
/// the same files as the already-archived model rooted at `existing_runtime`.
pub(crate) fn models_identical(model3_src: &Path, existing_runtime: &Path) -> bool {
    let src_dir = model3_src.parent().unwrap_or_else(|| Path::new("."));
    let dst3 = existing_runtime.join(model3_src.file_name().unwrap_or_default());
    if !dst3.is_file() {
        return false;
    }
    if file_hash(model3_src) != file_hash(&dst3) {
        return false;
    }
    // Compare the model3.json-referenced files; fall back to a full recursive
    // hash of both runtime dirs when references can't be resolved.
    let Ok(text) = std::fs::read_to_string(model3_src) else {
        return false;
    };
    let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) else {
        return false;
    };
    let mut refs: Vec<String> = Vec::new();
    if let Some(fr) = json.get("FileReferences") {
        if let Some(m) = fr.get("Moc").and_then(|v| v.as_str()) {
            refs.push(m.to_string());
        }
        for key in ["Physics", "Pose", "DisplayInfo"] {
            if let Some(s) = fr.get(key).and_then(|v| v.as_str()) {
                refs.push(s.to_string());
            }
        }
        for key in ["Textures", "Expressions"] {
            if let Some(arr) = fr.get(key).and_then(|v| v.as_array()) {
                for item in arr {
                    if let Some(s) = item.as_str() {
                        refs.push(s.to_string());
                    } else if let Some(s) = item.get("File").and_then(|v| v.as_str()) {
                        refs.push(s.to_string());
                    }
                }
            }
        }
        if let Some(obj) = fr.get("Motions").and_then(|v| v.as_object()) {
            for (_, v) in obj {
                if let Some(arr) = v.as_array() {
                    for m in arr {
                        if let Some(s) = m.get("File").and_then(|v| v.as_str()) {
                            refs.push(s.to_string());
                        }
                    }
                }
            }
        }
    }
    if refs.is_empty() {
        return runtime_dirs_equal(src_dir, existing_runtime);
    }
    for r in &refs {
        let a = src_dir.join(r);
        let b = existing_runtime.join(r);
        if !a.is_file() || !b.is_file() {
            return false;
        }
        if file_hash(&a) != file_hash(&b) {
            return false;
        }
    }
    true
}

/// Full recursive comparison of two runtime dirs by file hash.
fn runtime_dirs_equal(a: &Path, b: &Path) -> bool {
    let mut ha = Vec::new();
    collect_hashes(a, a, &mut ha);
    let mut hb = Vec::new();
    collect_hashes(b, b, &mut hb);
    ha.sort();
    hb.sort();
    ha == hb
}

fn collect_hashes(root: &Path, dir: &Path, out: &mut Vec<(String, String)>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for e in entries.flatten() {
        let p = e.path();
        if p.is_dir() {
            collect_hashes(root, &p, out);
        } else if p.is_file() {
            let rel = p
                .strip_prefix(root)
                .unwrap_or(&p)
                .to_string_lossy()
                .replace('\\', "/");
            out.push((rel, file_hash(&p)));
        }
    }
}
