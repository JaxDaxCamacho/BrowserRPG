/// The desktop shell: one window showing the game, which is the same web build
/// the browser plays, bundled with its art and sound.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running Allerya Heroes");
}
