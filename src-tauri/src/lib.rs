// TRACKLANDS native shell. The game is the unchanged web build (HTML, CSS,
// JavaScript, Three.js, Web Audio) staged into dist/native; this host only
// opens it in a window and adds the two plugins the game uses for the save
// export "save as" dialog. No game logic lives here.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("error while running TRACKLANDS");
}
