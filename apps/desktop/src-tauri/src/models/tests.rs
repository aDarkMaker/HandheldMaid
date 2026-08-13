use super::import::sanitize_id;
use super::*;
use std::fs;
use std::path::PathBuf;

/// Build a minimal valid model dir: `<root>/<id>/runtime/<id>.model3.json`
/// referencing `<id>.moc3` + a texture, plus a readme to test promotion.
fn make_model(root: &Path, id: &str, moc: &str) -> PathBuf {
    let dir = root.join(id);
    let rt = dir.join("runtime");
    fs::create_dir_all(&rt).unwrap();
    fs::write(rt.join(format!("{id}.moc3")), moc).unwrap();
    fs::create_dir_all(rt.join("tex")).unwrap();
    fs::write(rt.join("tex/texture_00.png"), b"png").unwrap();
    fs::write(rt.join("ReadMe.txt"), "note").unwrap();
    let model3 = format!(
        r#"{{"Version":3,"FileReferences":{{"Moc":"{id}.moc3","Textures":["tex/texture_00.png"]}}}}"#
    );
    let p = rt.join(format!("{id}.model3.json"));
    fs::write(&p, model3).unwrap();
    p
}

#[test]
fn import_new_then_same_then_dup() {
    let tmp = std::env::temp_dir().join(format!("hm-import-test-{}", std::process::id()));
    let _ = fs::remove_dir_all(&tmp);
    let assets = tmp.join("assets");
    fs::create_dir_all(assets.join("models")).unwrap();

    // First import: new.
    let src = tmp.join("src");
    let _ = make_model(&src, "haru", "moc-bytes");
    let r = import_model(&assets, &src.join("haru")).unwrap();
    assert_eq!(r.len(), 1);
    assert_eq!(r[0].status, "new");
    assert_eq!(r[0].info.id, "haru");
    assert!(assets
        .join("models/haru/runtime/haru.model3.json")
        .is_file());
    // ReadMe promoted to <id>/, not left in runtime/.
    assert!(assets.join("models/haru/ReadMe.txt").is_file());

    // Re-import identical content: "same", no duplication.
    let r2 = import_model(&assets, &src.join("haru")).unwrap();
    assert_eq!(r2[0].status, "same");
    assert!(!assets.join("models/haru(1)").exists());

    // Import a different model under the same id: suffixed dup.
    let src2 = tmp.join("src2");
    let _ = make_model(&src2, "haru", "different-moc");
    let r3 = import_model(&assets, &src2.join("haru")).unwrap();
    assert_eq!(r3[0].status, "new");
    assert_eq!(r3[0].info.id, "haru(1)");
    assert!(assets.join("models/haru(1)/runtime/haru.moc3").is_file());

    let _ = fs::remove_dir_all(&tmp);
}

#[test]
fn import_rejects_missing_model3() {
    let tmp = std::env::temp_dir().join(format!("hm-import-empty-{}", std::process::id()));
    let _ = fs::remove_dir_all(&tmp);
    let assets = tmp.join("assets");
    fs::create_dir_all(assets.join("models")).unwrap();
    let src = tmp.join("empty");
    fs::create_dir_all(&src).unwrap();
    let err = import_model(&assets, &src).unwrap_err();
    assert_eq!(err.kind(), std::io::ErrorKind::InvalidData);
    let _ = fs::remove_dir_all(&tmp);
}

#[test]
fn sanitize_id_lowercases_and_replaces() {
    assert_eq!(sanitize_id("Haru Pro!"), "haru-pro");
    assert_eq!(sanitize_id("わんこ"), "");
    assert_eq!(sanitize_id("Miku_2024"), "miku_2024");
}

#[test]
fn imported_flag_rename_and_delete() {
    let tmp = std::env::temp_dir().join(format!("hm-meta-test-{}", std::process::id()));
    let _ = fs::remove_dir_all(&tmp);
    let assets = tmp.join("assets");
    fs::create_dir_all(assets.join("models")).unwrap();

    // Import -> flagged imported.
    let src = tmp.join("src");
    let _ = make_model(&src, "haru", "moc");
    let r = import_model(&assets, &src.join("haru")).unwrap();
    assert!(r[0].info.imported);
    let listed = list_models(&assets);
    assert!(listed.iter().any(|m| m.id == "haru" && m.imported));

    // Built-in model (no meta entry) is not imported.
    let _ = make_model(&assets.join("models"), "builtin", "moc");
    let listed = list_models(&assets);
    let bi = listed.iter().find(|m| m.id == "builtin").unwrap();
    assert!(!bi.imported);

    // Rename applies a custom name.
    let renamed = rename_model(&assets, "haru", Some("My Haru")).unwrap();
    assert_eq!(renamed.name, "My Haru");
    assert_eq!(
        list_models(&assets)
            .into_iter()
            .find(|m| m.id == "haru")
            .unwrap()
            .name,
        "My Haru"
    );

    // Rename with None restores the default.
    let restored = rename_model(&assets, "haru", None).unwrap();
    assert_eq!(restored.name, "haru");

    // Deleting a built-in model is refused.
    let err = delete_model(&assets, "builtin").unwrap_err();
    assert_eq!(err.kind(), std::io::ErrorKind::PermissionDenied);
    assert!(assets.join("models/builtin").exists());

    // Deleting an imported model removes its dir + meta entry.
    delete_model(&assets, "haru").unwrap();
    assert!(!assets.join("models/haru").exists());
    assert!(list_models(&assets).iter().all(|m| m.id != "haru"));

    let _ = fs::remove_dir_all(&tmp);
}
