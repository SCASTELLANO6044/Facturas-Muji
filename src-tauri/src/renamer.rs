use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs, io,
    path::{Path, PathBuf},
    time::SystemTime,
};
use uuid::Uuid;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FileStamp {
    pub name: String,
    size: u64,
    modified: SystemTime,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RenameRow {
    pub original: String,
    pub renamed: String,
    pub size: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub id: String,
    pub folder: String,
    pub rows: Vec<RenameRow>,
    pub skipped: usize,
    pub first_number: u32,
    pub last_number: u32,
}

pub struct Plan {
    pub preview: Preview,
    pub directory: PathBuf,
    pub snapshot: Vec<FileStamp>,
}

fn error(context: &str, e: impl std::fmt::Display) -> String {
    format!("{context}: {e}")
}

pub fn scan(directory: &Path) -> Result<(Vec<FileStamp>, usize), String> {
    let mut files = Vec::new();
    let mut skipped = 0;
    for entry in fs::read_dir(directory).map_err(|e| error("Could not read this folder", e))? {
        let entry = entry.map_err(|e| error("Could not read a folder entry", e))?;
        // symlink_metadata deliberately excludes links, including links to regular files.
        let metadata = fs::symlink_metadata(entry.path())
            .map_err(|e| error("Could not read file details", e))?;
        if !metadata.file_type().is_file() {
            skipped += 1;
            continue;
        }
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| "A filename contains unsupported characters.")?;
        files.push(FileStamp {
            name,
            size: metadata.len(),
            modified: metadata
                .modified()
                .map_err(|e| error("Could not read modification time", e))?,
        });
    }
    files.sort_by(|a, b| {
        natord::compare(&a.name.to_lowercase(), &b.name.to_lowercase()).then(a.name.cmp(&b.name))
    });
    Ok((files, skipped))
}

pub fn make_plan(
    folder: &str,
    prefix: &str,
    start: u32,
    skip_numbers: &[u32],
) -> Result<Plan, String> {
    let prefix = prefix.trim();
    if prefix.is_empty()
        || prefix
            .chars()
            .any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
        || prefix.ends_with('.')
    {
        return Err(
            "Enter a filename prefix without Windows-reserved characters or a trailing period."
                .into(),
        );
    }
    if start > 99_999 {
        return Err("The starting number must be between 00000 and 99999.".into());
    }
    if skip_numbers.len() > 100_000 || skip_numbers.iter().any(|n| *n > 99_999) {
        return Err("Skipped numbers must be between 00000 and 99999.".into());
    }
    let excluded: HashSet<u32> = skip_numbers.iter().copied().collect();
    let directory = fs::canonicalize(folder).map_err(|e| error("Could not open this folder", e))?;
    let (snapshot, skipped) = scan(&directory)?;
    if snapshot.is_empty() {
        return Err(
            "There are no files in this folder. Subfolders and links are not included.".into(),
        );
    }
    if snapshot.len() as u64 + start as u64 > 100_000 {
        return Err("This batch would exceed 99999. Choose a lower starting number.".into());
    }
    let mut rows = Vec::new();
    let mut next_number = start;
    let mut first_number = start;
    let mut last_number = start;
    for file in &snapshot {
        while next_number <= 99_999 && excluded.contains(&next_number) {
            next_number += 1;
        }
        if next_number > 99_999 {
            return Err("Not enough numbers remain before 99999 after skipping. Choose a lower starting number or remove some skipped numbers.".into());
        }
        if rows.is_empty() {
            first_number = next_number;
        }
        last_number = next_number;
        let extension = Path::new(&file.name)
            .extension()
            .and_then(|s| s.to_str())
            .filter(|s| !s.is_empty());
        let mut renamed = format!("{prefix} {next_number:05}");
        next_number += 1;
        if let Some(extension) = extension {
            renamed.push('.');
            renamed.push_str(extension);
        }
        if renamed.encode_utf16().count() > 255 {
            return Err("The new filename is too long. Use a shorter prefix.".into());
        }
        rows.push(RenameRow {
            original: file.name.clone(),
            renamed,
            size: file.size,
        });
    }
    validate_targets(&directory, &rows)?;
    Ok(Plan {
        preview: Preview {
            id: Uuid::new_v4().to_string(),
            folder: folder.into(),
            rows,
            skipped,
            first_number,
            last_number,
        },
        directory,
        snapshot,
    })
}

