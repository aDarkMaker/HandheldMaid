//! Window manipulation IPC commands: move, resize, hide, click-through, and
//! hit-area registration.

use crate::state::{AppState, HitArea};
use tauri::Manager;

/// Move the window to an absolute top-left position (physical pixels).
/// `x`/`y` are the desired top-left, computed in the renderer from the cursor
/// minus the grab offset — absolute, so drags can't drift from increments.
#[tauri::command]
pub fn move_window(window: tauri::WebviewWindow, x: i32, y: i32) -> Result<(), String> {
    window
        .set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }))
        .map_err(|e| e.to_string())
}

/// Resize the window to a physical size. Keeps the pet's on-screen size
/// stable across DPI / display changes (window sized in physical px, renderer
/// layout in matching CSS px).
#[tauri::command]
pub fn resize_window_physical(window: tauri::WebviewWindow, w: u32, h: u32) -> Result<(), String> {
    window
        .set_size(tauri::Size::Physical(tauri::PhysicalSize {
            width: w,
            height: h,
        }))
        .map_err(|e| e.to_string())
}

/// Resize the window to a physical size while keeping its **bottom edge**
/// fixed on screen. `set_size` keeps the top-left fixed (growing downward),
/// so to grow the window *upward* (the speech bubble above the pet grows
/// upward and must not be clipped by the window top), we compute the current
/// bottom edge and set both the size and the top-left position so the bottom
/// stays put.
///
/// On Windows the size + position are applied as a **single atomic**
/// `SetWindowPos` call. Calling `set_size` then `set_position` separately
/// applies them in two steps with a paint in between, which makes the window
/// (and the model inside) visibly jitter — e.g. when toggling Dev mode, the
/// debug bubble's height change resizes the window and the model jumps. A
/// single `SetWindowPos` with `SWP_NOZORDER | SWP_NOACTIVATE` avoids the
/// intermediate paint.
#[tauri::command]
pub fn resize_window_keep_bottom(
    window: tauri::WebviewWindow,
    w: u32,
    h: u32,
) -> Result<(), String> {
    // Current outer position (top-left) and size, in physical px.
    let pos = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;
    // Bottom edge in screen coords = top + current height.
    let bottom_y = pos.y + size.height as i32;
    // New top-left keeps x and the bottom edge fixed: top = bottom - new height.
    let new_top_y = bottom_y - h as i32;

    #[cfg(windows)]
    {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::{SetWindowPos, SWP_NOACTIVATE, SWP_NOZORDER};
        // The HWND from Tauri is the webview's parent window's HWND.
        let tauri_hwnd = window.hwnd().map_err(|e| e.to_string())?;
        let hwnd = HWND(tauri_hwnd.0 as *mut core::ffi::c_void);
        // x, y, w, h all set in one call. SWP_NOZORDER ignores the z-order
        // (hwnd_insert_after), so pass None; SWP_NOACTIVATE avoids stealing focus.
        let r = unsafe {
            SetWindowPos(
                hwnd,
                None,
                pos.x,
                new_top_y,
                w as i32,
                h as i32,
                SWP_NOZORDER | SWP_NOACTIVATE,
            )
        };
        r.map_err(|e| e.to_string()).map(|_| ())
    }

    #[cfg(not(windows))]
    {
        window
            .set_size(tauri::Size::Physical(tauri::PhysicalSize {
                width: w,
                height: h,
            }))
            .map_err(|e| e.to_string())?;
        window
            .set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                x: pos.x,
                y: new_top_y,
            }))
            .map_err(|e| e.to_string())
    }
}

/// Hide the main pet window. Called by the frontend after it finishes fading
/// the model out (triggered by `hm://panel-opening`), so the disappear is
/// smooth rather than an instant hide.
#[tauri::command]
pub fn hide_main_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.hide();
    }
    Ok(())
}

#[tauri::command]
pub fn set_ignore_mouse_events(window: tauri::WebviewWindow, ignore: bool) -> Result<(), String> {
    window
        .set_ignore_cursor_events(ignore)
        .map_err(|e| e.to_string())
}

/// Register the pet's screen-space hit area for dynamic click-through.
/// Called by the frontend after the model is laid out (and on move/resize).
#[tauri::command]
pub fn register_hit_area(
    state: tauri::State<AppState>,
    x: i32,
    y: i32,
    w: i32,
    h: i32,
) -> Result<(), String> {
    tracing::info!(x, y, w, h, "register hit area");
    *state.hit_area.lock().unwrap() = Some(HitArea { x, y, w, h });
    Ok(())
}
