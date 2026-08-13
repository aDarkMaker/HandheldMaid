//! Archive tool: compress folders and extract archives.
//!
//! Format is chosen by platform to match local conventions: `.zip` on Windows,
//! `.tar.gz` on macOS. Extraction auto-detects the format from the file
//! extension. Archives are created next to the source (compress) or in a
//! same-named subfolder next to the archive (extract). Existing outputs are
//! rejected rather than overwritten.

use async_trait::async_trait;
use hm_core::tool::{Tool, ToolError};
use serde_json::{json, Value};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// Tool name, exposed for registration wiring.
pub const NAME: &str = "archive";

/// The archive file extension this platform produces on compress.
fn platform_ext() -> &'static str {
    if cfg!(target_os = "macos") {
        ".tar.gz"
    } else {
        ".zip"
    }
}

/// `archive` tool: compress a folder or extract an archive.
///
/// `action` is `"compress"` or `"extract"`; `path` is the absolute target. The
/// output is placed alongside the input: compress writes `<path><ext>`, extract
/// writes a `<stem>/` subfolder. Existing outputs are rejected.
pub struct ArchiveTool;

impl ArchiveTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for ArchiveTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for ArchiveTool {
    fn name(&self) -> &str {
        NAME
    }

    fn description(&self) -> &str {
        "Compress a folder into an archive, or extract an archive into a subfolder. \
         Output is placed next to the input. Existing outputs are rejected."
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["compress", "extract"],
                    "description": "Compress a folder, or extract an archive."
                },
                "path": {
                    "type": "string",
                    "description": "Absolute path of the folder to compress, or archive to extract."
                }
            },
            "required": ["action", "path"]
        })
    }

    async fn execute(&self, args: Value) -> Result<Value, ToolError> {
        let action = args
            .get("action")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::InvalidArgs("missing `action`".into()))?;
        let path = args
            .get("path")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::InvalidArgs("missing `path`".into()))?;
        let path = PathBuf::from(path);

        match action {
            "compress" => {
                let out = compress(&path)?;
                Ok(json!({ "ok": true, "action": "compress", "output": out.to_string_lossy() }))
            }
            "extract" => {
                let out = extract(&path)?;
                Ok(json!({ "ok": true, "action": "extract", "output": out.to_string_lossy() }))
            }
            other => Err(ToolError::InvalidArgs(format!("unknown action: {other}"))),
        }
    }
}

/// Compress `src` (a folder) into an archive next to it. Format is platform
/// default (`.tar.gz` on macOS, `.zip` elsewhere).
fn compress(src: &Path) -> Result<PathBuf, ToolError> {
    if !src.is_dir() {
        return Err(ToolError::InvalidArgs(format!(
            "not a folder: {}",
            src.display()
        )));
    }
    let name = src
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let out = src
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join(format!("{name}{}", platform_ext()));
    if out.exists() {
        return Err(ToolError::Execution(format!(
            "output exists: {}",
            out.display()
        )));
    }

    if cfg!(target_os = "macos") {
        compress_tar_gz(src, &out)?;
    } else {
        compress_zip(src, &out)?;
    }
    Ok(out)
}