fn validate_targets(directory: &Path, rows: &[RenameRow]) -> Result<(), String> {
    let sources: HashSet<_> = rows.iter().map(|r| r.original.to_lowercase()).collect();
    let mut targets = HashSet::new();
    for row in rows {
        if !targets.insert(row.renamed.to_lowercase()) {
            return Err(format!(
                "Two files would have the same name: {}",
                row.renamed
            ));
        }
        let target = directory.join(&row.renamed);
        if fs::symlink_metadata(&target).is_ok() && !sources.contains(&row.renamed.to_lowercase()) {
            return Err(format!(
                "A file or folder already uses the name {}. Nothing was changed.",
                row.renamed
            ));
        }
    }
    Ok(())
}

// Windows MoveFileEx with flags=0 performs an atomic move that cannot replace a target.
#[cfg(windows)]
fn move_no_replace(from: &Path, to: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::MoveFileExW;
    let from: Vec<u16> = from.as_os_str().encode_wide().chain(Some(0)).collect();
    let to: Vec<u16> = to.as_os_str().encode_wide().chain(Some(0)).collect();
    if unsafe { MoveFileExW(from.as_ptr(), to.as_ptr(), 0) } == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(not(windows))]
fn move_no_replace(from: &Path, to: &Path) -> io::Result<()> {
    fs::hard_link(from, to)?;
    if let Err(e) = fs::remove_file(from) {
        let _ = fs::remove_file(to);
        return Err(e);
    }
    Ok(())
}

#[derive(Serialize)]
struct RecoveryJournal<'a> {
    explanation: &'static str,
    directory: &'a Path,
    rows: &'a [RenameRow],
}

pub fn execute(plan: &Plan) -> Result<usize, String> {
    if scan(&plan.directory)?.0 != plan.snapshot {
        return Err(
            "The folder has changed since the preview. Refresh the preview before renaming.".into(),
        );
    }
    validate_targets(&plan.directory, &plan.preview.rows)?;
    let rows: Vec<_> = plan
        .preview
        .rows
        .iter()
        .filter(|r| r.original != r.renamed)
        .cloned()
        .collect();
    if rows.is_empty() {
        return Ok(0);
    }
    let staging = plan
        .directory
        .join(format!(".facturas-muji-recovery-{}", Uuid::new_v4()));
    fs::create_dir(&staging).map_err(|e| error("Could not create the recovery folder", e))?;
    let journal = staging.join("recovery.json");
    let journal_data = RecoveryJournal {
        explanation: "Interrupted rename. Each row's original and renamed paths are relative to directory. Staged file N corresponds to row N (zero based). Preserve this folder until all files are recovered.",
        directory: &plan.directory,
        rows: &rows,
    };
    let save = (|| -> Result<(), String> {
        use std::io::Write;
        let mut file = fs::File::create(&journal)
            .map_err(|e| error("Could not create recovery journal", e))?;
        file.write_all(&serde_json::to_vec_pretty(&journal_data).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())
    })();
    if let Err(e) = save {
        let _ = fs::remove_file(&journal);
        let _ = fs::remove_dir(&staging);
        return Err(e);
    }
    let mut staged = 0;
    let mut completed = 0;
    let result = (|| -> io::Result<()> {
        for (i, row) in rows.iter().enumerate() {
            move_no_replace(
                &plan.directory.join(&row.original),
                &staging.join(i.to_string()),
            )?;
            staged += 1;
        }
        for (i, row) in rows.iter().enumerate() {
            move_no_replace(
                &staging.join(i.to_string()),
                &plan.directory.join(&row.renamed),
            )?;
            completed += 1;
        }
        Ok(())
    })();
    if let Err(e) = result {
        let mut recovered = true;
        for (i, row) in rows.iter().enumerate().take(completed) {
            if move_no_replace(
                &plan.directory.join(&row.renamed),
                &staging.join(i.to_string()),
            )
            .is_err()
            {
                recovered = false;
            }
        }
        for (i, row) in rows.iter().enumerate().take(staged) {
            if move_no_replace(
                &staging.join(i.to_string()),
                &plan.directory.join(&row.original),
            )
            .is_err()
            {
                recovered = false;
            }
        }
        if !recovered {
            return Err(format!("Rename stopped ({e}). Some files could not be restored. Recovery files and the name mapping are in {}. Keep this folder for recovery.", staging.display()));
        }
        let _ = fs::remove_file(&journal);
        let _ = fs::remove_dir(&staging);
        return Err(format!(
            "Rename stopped: {e}. All moved files were restored."
        ));
    }
    // Leftover journal after cleanup failure is harmless and retains a useful mapping.
    let _ = fs::remove_file(&journal);
    let _ = fs::remove_dir(&staging);
    Ok(rows.len())
}

