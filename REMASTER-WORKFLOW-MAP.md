# Tabbed record workspace — implementation map

Baseline: main, inspected 2 November 2026. Plain HTML/CSS/JavaScript; no framework migration.

## Existing behavior and ownership

| Workflow | Owner / data path | Preservation contract |
| --- | --- | --- |
| Sign in, approval, registration, recovery, logout | app.js auth handlers; registration.js; firebase-sync.js | Existing account checks and unsaved-change confirmations |
| Teacher details / photo | renderHome, data-teacher input handlers, handlePhoto | Same teacher/photo fields and save pipeline |
| Class directory, JHS/SHS, active/archive | renderClassRecord, renderAddClass, renderEditSection, archive/delete handlers | Registry IDs, subject presets/custom weights, roster limits and confirmations |
| Quarterly/semestral and trimester records | applyCalendarMode, activeRegistry/activeSections, currentPeriod, select-period / data-mobile-period | Separate legacy/trimester collections; original period labels and indexing |
| Sheet, assessment and learner entry views | renderSectionRecord, renderEntryViewControls, renderMobileEntry, renderEditableStudentReport | Same view state and underlying roster; no copies of record data |
| Scores, attendance, names, dates, HPS and adjustments | delegated input/change handlers, commitHpsField, record-tools.js, updateLiveSummary | Immediate edits, HPS capping/restoration, A/M zero and E/L exclusion, validation |
| Rows / columns, bulk selection and clipboard | addRosterSlots, deleteRosterRow, changeColumnCount, selection/keyboard handlers | Existing keyboard navigation, paste, fill, copy/cut/delete and confirmations |
| Period add/delete/lock/name | addPeriod, requestDeletePeriod, toggleLockPeriod | Integrity gates, lock restrictions, explicit DELETE confirmation |
| Activity register | renderActivityRegister and data-activity-field handlers | Titles, competencies, topics, dates, HPS, ST1/ST2/TE grouping |
| Calculations / rounding | grading-engine.js; record-tools.js | Leave source unchanged |
| Saving / conflicts / drafts | markFieldEditDirty → noteEdit → session draft/autosave; saveToFirebase and remote conflict handlers | Existing schema v4, revisions, checkpoints, ownership and save indicators |
| Export / import / backup | Excel/official export handlers; excel-export.js, school-excel.js, official-egradesheet.js, backup.js, file-delivery.js | Existing Excel, PDF, Word, PNG, encrypted backup formats and readiness checks |
| Settings, password, version history, theme, navigation | renderSettings, account handlers, theme.js | Preserve controls and persistence |
| Android and privacy | mobile.css, app-install.js, native bridge, policy dialog | Keep mobile entry and update flow; native code untouched |

## Design decision before implementation

The school's period-based assessment ledger becomes a paper sheet inside a tabbed record folder. Real views, scores, completion counts, and period controls provide the content; no invented metrics or sample records enter production.

Nimbus Sans supplies local, familiar UI and numeric forms. Nimbus Roman supplies editorial titles only. Both already ship in the repository with font-display:swap and system fallbacks. Following the user's palette update, the interface uses the exact sampled colors #FFA322, #BB1414, #042134, #181818 and #000000, with white paper and quiet tints for legibility. User class accent choices remain visible. Original table color tokens are scoped inside the data surfaces so the brand theme does not recolor class data.

The requested taste skill explicitly excludes app screens. Its typography, deliberate composition and screenshot critique are applied; marketing direction draws, imagery quotas, giant headings and minimum animation quotas are inappropriate here. The user's requested sheet grid, folder edges and restrained shadows take precedence over its marketing bans. No new imagery or dependencies are needed.

## Motion contract

Period selection commits pending HPS edits, changes the existing active index synchronously and renders real content. Only the sheet content receives a brief directional turn; no asynchronous callback changes data. A newer transition cancels the older one. Keyboard actions and reduced motion update immediately. Score edits and routine toggles remain still.

## Initial design review

| Before | After | Why |
| --- | --- | --- |
| Entry views live in a select | Visible folder tabs backed by the same view state | Makes existing work surfaces discoverable |
| Broad app-shell entrance includes period changes | Scoped, cancellable sheet transition | Controls remain stable; current data appears immediately |
| All headings use the UI sans | Serif document titles, sans controls and values | Paper metaphor without compromising dense entry |
| Separate floating-looking tool rows | A continuous folder, toolbar and paper | Clear hierarchy without wasting table width |

See REMASTER-IMPLEMENTATION.md for verification and screenshot critique. Production service writes, deployment, native signing and physical-device checks are outside this visual change.
