# Copy and paste in the activity register

The full grade sheet's activity register supports spreadsheet-style blocks across **Activity title, Topic, Date and HPS**. The WW/PT/QA row labels and assessment-group controls are selection handles, not pasted data.

- Drag across cells, or click a first cell and Shift+click the last cell.
- A normal click or keyboard focus edits text directly without marking a bulk selection. Ctrl/Command+A selects text inside that field; arrows, Shift+arrows, Backspace and Enter retain their normal text-editing behavior.
- After explicitly selecting a range, Shift+arrow keys extend it and arrow keys, Enter and Tab move between cells. Escape, double-click or F2 returns to normal text editing.
- Click a row label or column heading to select the whole row/column. Shift+click another heading to extend that selection. Click **Score column**, or press Ctrl/Command+A while a bulk range is active, to select the register.
- On a phone, choose a first cell, turn on **Select range**, then tap the last cell. Copy/Paste buttons are available alongside keyboard shortcuts.
- Ctrl/Command+C copies, Ctrl/Command+X cuts, and Ctrl/Command+V pastes. Delete clears a selected block. Escape returns to a single cell.
- A single pasted value fills the selection. A copied rectangle repeats when it evenly fits the selected destination; otherwise it pastes from the selection's top-left cell.
- Multiline text, tabs and quotes round-trip using quoted tab-separated clipboard text compatible with Excel and Google Sheets. Activity text is stored literally, including text starting with `=`.

Dates accept `YYYY-MM-DD` or `MM/DD/YYYY` and are saved as ISO dates. HPS accepts positive numbers or blanks. The whole pasted block is validated before any change is applied. Invalid dates/HPS and blocks extending beyond existing activities are rejected without partial writes. Add more activities using **Manage columns** when needed.

One bulk edit forms one undo operation. HPS changes use the same score-capping and recovery history as normal edits. Existing auto-save and cloud-save behavior applies. Locked periods allow copying but block paste, cut and clearing.

The Paste button uses the browser clipboard when permitted. If clipboard reading is unavailable, it opens a paste box; paste copied cells there and choose **Apply paste**. Native text selection/copy inside a single field remains available.

## Verification

`pnpm test:register` runs the synthetic browser checks for pointer and keyboard ranges, rows/columns, multiline TSV, scalar/repeated paste, calendar dates, HPS capping, atomic validation, undo/redo, overflow, clipboard fallback, locked periods, navigation reset and phone layouts. The same test runs in `pnpm test:visual` before release. No live teacher records or operating-system clipboard data are used in these checks.