pub fn reverse_plan(plan: &Plan) -> Result<Plan, String> {
    let snapshot = scan(&plan.directory)?.0;
    Ok(Plan {
        directory: plan.directory.clone(),
        snapshot,
        preview: Preview {
            id: Uuid::new_v4().to_string(),
            folder: plan.preview.folder.clone(),
            skipped: plan.preview.skipped,
            first_number: plan.preview.first_number,
            last_number: plan.preview.last_number,
            rows: plan
                .preview
                .rows
                .iter()
                .map(|r| RenameRow {
                    original: r.renamed.clone(),
                    renamed: r.original.clone(),
                    size: r.size,
                })
                .collect(),
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn natural_order_extensions_and_undo() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("invoice10.PDF"), b"ten").unwrap();
        fs::write(dir.path().join("invoice2.pdf"), b"two").unwrap();
        fs::write(dir.path().join("invoice1"), b"one").unwrap();
        fs::create_dir(dir.path().join("archive")).unwrap();
        let plan = make_plan(
            dir.path().to_str().unwrap(),
            "2026 06 22 FRA EMITIDA",
            140,
            &[],
        )
        .unwrap();
        assert_eq!(plan.preview.skipped, 1);
        assert_eq!(plan.preview.rows[0].original, "invoice1");
        assert_eq!(
            plan.preview.rows[1].renamed,
            "2026 06 22 FRA EMITIDA 00141.pdf"
        );
        assert_eq!(execute(&plan).unwrap(), 3);
        assert_eq!(
            fs::read(dir.path().join("2026 06 22 FRA EMITIDA 00142.PDF")).unwrap(),
            b"ten"
        );
        execute(&reverse_plan(&plan).unwrap()).unwrap();
        assert_eq!(fs::read(dir.path().join("invoice2.pdf")).unwrap(), b"two");
    }

    #[test]
    fn overlapping_names_are_staged_without_losing_content() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("A 00001.pdf"), b"first").unwrap();
        fs::write(dir.path().join("A 00002.pdf"), b"second").unwrap();
        let plan = make_plan(dir.path().to_str().unwrap(), "A", 2, &[]).unwrap();
        execute(&plan).unwrap();
        assert_eq!(fs::read(dir.path().join("A 00002.pdf")).unwrap(), b"first");
        assert_eq!(fs::read(dir.path().join("A 00003.pdf")).unwrap(), b"second");
    }

    #[test]
    fn rejects_overflow_invalid_names_and_directory_collision() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("one.pdf"), b"1").unwrap();
        fs::write(dir.path().join("two.pdf"), b"2").unwrap();
        assert!(make_plan(dir.path().to_str().unwrap(), "A", 99999, &[]).is_err());
        assert!(make_plan(dir.path().to_str().unwrap(), "../escape", 1, &[]).is_err());
        fs::create_dir(dir.path().join("A 00001.pdf")).unwrap();
        assert!(make_plan(dir.path().to_str().unwrap(), "A", 1, &[]).is_err());
        assert!(dir.path().join("one.pdf").exists());
    }

    #[test]
    fn stale_preview_and_undo_refuse_changed_folder() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("one.txt"), b"original").unwrap();
        let plan = make_plan(dir.path().to_str().unwrap(), "A", 0, &[]).unwrap();
        fs::write(dir.path().join("added.txt"), b"new").unwrap();
        assert!(execute(&plan).is_err());
        fs::remove_file(dir.path().join("added.txt")).unwrap();
        execute(&plan).unwrap();
        let undo = reverse_plan(&plan).unwrap();
        fs::write(dir.path().join("A 00000.txt"), b"changed contents").unwrap();
        assert!(execute(&undo).is_err());
    }

    #[test]
    fn move_never_replaces_existing_file() {
        let dir = tempdir().unwrap();
        let from = dir.path().join("from");
        let to = dir.path().join("to");
        fs::write(&from, b"source").unwrap();
        fs::write(&to, b"existing").unwrap();
        assert!(move_no_replace(&from, &to).is_err());
        assert_eq!(fs::read(&to).unwrap(), b"existing");
        assert_eq!(fs::read(&from).unwrap(), b"source");
    }

    #[test]
    fn unchanged_batch_is_a_noop() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("A 00140.pdf"), b"same").unwrap();
        let plan = make_plan(dir.path().to_str().unwrap(), "A", 140, &[]).unwrap();
        assert_eq!(execute(&plan).unwrap(), 0);
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[cfg(windows)]
    #[test]
    fn locked_file_rolls_back_the_already_staged_files() {
        use std::os::windows::fs::OpenOptionsExt;
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("a.pdf"), b"first").unwrap();
        fs::write(dir.path().join("b.pdf"), b"second").unwrap();
        let plan = make_plan(dir.path().to_str().unwrap(), "Invoice", 140, &[]).unwrap();
        let locked = fs::OpenOptions::new()
            .read(true)
            .share_mode(1)
            .open(dir.path().join("b.pdf"))
            .unwrap();
        let failure = execute(&plan).unwrap_err();
        assert!(
            failure.contains("All moved files were restored"),
            "{failure}"
        );
        drop(locked);
        assert_eq!(fs::read(dir.path().join("a.pdf")).unwrap(), b"first");
        assert_eq!(fs::read(dir.path().join("b.pdf")).unwrap(), b"second");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 2);
    }

    #[test]
    fn last_valid_number_and_empty_folder() {
        let dir = tempdir().unwrap();
        assert!(make_plan(dir.path().to_str().unwrap(), "Invoice", 140, &[]).is_err());
        fs::write(dir.path().join("only.pdf"), b"last").unwrap();
        let plan = make_plan(dir.path().to_str().unwrap(), "Invoice", 99999, &[]).unwrap();
        execute(&plan).unwrap();
        assert!(dir.path().join("Invoice 99999.pdf").exists());
    }

    #[test]
    fn skipped_numbers_change_the_actual_rename_and_undo() {
        let dir = tempdir().unwrap();
        for (name, content) in [("a.pdf", "a"), ("b.pdf", "b"), ("c.PDF", "c")] {
            fs::write(dir.path().join(name), content).unwrap();
        }
        let plan = make_plan(
            dir.path().to_str().unwrap(),
            "Invoice",
            140,
            &[143, 140, 140, 142, 1, 900],
        )
        .unwrap();
        let names: Vec<_> = plan
            .preview
            .rows
            .iter()
            .map(|r| r.renamed.as_str())
            .collect();
        assert_eq!(
            names,
            [
                "Invoice 00141.pdf",
                "Invoice 00144.pdf",
                "Invoice 00145.PDF"
            ]
        );
        assert_eq!(
            (plan.preview.first_number, plan.preview.last_number),
            (141, 145)
        );
        execute(&plan).unwrap();
        assert_eq!(
            fs::read(dir.path().join("Invoice 00144.pdf")).unwrap(),
            b"b"
        );
        assert!(!dir.path().join("Invoice 00142.pdf").exists());
        execute(&reverse_plan(&plan).unwrap()).unwrap();
        assert_eq!(fs::read(dir.path().join("a.pdf")).unwrap(), b"a");
        assert_eq!(fs::read(dir.path().join("c.PDF")).unwrap(), b"c");
    }

    #[test]
    fn skipped_numbers_cannot_overflow_or_be_out_of_range() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("a.pdf"), "a").unwrap();
        let folder = dir.path().to_str().unwrap();
        assert!(make_plan(folder, "Invoice", 99999, &[99999]).is_err());
        assert!(make_plan(folder, "Invoice", 0, &[100000]).is_err());
        let all: Vec<u32> = (0..100000).collect();
        assert!(make_plan(folder, "Invoice", 0, &all).is_err());
        let plan = make_plan(folder, "Invoice", 99998, &[99998]).unwrap();
        assert_eq!(plan.preview.rows[0].renamed, "Invoice 99999.pdf");
        fs::write(dir.path().join("b.pdf"), "b").unwrap();
        assert!(make_plan(folder, "Invoice", 99998, &[99998]).is_err());
        assert_eq!(fs::read(dir.path().join("a.pdf")).unwrap(), b"a");
    }
}
