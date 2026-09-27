import { test, expect } from "@playwright/test";

test("initial state, accessible fields, browser limitation, and saved number", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Rename files", exact: true }),
  ).toBeDisabled();
  await expect(page.getByLabel("Starting number")).toHaveValue("00140");
  await page.getByLabel("Starting number").fill("250");
  await page.getByLabel("Filename prefix").click();
  await expect(page.getByLabel("Starting number")).toHaveValue("00250");
  await page.reload();
  await expect(page.getByLabel("Starting number")).toHaveValue("00250");
  await page.getByRole("button", { name: /Select a folder/ }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "desktop app" }),
  ).toBeVisible();
  await page.getByLabel("Starting number").fill("abc");
  await expect(page.getByLabel("Starting number")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
});

test("native bridge preview, number changes, rename, and undo", async ({
  page,
}) => {
  // UI contract test. Actual filesystem operations are independently covered by Rust tests.
  await page.addInitScript(() => {
    let renamed = false;
    Object.defineProperty(window, "isTauri", { value: true });
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {
        invoke: async (
          command: string,
          args: { prefix: string; start: number },
        ) => {
          if (command === "plugin:dialog|open")
            return "C:\\Invoices\\June 2026";
          if (command === "preview_rename")
            return {
              id: "fixture-preview",
              folder: "C:\\Invoices\\June 2026",
              skipped: 1,
              rows: ["invoice1.pdf", "invoice2.pdf", "invoice10.PDF"].map(
                (original, i) => ({
                  original,
                  renamed: `${args.prefix} ${String(args.start + i).padStart(5, "0")}.${i === 2 ? "PDF" : "pdf"}`,
                  size: 142000 + i,
                }),
              ),
            };
          if (command === "apply_rename") {
            renamed = true;
            return { count: 3, canUndo: true, warning: null };
          }
          if (command === "undo_rename" && renamed) {
            renamed = false;
            return { count: 3, canUndo: false, warning: null };
          }
          throw new Error(`Unexpected command: ${command}`);
        },
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Select a folder/ }).click();
  await expect(
    page.getByRole("cell", {
      name: "2026 06 22 FRA EMITIDA 00140.pdf",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", {
      name: "2026 06 22 FRA EMITIDA 00142.PDF",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByLabel("Starting number").fill("00500");
  await expect(
    page.getByRole("cell", {
      name: "2026 06 22 FRA EMITIDA 00500.pdf",
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({
    path: ".test-artifacts/preview-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Rename 3 files" }).click();
  await expect(page.getByRole("status")).toContainText(
    "3 files renamed successfully",
  );
  await expect(
    page.getByRole("button", { name: "Files renamed" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Undo last batch" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Original filenames restored",
  );
  await expect(
    page.getByRole("button", { name: "Rename 3 files" }),
  ).toBeEnabled();
});

test("narrow screens and reduced motion keep controls usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByLabel("Starting number")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".test-artifacts/preview-mobile.png",
    fullPage: true,
  });
});
