# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Source of truth

`SPEC.md` is the full functional specification (the original build prompt) and is the document the user iterates on. Read it before changing behavior, and update it when requirements change. It takes precedence over `README.md` if they disagree.

## Commands

```bash
npm install                 # install deps
npm start                   # electron . (starts internal Express on :4123 and opens the window)
npm run dist:win            # NSIS installer -> dist/
npm run dist:win-portable   # portable .exe -> dist/
```

There is no test suite, linter, or build step for the frontend. Not a git repository. `README.md` (in Spanish) documents the business rules in detail — read it before changing file-naming or filtering logic.

## Architecture

Desktop app: **Electron shell → embedded Express server → AngularJS 1.x frontend**, no database.

- `main.js` starts Express (`server/app.js`) on fixed port `4123` and loads `http://localhost:4123` in a `BrowserWindow`. It also owns the native dialogs (folder / multi-folder / Excel file pick / save-as) via `ipcMain.handle('dialog:*')`.
- `preload.js` exposes those dialogs to the renderer as `window.electronAPI.*` (contextIsolation on, nodeIntegration off). Adding a new native dialog requires touching `main.js`, `preload.js`, and the Angular factory/controller.
- `server/app.js` serves `public/` and also `node_modules/` statically, so AngularJS is loaded from `/angular/angular.js` (no CDN; must work offline). The `build.files` list in `package.json` must keep including `node_modules/**/*` for this reason.
- All API responses use the envelope `{ meta: { success, message }, data }`; errors are returned as HTTP 200 with `success:false` (see routes), not via status codes.
- Routes: `server/routes/cfdi.routes.js` (`/api/cfdi/*`) and `ingresosExcel.routes.js` (`/api/ingresos-excel/rellenar`). Business logic lives in `server/services/`:
  - `excelService` finds/reads Emitidos/Recibidos `.xlsx` (filename must contain "emitid"/"recibid") with `xlsx`.
  - `xmlService` extracts CFDI attributes by **recursive attribute-name search ignoring namespace prefixes** (not fixed XPath).
  - `organizerService` is the core: indexes CFDI files, then `planificar*` / `ejecutar*` pairs for Pagos, Egresos, Ingresos, and the multi-folder pago search.
  - `ingresosExcelService` fills the 12-tab master workbook using `exceljs` (to preserve formatting); locates the header row by scanning the first 15 rows.
- Frontend: `public/js/app.module.js`, one big controller `controllers/mainCtrl.js`, and factories in `factorys/` (note spelling) that wrap the API calls.

### Key patterns

- **Two-phase preview/confirm**: every organize operation has `/preview` (builds a plan, stored in the in-memory `cacheCarpetas` Map keyed by folder path in `cfdi.routes.js`) and `/confirm` (executes the cached plan, **moving** files, not copying). State is lost when the app closes; reloading Excels resets the folder's plans.
- **Ordering constraint**: Egresos preview is rejected until Pagos is confirmed for that folder (`pagosConfirmado`), because Egresos renames files that Pagos needs to find by original filename/UUID. Egresos names embed `( uuid )` so the cross-month search can still find them; The old "corregir nombres" button/route was removed, so the suffix stays.
- The multi-folder pago search uses a single module-level `planMultiCarpetaPendiente` (single-user assumption).
- Server-side code uses ES5 style (`var`, `function`) in routes; match the surrounding style.
