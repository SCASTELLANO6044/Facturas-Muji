"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { firstAvailableNumber, parseSkipNumbers } from "@/lib/skip-numbers";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ArrowDownAZ,
  ArrowRight,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  Hash,
  Info,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Undo2,
} from "lucide-react";

type Row = { original: string; renamed: string; size: number };
type Preview = {
  id: string;
  folder: string;
  rows: Row[];
  skipped: number;
  firstNumber: number;
  lastNumber: number;
};
type Outcome = { count: number; canUndo: boolean; warning: string | null };
const DEFAULT_PREFIX = "2026 06 22 FRA EMITIDA";
const PAGE_SIZE = 50;
const numberLabel = (value: number) => String(value).padStart(5, "0");
const sizeLabel = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1048576
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1048576).toFixed(1)} MB`;

export default function Renamer() {
  const [folder, setFolder] = useState("");
  const [prefix, setPrefix] = useState(DEFAULT_PREFIX);
  const [start, setStart] = useState("00140");
  const [skipNumbers, setSkipNumbers] = useState("");
  const skip = useMemo(() => parseSkipNumbers(skipNumbers), [skipNumbers]);
  const [ready, setReady] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewKey, setPreviewKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<"choose" | "rename" | "undo" | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [undoFolder, setUndoFolder] = useState("");
  const [completed, setCompleted] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [page, setPage] = useState(0);
  const generation = useRef(0);
  const key = JSON.stringify([folder, prefix, start, skipNumbers, refresh]);
  const validStart = /^\d{1,5}$/.test(start);
  const validPrefix =
    prefix.trim().length > 0 &&
    !/[<>:"/\\|?*\x00-\x1f]/.test(prefix) &&
    !prefix.trim().endsWith(".");
  const current = previewKey === key ? preview : null;
  const done = completed === key;
  const count = current?.rows.length ?? 0;
  const changed =
    current?.rows.filter((row) => row.original !== row.renamed).length ?? 0;
  const locked = busy !== null;
  const startNumber = validStart ? Number(start) : 0;
  const firstNumber = firstAvailableNumber(startNumber, skip.numbers);
  const skipError =
    skip.error ||
    (validStart && firstNumber === null
      ? "No available numbers remain from this starting number. Remove some skipped numbers."
      : "");

  useEffect(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem("facturas-muji-settings") || "null",
      );
      if (
        saved &&
        typeof saved.prefix === "string" &&
        typeof saved.start === "string"
      ) {
        setPrefix(saved.prefix);
        setStart(saved.start);
        if (typeof saved.skipNumbers === "string")
          setSkipNumbers(saved.skipNumbers);
      }
    } catch {
      /* Settings are optional; defaults remain usable. */
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(
        "facturas-muji-settings",
        JSON.stringify({ prefix, start, skipNumbers }),
      );
    } catch {
      /* A blocked web store does not prevent renaming. */
    }
  }, [prefix, start, skipNumbers, ready]);

  useEffect(() => {
    const request = ++generation.current;
    if (!folder || !validStart || !validPrefix || skipError || done) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    setPage(0);
    const timer = setTimeout(async () => {
      try {
        const result = await invoke<Preview>("preview_rename", {
          folder,
          prefix: prefix.trim(),
          start: Number(start),
          skipNumbers: skip.numbers,
        });
        if (request === generation.current) {
          setPreview(result);
          setPreviewKey(key);
        }
      } catch (e) {
        if (request === generation.current) {
          setPreview(null);
          setError(String(e));
        }
      } finally {
        if (request === generation.current) setLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      generation.current++;
    };
  }, [
    folder,
    prefix,
    start,
    key,
    validStart,
    validPrefix,
    skipError,
    skip.numbers,
    done,
  ]);

  function edited() {
    setMessage("");
    setError("");
  }

  async function chooseFolder() {
    if (!isTauri()) {
      setError(
        "Open the Facturas Muji desktop app to select and rename files. This browser preview cannot access your folders.",
      );
      return;
    }
    setBusy("choose");
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Choose a folder to rename",
        defaultPath: folder || undefined,
      });
      if (typeof selected === "string") {
        edited();
        setFolder(selected);
        setRefresh((value) => value + 1);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function rename() {
    if (!current || locked || done) return;
    setBusy("rename");
    setError("");
    setMessage("");
    try {
      const result = await invoke<Outcome>("apply_rename", { id: current.id });
      setCompleted(key);
      setMessage(
        result.warning ||
          `${result.count} ${result.count === 1 ? "file renamed" : "files renamed"} successfully. Everything is in order.`,
      );
      if (result.canUndo) setUndoFolder(folder);
      else setUndoFolder("");
    } catch (e) {
      setError(String(e));
      setPreview(null);
    } finally {
      setBusy(null);
    }
  }

  async function undo() {
    setBusy("undo");
    setError("");
    try {
      const result = await invoke<Outcome>("undo_rename");
      setFolder(undoFolder);
      setUndoFolder("");
      setCompleted("");
      setRefresh((value) => value + 1);
      setMessage(`Original filenames restored for ${result.count} files.`);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  const visibleRows =
    current?.rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE) ?? [];
  const folderName = folder.split(/[\\/]/).filter(Boolean).pop();

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to renamer
      </a>
      <header className="app-header">
        <a className="brand" href="./" aria-label="Facturas Muji home">
          <span className="brand-icon">
            <Folder size={21} strokeWidth={1.7} />
          </span>
          <span>
            facturas<span className="brand-light"> / muji</span>
          </span>
        </a>
        <div className="header-right">
          <span className="local-badge">
            <span /> Local workspace
          </span>
          <span className="version">v0.1</span>
        </div>
      </header>

      <main id="main">
        <div className="page-heading">
          <div>
            <div className="eyebrow">SMALL TOOLS, LESS BUSYWORK</div>
            <h1>A little order for your files.</h1>
            <p>One folder. A consistent name. Everything in sequence.</p>
          </div>
          <div className="privacy-note">
            <ShieldCheck size={18} />
            <span>
              Your files stay
              <br />
              <strong>on your computer</strong>
            </span>
          </div>
        </div>

        <div className="workspace">
          <aside className="settings" aria-label="Rename settings">
            <section className="panel folder-panel">
              <div className="section-heading">
                <span className="step">01</span>
                <h2>Choose your folder</h2>
              </div>
              <p className="section-description">
                Start with the files you want to organize.
              </p>
              <button
                className={`folder-picker ${folder ? "has-folder" : ""}`}
                onClick={chooseFolder}
                disabled={locked}
              >
                <span className="folder-art">
                  <FolderOpen size={30} strokeWidth={1.4} />
                </span>
                <strong>
                  {busy === "choose"
                    ? "Opening folder picker…"
                    : folderName || "Select a folder"}
                </strong>
                <span>
                  {folder
                    ? "Click to choose another folder"
                    : "Browse folders on your computer"}
                </span>
                <span className="browse-label">
                  {folder ? "Change folder" : "Browse folders"}
                  <ArrowRight size={15} />
                </span>
              </button>
              {folder && (
                <p className="folder-path" title={folder}>
                  {folder}
                </p>
              )}
              <div className="field-note">
                <Info size={14} />
                <span>Files only. Subfolders stay untouched.</span>
              </div>
            </section>

            <section className="panel pattern-panel">
              <div className="section-heading">
                <span className="step">02</span>
                <h2>Set the sequence</h2>
              </div>
              <p className="section-description">
                Make every filename follow your format.
              </p>
              <label htmlFor="prefix">Filename prefix</label>
              <input
                id="prefix"
                value={prefix}
                onChange={(e) => {
                  edited();
                  setPrefix(e.target.value);
                }}
                disabled={locked}
                aria-invalid={!validPrefix}
                aria-describedby={!validPrefix ? "prefix-error" : "prefix-hint"}
              />
              {!validPrefix ? (
                <p className="input-error" id="prefix-error">
                  Enter a valid prefix without reserved characters or a trailing
                  period.
                </p>
              ) : (
                <p className="input-hint" id="prefix-hint">
                  The fixed part of every filename.
                </p>
              )}
              <div className="number-label">
                <label htmlFor="start">Starting number</label>
                <span>5 digits</span>
              </div>
              <div className={`number-input ${!validStart ? "invalid" : ""}`}>
                <Hash size={18} />
                <input
                  id="start"
                  inputMode="numeric"
                  value={start}
                  onChange={(e) => {
                    edited();
                    setStart(e.target.value);
                  }}
                  onBlur={() => {
                    if (validStart) setStart(numberLabel(Number(start)));
                  }}
                  disabled={locked}
                  maxLength={5}
                  aria-invalid={!validStart}
                  aria-describedby="start-hint"
                />
                <span>+1 per file</span>
              </div>
              <p
                className={validStart ? "input-hint" : "input-error"}
                id="start-hint"
              >
                {validStart
                  ? "Leading zeros are added automatically."
                  : "Enter a number from 00000 to 99999."}
              </p>
              <div className="number-label">
                <label htmlFor="skip-numbers">Skip numbers</label>
                <span>Optional</span>
              </div>
              <input
                id="skip-numbers"
                placeholder="e.g. 142, 145-148"
                value={skipNumbers}
                onChange={(e) => {
                  edited();
                  setSkipNumbers(e.target.value);
                }}
                disabled={locked}
                maxLength={10000}
                spellCheck={false}
                aria-invalid={Boolean(skipError)}
                aria-describedby="skip-hint skip-feedback"
              />
              <p className="input-hint" id="skip-hint">
                Already used a number? Leave it out of the count. Separate
                numbers or ranges with commas.
              </p>
              <p
                className={skipError ? "input-error" : "skip-feedback"}
                id="skip-feedback"
                aria-live="polite"
              >
                {skipError ||
                  (skip.numbers.length
                    ? `${skip.numbers.length} ${skip.numbers.length === 1 ? "number" : "numbers"} excluded · saved for next time`
                    : "Leave blank to use every number.")}
              </p>
              <div className="example-name">
                <span>FIRST FILENAME</span>
                <p>
                  {validPrefix ? prefix.trim() : "Your prefix"}{" "}
                  <strong>
                    {validStart && !skipError && firstNumber !== null
                      ? numberLabel(firstNumber)
                      : "—"}
                  </strong>
                  <span className="extension">.pdf</span>
                </p>
                <small>Example extension · original extensions are kept</small>
              </div>
            </section>
            <p className="settings-saved">
              <Check size={13} /> Your naming settings are saved for next time.
            </p>
          </aside>

          <section
            className="panel preview-panel"
            aria-labelledby="preview-heading"
            aria-busy={loading || busy === "rename"}
          >
            <div className="preview-header">
              <div>
                <div className="section-heading">
                  <span className="step">03</span>
                  <h2 id="preview-heading">
                    {done ? "All in order" : "Preview your changes"}
                  </h2>
                  {count > 0 && <span className="count-badge">{count}</span>}
                </div>
                <p className="section-description">
                  {done
                    ? "Your files now follow one consistent sequence."
                    : "A quick look before you make it official."}
                </p>
              </div>
              <button
                className="icon-button"
                aria-label="Refresh folder preview"
                title="Refresh folder preview"
                disabled={!folder || locked || loading}
                onClick={() => {
                  edited();
                  setRefresh((value) => value + 1);
                }}
              >
                <RefreshCw size={17} className={loading ? "spin" : ""} />
              </button>
            </div>
            <div className="table-toolbar">
              <span>
                <Folder size={15} />
                {folderName || "No folder selected"}
              </span>
              <span>
                <ArrowDownAZ size={15} />
                Filename order
              </span>
            </div>
            {current ? (
              <>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th className="row-number">#</th>
                        <th>Original filename</th>
                        <th aria-label="becomes" />
                        <th>{done ? "Renamed filename" : "New filename"}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRows.map((row, index) => (
                        <tr key={row.original}>
                          <td className="row-number">
                            {String(page * PAGE_SIZE + index + 1).padStart(
                              2,
                              "0",
                            )}
                          </td>
                          <td>
                            <div className="original-cell">
                              <FileText size={19} />
                              <div>
                                <span>{row.original}</span>
                                <small>{sizeLabel(row.size)}</small>
                              </div>
                            </div>
                          </td>
                          <td className="arrow-cell">
                            {done ? (
                              <Check size={15} />
                            ) : (
                              <ArrowRight size={15} />
                            )}
                          </td>
                          <td className="new-name">{row.renamed}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="table-summary">
                  <span>
                    <CheckCheck size={15} />
                    {done
                      ? `${count} files in sequence`
                      : `${changed} of ${count} files will be renamed`}
                    {current.skipped > 0
                      ? ` · ${current.skipped} folders or links skipped`
                      : ""}
                  </span>
                  {count > PAGE_SIZE && (
                    <div className="pagination">
                      <button
                        className="icon-button"
                        aria-label="Previous page"
                        disabled={page === 0}
                        onClick={() => setPage(page - 1)}
                      >
                        <ChevronLeft size={16} />
                      </button>
                      <span>
                        {page + 1} / {Math.ceil(count / PAGE_SIZE)}
                      </span>
                      <button
                        className="icon-button"
                        aria-label="Next page"
                        disabled={(page + 1) * PAGE_SIZE >= count}
                        onClick={() => setPage(page + 1)}
                      >
                        <ChevronRight size={16} />
                      </button>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="empty-preview">
                {loading ? (
                  <>
                    <LoaderCircle className="spin empty-loader" size={32} />
                    <h3>Putting your preview together…</h3>
                    <p>Reading filenames from your selected folder.</p>
                  </>
                ) : (
                  <>
                    <div className="file-illustration" aria-hidden="true">
                      <div className="illustration-file file-back">
                        <FileText size={28} />
                        <i />
                        <i />
                      </div>
                      <div className="illustration-file file-front">
                        <FileText size={30} />
                        <i />
                        <i />
                        <span>00140</span>
                      </div>
                      <div className="illustration-check">
                        <Check size={17} />
                      </div>
                    </div>
                    <h3>
                      {folder
                        ? "Your next sequence starts here"
                        : "Goodbye, scattered filenames."}
                    </h3>
                    <p>
                      {folder
                        ? "Set a valid naming format to see your files in sequence."
                        : "Choose a folder and we’ll show you exactly\nhow your files will be renamed."}
                    </p>
                    {!folder && (
                      <div
                        className="sample-sequence"
                        aria-label="Example numbering"
                      >
                        <span>00140</span>
                        <ArrowRight size={14} />
                        <span>00141</span>
                        <ArrowRight size={14} />
                        <span>00142</span>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
            <div className="preview-bottom">
              <div className="preservation-note">
                <ShieldCheck size={17} />
                <span>Same files. Same extensions. Just a better name.</span>
              </div>
              <div className="action-row">
                <div>
                  <strong>
                    {done
                      ? "Nicely organized."
                      : count
                        ? `${count} files, one clean sequence.`
                        : "Ready when you are."}
                  </strong>
                  <span>
                    {done
                      ? "You can undo the last batch during this session."
                      : count
                        ? `${numberLabel(current!.firstNumber)} → ${numberLabel(current!.lastNumber)}${skip.numbers.length ? " · skipped numbers omitted" : ""}`
                        : "Select a folder to get started."}
                  </span>
                </div>
                <button
                  className="primary-button"
                  onClick={rename}
                  disabled={
                    !current || loading || locked || done || changed === 0
                  }
                >
                  {busy === "rename" ? (
                    <LoaderCircle size={17} className="spin" />
                  ) : done ? (
                    <Check size={17} />
                  ) : (
                    <ArrowRight size={17} />
                  )}{" "}
                  {busy === "rename"
                    ? "Renaming…"
                    : done
                      ? "Files renamed"
                      : count
                        ? `Rename ${changed} files`
                        : "Rename files"}
                </button>
              </div>
            </div>
          </section>
        </div>

        <div className="feedback-area">
          {error && (
            <div className="notice error-notice" role="alert">
              <Info size={18} />
              <p>{error}</p>
            </div>
          )}
          {message && (
            <div className="notice success-notice" role="status">
              <CheckCheck size={19} />
              <p>{message}</p>
            </div>
          )}
          {undoFolder && (
            <button
              className="undo-button"
              onClick={undo}
              disabled={locked || loading}
              title={`Restore the last batch in ${undoFolder}`}
            >
              <Undo2 size={16} />
              {busy === "undo" ? "Restoring names…" : "Undo last batch"}
            </button>
          )}
        </div>
        <footer className="app-footer">
          <span>Less admin. More room for everything else.</span>
          <span>
            <span className="footer-dot" /> Built for a more organized day.
          </span>
        </footer>
      </main>
    </div>
  );
}
