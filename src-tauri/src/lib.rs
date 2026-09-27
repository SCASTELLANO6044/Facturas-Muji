mod renamer;

use renamer::{Plan, Preview};
use serde::Serialize;
use std::sync::Mutex;
use tauri::State;

#[derive(Default)]
struct Session {
    preview: Option<Plan>,
    undo: Option<Plan>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Outcome {
    count: usize,
    can_undo: bool,
    warning: Option<String>,
}

#[tauri::command]
async fn preview_rename(
    folder: String,
    prefix: String,
    start: u32,
    skip_numbers: Vec<u32>,
    state: State<'_, Mutex<Session>>,
) -> Result<Preview, String> {
    let mut session = state
        .lock()
        .map_err(|_| "The app session is unavailable. Restart the app.")?;
    session.preview = None;
    let plan = renamer::make_plan(&folder, &prefix, start, &skip_numbers)?;
    let preview = plan.preview.clone();
    session.preview = Some(plan);
    Ok(preview)
}

#[tauri::command]
async fn apply_rename(id: String, state: State<'_, Mutex<Session>>) -> Result<Outcome, String> {
    let mut session = state
        .lock()
        .map_err(|_| "The app session is unavailable. Restart the app.")?;
    let plan = session
        .preview
        .take()
        .ok_or("Refresh the preview before renaming.")?;
    if plan.preview.id != id {
        return Err("This preview has expired. Refresh and try again.".into());
    }
    let count = renamer::execute(&plan)?;
    if count == 0 {
        return Ok(Outcome {
            count,
            can_undo: session.undo.is_some(),
            warning: None,
        });
    }
    match renamer::reverse_plan(&plan) {
        Ok(undo) => {
            session.undo = Some(undo);
            Ok(Outcome {
                count,
                can_undo: true,
                warning: None,
            })
        }
        Err(e) => {
            session.undo = None;
            Ok(Outcome {
                count,
                can_undo: false,
                warning: Some(format!("Files were renamed, but undo is unavailable: {e}")),
            })
        }
    }
}

#[tauri::command]
async fn undo_rename(state: State<'_, Mutex<Session>>) -> Result<Outcome, String> {
    let mut session = state
        .lock()
        .map_err(|_| "The app session is unavailable. Restart the app.")?;
    let plan = session
        .undo
        .as_ref()
        .ok_or("There is no batch to undo in this session.")?;
    let count = renamer::execute(plan)?;
    session.undo = None;
    session.preview = None;
    Ok(Outcome {
        count,
        can_undo: false,
        warning: None,
    })
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Mutex::new(Session::default()))
        .invoke_handler(tauri::generate_handler![
            preview_rename,
            apply_rename,
            undo_rename
        ])
        .run(tauri::generate_context!())
        .expect("Could not start Facturas Muji");
}