/// Extract `archive` into a same-named subfolder next to it. Format is detected
/// from the extension (`.zip`, `.tar.gz`, `.tgz`).
fn extract(archive: &Path) -> Result<PathBuf, ToolError> {
    if !archive.is_file() {
        return Err(ToolError::InvalidArgs(format!(
            "not a file: {}",
            archive.display()
        )));
    }
    let stem = archive_stem(archive);
    let out = archive
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join(&stem);
    if out.exists() {
        return Err(ToolError::Execution(format!(
            "output exists: {}",
            out.display()
        )));
    }
    fs::create_dir_all(&out).map_err(|e| ToolError::Execution(format!("create dir: {e}")))?;

    let name = archive
        .file_name()
        .map(|n| n.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if name.ends_with(".zip") {
        extract_zip(archive, &out)?;
    } else if name.ends_with(".tar.gz") || name.ends_with(".tgz") {
        extract_tar_gz(archive, &out)?;
    } else {
        // Clean up the empty folder we just made.
        let _ = fs::remove_dir(&out);
        return Err(ToolError::InvalidArgs(format!(
            "unsupported archive: {}",
            archive.display()
        )));
    }
    Ok(out)
}

/// Extract any supported archive (`.zip` / `.tar.gz` / `.tgz`) into `out_dir`,
/// which must already exist. Format is detected from the extension. Reuses the
/// private extractors (which guard against zip-slip / tar-slip).
pub fn extract_archive(archive: &Path, out_dir: &Path) -> Result<(), ToolError> {
    if !archive.is_file() {
        return Err(ToolError::InvalidArgs(format!(
            "not a file: {}",
            archive.display()
        )));
    }
    let name = archive
        .file_name()
        .map(|n| n.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if name.ends_with(".zip") {
        extract_zip(archive, out_dir)
    } else if name.ends_with(".tar.gz") || name.ends_with(".tgz") {
        extract_tar_gz(archive, out_dir)
    } else {
        Err(ToolError::InvalidArgs(format!(
            "unsupported archive: {}",
            archive.display()
        )))
    }
}

/// The archive's base name without a `.zip` / `.tar.gz` / `.tgz` extension.
fn archive_stem(path: &Path) -> String {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    for ext in [".tar.gz", ".tgz", ".zip"] {
        if name.to_lowercase().ends_with(ext) {
            return name[..name.len() - ext.len()].to_string();
        }
    }
    name
}

// ── zip ─────────────────────────────────────────────────────────────────────

fn compress_zip(src: &Path, out: &Path) -> Result<(), ToolError> {
    let file =
        fs::File::create(out).map_err(|e| ToolError::Execution(format!("create file: {e}")))?;
    let mut writer = zip::ZipWriter::new(file);
    let opts = zip::write::SimpleFileOptions::default();

    let mut entries: Vec<PathBuf> = Vec::new();
    collect_entries(src, src, &mut entries)
        .map_err(|e| ToolError::Execution(format!("walk: {e}")))?;
    for entry in &entries {
        // Store paths relative to the source (no top-level folder name), so
        // extracting into a same-named subfolder reproduces the original layout
        // without an extra nesting level.
        let rel = entry.strip_prefix(src).unwrap_or(entry);
        let zip_name = rel.to_string_lossy().replace('\\', "/");
        if entry.is_dir() {
            writer
                .add_directory(format!("{zip_name}/"), opts)
                .map_err(|e| ToolError::Execution(format!("zip dir: {e}")))?;
        } else {
            writer
                .start_file(zip_name, opts)
                .map_err(|e| ToolError::Execution(format!("zip file: {e}")))?;
            let mut f =
                fs::File::open(entry).map_err(|e| ToolError::Execution(format!("open: {e}")))?;
            io::copy(&mut f, &mut writer)
                .map_err(|e| ToolError::Execution(format!("write: {e}")))?;
        }
    }
    writer
        .finish()
        .map_err(|e| ToolError::Execution(format!("finish zip: {e}")))?;
    Ok(())
}

fn extract_zip(archive: &Path, out: &Path) -> Result<(), ToolError> {
    let file = fs::File::open(archive).map_err(|e| ToolError::Execution(format!("open: {e}")))?;
    let mut zip =
        zip::ZipArchive::new(file).map_err(|e| ToolError::Execution(format!("read zip: {e}")))?;
    for i in 0..zip.len() {
        let mut entry = zip
            .by_index(i)
            .map_err(|e| ToolError::Execution(format!("zip entry: {e}")))?;
        let name = entry
            .enclosed_name()
            .ok_or_else(|| ToolError::Execution("unsafe zip entry name".into()))?;
        let target = out.join(&name);
        // Ensure the resolved path stays inside `out` (no zip-slip).
        if !target.starts_with(out) {
            return Err(ToolError::Execution(format!(
                "zip entry escapes output dir: {}",
                name.display()
            )));
        }
        if entry.is_dir() {
            fs::create_dir_all(&target).map_err(|e| ToolError::Execution(format!("mkdir: {e}")))?;
        } else {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| ToolError::Execution(format!("mkdir: {e}")))?;
            }
            let mut f = fs::File::create(&target)
                .map_err(|e| ToolError::Execution(format!("create: {e}")))?;
            io::copy(&mut entry, &mut f)
                .map_err(|e| ToolError::Execution(format!("write: {e}")))?;
        }
    }
    Ok(())
}

// ── tar.gz ──────────────────────────────────────────────────────────────────

