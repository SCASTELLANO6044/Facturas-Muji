# Facturas Muji

A Windows desktop application built with **Tauri 2.12** and **Next.js 16.3.6** (the npm `latest` release when created). React and TypeScript power the interface; Rust performs the filesystem operations. The Next.js UI is exported statically and embedded in the executable, following [Tauri's Next.js integration](https://v2.tauri.app/start/frontend/nextjs/).

## Use the app

1. Choose a folder with the native folder picker.
2. Keep or edit the filename prefix. The default is `2026 06 22 FRA EMITIDA`.
3. Enter the starting number, such as `00140`.
4. Review the original and proposed names, then click **Rename files**.

For example, the first two PDF files become:

```text
2026 06 22 FRA EMITIDA 00140.pdf
2026 06 22 FRA EMITIDA 00141.pdf
```

The starting number and prefix are remembered between runs. The number is not automatically advanced after a batch; explicitly set the number for your next batch. A five-digit sequence can start at `00000` and end at `99999`.

Files are ordered by their current filenames using natural, case-insensitive order (`invoice2` before `invoice10`), with a deterministic case-sensitive tie-breaker. All regular files directly inside the selected folder are included. Subfolders and symbolic links are skipped. Original extensions, including their case, are retained; files without an extension stay extensionless. For compound extensions, the final suffix is retained (`archive.tar.gz` becomes `…00140.gz`).

**Undo last batch** restores original names during the current app session. Undo is replaced by the next successful batch and is unavailable after closing the app. It refuses to proceed if the files have changed. Refresh the preview when you change files outside the app.

## Run from source

Prerequisites: Node.js 20.9+ with npm, a current Rust MSVC toolchain, Visual Studio C++ Build Tools with the Windows SDK, and Microsoft Edge WebView2. These tools were available on the development PC.

```powershell
npm ci
npm run desktop
```

`npm run dev` opens the UI in a browser for development. Real folder selection and renaming require the Tauri desktop window.

## Build a Windows app

```powershell
npm run desktop:build
```

Outputs:

- Standalone executable: `src-tauri/target/release/facturas-muji.exe`
- Windows installer: `src-tauri/target/release/bundle/nsis/Facturas Muji_0.1.0_x64-setup.exe`

The application uses the local WebView2 runtime and needs no Node.js server when installed. Dependencies are pinned by `package-lock.json` and `src-tauri/Cargo.lock`.

## Verification

```powershell
npm run typecheck
npm run build
npm run test:rust
npm run test:ui
```

Rust tests operate on disposable folders and cover numbering, natural order, extension preservation, overlap, collision rejection, overflow, stale previews, undo, no-op batches, and rollback of partially staged batches when a file is locked. Playwright uses installed Microsoft Edge to test form validation, saved settings, narrow layouts, and the UI/native command contract with an explicit mock. Native filesystem behavior is tested by Rust, not the mock.

## Rename recovery

The app validates a preview again before applying it. Windows moves use a native operation that refuses to replace an existing target. Files are first staged in a unique recovery folder inside the selected directory, allowing overlapping old and new names without overwrites. If an operation fails, the app attempts to restore the original names.

A recovery journal is saved before moving any files. If the app or computer stops unexpectedly mid-batch, preserve the `.facturas-muji-recovery-*` folder. Its `recovery.json` maps original names to new names; numbered files inside that folder correspond to zero-based rows in the mapping. Recovery after a process crash is manual. If rollback fails, the error includes the recovery folder path. Multi-file renames are not filesystem-wide atomic transactions; avoid editing the selected folder during a batch.

The UI uses local system fonts and performs no uploads or network requests in the installed app.