fn compress_tar_gz(src: &Path, out: &Path) -> Result<(), ToolError> {
    let file =
        fs::File::create(out).map_err(|e| ToolError::Execution(format!("create file: {e}")))?;
    let gz = flate2::write::GzEncoder::new(file, flate2::Compression::default());
    let mut builder = tar::Builder::new(gz);

    let mut entries: Vec<PathBuf> = Vec::new();
    collect_entries(src, src, &mut entries)
        .map_err(|e| ToolError::Execution(format!("walk: {e}")))?;
    for entry in &entries {
        // Store paths relative to the source (no top-level folder name).
        let rel = entry.strip_prefix(src).unwrap_or(entry);
        builder
            .append_path_with_name(entry, rel)
            .map_err(|e| ToolError::Execution(format!("tar append: {e}")))?;
    }
    builder
        .finish()
        .map_err(|e| ToolError::Execution(format!("finish tar: {e}")))?;
    Ok(())
}

fn extract_tar_gz(archive: &Path, out: &Path) -> Result<(), ToolError> {
    let file = fs::File::open(archive).map_err(|e| ToolError::Execution(format!("open: {e}")))?;
    let gz = flate2::read::GzDecoder::new(file);
    let mut tar = tar::Archive::new(gz);
    for entry in tar
        .entries()
        .map_err(|e| ToolError::Execution(format!("read tar: {e}")))?
    {
        let mut entry = entry.map_err(|e| ToolError::Execution(format!("tar entry: {e}")))?;
        let name = entry
            .path()
            .map_err(|e| ToolError::Execution(format!("tar path: {e}")))?;
        let name = name.into_owned();
        let target = out.join(&name);
        // Guard against path traversal (tar-slip).
        if !target.starts_with(out) {
            return Err(ToolError::Execution(format!(
                "tar entry escapes output dir: {}",
                name.display()
            )));
        }
        entry
            .unpack(&target)
            .map_err(|e| ToolError::Execution(format!("unpack: {e}")))?;
    }
    Ok(())
}

// ── helpers ─────────────────────────────────────────────────────────────────

/// Recursively collect all entries under `root` (depth-first), relative paths
/// included so empty directories are preserved.
fn collect_entries(root: &Path, dir: &Path, out: &mut Vec<PathBuf>) -> io::Result<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        out.push(path.clone());
        if path.is_dir() {
            collect_entries(root, &path, out)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmp(test_name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("hm-archive-{}-{}", std::process::id(), test_name));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn archive_stem_strips_extensions() {
        assert_eq!(archive_stem(Path::new("/x/foo.zip")), "foo");
        assert_eq!(archive_stem(Path::new("/x/foo.tar.gz")), "foo");
        assert_eq!(archive_stem(Path::new("/x/foo.tgz")), "foo");
        assert_eq!(archive_stem(Path::new("/x/foo.bar")), "foo.bar");
    }

    #[test]
    fn compress_then_extract_round_trip() {
        let dir = tmp("round_trip");
        let src = dir.join("sample");
        fs::create_dir_all(&src).unwrap();
        fs::write(src.join("a.txt"), "hello").unwrap();
        fs::create_dir_all(src.join("sub")).unwrap();
        fs::write(src.join("sub").join("b.txt"), "world").unwrap();

        let archive = compress(&src).unwrap();
        assert!(archive.exists());
        // Remove the source so extracting (which outputs to `sample/`) doesn't
        // collide with the still-present source folder.
        fs::remove_dir_all(&src).unwrap();

        let extracted = extract(&archive).unwrap();
        assert!(extracted.is_dir());
        assert_eq!(
            fs::read_to_string(extracted.join("a.txt")).unwrap(),
            "hello"
        );
        assert_eq!(
            fs::read_to_string(extracted.join("sub").join("b.txt")).unwrap(),
            "world"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn compress_rejects_existing_output() {
        let dir = tmp("reject_existing");
        let src = dir.join("sample");
        fs::create_dir_all(&src).unwrap();
        fs::write(src.join("a.txt"), "x").unwrap();
        // First compress succeeds.
        compress(&src).unwrap();
        // Second compress collides with the existing archive.
        let err = compress(&src).unwrap_err();
        assert!(matches!(err, ToolError::Execution(_)));
        let _ = fs::remove_dir_all(&dir);
    }
}
