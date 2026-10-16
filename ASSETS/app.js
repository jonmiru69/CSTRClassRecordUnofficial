(() => {
  "use strict";

  const {
    calculateComponent,
    calculateQuarterlyAssessment,
    calculateInitialGrade,
    format,
    hasRawAboveHps,
    isAttendanceCode,
    isZeroScoreCode,
    isExcludedCode,
    SUBJECT_PRESETS,
    matchSubjectWeights,
    transmuteGrade,
    getGradeDescriptor
  } = window.CSTRGrading;
  
  const WELCOME_SEEN_PREFIX = "cstr-class-record-welcome-seen:";
  const app = document.querySelector("#app");

  // Fresh/blank template for a brand-new account with no saved data yet.
  // Intentionally EMPTY: every account (new or existing) must start with zero
  // classes and build its own registry via "+ Add Class". Do not repopulate
  // this with sample sections — doing so previously caused new accounts to
  // appear to inherit another teacher's class list.
  const DEFAULT_REGISTRY = [];
  // Verify these labels and the SHS period plan against the school's report card.
  const TRIMESTER_TERM_NAMES = ["Term 1", "Term 2", "Term 3"];
  const TRIMESTER_APPLIES_TO_SHS_SEPARATELY = false;
  const TRIMESTER_SHS_TERM_NAMES = ["Term 1", "Term 2", "Term 3"];
  // Verify whether zero-based grading is tied to the trimester calendar.
  const TRIMESTER_USES_ZERO_BASED_GRADING = true;
  // Verify whether the final grade is an equal average of the three term grades.
  const TRIMESTER_FINAL_GRADE_WEIGHTS = [1, 1, 1];

  let currentView = "home";
  let activeGroup = "JHS";
  let activeSectionId = DEFAULT_REGISTRY[0]?.id || "";
  let activePeriodIndex = 0;
  let sheetEntryView = "sheet";
  let activeOneLearnerRowIndex = null;
  let sidebarCollapsed = matchMedia("(max-width: 760px)").matches;
  try { const stored = localStorage.getItem("cstr-sidebar-collapsed"); if (stored !== null) sidebarCollapsed = matchMedia("(max-width: 760px)").matches || stored === "true"; } catch (_) {}
  const hpsEdits = new WeakMap();
  let lastRenderedRecord = "";
  const completionSeen = new WeakMap();
  let archiveFilter = "active"; // "active" | "archived"
  let state = createInitialState();

  let cloudRevision = 0;
  let pendingRemoteRevision = 0;
  let isDataLoaded = false;
  let isLoading = false;
  let loadRequestId = 0;    // Bumped on every subscribeToSync() call so a slower, older in-flight
                             // request (e.g. from a stale/earlier credential attempt) can never
                             // overwrite the outcome of a newer one that already finished.
  let lastLoadError = "";   // Persists the real reason the last load failed, so it survives
                             // later re-renders instead of being silently replaced by the
                             // generic "DATA LOCKED" status.
  let isSaving = false;
  let saveQueued = false;
  let autoSaveTimer = null;
  let saveToastTimer = null;
  let unsubscribeSync = null;
  let isLinkingLegacyInProgress = false;
  let loginPanel = "signin"; // "signin" | "signup" | "legacy" — which login-screen panel is showing
  // isStale = true means a DIFFERENT device just saved changes to this same
  // account while THIS device had unsaved edits in progress. Rather than
  // silently overwrite one or the other, saving is blocked until the teacher
  // picks a side in Settings — the same "don't clobber unseen data" guarantee
  // the old GitHub Gist flow gave via its "DATA LOCKED" state.
  let isStale = false;
  let pendingRemoteState = null;
  let pendingRemoteAt = null;
  let stateRevision = 0;
  let lastSavedRevision = 0;
  let selectionState = { active: false, startRow: null, startCol: null, endRow: null, endCol: null };
  // True once the user has actually typed into the anchor cell (the cell a
  // multi-cell drag-selection started from) while that selection is active.
  // Only an actual edit arms this — merely dragging out a selection never
  // does — so a plain click-drag-then-click-away can never overwrite the
  // other selected cells with a value nobody typed.
  let fillArmed = false;
  let pendingAutoSaveChanges = 0;   // Logical edits accumulated since the last successful save
  let activeEditFieldKey = null;    // Identifies the field currently mid-edit, so multi-keystroke typing groups into one logical change
  let fieldEditIdleTimer = null;
  let autoSaveMaxWaitTimer = null;  // Forces a save AUTOSAVE_MAX_WAIT_MS after the first unsaved change, even under the change threshold
  let preBatchSnapshot = null;      // Full state as of the last clean save — the restorable "previous version"
  let lastSavedAt = null;           // Date of the last successful save (cloud, or local-only fallback)
  let lastCloudSavedAt = null;
  let lastCloudVerifiedAt = null;
  let saveIndicatorTicker = null;

  const AUTOSAVE_DELAY = 900; // Quiet period after the most recent edit before the change-count is checked
  const AUTOSAVE_MIN_CHANGES = 8; // Safety buffer: require this many logical edits (input, edit, add, delete, etc.) to accumulate before an autosave is allowed to push to GitHub, so a single accidental clear/deletion isn't silently synced.
  const AUTOSAVE_MAX_WAIT_MS = 3 * 60 * 1000; // Ceiling: force an autosave this long after the first unsaved change, even if the 8-change threshold hasn't been reached yet.
  const FIELD_EDIT_GROUP_IDLE_MS = 1200; // Keystrokes on the same field within this window count as ONE logical edit, not one per keystroke.
  const LOCAL_DRAFT_PREFIX = "cstr-class-record-autosave-draft:";
  const VERSION_HISTORY_PREFIX = "cstr-class-record-history:";
  const MAX_HISTORY_VERSIONS = 8; // How many restorable previous versions to keep per user

  function rememberTableScroll() {
    const wrap = document.querySelector(".table-wrap");
    return wrap ? { left: wrap.scrollLeft, top: wrap.scrollTop, x: window.scrollX, y: window.scrollY } : null;
  }

  function restoreTableScroll(scrollLeft) {
    if (scrollLeft === null) return;
    const wrap = document.querySelector(".table-wrap");
    if (wrap) { wrap.scrollLeft = scrollLeft.left; wrap.scrollTop = scrollLeft.top; }
    window.scrollTo({ left: scrollLeft.x, top: scrollLeft.y, behavior: "instant" });
  }

  function currentUserKey() {
    return sessionStorage.getItem("cstr-class-record-user") || "local";
  }

  function localDraftKey() {
    return `${LOCAL_DRAFT_PREFIX}${currentUserKey()}`;
  }

  function isSyncConfigured() {
    return Boolean(window.CSTRSync && window.CSTRSync.configured);
  }

  function isSignedIn() {
    return sessionStorage.getItem("cstr-class-record-login") === "true";
  }

  function currentUserEmail() {
    return sessionStorage.getItem("cstr-class-record-email") || "";
  }

  function currentUserName() {
    return sessionStorage.getItem("cstr-class-record-name") || (state && state.teacher ? state.teacher.name : "Teacher");
  }

  function maskEmail(email) {
    if (!email || typeof email !== "string") return "Google Account";
    const parts = email.split("@");
    if (parts.length !== 2) return "Google Account";
    const name = parts[0];
    const domain = parts[1];
    const maskedName = name.length <= 2 ? name[0] + "***" : name[0] + "***" + name.slice(-1);
    return `${maskedName}@${domain}`;
  }

  // Every account is a full account with identical functionality — this only tracks
  // whether a one-time welcome notice has been shown on this device, so it appears
  // exactly once per account.
  function welcomeSeenKey() {
    return `${WELCOME_SEEN_PREFIX}${currentUserKey()}`;
  }

  function hasSeenWelcome() {
    try {
      return localStorage.getItem(welcomeSeenKey()) === "true";
    } catch (error) {
      return true; // If storage is unavailable, fail closed rather than repeat the popup.
    }
  }

  function markWelcomeSeen() {
    try {
      localStorage.setItem(welcomeSeenKey(), "true");
    } catch (error) {
      // No persistent storage available; nothing further to do.
    }
  }

  function cloneState(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function persistLocalDraft() {
    if (!isSignedIn()) return;
    try {
      let recoveryState = state;
      const input = document.activeElement;
      if (input?.dataset?.hps && hpsEdits.has(input)) {
        recoveryState = cloneState(state);
        const recoverySections = recoveryState.calendarMode === "trimester" ? recoveryState.sectionsTri : recoveryState.sections;
        const period = recoverySections[activeSectionId]?.periods[activePeriodIndex];
        if (period) adjustRecordHps(period, input.dataset.hps, Number(input.dataset.index), hpsEdits.get(input), input.value);
      }
      sessionStorage.setItem(localDraftKey(), JSON.stringify({ savedAt: new Date().toISOString(), state: recoveryState }));
    } catch (error) {
      // Cloud saves remain available even if the browser has no space for a recovery copy.
    }
  }

  function restoreLocalDraft() {
    try {
      const old = localStorage.getItem(localDraftKey());
      if (old && !sessionStorage.getItem(localDraftKey())) sessionStorage.setItem(localDraftKey(), old);
      if (old) localStorage.removeItem(localDraftKey());
      const saved = JSON.parse(sessionStorage.getItem(localDraftKey()) || "null");
      return saved && saved.state ? normalizeState(saved.state) : null;
    } catch (error) {
      return null;
    }
  }

  function versionHistoryKey() {
    return `${VERSION_HISTORY_PREFIX}${currentUserKey()}`;
  }

  function loadVersionHistory() {
    try {
      const old = localStorage.getItem(versionHistoryKey());
      if (old && !sessionStorage.getItem(versionHistoryKey())) sessionStorage.setItem(versionHistoryKey(), old);
      if (old) localStorage.removeItem(versionHistoryKey());
      const raw = JSON.parse(sessionStorage.getItem(versionHistoryKey()) || "[]");
      return Array.isArray(raw) ? raw : [];
    } catch (error) {
      return [];
    }
  }

  // Records a restorable checkpoint of the state as it stood BEFORE a batch of
  // changes was saved. This is what lets an accidental deletion or clearing be
  // rolled back later, even after that batch has already been autosaved.
  function pushVersionSnapshot(snapshotState) {
    if (!snapshotState) return;
    try {
      const history = loadVersionHistory();
      history.push({ savedAt: new Date().toISOString(), state: snapshotState });
      while (history.length > MAX_HISTORY_VERSIONS) history.shift();
      sessionStorage.setItem(versionHistoryKey(), JSON.stringify(history));
    } catch (error) {
      // Best-effort recovery point only — never block the actual save over this.
    }
  }

  // Marks the current state as the known-good baseline that the NEXT batch of
  // edits will be checkpointed against.
  function establishCleanBaseline() {
    preBatchSnapshot = cloneState(state);
  }

  function showSaveToast(message, type = "success") {
    document.querySelector("#saveToast")?.remove();
    if (saveToastTimer) clearTimeout(saveToastTimer);
    const toast = document.createElement("div");
    toast.id = "saveToast";
    toast.className = `save-toast ${type}`;
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    toast.innerHTML = `<span class="save-toast-icon" aria-hidden="true">${type === "error" ? "!" : "✓"}</span><span>${escapeHtml(message)}</span>`;
    document.body.append(toast);
    requestAnimationFrame(() => toast.classList.add("is-visible"));
    saveToastTimer = setTimeout(() => {
      toast.classList.remove("is-visible");
      setTimeout(() => toast.remove(), 220);
    }, 3200);
  }

  // Closes out an in-progress keystroke-grouped field edit (see markFieldEditDirty)
  // without changing the pending-change count — the edit was already counted
  // the moment it started.
  function commitActiveFieldEdit() {
    if (fieldEditIdleTimer) { clearTimeout(fieldEditIdleTimer); fieldEditIdleTimer = null; }
    activeEditFieldKey = null;
  }

  // Guarantees an autosave happens at most AUTOSAVE_MAX_WAIT_MS after the FIRST
  // unsaved change in a batch, even if the 8-change threshold is never reached
  // (e.g. the teacher makes a few edits, then walks away).
  function scheduleAutoSaveMaxWait() {
    if (autoSaveMaxWaitTimer) return; // Already ticking for this unsaved batch
    autoSaveMaxWaitTimer = setTimeout(() => {
      autoSaveMaxWaitTimer = null;
      if (pendingAutoSaveChanges > 0) triggerAutoSaveNow();
    }, AUTOSAVE_MAX_WAIT_MS);
  }

  // fieldKey groups consecutive keystrokes on the SAME field into a single
  // logical change. Pass null for direct, single-shot actions (buttons, bulk
  // paste, photo upload, etc.) that are already one meaningful edit apiece.
  function noteEdit(fieldKey) {
    stateRevision += 1;
    const isNewLogicalChange = fieldKey ? fieldKey !== activeEditFieldKey : true;
    if (fieldKey) {
      activeEditFieldKey = fieldKey;
      if (fieldEditIdleTimer) clearTimeout(fieldEditIdleTimer);
      fieldEditIdleTimer = setTimeout(() => { activeEditFieldKey = null; fieldEditIdleTimer = null; }, FIELD_EDIT_GROUP_IDLE_MS);
    } else {
      commitActiveFieldEdit();
    }
    if (isNewLogicalChange) {
      if (pendingAutoSaveChanges === 0 && !preBatchSnapshot) establishCleanBaseline();
      pendingAutoSaveChanges += 1;
      scheduleAutoSaveMaxWait();
    }
    updateSaveIndicators();
    updateCompletionIndicators();
    queueAutoSave();
  }

  function markStateDirty() {
    noteEdit(null);
  }

  // Use for text/number fields wired to the "input" event, so typing multiple
  // characters into the same cell (or deleting them) counts as ONE change,
  // not one per keystroke.
  function markFieldEditDirty(fieldKey) {
    noteEdit(fieldKey);
  }

  function queueAutoSave() {
    // A local recovery copy is kept on every change regardless of the change-count
    // buffer below — this is just a browser-side safety net and never overwrites
    // the live-synced copy, so it's safe to keep it fully up to date.
    persistLocalDraft();
    if (!isSignedIn()) return;
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => {
      autoSaveTimer = null;
      // Require a minimum number of accumulated logical edits before pushing an
      // automatic save to GitHub. This prevents a single accidental clear/deletion
      // of a score from being immediately and silently synced to the shared saved
      // copy. The AUTOSAVE_MAX_WAIT_MS ceiling (scheduled separately) still forces
      // a save if changes keep trickling in slower than this threshold.
      if (pendingAutoSaveChanges < AUTOSAVE_MIN_CHANGES) return;
      triggerAutoSaveNow();
    }, AUTOSAVE_DELAY);
  }

  function triggerAutoSaveNow() {
    commitActiveFieldEdit();
    if (!isSignedIn() || pendingAutoSaveChanges === 0) return;
    if (!isSyncConfigured()) {
      // Live sync isn't set up yet — the local recovery draft is the only store.
      // Still checkpoint a restorable version and close out this batch.
      finalizeSavedBatch();
      showSaveToast("Changes saved on this device. Finish FIREBASE_SETUP.md to sync across devices.", "info");
      return;
    }
    if (!isDataLoaded) {
      showSaveToast("Autosave is waiting for verified saved data to load.", "error");
      return;
    }
    if (isStale) {
      // Another device saved changes we haven't reconciled with yet — never
      // silently overwrite them. The local draft still protects this device's
      // edits; the teacher resolves the conflict in Settings.
      return;
    }
    saveToFirebase({ automatic: true });
  }

  // Called once a batch of changes has actually been persisted (cloud or
  // local-only): records the pre-batch state as a restorable version, resets
  // the pending-change counter, and re-establishes the clean baseline.
  function finalizeSavedBatch() {
    // Only checkpoint if there was actually a batch of changes to protect —
    // avoids piling up no-op "versions" every time Save Changes is clicked
    // with nothing new to save.
    if (preBatchSnapshot && pendingAutoSaveChanges > 0) pushVersionSnapshot(preBatchSnapshot);
    pendingAutoSaveChanges = 0;
    if (autoSaveMaxWaitTimer) { clearTimeout(autoSaveMaxWaitTimer); autoSaveMaxWaitTimer = null; }
    lastSavedAt = new Date();
    establishCleanBaseline();
    updateSaveIndicators();
  }

  function formatSavedAt(date) {
    if (!date) return "Not saved yet this session";
    const diffMs = Date.now() - date.getTime();
    if (diffMs < 45 * 1000) return "Last saved just now";
    const diffMin = Math.round(diffMs / 60000);
    if (diffMin < 60) return `Last saved ${diffMin} minute${diffMin === 1 ? "" : "s"} ago`;
    return `Last saved at ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  }

  // Updates the "N unsaved changes • Last saved …" indicator directly, without
  // a full re-render — a full render() while the teacher is mid-keystroke would
  // steal focus out of the input they're typing in.
  function updateSaveIndicators() {
    const meta = document.querySelector("#saveMeta");
    if (!meta) return;
    const pending = pendingAutoSaveChanges > 0 || stateRevision > lastSavedRevision && isSaving;
    if (!isSyncConfigured()) meta.textContent = "Cloud unavailable · recovery copy on this device only";
    else if (isStale) meta.textContent = "Cloud conflict · review in Settings before saving";
    else if (!isDataLoaded) meta.textContent = "Cloud save unverified · check your connection";
    else if (isSaving) meta.textContent = "Saving to cloud…";
    else if (pending) meta.textContent = `${pendingAutoSaveChanges} unsaved change${pendingAutoSaveChanges === 1 ? "" : "s"} · ${lastCloudSavedAt ? `last cloud save ${lastCloudSavedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "not yet saved to cloud this session"}`;
    else if (lastCloudSavedAt) meta.textContent = `All changes saved to cloud · ${lastCloudSavedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
    else meta.textContent = `Cloud copy current · verified ${lastCloudVerifiedAt ? lastCloudVerifiedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "this session"}`;
    meta.classList.toggle("has-unsaved", pending || isStale || !isDataLoaded);
  }

  function emptyRoster(size, wwLen = 10, ptLen = 8, qaLen = 3) {
    return Array.from({ length: size }, () => ({ name: "", ww: Array(wwLen).fill(""), pt: Array(ptLen).fill(""), qa: Array(qaLen).fill("") }));
  }

  function initialPeriod(section, calendarMode = "legacy") {
    return {
      name: calendarMode === "trimester" ? trimesterTermNames(section)[0] : section.group === "JHS" ? "1st Grading" : "1st Quarter, 1st Semester",
      ...(calendarMode === "trimester" ? { term: 1, quarter: 0, semester: 0 } : {}),
      wwDates: Array(10).fill(""),
      ptDates: Array(8).fill(""),
      qaDates: Array(3).fill(""),
      wwHps: Array(10).fill(""),
      ptHps: Array(8).fill(""),
      qaHps: Array(3).fill(""),
      activityMeta: { ww: Array.from({ length: 10 }, () => ({ title: "", competency: "", topic: "" })), pt: Array.from({ length: 8 }, () => ({ title: "", competency: "", topic: "" })), qa: Array.from({ length: 3 }, () => ({ title: "", competency: "", topic: "" })) },
      roster: emptyRoster(section.rosterSize || 50, 10, 8, 3),
      locked: false
    };
  }

  function createInitialState() {
    return {
      version: 4,
      photo: "",
      teacher: {
        name: "",
        age: "",
        specialization: "",
        level: "Secondary",
        bio: ""
      },
      registry: JSON.parse(JSON.stringify(DEFAULT_REGISTRY)),
      sections: Object.fromEntries(DEFAULT_REGISTRY.map((section) => [section.id, { periods: [initialPeriod(section)] }])),
      calendarMode: "legacy",
      trimesterModeSeen: false,
      registryTri: [],
      sectionsTri: {}
    };
  }

  function ensureSectionField(entry) {
    if (typeof entry.section !== "string") {
      const subj = String(entry.subject || "");
      const marker = subj.indexOf(" - ");
      if (marker !== -1) {
        entry.section = subj.slice(marker + 3).trim();
        entry.subject = subj.slice(0, marker).trim();
      } else {
        entry.section = "";
      }
    }
    if (typeof entry.archived !== "boolean") {
      entry.archived = false;
    }
    if (!Array.isArray(entry.weights) || entry.weights.length !== 3) {
      entry.weights = matchSubjectWeights(entry.subject);
    }
    return entry;
  }

  function normalizeRegistryAndSections(savedRegistry, savedSections, calendarMode) {
    const registry = Array.isArray(savedRegistry) && savedRegistry.length > 0
      ? JSON.parse(JSON.stringify(savedRegistry)) : [];
    const sections = {};
    registry.forEach(ensureSectionField);
    registry.forEach((section) => {
      const loaded = savedSections && savedSections[section.id];
      if (!loaded || !Array.isArray(loaded.periods) || !loaded.periods.length) {
        sections[section.id] = { periods: [initialPeriod(section, calendarMode)] };
        return;
      }
      sections[section.id] = { periods: loaded.periods.map((period, periodIndex) => {
        const wwLen = Array.isArray(period.wwDates) ? period.wwDates.length : 10;
        const ptLen = Array.isArray(period.ptDates) ? period.ptDates.length : 8;
        const qaLen = Array.isArray(period.qaDates) ? period.qaDates.length : 3;

        return {
          name: typeof period.name === "string" && period.name.trim() ? period.name : initialPeriod(section, calendarMode).name,
          locked: period.locked === true,
          quarter: calendarMode === "trimester" ? (period.quarter || 0) : (period.quarter || (section.group === "SHS" ? periodIndex % 2 + 1 : periodIndex + 1)),
          semester: calendarMode === "trimester" ? (period.semester || 0) : (period.semester || (section.group === "SHS" ? Math.floor(periodIndex / 2) + 1 : 0)),
          ...(calendarMode === "trimester" ? { term: period.term || periodIndex + 1 } : {}),
          wwDates: fitArray(period.wwDates, wwLen),
          ptDates: fitArray(period.ptDates, ptLen),
          qaDates: fitArray(period.qaDates, qaLen),
          wwHps: fitArray(period.wwHps, wwLen),
          ptHps: fitArray(period.ptHps, ptLen),
          qaHps: fitArray(period.qaHps, qaLen),
          activityMeta: Object.fromEntries(["ww", "pt", "qa"].map((kind) => [kind, Array.from({ length: kind === "ww" ? wwLen : kind === "pt" ? ptLen : qaLen }, (_, index) => {
            const item = period.activityMeta?.[kind]?.[index];
            return { title: typeof item?.title === "string" ? item.title : "", competency: typeof item?.competency === "string" ? item.competency : "", topic: typeof item?.topic === "string" ? item.topic : "" };
          })])),
          roster: Array.from({ length: Array.isArray(period.roster) && period.roster.length ? period.roster.length : (section.rosterSize || 50) }, (_, index) => {
            const learner = Array.isArray(period.roster) ? period.roster[index] : null;
            return {
              name: learner && typeof learner.name === "string" ? learner.name : "",
              ww: fitArray(learner && learner.ww, wwLen),
              pt: fitArray(learner && learner.pt, ptLen),
              qa: fitArray(learner && learner.qa, qaLen),
              hpsOriginals: window.CSTRRecordTools.normalizeOrigins(learner, { ww: wwLen, pt: ptLen, qa: qaLen })
            };
          })
        };
      }) };
    });
    return { registry, sections };
  }

  function normalizeState(saved) {
    const base = createInitialState();
    if (!saved || typeof saved !== "object") return base;
    base.photo = typeof saved.photo === "string" && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(saved.photo) && saved.photo.length <= 2000000 ? saved.photo : "";
    base.teacher = saved.teacher && typeof saved.teacher === "object" ? saved.teacher : base.teacher;
    base.calendarMode = saved.calendarMode === "trimester" ? "trimester" : "legacy";
    base.trimesterModeSeen = saved.trimesterModeSeen === true || saved.calendarMode === "trimester" || (Array.isArray(saved.registryTri) && saved.registryTri.length > 0);
    const legacy = normalizeRegistryAndSections(saved.registry, saved.sections, "legacy");
    base.registry = legacy.registry;
    base.sections = legacy.sections;
    const trimester = normalizeRegistryAndSections(saved.registryTri, saved.sectionsTri, "trimester");
    base.registryTri = trimester.registry;
    base.sectionsTri = trimester.sections;
    return base;
  }

  function fitArray(values, length) {
    return Array.from({ length }, (_, index) => Array.isArray(values) && values[index] !== undefined ? values[index] : "");
  }

  function activeRegistry() { return state.calendarMode === "trimester" ? state.registryTri : state.registry; }
  function activeSections() { return state.calendarMode === "trimester" ? state.sectionsTri : state.sections; }
  function trimesterTermNames(section) {
    return section.group === "SHS" && TRIMESTER_APPLIES_TO_SHS_SEPARATELY ? TRIMESTER_SHS_TERM_NAMES : TRIMESTER_TERM_NAMES;
  }

  function currentSection() { return activeRegistry().find((section) => section.id === activeSectionId) || activeRegistry()[0]; }

  // Resolves through currentSection()'s own fallback rather than indexing
  // activeSections()[activeSectionId] directly, and never throws. Whenever the
  // whole `state` object gets swapped out (loading from GitHub, restoring a
  // version, restoring a local draft) activeSectionId can briefly point at a
  // section that no longer exists in the new data — this must degrade to
  // "no current period" instead of crashing every render() in between.
  function currentPeriod() {
    const section = currentSection();
    const bucket = section && activeSections()[section.id];
    return bucket && Array.isArray(bucket.periods) ? bucket.periods[activePeriodIndex] : undefined;
  }

  // Rosters belong to each grading period individually, so adding/removing
  // learner rows only needs the CURRENT period unlocked. Grading weights and
  // subject are still section-wide, so those stay blocked while ANY period in
  // the section is locked.
  function sectionHasLockedPeriod(section) {
    const bucket = section && activeSections()[section.id];
    return !!(bucket && Array.isArray(bucket.periods) && bucket.periods.some((p) => p.locked));
  }

  // Call right after anything replaces `state` wholesale (data load, version
  // restore, local draft restore). If activeSectionId no longer matches a
  // section in the new registry, snap it back to a real section (or clear it
  // if there are none) and back out of the "record" view for that vanished
  // section instead of leaving the app pointed at data that doesn't exist.
  function ensureActiveSelectionValid() {
    const stillExists = activeRegistry().some((section) => section.id === activeSectionId);
    if (stillExists) return;
    const fallback = activeRegistry()[0];
    activeSectionId = fallback ? fallback.id : "";
    activeGroup = fallback ? fallback.group : activeGroup;
    activePeriodIndex = 0;
    if (currentView === "record") currentView = activeRegistry().length ? "chooser" : "home";
  }
  function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]); }
  function safeValue(value) { return escapeHtml(value === undefined || value === null ? "" : value); }
  function icon(name, className = "ui-icon") {
    const paths = {
      home: '<path d="m3 10 9-7 9 7v9a2 2 0 0 1-2 2h-5v-7h-4v7H5a2 2 0 0 1-2-2Z"/>',
      records: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5Zm16 0A2.5 2.5 0 0 0 17.5 3H13v16h4.5a2.5 2.5 0 0 1 2.5 2.5Z"/>',
      save: '<path d="M5 3h12l2 2v16H5Z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/>',
      settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.1A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.2 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H2.4v-4h.1A1.7 1.7 0 0 0 4.2 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 8.6 4.2a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V2.4h4v.1A1.7 1.7 0 0 0 15 4.2a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 8.6a1.7 1.7 0 0 0 .6 1 1.7 1.7 0 0 0 1.1.4h.1v4h-.1a1.7 1.7 0 0 0-1.7 1Z"/>',
      logout: '<path d="M10 17l5-5-5-5M15 12H3"/><path d="M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5"/>',
      search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
      plus: '<path d="M12 5v14M5 12h14"/>',
      arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
      back: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
      users: '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M20 8v6M23 11h-6"/>',
      classes: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h10M7 12h6M7 16h8"/>',
      lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
      unlock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 7.5-2"/>',
      archive: '<path d="M3 6h18v4H3zM5 10v10h14V10M9 14h6"/>',
      download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
      trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 15H6L5 6M10 11v6M14 11v6"/>',
      edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/>',
      chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
      calendar: '<circle cx="12" cy="12" r="9"/><path d="M12 3V21M3 12H21"/>',
      terms: '<circle cx="12" cy="12" r="9"/><path d="M12 3V12M12 12L19.79 16.5M12 12L4.21 16.5"/>',
      check: '<path d="m5 12 4 4L19 6"/>',
      alert: '<path d="M12 3 2 21h20Z"/><path d="M12 9v4M12 17h.01"/>',
      info: '<circle cx="12" cy="12" r="9"/><path d="M12 10.5v6M12 7.5h.01"/>',
      close: '<path d="m6 6 12 12M18 6 6 18"/>',
      chevron: '<path d="m6 9 6 6 6-6"/>',
      panel: '<rect x="3" y="3" width="18" height="18"/><path d="M9 3v18m5-13 4 4-4 4"/>',
      print: '<path d="M6 8V3h12v5M6 17H3V8h18v9h-3M6 14h12v7H6zM17 11h.01"/>',
      eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/>',
      more: '<circle cx="5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none"/>'
    };
    return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.records}</svg>`;
  }

  function button(label, action, className = "button", extra = "") { return `<button type="button" class="${className}" data-action="${action}" ${extra}>${label}</button>`; }

  // Custom/Other subject grading weights — lets a teacher set their own
  // WW / PT / QA split for a subject that isn't one of the DepEd presets.
  // The QA column's internal ST1/ST2/Term Exam 30/30/40 split is untouched:
  // that split lives in CSTRGrading.calculateQuarterlyAssessment and applies
  // uniformly whenever a period has exactly 3 QA columns, regardless of subject.
  function attachCustomWeightLiveTotal(modal, ids, noteId) {
    const inputs = ids.map((id) => modal.querySelector(`#${id}`)).filter(Boolean);
    const note = modal.querySelector(`#${noteId}`);
    if (!note || inputs.length !== 3) return;
    const refresh = () => {
      const total = inputs.reduce((sum, input) => sum + (Number(input.value) || 0), 0);
      const rounded = Math.round(total * 100) / 100;
      const balanced = Math.abs(rounded - 100) <= 0.01;
      note.textContent = balanced
        ? `Total: ${rounded}% ✓ (WW ${Number(inputs[0].value) || 0}% · PT ${Number(inputs[1].value) || 0}% · QA ${Number(inputs[2].value) || 0}%)`
        : `Total: ${rounded}% — WW + PT + QA must add up to exactly 100%.`;
      note.classList.toggle("error", !balanced);
      note.classList.toggle("is-valid", balanced);
    };
    inputs.forEach((input) => input.addEventListener("input", refresh));
    refresh();
  }

  // Reads and validates the three custom-weight inputs. Returns null (and
  // never a partially-valid array) when any value is missing, negative, or
  // the three don't sum to 100 within floating-point tolerance.
  function readCustomWeightInputs(modal, ids) {
    const values = ids.map((id) => Number(modal.querySelector(`#${id}`)?.value));
    if (values.some((value) => !Number.isFinite(value) || value < 0)) return null;
    const total = values.reduce((sum, value) => sum + value, 0);
    if (Math.abs(total - 100) > 0.01) return null;
    return values;
  }

  function dashboardMetrics() {
    const activeClasses = activeRegistry().filter((section) => !section.archived);
    const archivedSections = activeRegistry().filter((section) => section.archived);
    const sectionRecords = activeSections();
    let learners = 0;
    let totalPeriods = 0;
    let lockedPeriods = 0;
    activeClasses.forEach((section) => {
      const periods = sectionRecords[section.id] && Array.isArray(sectionRecords[section.id].periods) ? sectionRecords[section.id].periods : [];
      totalPeriods += periods.length;
      lockedPeriods += periods.filter((period) => recordCompletion(period).complete).length;
      learners += computeLearnerNumbering(currentRosterOf(periods)).totalLearners;
    });
    const completion = totalPeriods ? Math.round((lockedPeriods / totalPeriods) * 100) : 0;
    return { activeSections: activeClasses, archivedSections, learners, totalPeriods, lockedPeriods, completion };
  }

  function themeColorHex(name) {
    const colors = { purple: "#6a1b9a", green: "#1b5e20", blue: "#0d47a1", red: "#c62828", charcoal: "#263238", "baby-blue": "#0277bd", "deep-red": "#880e4f", black: "#111827", brown: "#4e342e", orange: "#d13f14", pink: "#ad1457", gray: "#374151", yellow: "#b45309" };
    return colors[name] || colors.blue;
  }

  function themeColorInk(name) {
    return "#ffffff";
  }

  function renderDescriptorBadge(descriptor) {
    if (!descriptor || descriptor === "—") return `<span class="descriptor-empty">—</span>`;
    const clsMap = {
      "Advancing": "desc-advancing",
      "Benchmarking": "desc-benchmarking",
      "Connecting": "desc-connecting",
      "Developing": "desc-developing",
      "Emerging": "desc-emerging"
    };
    const cls = clsMap[descriptor] || "";
    return `<span class="descriptor-badge ${cls}">${escapeHtml(descriptor)}</span>`;
  }

  function getLearnerCategory(name) {
    return window.CSTRRecordTools.getLearnerCategory(name);
  }

  // Keep divider rows out of the record tools, including when their labels
  // contain additional words (for example, "Grade 8 Boys").
  function recordablePeriod(period) {
    if (!period || !Array.isArray(period.roster)) return period;
    return { ...period, roster: period.roster.filter((learner) => !getLearnerCategory(learner.name)) };
  }

  function recordCompletion(period) {
    return window.CSTRRecordTools.completion(recordablePeriod(period));
  }

  function adjustRecordHps(period, kind, index, previous, next) {
    return window.CSTRRecordTools.adjustHps(recordablePeriod(period), kind, index, previous, next);
  }

  function sectionNameShade(accent) {
    return { background: "var(--section-surface)", color: themeColorHex(accent) };
  }

  function themeControl() {
    const dark = document.documentElement.dataset.theme === "dark";
    return `<button type="button" class="theme-toggle" data-toggle-theme aria-pressed="${dark}" aria-label="Switch to ${dark ? "light" : "dark"} mode" title="Switch to ${dark ? "light" : "dark"} mode"><span class="theme-switch-track" aria-hidden="true"><svg class="theme-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="3.5"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></svg><span class="theme-switch-thumb"></span><svg class="theme-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20.2 15.5A8.4 8.4 0 0 1 8.5 3.8 8.5 8.5 0 1 0 20.2 15.5Z"/></svg></span><span class="theme-toggle-label">${dark ? "Light mode" : "Dark mode"}</span></button>`;
  }

  function computeLearnerNumbering(roster) {
    let count = 0;
    const numbering = roster.map((learner) => {
      const name = (learner.name || "").trim();
      if (!name) return ""; 
      if (getLearnerCategory(name)) return ""; 
      count += 1;
      return count;
    });
    return { numbering, totalLearners: count };
  }

  // Rosters are per grading period, so a class's current headcount comes from
  // the latest period that actually lists learners (someone who left earlier no
  // longer counts). Falls back to the first period for a brand-new class.
  function currentRosterOf(periods) {
    for (let i = periods.length - 1; i >= 0; i -= 1) {
      const roster = periods[i] && periods[i].roster;
      if (Array.isArray(roster) && computeLearnerNumbering(roster).totalLearners > 0) return roster;
    }
    return periods[0] && Array.isArray(periods[0].roster) ? periods[0].roster : [];
  }

  function updateAllNumberingAndCounts() {
    const period = currentPeriod();
    if (!period || !period.roster) return;
    const { numbering, totalLearners } = computeLearnerNumbering(period.roster);
    document.querySelectorAll("tr[data-learner-row]").forEach((row, idx) => {
      const numCell = row.querySelector(".number-cell");
      if (numCell) numCell.textContent = numbering[idx] !== undefined ? numbering[idx] : "";
    });
    const countBadge = document.querySelector("#liveLearnerCount");
    if (countBadge) countBadge.textContent = `${totalLearners} Learner${totalLearners === 1 ? "" : "s"}`;
  }

  function adjustNameColumnWidth() {
    const period = currentPeriod();
    if (!period || !period.roster) return;
    const inputs = document.querySelectorAll(".record-table .name-cell input[data-name-row]");
    if (!inputs.length) return;
    // Measure the rendered text, so wide letters, uppercase dividers, and
    // long names all expand the same shared table column without a hard cap.
    document.documentElement.style.setProperty("--name-col-width", "218px");
    let newWidth = 218;
    inputs.forEach((input) => {
      const cell = input.closest(".name-cell");
      const overflow = Math.max(0, input.scrollWidth - input.clientWidth);
      newWidth = Math.max(newWidth, Math.ceil(cell.getBoundingClientRect().width + overflow + 12));
    });
    document.documentElement.style.setProperty("--name-col-width", `${newWidth}px`);
  }

  // Smooth jitter-free header scrolling with hysteresis
  let isHeaderShrunk = false;
  let scrollTicking = false;

  function updateHeaderScroll() {
    if (scrollTicking) return;
    scrollTicking = true;
    requestAnimationFrame(() => {
      const header = document.querySelector(".app-header");
      if (header) {
        const top = window.scrollY || document.documentElement.scrollTop;
        if (!isHeaderShrunk && top > 60) {
          isHeaderShrunk = true;
          header.classList.add("header-shrunk");
        } else if (isHeaderShrunk && top < 20) {
          isHeaderShrunk = false;
          header.classList.remove("header-shrunk");
        }
      }
      scrollTicking = false;
    });
  }

  window.addEventListener("scroll", updateHeaderScroll, { passive: true });

  function sanitizeScoreValue(raw) {
    if (raw === "" || raw === null || raw === undefined) return "";
    const trimmed = String(raw).trim();
    const upper = trimmed.toUpperCase();
    if (upper === "A" || upper === "E" || upper === "L" || upper === "M") return upper;
    const numeric = trimmed.replace(/[^0-9.]/g, "");
    const firstDot = numeric.indexOf(".");
    if (firstDot === -1) return numeric;
    return numeric.slice(0, firstDot + 1) + numeric.slice(firstDot + 1).replace(/\./g, "");
  }

  // Scores remain text while a teacher is typing so partial decimals stay
  // usable. This only drives integrity feedback; grading formulas stay intact.
  function getPeriodInputIntegrity(period) {
    const issues = { invalidHps: 0, invalidScores: 0, aboveHps: 0 };
    if (!period) return issues;
    ["ww", "pt", "qa"].forEach((kind) => {
      const hpsValues = period[`${kind}Hps`] || [];
      hpsValues.forEach((value) => {
        if (value === "" || value === null || value === undefined) return;
        const hps = Number(value);
        if (!Number.isFinite(hps) || hps <= 0) issues.invalidHps += 1;
      });
      (period.roster || []).forEach((learner) => {
        if (getLearnerCategory(learner.name)) return;
        (learner[kind] || []).forEach((value, index) => {
          if (value === "" || value === null || value === undefined || isAttendanceCode(value)) return;
          const score = Number(value);
          if (!Number.isFinite(score) || score < 0) {
            issues.invalidScores += 1;
            return;
          }
          const hps = Number(hpsValues[index]);
          if (Number.isFinite(hps) && hps > 0 && score > hps) issues.aboveHps += 1;
        });
      });
    });
    return issues;
  }

  function hasPeriodInputIssues(issues) {
    return issues.invalidHps > 0 || issues.invalidScores > 0 || issues.aboveHps > 0;
  }

  function periodInputIssueMessage(issues) {
    const parts = [];
    if (issues.invalidHps) parts.push(`${issues.invalidHps} invalid HPS value${issues.invalidHps === 1 ? "" : "s"}`);
    if (issues.invalidScores) parts.push(`${issues.invalidScores} invalid score${issues.invalidScores === 1 ? "" : "s"}`);
    if (issues.aboveHps) parts.push(`${issues.aboveHps} score${issues.aboveHps === 1 ? "" : "s"} above HPS`);
    return parts.join("; ");
  }

  function updateSiteBackground() {
    const bg = document.querySelector("#siteBg");
    if (!bg) return;
    const isLoggedIn = sessionStorage.getItem("cstr-class-record-login") === "true";
    bg.className = isLoggedIn ? "bg-sheets" : "bg-login";
  }

  // Authorization is an expiring server-issued ticket; sessionStorage flags
  // and client-side hashes are never accepted as security evidence.
  function isRegistrationAuthorized() { return true; }

  async function verifySecretRegistrationCode() { throw new Error("Approval is managed by the developer. Contact SANCHEZRAMIL2202@GMAIL.COM."); }

  function showRegistrationCodeModal() { alert("Contact SANCHEZRAMIL2202@GMAIL.COM for account approval. Do not send passwords or student records by email."); }

  function render() {
    updateSiteBackground();
    ensureActiveSelectionValid();
    const scrollLeft = currentView === "record" ? rememberTableScroll() : null;
    const signedIn = isSignedIn();
    const recordKey = signedIn && currentView === "record" ? activeSectionId + ":" + activePeriodIndex : "";
    const existing = app.querySelector(".app-layout");
    if (existing && signedIn && recordKey && recordKey === lastRenderedRecord) {
      const template = document.createElement("template");
      template.innerHTML = renderApp();
      window.CSTRStableDOM.patch(existing, template.content.querySelector(".app-layout"));
    } else {
      app.innerHTML = signedIn ? renderApp() : renderLogin();
    }
    lastRenderedRecord = recordKey;
    if (sessionStorage.getItem("cstr-class-record-login") === "true") {
      syncSaveControl();
      updateSaveIndicators();
      adjustNameColumnWidth();
      updateAllNumberingAndCounts();
      updateHeaderScroll();
    }
    updateCompletionIndicators();
    document.querySelectorAll('.record-section textarea[data-activity-field]').forEach(sizeActivityTextarea);
    sizeSheetWorkspace();
    requestAnimationFrame(fitSectionName);
    restoreTableScroll(scrollLeft);
  }

  function fitSectionName() {
    const name = document.querySelector(".class-name");
    if (!name) return;
    const available = name.clientWidth;
    if (!available) return;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    const style = getComputedStyle(name);
    const weight = style.fontWeight || "700";
    const family = style.fontFamily || "sans-serif";
    let low = 10, high = 88;
    while (high - low > 0.5) {
      const size = (low + high) / 2;
      context.font = `${weight} ${size}px ${family}`;
      if (context.measureText(name.textContent).width <= available - 4) low = size;
      else high = size;
    }
    name.style.fontSize = `${Math.floor(low)}px`;
  }

  function sizeActivityTextarea(input) {
    input.style.height = 'auto';
    input.style.height = `${Math.max(44, input.scrollHeight + 2)}px`;
  }
  window.addEventListener('resize', () => document.querySelectorAll('.record-section textarea[data-activity-field]').forEach(sizeActivityTextarea), { passive: true });

  function renderLogin() {
    const titles = { signin: "Sign in to your records", signup: "Create your teacher account", legacy: "Claim your existing records" };
    const panelBody = loginPanel === "signup" ? renderSignUpPanel()
      : loginPanel === "legacy" ? renderLegacyClaimPanel()
      : renderSignInPanel();

    return `<header class="welcome-nav"><a class="welcome-brand" href="./"><img src="ASSETS/logo-compact.png" alt="">Colegio de Sto. Tomas-Recoletos, Incorporated <span>Digital Class Record · Unofficial</span></a><div class="welcome-tools">${themeControl()}<button type="button" class="welcome-policy" data-open-policies>${icon("lock")}<span>Privacy &amp; terms</span></button></div></header><section class="login-screen">
      <div class="welcome-story"><p class="eyebrow">CST-R · Digital Class Record</p><h2>Teaching records,<br><span>clearly organized.</span></h2><p>Keep class rosters, assessment scores, and grade reviews together in your teacher workspace.</p><div class="welcome-features"><span>${icon("records")} Class records</span><span>${icon("save")} Visible save status</span><span>${icon("lock")} Teacher access</span></div><figure><img src="ASSETS/campus.webp" width="1400" height="788" loading="lazy" decoding="async" alt="Colegio de Sto. Tomás – Recoletos campus"><figcaption>Colegio de Sto. Tomás – Recoletos</figcaption></figure><p class="welcome-unofficial">An independent, unofficial faculty tool.</p></div>
      <div class="login-card">
        <div class="login-header-logo">
          <img src="ASSETS/logo-compact.png" alt="Colegio de Sto. Tomás – Recoletos crest" class="login-logo-img">
        </div>
        <p class="eyebrow">Colegio de Sto. Tomás – Recoletos</p>
        <h1>${titles[loginPanel]}</h1><p class="login-intro">Access your class record workspace.</p>
        <p class="muted">Confirm grading settings and assessment rules with your school before use.</p>

        ${panelBody}

        <p class="login-policy-note">Read our <button type="button" data-open-policies>Privacy, Terms &amp; Data Protection</button> information before using the workspace.</p><p id="loginError" class="login-error" role="alert"></p>
        <p id="loginSuccess" class="login-success" role="status" style="display: none;"></p>
      </div>
      <article class="project-about" aria-labelledby="projectTitle">
        <p class="project-kicker">About the project and the developer</p>
        <p class="project-label">Project Title</p>
        <h2 id="projectTitle">CSTR Class Record System</h2>
        <p class="project-subtitle"><em>Unofficial Digital Grading Platform of Colegio de Sto. Tomás – Recoletos, Incorporated</em></p>
        <section><h3>About the Project</h3><p>This platform is the unofficial class record system of Colegio de Sto. Tomás – Recoletos, Incorporated, built to bring accuracy, consistency, and convenience to everyday classroom grade management.</p></section>
        <section><h3>About the Developer</h3><p>Designed and developed through vibe coding by Sir Ramelito &quot;Johnmil&quot; Jr. C. Sanchez, LPT — a Licensed Professional Teacher, Science and Research educator, and graduate of Science Education — as a personal initiative to give CSTR faculty a faster, more reliable way to handle their records.</p></section>
        <section><h3>Features &amp; Advantages</h3><p>Configurable grade computation across Written Work, Performance Tasks, and Quarterly Assessments. Color-coded, easy-to-navigate class and section management. Teacher-assisted lookup of an individual learner’s results within the signed-in workspace.</p><p>Real-time sync across devices — log in anywhere and pick up right where you left off. Developer-approved account access. Excel, PDF and Word exports for teacher review before submission.</p></section>
        <section class="project-standout"><h3>The Standout Feature</h3><p>What sets this system apart is its live, cross-device synchronization — access to the latest successfully saved record from another approved sign-in. Your class record simply follows you, available across signed-in devices after a successful cloud save. Check the save status before switching devices.</p></section>
      </article>
    </section>`;
  }

  function renderSignInPanel() {
    return `<form id="signinForm" class="legacy-login-box">
        <label class="field-label" style="text-align: left; margin: 10px 0 6px;">Email
          <input id="signinEmail" type="email" autocomplete="username" placeholder="you@example.com" required>
        </label>
        <label class="field-label" style="text-align: left; margin: 10px 0 6px;">Password
          <input id="signinPassword" type="password" autocomplete="current-password" placeholder="Your password" required>
        </label>
        <button type="submit" class="button button-primary" data-action="email-signin" style="width: 100%; margin-top: 6px;">Sign In</button>
      </form>
      <p style="text-align: center; margin-top: 8px;"><a href="#" class="legacy-toggle-link" data-action="forgot-password">Forgot password?</a></p>

      <div class="login-divider"><span>OR</span></div>
      <div class="login-cta-group">
        <button type="button" class="button-google" data-action="google-login">
          <svg class="google-icon" viewBox="0 0 48 48" width="20" height="20" aria-hidden="true">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.79l7.97-6.2z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
          </svg>
          <span>Continue with Google</span>
        </button>
      </div>

      <p class="login-alternative"><a href="#" class="legacy-toggle-link" data-action="show-signup">Prefer email? Register here</a></p>
      <p style="text-align: center; margin-top: 6px;">
        <a href="#" class="legacy-toggle-link" data-action="show-legacy-claim"> Need your existing records? Request recovery</a>
      </p>`;
  }

  function renderSignUpPanel() {
    return `<p class="legacy-helper-text" style="text-align: left;">Enter your details below to create an account. Developer approval is required before accessing a workspace.</p>
      <form id="signupForm" class="legacy-login-box">
        <label class="field-label" style="text-align: left; margin: 10px 0 6px;">Full Name
          <input id="signupName" type="text" autocomplete="name" placeholder="e.g. Maria Santos" required>
        </label>
        <label class="field-label" style="text-align: left; margin: 10px 0 6px;">Email
          <input id="signupEmail" type="email" autocomplete="username" placeholder="you@example.com" required>
        </label>
        <label class="field-label" style="text-align: left; margin: 10px 0 6px;">Password
          <input id="signupPassword" type="password" autocomplete="new-password" placeholder="At least 12 characters" minlength="12" required>
        </label>
        <label class="field-label" style="text-align: left; margin: 10px 0 6px;">Confirm Password
          <input id="signupPasswordConfirm" type="password" autocomplete="new-password" placeholder="Re-enter password" minlength="12" required>
        </label>
        <button type="submit" class="button button-primary" data-action="email-signup" style="width: 100%; margin-top: 6px;"> Create account</button>
      </form>
      <p style="text-align: center; margin-top: 10px;"><a href="#" class="legacy-toggle-link" data-action="show-signin">← Back to Sign In</a></p>`;
  }

  function renderLegacyClaimPanel() {
    return `<h2>Recover existing records</h2><p>Sign in with your existing approved account. If your records are missing, contact the developer to verify ownership and reconnect your workspace.</p><p><a href="mailto:SANCHEZRAMIL2202@GMAIL.COM?subject=Class%20record%20recovery">SANCHEZRAMIL2202@GMAIL.COM</a></p><p>Send your sign-in email and a brief description. Never email passwords, account codes, learner lists, or grade files.</p><button type="button" class="button button-secondary" data-action="show-signin">Back to sign in</button>`;
  }

  function showSignInPanel() { loginPanel = "signin"; render(); }
  function showSignUpPanel() {
    if (!isRegistrationAuthorized()) {
      showRegistrationCodeModal(() => {
        loginPanel = "signup";
        render();
      });
      return;
    }
    loginPanel = "signup";
    render();
  }
  function showLegacyClaimPanel() { loginPanel = "legacy"; render(); }

  // Turns a raw Firebase/JS error into user-facing text. Specifically catches
  // the case where the Firebase scripts themselves failed to load (flaky
  // connection, ad-blocker, etc.) — window.CSTRSync's fallback throws
  // "Firebase SDK not loaded" for every method in that case — and shows a
  // plain, actionable message instead of that internal-sounding string.
  function friendlyAuthErrorMessage(err, fallbackPrefix) {
    const sdkDown = !window.CSTRSync || !window.CSTRSync.configured || err?.message === "Firebase SDK not loaded";
    if (sdkDown) {
      return "Couldn't reach the sign-in service (this usually means the page didn't fully load). Please check your internet connection and reload the page, then try again.";
    }
    return `${fallbackPrefix}: ${err.message}`;
  }

  // Shared "finish signing in" step used by every successful sign-in/sign-up path.
  function completeSignInSession(profile, user) {
    sessionStorage.setItem("cstr-class-record-login", "true");
    sessionStorage.setItem("cstr-class-record-user", profile.dataKey);
    sessionStorage.setItem("cstr-class-record-email", user.email || "");
    sessionStorage.setItem("cstr-class-record-name", profile.name || user.displayName || "");
    render();
    if (!hasSeenWelcome()) {
      markWelcomeSeen();
      showWelcomeModal();
    }
    subscribeToSync();
    startSaveIndicatorTicker();
  }

  function showGoogleContinuation(prefillAccountCode) {
    // A fresh click after verification preserves the browser's popup permission.
    const modal = document.createElement("div");
    modal.className = "modal-backdrop";
    modal.innerHTML = `<section class="modal" role="dialog" aria-modal="true" aria-labelledby="googleContinueTitle"><h2 id="googleContinueTitle">Registration authorized</h2><p>Continue with the Google account matching the email you entered.</p><button type="button" class="button button-primary" id="authorizedGoogleContinue">Continue with Google</button>${button("Cancel","close-modal","button")}</section>`;
    document.body.append(modal);
    modal.querySelector("#authorizedGoogleContinue").addEventListener("click", () => { modal.remove(); performGoogleLogin(prefillAccountCode); });
    modal.querySelector("#authorizedGoogleContinue").focus();
  }

  async function authFeedback(action, label, operation) {
    const control = document.querySelector(`[data-action="${action}"]`);
    if (control?.getAttribute("aria-busy") === "true") return;
    const original = control?.innerHTML;
    if (control) { control.setAttribute("aria-busy", "true"); control.disabled = true; control.textContent = label; }
    try { return await operation(); }
    finally {
      if (control) { control.removeAttribute("aria-busy"); control.disabled = false; control.innerHTML = original; }
    }
  }
  function performGoogleLogin(...args) { return authFeedback("google-login", "Connecting…", () => performGoogleLoginRequest(...args)); }
  function performEmailSignIn(...args) { return authFeedback("email-signin", "Signing in…", () => performEmailSignInRequest(...args)); }
  function performEmailSignUp(...args) { return authFeedback("email-signup", "Creating account…", () => performEmailSignUpRequest(...args)); }
  function performLegacyClaim(...args) { return authFeedback("legacy-claim", "Checking account…", () => performLegacyClaimRequest(...args)); }

  async function performGoogleLoginRequest(prefillAccountCode) {
    if (!isRegistrationAuthorized()) {
      showRegistrationCodeModal(() => showGoogleContinuation(prefillAccountCode));
      return;
    }
    const error = document.querySelector("#loginError");
    const success = document.querySelector("#loginSuccess");
    if (error) { error.textContent = ""; error.classList.remove("error"); }
    if (success) { success.textContent = ""; success.style.display = "none"; }

    isLinkingLegacyInProgress = true;
    try {
      setStatus("Signing in with Google...", "saving");
      const user = await window.CSTRSync.signInWithGoogle();
      if (!user) return;

      const profile = await window.CSTRSync.getUserProfile(user.uid);
      if (profile && profile.dataKey) {
        completeSignInSession(profile, user);
      } else {
        showOnboardingModal(user, prefillAccountCode);
      }
    } catch (err) {
      console.error("Google sign-in error:", err);
      if (error) {
        if (err.code === "auth/popup-closed-by-user" || err.code === "auth/cancelled-popup-request") {
          error.textContent = "Sign-in cancelled. Please try again.";
        } else if (err.code === "auth/unauthorized-domain") {
          error.textContent = "Domain not authorized in Firebase Console. Please see FIREBASE_SETUP.md.";
        } else {
          error.textContent = friendlyAuthErrorMessage(err, "Sign-in failed");
        }
        error.classList.add("error");
      }
    } finally {
      isLinkingLegacyInProgress = false;
    }
  }

  async function performEmailSignInRequest() {
    const emailInput = document.querySelector("#signinEmail");
    const passwordInput = document.querySelector("#signinPassword");
    const email = emailInput ? emailInput.value.trim() : "";
    const password = passwordInput ? passwordInput.value : "";
    const error = document.querySelector("#loginError");
    const success = document.querySelector("#loginSuccess");
    if (error) { error.textContent = ""; error.classList.remove("error"); }
    if (success) { success.textContent = ""; success.style.display = "none"; }

    if (!email || !password) {
      if (error) { error.textContent = "Please enter your email and password."; error.classList.add("error"); }
      return;
    }

    try {
      setStatus("Signing in...", "saving");
      const user = await window.CSTRSync.signInWithEmail(email, password);
      if (!user) return;
      const profile = await window.CSTRSync.getUserProfile(user.uid);
      if (profile && profile.dataKey) {
        completeSignInSession(profile, user);
      } else {
        showOnboardingModal(user);
      }
    } catch (err) {
      console.error("Email sign-in error:", err);
      if (error) {
        if (["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found"].includes(err.code)) {
          error.textContent = "Incorrect email or password.";
        } else if (err.code === "auth/too-many-requests") {
          error.textContent = "Too many attempts. Please wait a moment and try again.";
        } else if (err.code === "auth/invalid-email") {
          error.textContent = "Please enter a valid email address.";
        } else {
          error.textContent = friendlyAuthErrorMessage(err, "Sign-in failed");
        }
        error.classList.add("error");
      }
    }
  }

  async function performEmailSignUpRequest() {
    const name = document.querySelector("#signupName")?.value.trim();
    const email = document.querySelector("#signupEmail")?.value.trim();
    const password = document.querySelector("#signupPassword")?.value || "";
    const confirmation = document.querySelector("#signupPasswordConfirm")?.value;
    const error = document.querySelector("#loginError");
    if (!name || !email || password.length < 12 || password !== confirmation) {
      if (error) error.textContent = "Enter your name, a valid email, and matching passwords of at least 12 characters.";
      return;
    }
    isLinkingLegacyInProgress = true;
    try {
      await window.CSTRSync.signUpWithEmail(email, password);
      showSignInPanel();
      const message = document.querySelector("#loginError");
      if (message) message.textContent = "Account created. Request approval from SANCHEZRAMIL2202@GMAIL.COM using your sign-in email. Do not send your password or student records. Sign in after approval.";
    } catch (err) { if (error) error.textContent = friendlyAuthErrorMessage(err, "Account creation failed"); }
    finally { isLinkingLegacyInProgress = false; }
  }

  async function performLegacyClaimRequest() { showLegacyClaimPanel(); }

  async function performForgotPassword() {
    const emailInput = document.querySelector("#signinEmail");
    let email = emailInput ? emailInput.value.trim() : "";
    if (!email) {
      email = (prompt("Enter the email address for your account:") || "").trim();
    }
    const error = document.querySelector("#loginError");
    const success = document.querySelector("#loginSuccess");
    if (error) { error.textContent = ""; error.classList.remove("error"); }
    if (success) { success.textContent = ""; success.style.display = "none"; }
    if (!email) return;

    try {
      await window.CSTRSync.sendPasswordResetEmail(email);
      if (success) {
        success.textContent = `Password reset link sent to ${email}. Check your inbox (and spam folder) and click the link to set a new password.`;
        success.style.display = "block";
      }
    } catch (err) {
      console.error("Password reset error:", err);
      if (error) {
        error.textContent = err.code === "auth/user-not-found" ? "No account found with that email." : friendlyAuthErrorMessage(err, "Couldn't send reset email");
        error.classList.add("error");
      }
    }
  }

  function showOnboardingModal(user) {
    document.querySelector(".onboarding-modal")?.remove();
    const backdrop = document.createElement("div"); backdrop.className = "modal-backdrop onboarding-modal";
    backdrop.innerHTML = `<section class="modal" role="dialog" aria-modal="true" aria-labelledby="onboardTitle"><h2 id="onboardTitle">Create your workspace</h2><p>Approved account: ${safeValue(user.email || "")}</p><p>If you have existing records, contact <a href="mailto:SANCHEZRAMIL2202@GMAIL.COM">the developer</a> before creating an empty workspace.</p><label>Teacher name<input id="onboardTeacherName" maxlength="120" value="${safeValue(user.displayName || "")}"></label><div class="stack-actions"><button type="button" class="button button-primary" data-action="complete-new-teacher">Create workspace</button><button type="button" class="button button-secondary" data-action="onboard-cancel">Sign out</button></div><p id="onboardError" role="alert"></p></section>`;
    document.body.append(backdrop);
  }

  async function completeNewTeacherSignup(user) {
    if (!await window.CSTRRegistration.isApproved(user)) {
      showRegistrationCodeModal(async () => { await window.CSTRRegistration.enroll(user); completeNewTeacherSignup(user); });
      return;
    }
    const nameInput = document.querySelector("#onboardTeacherName");
    const teacherName = nameInput ? nameInput.value.trim() : (user.displayName || "Teacher");
    const error = document.querySelector("#onboardError");

    try {
      const profile = await window.CSTRSync.registerNewTeacher(user, teacherName);
      document.querySelector(".modal-backdrop.onboarding-modal")?.remove();

      state = createInitialState();
      state.teacher.name = profile.name;

      completeSignInSession(profile, user);
    } catch (err) {
      if (error) {
        error.textContent = friendlyAuthErrorMessage(err, "Setup failed");
        error.classList.add("error");
      }
    }
  }

  async function completeOnboardLegacyLink() { alert("Record recovery requires developer verification. Contact SANCHEZRAMIL2202@GMAIL.COM."); }

  function renderApp() {
    const content = currentView === "home" ? renderHome() : currentView === "chooser" ? renderClassRecord() : renderSectionRecord();
    const viewTitle = currentView === "home" ? "Overview" : currentView === "chooser" ? "Class records" : "Grade sheet";
    return `<div class="aura-bg"><div class="aura-content app-layout ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${currentView === "record" ? "sheet-layout" : ""}" data-calendar-mode="${state.calendarMode}">
      <aside class="app-sidebar" aria-label="Application navigation" id="workspaceSidebar">
        <div class="sidebar-brand"><span class="sidebar-logo"><img src="ASSETS/logo-compact.png" alt="CST-R crest"></span><span class="sidebar-brand-copy"><strong>CST-R</strong><small>Digital Class Record</small></span></div>
        <button type="button" class="sidebar-toggle sidebar-link" data-action="toggle-sidebar" aria-controls="workspaceSidebar" aria-expanded="${!sidebarCollapsed}" aria-label="${sidebarCollapsed ? "Expand navigation" : "Retract navigation"}" title="Expand or retract navigation">${icon("panel")}<span>Retract navigation</span></button>
        <nav class="sidebar-nav" aria-label="Workspace"><p class="sidebar-label">Workspace</p>
          <button class="sidebar-link" type="button" data-action="go-home" aria-current="${currentView === "home" ? "page" : "false"}" title="Overview">${icon("home")}<span>Overview</span></button>
          <button class="sidebar-link" type="button" data-action="go-records" aria-current="${currentView !== "home" ? "page" : "false"}" title="Class records">${icon("records")}<span>Class records</span></button>
          <div class="sidebar-mode-switch" role="group" aria-label="Grading system">
            <p class="sidebar-label">Grading system</p>
            <button class="sidebar-link sidebar-mode-option" type="button" data-action="select-calendar-mode" data-mode="legacy" aria-label="Quarterly / Semestral mode" aria-pressed="${state.calendarMode === "legacy"}" title="Quarterly / Semestral mode">${icon("calendar")}<span>Quarterly / Semestral</span></button>
            <button class="sidebar-link sidebar-mode-option" type="button" data-action="select-calendar-mode" data-mode="trimester" aria-label="Trimester (Zero-Based) mode" aria-pressed="${state.calendarMode === "trimester"}" title="Trimester (Zero-Based) mode">${icon("terms")}<span>Trimester (Zero-Based)</span></button>
          </div>
        </nav>
        <section class="sidebar-search-block" aria-label="Find a learner"><p class="sidebar-label">Learner lookup</p>
          <button type="button" class="sidebar-link search-expand" data-action="expand-search" aria-label="Expand learner search" title="Find a learner">${icon("search")}<span>Find a learner</span></button>
          <div class="header-search sidebar-search" role="search"><label for="studentSearch">Find a learner by complete name</label><input id="studentSearch" type="search" autocomplete="off" placeholder="Full student name"><button type="button" class="button button-secondary" data-action="search-student" aria-label="Search learner" title="Search learner">${icon("search")}<span>Search learner</span></button></div>
        </section>
        <nav class="sidebar-account-tools" aria-label="Account"><p class="sidebar-label">Account</p>
          <button class="sidebar-link" type="button" data-action="open-settings" title="Settings">${icon("settings")}<span>Settings</span></button>
          <button class="sidebar-link policy-sidebar-link" type="button" data-open-policies title="Privacy, terms and data protection" aria-label="Privacy, terms and data protection">${icon("lock")}<span>Privacy &amp; terms</span></button>
          <button class="sidebar-link" type="button" data-action="logout" title="Log out">${icon("logout")}<span>Log out</span></button>
          <p class="sidebar-owner">${escapeHtml(currentUserName() || state.teacher.name || "Teacher")}</p>
        </nav>
      </aside>
      <div class="app-main"><header class="app-header"><div class="app-header-inner">
        <div class="page-context"><p class="eyebrow">Teacher workspace</p><h1 class="app-title">${viewTitle}</h1></div>
        <div class="header-actions-wrap"><div class="save-feedback"><p id="statusMessage" class="save-status" role="status" aria-live="polite"></p><p id="saveMeta" class="save-meta" aria-live="polite"></p></div>
          ${themeControl()}
          ${button(`${icon("save")}<span>Save changes</span>`, "save-changes", "button button-primary", 'id="saveChanges"')}
        </div>
      </div></header><div class="app-shell">${content}</div></div>
    </div></div>`;
  }

  function activeClassRow(section) {
    const periods = activeSections()[section.id] && activeSections()[section.id].periods ? activeSections()[section.id].periods : [];
    const learnerCount = computeLearnerNumbering(currentRosterOf(periods)).totalLearners;
    const locked = periods.filter((period) => recordCompletion(period).complete).length;
    return `<button type="button" class="recent-class-row" data-action="select-section" data-section="${safeValue(section.id)}">
      <span class="recent-class-accent accent-${safeValue(section.accent || section.theme)}" aria-hidden="true"></span>
      <span class="recent-class-main"><strong>${escapeHtml(section.subject)}</strong><small>${escapeHtml(section.level)}${section.section ? ` · ${escapeHtml(section.section)}` : ""}</small></span>
      <span class="recent-class-stat"><strong>${learnerCount}</strong><small>Learners</small></span>
      <span class="recent-class-stat"><strong>${locked}/${periods.length}</strong><small>Complete</small></span>
      ${icon("arrow", "ui-icon row-arrow")}
    </button>`;
  }

  // Renders every active class on the Overview page (both JHS and SHS), grouped
  // under a small level heading so long lists stay scannable instead of being
  // silently cut off to the first few sections.
  function buildActiveClassRows(sections) {
    if (!sections.length) return "";
    const groupOrder = [{ key: "JHS", label: "Junior High School" }, { key: "SHS", label: "Senior High School" }];
    const claimed = new Set();
    const blocks = [];
    groupOrder.forEach(({ key, label }) => {
      const groupSections = sections.filter((section) => section.group === key);
      if (!groupSections.length) return;
      groupSections.forEach((section) => claimed.add(section.id));
      blocks.push(`<div class="recent-class-group-heading">${escapeHtml(label)}</div>${groupSections.map(activeClassRow).join("")}`);
    });
    const leftover = sections.filter((section) => !claimed.has(section.id));
    if (leftover.length) {
      blocks.push(`${blocks.length ? `<div class="recent-class-group-heading">Other</div>` : ""}${leftover.map(activeClassRow).join("")}`);
    }
    return blocks.join("");
  }

  function renderHome() {
    const metrics = dashboardMetrics();
    const portrait = state.photo ? `<img class="profile-photo" src="${safeValue(state.photo)}" alt="Teacher portrait">` : `<span class="photo-placeholder" aria-hidden="true">${icon("users")}</span><span class="photo-caption">Upload photo</span>`;
    const recentClasses = buildActiveClassRows(metrics.activeSections);

    return `<section class="dashboard">
      <section class="dashboard-hero" aria-labelledby="ownerTitle">
        <div class="owner-intro">
          <p class="eyebrow">Teacher profile</p>
          <h2 id="ownerTitle">Class record owner</h2>
          <p class="owner-context">${state.calendarMode === "trimester" ? "Trimester (Zero-Based)" : "Quarterly / Semestral"} workspace</p>
          <input id="photoInput" type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" hidden>
          <button class="photo-frame" type="button" data-action="choose-photo" data-has-photo="${Boolean(state.photo)}" aria-label="${state.photo ? "Change" : "Upload"} teacher photo" title="${state.photo ? "Change" : "Upload"} teacher photo">${portrait}</button>
        </div>
        <div class="owner-workspace">
          <div class="profile-editor">
            <div class="teacher-block">
              <label class="profile-field profile-name-field"><span>Full name</span><input type="text" class="teacher-name-input" data-teacher="name" value="${safeValue(state.teacher.name)}" placeholder="Full name"></label>
              <label class="profile-field"><span>School level</span><select class="teacher-meta-input" data-teacher="level"><option value="Elementary" ${state.teacher.level === "Elementary" ? "selected" : ""}>Elementary</option><option value="Secondary" ${state.teacher.level === "Secondary" ? "selected" : ""}>Secondary</option></select></label>
              <label class="profile-field"><span>Specialization</span><input type="text" class="teacher-meta-input" data-teacher="specialization" value="${safeValue(state.teacher.specialization)}" placeholder="e.g. Science and Research"></label>
              <label class="profile-field profile-bio-field"><span>Professional bio</span><textarea class="teacher-bio-input" data-teacher="bio" placeholder="Short bio or role description">${safeValue(state.teacher.bio)}</textarea></label>
            </div>
          </div>
          <div class="owner-footer"><p class="teacher-edit-hint">Profile edits are included in your next save.</p><div class="dashboard-hero-actions">
            ${button(`${icon("records")}<span>Open class records</span>`, "go-records", "button button-primary")}
            ${button(`${icon("plus")}<span>Add class</span>`, "open-add-class", "button button-secondary")}
          </div></div>
        </div>
      </section>

      <div class="metric-grid" aria-label="Class record overview">
        <article class="metric-card metric-primary"><span class="metric-icon">${icon("classes")}</span><div><p>Active classes</p><strong>${metrics.activeSections.length}</strong><small>${metrics.archivedSections.length} archived record${metrics.archivedSections.length === 1 ? "" : "s"}</small></div></article>
        <article class="metric-card"><span class="metric-icon">${icon("users")}</span><div><p>Total learners</p><strong>${metrics.learners}</strong><small>Across active class rosters</small></div></article>
        <article class="metric-card"><span class="metric-icon">${icon("chart")}</span><div><p>Complete periods</p><strong>${metrics.lockedPeriods}<span> / ${metrics.totalPeriods}</span></strong><small>All required entries present</small></div></article>
        <article class="metric-card metric-progress"><span class="metric-icon">${icon("chart")}</span><div><p>Entry completion</p><strong>${metrics.completion}%</strong><div class="progress-track" aria-label="${metrics.completion}% of periods complete"><span style="width:${metrics.completion}%"></span></div></div></article>
      </div>

      <div class="dashboard-grid">
        <section class="dashboard-panel recent-panel">
          <div class="panel-heading"><div><p class="eyebrow">Your workspace</p><h3>Active class records${metrics.activeSections.length ? ` <span class="panel-count">${metrics.activeSections.length}</span>` : ""}</h3></div>${button(`View all ${icon("arrow")}`, "go-records", "button button-ghost button-small")}</div>
          <div class="recent-class-list">${recentClasses || `<div class="empty-state compact-empty"><span class="empty-icon">${icon("classes")}</span><h4>No classes yet</h4><p>Create your first class to begin building a roster and entering scores.</p>${button(`${icon("plus")}<span>Create first class</span>`, "open-add-class", "button button-primary")}</div>`}</div>
        </section>
      </div>
    </section>`;
  }

  function renderClassRecord() {
    const edge = (group) => group === "JHS" ? `<span class="level-edge edge-green"></span><span class="level-edge edge-yellow"></span><span class="level-edge edge-red"></span><span class="level-edge edge-blue"></span>` : `<span class="level-edge edge-charcoal"></span><span class="level-edge edge-baby-blue"></span><span class="level-edge edge-deep-red"></span>`;
    const groupCards = ["JHS", "SHS"].map((group) => `<button type="button" class="level-card level-card-${group.toLowerCase()} ${activeGroup === group ? "is-active" : ""}" data-action="select-group" data-group="${group}">${edge(group)}<span class="level-card-kicker">${group}</span><strong>${group === "JHS" ? "Junior High School" : "Senior High School"}</strong><small>Choose a level to view its sections</small></button>`).join("");
    
    const groupSections = activeRegistry().filter((section) => section.group === activeGroup);
    const activeCount = groupSections.filter((section) => !section.archived).length;
    const archivedCount = groupSections.filter((section) => Boolean(section.archived)).length;
    
    const visibleSections = groupSections.filter((section) => archiveFilter === "archived" ? Boolean(section.archived) : !section.archived);

    const sectionCards = visibleSections.length > 0 ? visibleSections.map((section) => `
      <div class="section-card-wrap">
        <button type="button" class="kebab-btn" data-action="open-edit-section" data-section="${safeValue(section.id)}" aria-label="Edit or archive class">${icon("more")}</button>
        <button type="button" class="section-card accent-${safeValue(section.accent || section.theme)}" data-action="select-section" data-section="${safeValue(section.id)}">
          <div class="section-card-header">
            <span class="card-level-badge">${escapeHtml(section.level)}</span>
            ${section.archived ? `<span class="card-archived-badge">${icon("archive")} Archived</span>` : ""}
          </div>
          <strong>${escapeHtml(section.subject)}</strong>
          ${section.section ? `<span class="section-card-section">${escapeHtml(section.section)}</span>` : ""}
          <div class="section-card-weights">
            <span class="weight-pill">WW: ${section.weights[0]}%</span>
            <span class="weight-pill">PT: ${section.weights[1]}%</span>
            <span class="weight-pill">EX: ${section.weights[2]}%</span>
          </div>
          <small class="section-card-link">Open grade sheet ${icon("arrow")}</small>
        </button>
      </div>`).join("") : `<div class="empty-state chooser-empty"><span class="empty-icon">${icon(archiveFilter === "archived" ? "archive" : "classes")}</span><h3>No ${archiveFilter === "archived" ? "archived" : "active"} ${activeGroup} classes</h3><p>${archiveFilter === "archived" ? "Archived classes will remain available here for future reference." : "Add a class to create its roster and grading periods."}</p>${archiveFilter === "active" ? button(`${icon("plus")}<span>Add a class</span>`, "open-add-class", "button button-primary") : ""}</div>`;
      
    return `<section class="record-chooser">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Class Record</p>
          <h2>Select a level and section</h2>
          <p class="muted">Choose a school level first, then open the specific section. Grade sheets stay hidden until a section is selected.</p>
        </div>
        ${button(`${icon("plus")}<span>Add class</span>`, "open-add-class", "button button-primary")}
      </div>
      <div class="level-grid" aria-label="School levels">${groupCards}</div>
      
      <div class="archive-toggle-bar">
        <div class="archive-pills">
          <button type="button" class="archive-pill" data-action="set-archive-filter" data-filter="active" aria-pressed="${archiveFilter === "active"}">Active Classes (${activeCount})</button>
          <button type="button" class="archive-pill" data-action="set-archive-filter" data-filter="archived" aria-pressed="${archiveFilter === "archived"}">${icon("archive")} Archived Classes (${archivedCount})</button>
        </div>
        ${archiveFilter === "archived" ? `<span style="font-size:0.8rem;color:var(--muted);">Showing archived records. Stored safely for future reference.</span>` : ""}
      </div>

      <div class="chooser-divider"><span>${activeGroup === "JHS" ? "Junior High School sections" : "Senior High School sections"} (${archiveFilter === "archived" ? "Archived" : "Active"})</span></div>
      <div class="section-card-grid" aria-label="${activeGroup} sections">${sectionCards}</div>
    </section>`;
  }

  function renderSectionRecord() {
    const section = currentSection();
    const periods = activeSections()[section.id].periods;
    if (activePeriodIndex >= periods.length) activePeriodIndex = 0;
    const period = currentPeriod();
    const { totalLearners } = computeLearnerNumbering(period.roster);
    
    const sectionColorHex = themeColorHex(section.accent || section.theme);
    const sectionLocked = sectionHasLockedPeriod(section);
    const inputIntegrity = getPeriodInputIntegrity(period);
    const integrityNote = hasPeriodInputIssues(inputIntegrity)
      ? `<p class="integrity-note" role="status"><strong>Review needed before locking:</strong> ${escapeHtml(periodInputIssueMessage(inputIntegrity))}. Correct these values to keep the record valid.</p>`
      : "";

    const shade = sectionNameShade(section.accent || section.theme);
    const sectionColorInk = themeColorInk(section.accent || section.theme);
    return `<div class="record-section" style="--class-color:${sectionColorHex};--class-on:${sectionColorInk};--class-surface:${shade.background};--class-ink:${shade.color}">
      <section class="class-header-card" style="--class-color:${sectionColorHex};--class-on:${sectionColorInk};--class-surface:${shade.background};--class-ink:${shade.color}">
        ${section.archived ? `<div class="archive-banner"><span>Archived class</span>${button("Restore class", "unarchive-section", "button", `data-section="${safeValue(section.id)}"`)}</div>` : ""}
        <div class="class-identity">
          <div class="class-subject-line"><details class="subject-picker"><summary aria-label="Change subject"><span>${escapeHtml(section.subject)}</span>${icon("chevron")}</summary>
            <div class="subject-menu" aria-label="Subject choices">
              ${SUBJECT_PRESETS.map(p => `<button type="button" data-action="choose-sheet-subject" data-subject="${escapeHtml(p.name)}" ${sectionLocked ? "disabled" : ""}><span>${escapeHtml(p.name)}</span><span class="weight-preview" role="tooltip">WW ${p.weights[0]}% · PT ${p.weights[1]}% · QA ${p.weights[2]}%</span></button>`).join("")}
              <button type="button" data-action="choose-sheet-subject" data-subject="custom" ${sectionLocked ? "disabled" : ""}>Other / Custom<span class="weight-preview">Review subject settings</span></button>
              ${sectionLocked ? '<p>Unlock all periods to change grading weights.</p>' : ""}
            </div>
          </details><div class="class-weights" tabindex="0" aria-label="${escapeHtml(section.subject)} grading weights: Written Works ${section.weights[0]}%, Performance Tasks ${section.weights[1]}%, ${state.calendarMode === "trimester" ? "Term" : "Quarterly"} Assessment ${section.weights[2]}%"><span aria-hidden="true">${icon("info")}</span><div class="class-weights-popover" role="tooltip"><strong>${escapeHtml(section.subject)} grading weights</strong><span>Written Works ${section.weights[0]}%</span><span>Performance Tasks ${section.weights[1]}%</span><span>${state.calendarMode === "trimester" ? "Term" : "Quarterly"} Assessment ${section.weights[2]}%</span></div></div></div>
          <p class="class-level">${escapeHtml(section.level)}</p>
          <h2 class="class-name" title="${escapeHtml(section.section || section.level)}">${escapeHtml(section.section || section.level)}</h2>
          <div class="class-context-line"><span id="liveLearnerCount">${totalLearners} learner${totalLearners === 1 ? "" : "s"}</span><span>${escapeHtml(section.subject)}</span></div>
        </div>
        <div class="class-period-area">
          <div class="period-tabs" role="group" aria-label="Grading periods">${periods.map((entry,index) => `<button type="button" class="tab" data-action="select-period" data-period="${index}" aria-pressed="${activePeriodIndex === index}">${entry.locked ? icon("lock") : ""}<span>${escapeHtml(window.CSTRRecordTools.periodLabel(entry, section.group, index, state.calendarMode))}</span><span class="period-completion-dot" data-period-dot="${index}" aria-label="${recordCompletion(entry).complete ? "Complete" : "In progress"}">${recordCompletion(entry).complete ? "✓" : "·"}</span></button>`).join("")}</div>
          <details class="period-settings"><summary>${icon("settings")}<span>Period options</span>${icon("chevron")}</summary><div class="period-toolbar">
            <label class="period-name-field" for="periodName"><span>Period name</span><input id="periodName" class="period-name" value="${safeValue(period.name)}" data-period-name ${period.locked ? "disabled" : ""}></label>
            <div id="periodCompletion" class="period-completion" role="status">${renderCompletionLabel(period, section, activePeriodIndex)}</div>
            <div class="period-actions">
              ${button(`${icon("plus")} Add period`, "add-period", "button button-secondary", state.calendarMode === "trimester" && periods.length >= trimesterTermNames(section).length ? 'disabled title="Three terms is the maximum"' : "")}
              ${button(`${icon(period.locked ? "unlock" : "lock")} ${period.locked ? "Unlock" : "Lock"} period`, "toggle-lock-period", "button button-secondary")}
              ${button(`${icon("trash")} Delete period`, "delete-period", "button button-danger", period.locked ? "disabled" : "")}
              ${button(`${icon("download")} Excel`, "export-excel", "button button-secondary", 'aria-label="Download print-ready Excel sheet" title="Download print-ready Excel sheet"')}
              ${button(`${icon("download")} Export to Official E-Gradesheet`, "export-official", "button button-primary", 'aria-label="Export this class as the official e-gradesheet in PDF or Word" title="Export this class as the official e-gradesheet in PDF or Word"')}
            </div>
          </div></details>
        </div>
      </section>
      ${period.locked ? '<p class="locked-period-note">This period is locked. Unlock it to edit its scores and activities.</p>' : ""}
      <div id="periodIntegrity">${integrityNote}</div>
      <div class="sheet-utilities">
        ${button(`${icon("back")}<span>Sections</span>`, "go-records", "button button-ghost")}
        <details class="roster-options"><summary>Manage rows ${icon("chevron")}</summary><div class="bulk-column-tools roster-slots-tools"><label for="rosterSlotCount">Add learner rows (this period only)</label><input id="rosterSlotCount" type="number" min="1" max="100" value="10" data-column-count="roster" ${period.locked ? "disabled" : ""}>${button("Add rows","add-roster-slots","button button-secondary",period.locked ? "disabled" : "")}</div></details>
        <details class="column-options"><summary>Manage columns ${icon("chevron")}</summary><div class="bulk-column-tools" aria-label="Bulk column controls">${renderBulkColumnControl("ww","WW",period.wwDates.length,period.locked)}${renderBulkColumnControl("pt","PT",period.ptDates.length,period.locked)}${renderBulkColumnControl("qa","QA",period.qaDates.length,period.locked)}</div></details>
        <span class="sheet-caption">Assessment entries</span>
        <details class="sheet-help"><summary aria-label="Grade sheet help and legend" title="Grade sheet help and legend">?</summary><div class="sheet-help-panel">
          <h3>Working in your grade sheet</h3>
          <p>Drag across cells to select a block. Copy with Ctrl+C, cut with Ctrl+X, clear with Delete, or paste a spreadsheet block with Ctrl+V.</p>
          <p>To fill a selection with one value, type in its first cell and press Enter or Tab.</p>
          <h3>Score legend</h3><dl><dt>Red outline</dt><dd>Score above HPS or invalid value. Correct before finalizing.</dd><dt>A — Absent · M — Missing</dt><dd>Counted as zero against HPS.</dd><dt>E — Excused · L — Late</dt><dd>Excluded from the grade calculation.</dd><dt>${state.calendarMode === "trimester" ? "Term assessment" : "Quarterly assessment"}</dt><dd>With three QA slots, ST1/ST2/Term Exam use 30%/30%/40%, normalized to included entries. Other slot counts use the existing uniform calculation.</dd></dl>
          <p>Complete means every named learner has an entry for every visible WW, PT and QA activity, and every HPS is valid. Remove unused columns. Locking a period is a separate action.</p>
          <p>Lowering HPS caps scores above it when you leave the field. Restoring the original HPS restores those original scores unless you explicitly edited them afterward.</p>
        </div></details>
      </div>
      ${renderEntryViewControls(period)}
      <p class="sheet-scroll-hint" id="sheetScrollHint" ${sheetEntryView === "one" ? "hidden" : ""}>Grade sheet: scroll sideways to reach all assessments. Select the sheet to use keyboard scrolling.</p>
      ${sheetEntryView === "one" ? renderEditableStudentReport(section, periods, period) : ""}
      ${renderRecordTable(section, period, sheetEntryView === "one")}
      ${renderActivityRegister(section, period)}

    </div>`;
  }

  function renderCompletionLabel(period, section, index) {
    const result = recordCompletion(period);
    const label = escapeHtml(window.CSTRRecordTools.periodLabel(period, section.group, index, state.calendarMode));
    return `<span class="${result.complete ? "is-complete" : "is-incomplete"}">${result.complete ? "Complete" : "In progress"} · ${label}</span><small>${result.filled} / ${result.expected} score entries</small>`;
  }

  function entryLearnerRows(period) {
    return period.roster.map((learner, index) => ({ learner, index }))
      .filter(({ learner }) => !getLearnerCategory(learner.name));
  }

  function selectedEntryRow(period) {
    const rows = entryLearnerRows(period);
    if (!rows.some(({ index }) => index === activeOneLearnerRowIndex)) activeOneLearnerRowIndex = rows[0]?.index ?? null;
    return activeOneLearnerRowIndex;
  }

  function renderEntryViewControls(period) {
    const rows = entryLearnerRows(period), selected = selectedEntryRow(period);
    return `<div class="entry-focus-controls" role="group" aria-label="Grade sheet view">
      <label>Entry view<select data-entry-view aria-label="Entry view"><option value="sheet" ${sheetEntryView === "sheet" ? "selected" : ""}>Full grade sheet</option><option value="one" ${sheetEntryView === "one" ? "selected" : ""}>One learner</option></select></label>
      ${sheetEntryView === "one" ? `<label>Learner<select data-entry-row aria-label="Learner to display">${rows.map(({ learner, index }) => `<option value="${index}" ${index === selected ? "selected" : ""}>${escapeHtml(learner.name.trim() || `Learner ${index + 1}`)}</option>`).join("")}</select></label><p>Activity titles, dates, HPS, and scores in the selected period are editable below. Competencies and topics remain in the activity register.</p>` : ""}
    </div>`;
  }

  function reportEntriesForLearner(periods, rowIndex) {
    const active = periods[activePeriodIndex], learner = active.roster[rowIndex];
    if (!learner) return [];
    const name = String(learner.name || "").trim(), key = searchNameKey(name);
    const occurrence = key ? active.roster.slice(0, rowIndex + 1).filter(item => !getLearnerCategory(item.name) && searchNameKey(item.name) === key).length - 1 : 0;
    return periods.flatMap((period, periodIndex) => {
      const found = periodIndex === activePeriodIndex ? learner : key ? period.roster.filter(item => !getLearnerCategory(item.name) && searchNameKey(item.name) === key)[occurrence] : null;
      return found ? [{ period, periodIndex, learner: found, result: learnerResult(found, period, currentSection().weights), complete: isLearnerAssessmentComplete(found, period) }] : [];
    });
  }

  function renderEditableStudentReport(section, periods, period) {
    const rowIndex = selectedEntryRow(period);
    if (rowIndex === null) return `<section class="editable-student-report empty-state"><h3>No learner rows</h3><p>Add a learner row to use this view.</p></section>`;
    const learner = period.roster[rowIndex], entries = reportEntriesForLearner(periods, rowIndex);
    const categories = [
      { key: "ww", label: "Written Works", weight: section.weights[0] },
      { key: "pt", label: "Performance Tasks", weight: section.weights[1] },
      { key: "qa", label: state.calendarMode === "trimester" ? "Term Assessment" : "Quarterly Assessment", weight: section.weights[2] }
    ];
    const pct = value => Number.isFinite(value) ? `${format(value, 1)}%` : "—";
    const chart = `<div class="report-chart" role="img" aria-label="Assessment percentages by component and grading period">${entries.map(({ period: entryPeriod, periodIndex, result }) => `<div class="report-chart-group"><div class="report-bars">${categories.map(cat => `<span class="report-bar report-${cat.key}" style="height:${Number.isFinite(result[cat.key].percentage) ? Math.max(0, Math.min(100, result[cat.key].percentage)) : 0}%" title="${escapeHtml(cat.label)}: ${pct(result[cat.key].percentage)}"></span>`).join("")}</div><span>${escapeHtml(shortenPeriodLabel(entryPeriod.name))}</span></div>`).join("")}</div>`;
    const means = categories.map(cat => {
      const values = entries.map(({ result }) => result[cat.key].percentage).filter(Number.isFinite);
      return `<div class="report-mean report-${cat.key}"><span>${escapeHtml(cat.label)}</span><strong>${pct(values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null)}</strong><small>${values.length} period${values.length === 1 ? "" : "s"}</small></div>`;
    }).join("");
    const rankedMeans = categories.map(cat => {
      const values = entries.map(({ result }) => result[cat.key].percentage).filter(Number.isFinite);
      return { label: cat.label, average: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null };
    }).filter(item => Number.isFinite(item.average)).sort((a, b) => b.average - a.average);
    const interpretation = rankedMeans.length > 1
      ? `Highest recorded component mean: ${rankedMeans[0].label} (${pct(rankedMeans[0].average)}); lowest: ${rankedMeans[rankedMeans.length - 1].label} (${pct(rankedMeans[rankedMeans.length - 1].average)}).`
      : rankedMeans.length ? `Only ${rankedMeans[0].label} has a recorded component percentage so far.` : "No component percentages are available yet.";
    const cards = entries.map(({ period: entryPeriod, periodIndex, result, complete }) => {
      const active = periodIndex === activePeriodIndex;
      const gradeLabel = state.calendarMode === "trimester" ? "Term grade" : "Initial grade";
      const components = categories.map(cat => `<div class="report-component report-${cat.key}"><strong>${escapeHtml(cat.label)}</strong><span>${pct(result[cat.key].percentage)} · ${Number.isFinite(result[cat.key].weighted) ? `${format(result[cat.key].weighted, 2)} weighted` : "— weighted"}</span><small>${scoreTotal(result[cat.key])} raw / HPS</small></div>`).join("");
      const inputs = active ? `<div class="report-edit-scores"><h4>Edit ${escapeHtml(entryPeriod.name)} activities and scores</h4><p>Enter a number or A, M, E, L for each score. An empty score remains missing. Changing HPS also updates the full sheet.</p><div class="report-score-groups">${categories.map(cat => `<fieldset class="report-score-group report-${cat.key}"><legend>${escapeHtml(cat.label)}</legend><div class="report-score-grid">${learner[cat.key].map((value, index) => {
        const hps = entryPeriod[cat.key + "Hps"][index];
        const info = entryPeriod.activityMeta[cat.key][index];
        const date = entryPeriod[cat.key + "Dates"][index];
        const slot = `${cat.key.toUpperCase()} ${index + 1}`;
        const invalid = hasRawAboveHps(value, hps) || (value !== "" && !isAttendanceCode(value) && (!Number.isFinite(Number(value)) || Number(value) < 0));
        const locked = entryPeriod.locked ? "disabled" : "";
        const hpsLabel = hps === "" || hps === null || hps === undefined ? "—" : String(hps);
        return `<div class="report-activity-row" data-report-kind="${cat.key}" data-report-index="${index}">
          <div class="report-activity-name"><strong>${slot}</strong><label>Activity title<textarea class="activity-register-input" rows="1" data-activity-kind="${cat.key}" data-activity-index="${index}" data-activity-field="title" aria-label="${slot} activity title" placeholder="Activity title" ${locked}>${safeValue(info.title)}</textarea></label></div>
          <label>Date<input type="text" maxlength="12" data-date="${cat.key}" data-index="${index}" value="${safeValue(date)}" aria-label="${slot} date" placeholder="Date" ${locked}></label>
          <label>HPS<input type="number" min="0" step="any" inputmode="decimal" data-hps="${cat.key}" data-index="${index}" value="${safeValue(hps)}" aria-label="${slot} highest possible score" ${locked}></label>
          <label>Score <small class="score-hps">/ ${escapeHtml(hpsLabel)}</small><input type="text" inputmode="text" autocomplete="off" maxlength="6" data-score="${cat.key}" data-row="${rowIndex}" data-index="${index}" value="${safeValue(value)}" aria-label="${slot} score for ${escapeHtml(learner.name.trim() || `Learner ${rowIndex + 1}`)}" aria-invalid="${invalid}" class="${invalid ? "invalid" : ""}" ${locked}></label>
        </div>`;
      }).join("")}</div></fieldset>`).join("")}</div></div>` : `<button type="button" class="button button-secondary report-switch-period" data-action="select-period" data-period="${periodIndex}">Open this period to edit</button>`;
      return `<article class="report-period-card ${active ? "is-current" : ""}"><div data-report-live="period-${periodIndex}"><div class="report-period-heading"><h3>${escapeHtml(entryPeriod.name)}</h3><span class="report-status ${complete ? "is-complete" : ""}">${complete ? "Complete requirements" : "Provisional · incomplete requirements"}</span></div><div class="report-grades"><div><small>${gradeLabel}</small><strong>${format(result.initial.rounded, 3)}</strong></div><div><small>${state.calendarMode === "trimester" ? "Transmutation" : "Final transmuted"}</small><strong>${state.calendarMode === "trimester" ? "Not used" : format(result.initial.transmuted, 0)}</strong></div><div><small>Qualitative descriptor</small><strong>${renderDescriptorBadge(result.initial.descriptor)}</strong></div></div><div class="report-components">${components}</div></div>${inputs}</article>`;
    }).join("");
    return `<section class="editable-student-report" aria-label="Editable individual grade report"><div class="report-heading"><p>Individual grade report</p><label>Learner name<input data-name-row="${rowIndex}" value="${safeValue(learner.name)}" aria-label="Learner ${rowIndex + 1} name" ${period.locked ? "disabled" : ""}></label><span>${escapeHtml(section.level)} · ${escapeHtml(section.subject)}${section.section ? ` · ${escapeHtml(section.section)}` : ""}</span></div><div data-report-live="overview"><h3>Assessment performance</h3><p>Percentage scored by component and grading period</p><div class="report-legend">${categories.map(cat => `<span class="report-${cat.key}">${escapeHtml(cat.label)} (${cat.weight}%)</span>`).join("")}</div>${chart}<h3>Component means across recorded periods</h3><div class="report-means">${means}</div><p class="report-interpretation">${escapeHtml(interpretation)}</p></div><div class="report-periods">${cards}</div><p class="report-footnote">Component means are unweighted averages of available period percentages; they are not final grades. A/M count as zero. E/L are excluded. Grades are provisional when requirements are incomplete.</p></section>`;
  }

  function refreshEditableStudentReport() {
    const report = document.querySelector(".editable-student-report");
    if (!report || !currentPeriod()) return;
    const template = document.createElement("template");
    template.innerHTML = renderEditableStudentReport(currentSection(), activeSections()[currentSection().id].periods, currentPeriod());
    template.content.querySelectorAll("[data-report-live]").forEach(fresh => {
      const old = report.querySelector(`[data-report-live="${fresh.dataset.reportLive}"]`);
      if (old) old.innerHTML = fresh.innerHTML;
    });
    template.content.querySelectorAll('.report-activity-row').forEach(fresh => {
      const input = fresh.querySelector('input[data-score]');
      const current = input && report.querySelector(`.report-score-group input[data-score="${input.dataset.score}"][data-index="${input.dataset.index}"]`);
      if (current) {
        current.closest('.report-activity-row').querySelector('.score-hps').textContent = fresh.querySelector('.score-hps').textContent;
        current.classList.toggle('invalid', input.classList.contains('invalid'));
        current.setAttribute('aria-invalid', input.getAttribute('aria-invalid'));
      }
    });
  }

  function updateCompletionIndicators() {
    if (currentView !== "record" || !currentPeriod()) return;
    const section = currentSection(), period = currentPeriod();
    const node = document.querySelector("#periodCompletion");
    if (node) node.innerHTML = renderCompletionLabel(period, section, activePeriodIndex);
    const complete = recordCompletion(period).complete;
    const previous = completionSeen.get(period);
    completionSeen.set(period, complete);
    if (previous === false && complete) showSaveToast(`All required entries complete: ${window.CSTRRecordTools.periodLabel(period, section.group, activePeriodIndex, state.calendarMode)}`);
    document.querySelectorAll("[data-period-dot]").forEach(dot => {
      const value = recordCompletion(activeSections()[section.id].periods[Number(dot.dataset.periodDot)]).complete;
      dot.textContent = value ? "✓" : "·";
      dot.setAttribute("aria-label", value ? "Complete" : "In progress");
    });
    const issues = getPeriodInputIntegrity(period), integrity = document.querySelector("#periodIntegrity");
    if (integrity) integrity.innerHTML = hasPeriodInputIssues(issues) ? `<p class="integrity-note">Review needed: ${escapeHtml(periodInputIssueMessage(issues))}.</p>` : "";
  }

  function renderBulkColumnControl(kind, label, count, locked) {
    return `<div class="bulk-column-control"><strong>${label}</strong><label class="sr-only" for="${kind}ColumnCount">Number of ${label} columns</label><input id="${kind}ColumnCount" type="number" min="1" max="50" value="1" data-column-count="${kind}" aria-label="Number of ${label} columns" ${locked ? "disabled" : ""}><button type="button" class="col-btn col-btn-wide" data-action="bulk-add-col" data-kind="${kind}" title="Add columns" ${locked ? "disabled" : ""}>Add</button><button type="button" class="col-btn col-btn-wide" data-action="bulk-remove-col" data-kind="${kind}" title="Remove last columns" ${locked ? "disabled" : ""}>Remove</button><small>${count} active</small></div>`;
  }

  function renderRecordTable(section, period, concealed = false) {
    const dateHeaders = (kind, values, labels = []) => values.map((value, index) => {
      const label = labels[index] ? `<span>${labels[index]}</span>` : "";
      const borderClass = (index === 0 && kind === "pt") ? "border-start-pt" : (index === 0 && kind === "qa") ? "border-start-qa" : "";
      return `<th scope="col" class="activity-date-cell ${borderClass}">${label}<input class="activity-date" type="text" maxlength="12" placeholder="Date" data-date="${kind}" data-index="${index}" value="${safeValue(value)}" aria-label="${kind.toUpperCase()} activity ${index + 1} date" ${period.locked ? "disabled" : ""}></th>`;
    }).join("");
    const hpsInputs = (kind, values) => values.map((value, index) => {
      const borderClass = (index === 0 && kind === "pt") ? "border-start-pt" : (index === 0 && kind === "qa") ? "border-start-qa" : "";
      return `<td class="${borderClass}"><input type="number" min="0" step="any" inputmode="decimal" data-hps="${kind}" data-index="${index}" value="${safeValue(value)}" aria-label="${kind.toUpperCase()} ${index + 1} highest possible score" ${period.locked ? "disabled" : ""}></td>`;
    }).join("");
    const { numbering } = computeLearnerNumbering(period.roster);
    
    const wwLen = period.wwDates.length;
    const ptLen = period.ptDates.length;
    const qaLen = period.qaDates.length;
    const qaLabels = qaLen === 3 ? ["ST 1 (30%)", "ST 2 (30%)", "Term Exam (40%)"] : [];

    const sectionLocked = sectionHasLockedPeriod(section);
    const rows = period.roster.map((learner, rowIndex) => renderLearnerRow(learner, rowIndex, period, section, numbering[rowIndex], period.locked)).join("");
    
    return `<div class="table-wrap" role="region" aria-label="Scrollable grade sheet" aria-describedby="sheetScrollHint" tabindex="${concealed ? "-1" : "0"}" ${concealed ? "hidden" : ""}><table class="record-table compact-record"><caption class="sr-only">Scores, highest possible scores, and calculated grades for ${escapeHtml(section.subject)}. Attendance codes and editing guidance are in Grade sheet help.</caption><thead>
      <tr class="component-row">
        <th class="number-cell" scope="col" rowspan="3">#</th>
        <th class="name-cell" scope="col" rowspan="3">Learner name</th>
        <th class="component-header component-ww" scope="colgroup" colspan="${wwLen + 3}">
          Written Works (${section.weights[0]}%)
          <button type="button" class="col-btn" data-action="add-col" data-kind="ww" title="Add Written Work column" aria-label="Add Written Work column" ${period.locked ? "disabled" : ""}>+</button>
          <button type="button" class="col-btn" data-action="remove-col" data-kind="ww" title="Remove Written Work column" aria-label="Remove Written Work column" ${period.locked ? "disabled" : ""}>-</button>
        </th>
        <th class="component-header component-pt border-start-pt" scope="colgroup" colspan="${ptLen + 3}">
          Performance Tasks (${section.weights[1]}%)
          <button type="button" class="col-btn" data-action="add-col" data-kind="pt" title="Add Performance Task column" aria-label="Add Performance Task column" ${period.locked ? "disabled" : ""}>+</button>
          <button type="button" class="col-btn" data-action="remove-col" data-kind="pt" title="Remove Performance Task column" aria-label="Remove Performance Task column" ${period.locked ? "disabled" : ""}>-</button>
        </th>
        <th class="component-header component-qa border-start-qa" scope="colgroup" colspan="${qaLen + 3}">
          ${state.calendarMode === "trimester" ? "Term Assessment" : "Quarterly Assessment"} (${section.weights[2]}%)
          <button type="button" class="col-btn" data-action="add-col" data-kind="qa" title="Add assessment column" aria-label="Add assessment column" ${period.locked ? "disabled" : ""}>+</button>
          <button type="button" class="col-btn" data-action="remove-col" data-kind="qa" title="Remove assessment column" aria-label="Remove assessment column" ${period.locked ? "disabled" : ""}>-</button>
        </th>
        <th class="initial-header" scope="col" rowspan="3">${state.calendarMode === "trimester" ? "Term<br>Grade" : "Initial<br>Grade"}</th>
        ${state.calendarMode === "trimester" ? "" : '<th class="transmuted-header" scope="col" rowspan="3">Final Transmuted<br>Grade</th>'}
        <th class="descriptor-header" scope="col" rowspan="3">Qualitative<br>Descriptor</th>
      </tr>
      <tr class="activity-row">
        ${dateHeaders("ww", period.wwDates)}<th class="component-summary component-ww" scope="col">Total WW</th><th class="component-summary component-ww" scope="col">PS</th><th class="component-summary component-ww" scope="col">WS<br>(${section.weights[0]}%)</th>
        ${dateHeaders("pt", period.ptDates)}<th class="component-summary component-pt" scope="col">Total PT</th><th class="component-summary component-pt" scope="col">PS</th><th class="component-summary component-pt" scope="col">WS<br>(${section.weights[1]}%)</th>
        ${dateHeaders("qa", period.qaDates, qaLabels)}<th class="component-summary component-qa" scope="col">Total QA</th><th class="component-summary component-qa" scope="col">PS</th><th class="component-summary component-qa" scope="col">WS<br>(${section.weights[2]}%)</th>
      </tr>
      <tr class="hps-row">
        <th colspan="${wwLen}" scope="row">Highest Possible Scores (HPS)</th><th class="component-summary component-ww">Raw / HPS</th><th class="component-summary component-ww">Percentage</th><th class="component-summary component-ww">Weighted</th>
        <th colspan="${ptLen}" scope="row" class="border-start-pt">Highest Possible Scores (HPS)</th><th class="component-summary component-pt">Raw / HPS</th><th class="component-summary component-pt">Percentage</th><th class="component-summary component-pt">Weighted</th>
        <th colspan="${qaLen}" scope="row" class="border-start-qa">Highest Possible Scores (HPS)</th><th class="component-summary component-qa">Raw / HPS</th><th class="component-summary component-qa">Percentage</th><th class="component-summary component-qa">Weighted</th>
      </tr>
      <tr class="hps-input-row">
        <th class="number-cell" aria-hidden="true"></th><th class="name-cell" scope="row">Enter HPS</th>
        ${hpsInputs("ww", period.wwHps)}<td colspan="3">&nbsp;</td>
        ${hpsInputs("pt", period.ptHps)}<td colspan="3">&nbsp;</td>
        ${hpsInputs("qa", period.qaHps)}<td colspan="3">&nbsp;</td><td colspan="${state.calendarMode === "trimester" ? 2 : 3}">&nbsp;</td>
      </tr>
      </thead><tbody>${rows}</tbody></table></div>`;
  }

  function renderActivityRegister(section, period) {
    const kinds = [
      ["ww", "Written Works"],
      ["pt", "Performance Tasks"],
      ["qa", state.calendarMode === "trimester" ? "Term Assessment" : "Quarterly Assessment"]
    ];
    const rows = kinds.flatMap(([kind, label]) => period[`${kind}Hps`].map((hps, index) => {
      const info = period.activityMeta[kind][index];
      const number = `${kind.toUpperCase()} ${index + 1}`;
      const disabled = period.locked ? "disabled" : "";
      return `<tr><th scope="row"><span class="activity-kind">${escapeHtml(label)}</span><strong>${number}</strong></th>
        <td><textarea class="activity-register-input" rows="1" data-activity-kind="${kind}" data-activity-index="${index}" data-activity-field="title" placeholder="Activity title" aria-label="${number} title" ${disabled}>${safeValue(info.title)}</textarea></td>
        <td><textarea class="activity-register-input" rows="1" data-activity-kind="${kind}" data-activity-index="${index}" data-activity-field="competency" placeholder="Learning competency" aria-label="${number} competency" ${disabled}>${safeValue(info.competency)}</textarea></td>
        <td><textarea class="activity-register-input" rows="1" data-activity-kind="${kind}" data-activity-index="${index}" data-activity-field="topic" placeholder="Topic" aria-label="${number} topic" ${disabled}>${safeValue(info.topic)}</textarea></td>
        <td><input data-date="${kind}" data-index="${index}" maxlength="12" value="${safeValue(period[`${kind}Dates`][index])}" placeholder="Date" aria-label="${number} date" ${disabled}></td>
        <td><input type="number" min="0" step="any" inputmode="decimal" data-hps="${kind}" data-index="${index}" value="${safeValue(hps)}" aria-label="${number} highest possible score" ${disabled}></td></tr>`;
    })).join("");
    return `<section class="activity-register" aria-labelledby="activityRegisterTitle"><div class="activity-register-heading"><div><p class="eyebrow">Assessment transparency</p><h3 id="activityRegisterTitle">${state.calendarMode === "trimester" ? "Term" : "Quarter"} activity register</h3></div><p>One row per score column. Dates and HPS are shared with the grade sheet above.</p></div><div class="activity-register-scroll"><table><caption class="sr-only">Activity title, competency, topic, date, and HPS for ${escapeHtml(section.subject)} ${escapeHtml(period.name)}</caption><thead><tr><th scope="col">Score column</th><th scope="col">Activity title</th><th scope="col">Learning competency</th><th scope="col">Topic</th><th scope="col">Date</th><th scope="col">HPS</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
  }

  function renderLearnerRow(learner, rowIndex, period, section, numDisplay, periodLocked) {
    const cat = getLearnerCategory(learner.name);
    const catClass = cat ? `row-category row-category-${cat}` : "";
    const cellsDisabled = cat || period.locked;
    const learnerLabel = escapeHtml(String(learner.name || "").trim() || `Learner ${rowIndex + 1}`);

    const scoreInputs = (kind, values, hpsValues) => values.map((value, index) => {
      const tdBorderClass = (index === 0 && kind === "pt") ? "border-start-pt" : (index === 0 && kind === "qa") ? "border-start-qa" : "";
      const codeValue = typeof value === "string" ? value.trim().toUpperCase() : "";
      const rawNumber = Number(value);
      const invalidScore = !isAttendanceCode(value) && value !== "" && (!Number.isFinite(rawNumber) || rawNumber < 0);
      const aboveHps = hasRawAboveHps(value, hpsValues[index]);
      const inputClasses = [aboveHps || invalidScore ? "invalid" : "", isAttendanceCode(value) ? "code-cell" : "", codeValue === "M" ? "code-cell-missing" : ""].filter(Boolean).join(" ");
      const invalidMessage = invalidScore ? "Invalid score. Enter zero or a positive number, or an attendance code." : aboveHps ? "Score is above the highest possible score." : "";
      const kindLabel = kind === "ww" ? "Written Work" : kind === "pt" ? "Performance Task" : "Assessment";
      return `<td class="${tdBorderClass}"><input class="${inputClasses}" type="text" inputmode="text" maxlength="6" autocomplete="off" data-score="${kind}" data-row="${rowIndex}" data-index="${index}" value="${safeValue(cat ? "" : value)}" ${cellsDisabled ? 'disabled tabindex="-1"' : ''} title="${invalidMessage || "Enter a numeric score, or A (Absent, scored 0/HPS), E (Excused, excluded), L (Late, excluded), M (Missing, no excuse, scored 0/HPS)"}" aria-invalid="${invalidScore || aboveHps}" aria-label="${learnerLabel}, ${kindLabel} ${index + 1}${invalidMessage ? `, ${invalidMessage}` : ""}"></td>`;
    }).join("");
    const result = learnerResult(cat ? {
      ww: learner.ww.map(() => ""),
      pt: learner.pt.map(() => ""),
      qa: learner.qa.map(() => "")
    } : learner, period, section.weights);
    const deleteRowBtn = `<button type="button" class="row-delete-btn" data-action="delete-roster-row" data-row="${rowIndex}" title="${periodLocked ? "Unlock this grading period to delete rows" : "Remove this learner row from this grading period only"}" aria-label="Delete learner ${rowIndex + 1} row" ${periodLocked ? "disabled" : ""}>${icon("trash")}</button>`;
    return `<tr class="${catClass}" data-learner-row="${rowIndex}"><th class="number-cell" scope="row">${numDisplay !== undefined ? numDisplay : ""}</th><td class="name-cell"><div class="name-cell-inner"><input class="text-input" data-name-row="${rowIndex}" value="${safeValue(learner.name)}" aria-label="${learnerLabel} name" ${period.locked ? "disabled" : ""}>${deleteRowBtn}</div></td>${scoreInputs("ww", learner.ww, period.wwHps)}${summaryCells(result, "ww")}${scoreInputs("pt", learner.pt, period.ptHps)}${summaryCells(result, "pt")}${scoreInputs("qa", learner.qa, period.qaHps)}${summaryCells(result, "qa")}<td class="summary-cell initial-cell summary-initial">${format(result.initial.rounded, 3)}</td>${state.calendarMode === "trimester" ? "" : `<td class="summary-cell transmuted-cell summary-transmuted">${format(result.initial.transmuted, 0)}</td>`}<td class="summary-cell descriptor-cell summary-descriptor">${renderDescriptorBadge(result.initial.descriptor)}</td></tr>`;
  }

  function learnerResult(learner, period, weights) {
    const ww = calculateComponent(learner.ww, period.wwHps, weights[0]);
    const pt = calculateComponent(learner.pt, period.ptHps, weights[1]);
    const qa = calculateQuarterlyAssessment(learner.qa, period.qaHps, weights[2]);
    const transmute = state.calendarMode !== "trimester" || !TRIMESTER_USES_ZERO_BASED_GRADING;
    return { ww, pt, qa, initial: calculateInitialGrade(ww, pt, qa, { transmute }) };
  }

  function formatScore(value) {
    if (!Number.isFinite(value)) return "—";
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }

  function scoreTotal(component) {
    return component.used ? `${formatScore(component.rawTotal)} / ${formatScore(component.hpsTotal)}` : "—";
  }

  function summaryCells(result, kind) {
    const component = result[kind];
    return `<td class="summary-cell component-total summary-${kind}-total">${scoreTotal(component)}</td><td class="summary-cell summary-${kind}-ps">${format(component.percentage, 3)}</td><td class="summary-cell summary-${kind}-ws">${format(component.weighted, 3)}</td>`;
  }

  function nextPeriodName(section, count) {
    if (state.calendarMode === "trimester") return trimesterTermNames(section)[count] || `Term ${count + 1}`;
    const jhs = ["1st Grading", "2nd Grading", "3rd Grading", "4th Grading"];
    const shs = ["1st Quarter, 1st Semester", "2nd Quarter, 1st Semester", "1st Quarter, 2nd Semester", "2nd Quarter, 2nd Semester"];
    const choices = section.group === "JHS" ? jhs : shs;
    return choices[count] || `Additional Grading Period ${count + 1}`;
  }

  function addPeriod() {
    const section = currentSection();
    const periods = activeSections()[section.id].periods;
    if (state.calendarMode === "trimester" && periods.length >= trimesterTermNames(section).length) return;
    const period = initialPeriod(section, state.calendarMode);
    if (state.calendarMode === "trimester") {
      const usedTerms = new Set(periods.map((entry, index) => entry.term || index + 1));
      const term = trimesterTermNames(section).findIndex((_, index) => !usedTerms.has(index + 1)) + 1;
      period.term = term;
      period.name = nextPeriodName(section, term - 1);
      periods.push(period);
      periods.sort((left, right) => left.term - right.term);
      activePeriodIndex = periods.indexOf(period);
      markStateDirty();
      render();
      return;
    }
    const ordinal = Math.max(...periods.map((p, i) => section.group === "SHS"
      ? ((p.semester || Math.floor(i / 2) + 1) - 1) * 2 + (p.quarter || i % 2 + 1)
      : (p.quarter || i + 1)));
    period.name = nextPeriodName(section, ordinal);
    period.quarter = section.group === "SHS" ? ordinal % 2 + 1 : ordinal + 1;
    period.semester = section.group === "SHS" ? Math.floor(ordinal / 2) + 1 : 0;
    periods.push(period);
    activePeriodIndex = periods.length - 1;
    markStateDirty();
    render();
  }

  // Locking a quarter protects it from accidental edits or typos once its
  // grades are finalized: every input in that period (names, dates, HPS,
  // scores, columns) becomes read-only and it can't be deleted, until it's
  // unlocked again.
  function toggleLockPeriod() {
    const period = currentPeriod();
    if (!period) return;
    if (!period.locked) {
      const issues = getPeriodInputIntegrity(period);
      if (hasPeriodInputIssues(issues)) {
        const message = `Correct ${periodInputIssueMessage(issues)} before locking this grading period.`;
        setStatus(message, "error");
        showSaveToast(message, "error");
        return;
      }
    }
    period.locked = !period.locked;
    markStateDirty();
    render();
    setStatus(period.locked
      ? `Locked "${period.name}". It's now protected from edits and deletion until you unlock it.`
      : `Unlocked "${period.name}". It can be edited again.`);
  }

  // Opens a type-to-confirm modal instead of deleting right away — a
  // one-tap confirm was too easy to hit by accident given how much data
  // (every learner name/score under this quarter) a delete wipes out.
  function requestDeletePeriod() {
    const period = currentPeriod();
    if (!period) return;
    if (period.locked) {
      setStatus("This grading period is locked — unlock it first before deleting.", "error");
      return;
    }
    const periods = activeSections()[currentSection().id].periods;
    if (periods.length <= 1) {
      setStatus("Keep at least one grading period.", "error");
      return;
    }
    document.querySelector(".modal-backdrop")?.remove();
    const modal = document.createElement("div");
    modal.className = "modal-backdrop";
    modal.innerHTML = `<section class="modal delete-confirmation" role="dialog" aria-modal="true" aria-labelledby="deletePeriodTitle">
      <div class="section-heading"><div><p class="eyebrow">Grading period</p><h2 id="deletePeriodTitle">Delete this quarter?</h2></div>${button(icon("close"), "close-modal", "icon-button", 'aria-label="Close"')}</div>
      <p>This permanently removes <strong>${escapeHtml(period.name)}</strong>, including every learner name and score entered under it. A session checkpoint is kept; download a backup first for durable recovery.</p>
      <label class="delete-confirmation-label">Type <strong>DELETE</strong> to confirm
        <input id="deletePeriodConfirmation" autocomplete="off" spellcheck="false" aria-label="Type DELETE to confirm quarter deletion">
      </label>
      <div class="stack-actions delete-confirmation-actions">${button("Cancel", "close-modal", "button button-secondary")} ${button("Delete Quarter", "confirm-delete-period", "button button-danger")}</div>
    </section>`;
    document.body.append(modal);
    modal.querySelector("#deletePeriodConfirmation")?.focus();
  }

  function deletePeriod() {
    const section = currentSection();
    const periods = activeSections()[section.id].periods;
    const period = currentPeriod();
    if (!period) return;
    if (period.locked) {
      setStatus("This grading period is locked — unlock it first before deleting.", "error");
      return;
    }
    if (periods.length <= 1) {
      setStatus("Keep at least one grading period.", "error");
      return;
    }
    const confirmation = document.querySelector("#deletePeriodConfirmation")?.value.trim().toUpperCase();
    if (confirmation !== "DELETE") {
      showSaveToast("Type DELETE to confirm this deletion.", "error");
      return;
    }

    const deletedName = period.name;
    periods.splice(activePeriodIndex, 1);
    activePeriodIndex = Math.max(0, Math.min(activePeriodIndex, periods.length - 1));
    document.querySelector(".modal-backdrop")?.remove();
    markStateDirty();
    render();
    setStatus(`Deleted grading period "${deletedName}".`);
    showSaveToast("Grading period deleted. Autosave is queued.", "info");
  }

  // Adds more empty name slots to the CURRENT grading period only. Every period
  // keeps its own roster, so a learner who joins or leaves partway through the
  // year never changes the lists of the other periods. New rows use this
  // period's own WW/PT/QA column counts, so the same scoring math (HPS,
  // weights, percentages) applies to them exactly like every other row.
  function addRosterSlots(amount) {
    if (!Number.isInteger(amount) || amount <= 0) return;
    const section = currentSection();
    const period = currentPeriod();
    if (!period) return;
    if (period.locked) {
      setStatus("This grading period is locked. Unlock it to add learner rows.", "error");
      return;
    }
    const wwLen = period.wwDates.length;
    const ptLen = period.ptDates.length;
    const qaLen = period.qaDates.length;
    for (let i = 0; i < amount; i += 1) {
      period.roster.push({ name: "", ww: Array(wwLen).fill(""), pt: Array(ptLen).fill(""), qa: Array(qaLen).fill("") });
    }
    // rosterSize is only the starting row count for brand-new periods; keep it at
    // the largest roster so a period added later has room for the whole class.
    section.rosterSize = Math.max(section.rosterSize || 0, period.roster.length);
    markStateDirty();
    render();
    setStatus(`Added ${amount} more name slot${amount === 1 ? "" : "s"} to ${period.name}. Other grading periods are unchanged.`);
  }

  // Removes one name slot from the CURRENT grading period only (e.g. a learner
  // who stopped attending in the 2nd grading is removed from the 2nd grading
  // list while her 1st grading row and grades stay untouched). Asks for
  // confirmation when the row holds a name or scores.
  function deleteRosterRow(rowIndex) {
    const period = currentPeriod();
    if (!period || !period.roster.length) return;
    if (rowIndex < 0 || rowIndex >= period.roster.length) return;
    if (period.roster.length <= 1) {
      setStatus("Keep at least one name slot in the roster.", "error");
      return;
    }
    if (period.locked) {
      setStatus("This grading period is locked. Unlock it to delete learner rows.", "error");
      return;
    }

    const learner = period.roster[rowIndex];
    const learnerName = (learner.name || "").trim();
    const rowHasData = learnerName || [...learner.ww, ...learner.pt, ...learner.qa].some((value) => String(value).trim() !== "");
    if (rowHasData) {
      const confirmMsg = learnerName
        ? `Remove "${learnerName}" from ${period.name}? Only this grading period is affected — the same learner in your other grading periods stays as it is. A session checkpoint is kept; download a backup first for durable recovery.`
        : `This row has scores entered in ${period.name}. Remove it from this grading period only? A session checkpoint is kept; download a backup first for durable recovery.`;
      if (!confirm(confirmMsg)) return;
    }

    period.roster.splice(rowIndex, 1);
    markStateDirty();
    render();
    setStatus(`Removed 1 name slot from ${period.name}. Other grading periods are unchanged.`);
  }

  function changeColumnCount(kind, amount) {
    if (!["ww", "pt", "qa"].includes(kind) || !Number.isInteger(amount) || amount === 0) return;
    const period = currentPeriod();
    if (period.locked) {
      setStatus("This grading period is locked — unlock it first to change columns.", "error");
      return;
    }
    const dates = period[`${kind}Dates`];
    const hps = period[`${kind}Hps`];
    if (amount > 0) {
      for (let index = 0; index < amount; index += 1) {
        dates.push("");
        hps.push("");
        period.activityMeta[kind].push({ title: "", competency: "", topic: "" });
        period.roster.forEach((learner) => learner[kind].push(""));
      }
      markStateDirty();
      render();
      setStatus(`Added ${amount} ${kind.toUpperCase()} column${amount === 1 ? "" : "s"}.`);
      return;
    }

    const removable = Math.min(Math.abs(amount), Math.max(0, dates.length - 1));
    if (!removable) {
      setStatus(`Keep at least one ${kind.toUpperCase()} column.`, "error");
      return;
    }
    dates.splice(-removable, removable);
    hps.splice(-removable, removable);
    period.activityMeta[kind].splice(-removable, removable);
    period.roster.forEach((learner) => {
      learner[kind].splice(-removable, removable);
      if (learner.hpsOriginals?.[kind]) Object.keys(learner.hpsOriginals[kind]).forEach(key => {
        if (Number(key) >= dates.length) delete learner.hpsOriginals[kind][key];
      });
    });
    markStateDirty();
    render();
    setStatus(`Removed the last ${removable} ${kind.toUpperCase()} column${removable === 1 ? "" : "s"}.`);
  }

  function excelColumn(index) {
    let value = index + 1;
    let label = "";
    while (value > 0) {
      const remainder = (value - 1) % 26;
      label = String.fromCharCode(65 + remainder) + label;
      value = Math.floor((value - 1) / 26);
    }
    return label;
  }

  function excelValue(value) {
    if (value === "" || value === null || value === undefined) return "";
    if (isAttendanceCode(value)) return String(value).trim().toUpperCase();
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : String(value);
  }

  function componentExcelFormulas(startCol, length, excelRow, hpsRow, weight, isWeightedQa) {
    const first = excelColumn(startCol);
    const last = excelColumn(startCol + length - 1);
    const scores = `${first}${excelRow}:${last}${excelRow}`;
    const hps = `${first}$${hpsRow}:${last}$${hpsRow}`;
    const counted = `(ISNUMBER(${scores})+(UPPER(${scores})="A")+(UPPER(${scores})="M"))`;
    const valid = `SUMPRODUCT(${counted},--ISNUMBER(${hps}),--(${hps}>0))`;
    const raw = `SUMPRODUCT(N(${scores}),--ISNUMBER(${hps}),--(${hps}>0))`;
    const possible = `SUMPRODUCT(${counted},--ISNUMBER(${hps}),--(${hps}>0),${hps})`;
    const total = `IFERROR(IF(${valid}=0,"",TEXT(${raw},"0.##")&" / "&TEXT(${possible},"0.##")),"")`;
    let percentage = `IFERROR(IF(${valid}=0,"",${raw}/${possible}*100),"")`;
    if (isWeightedQa && length === 3) {
      const intraWeights = `{0.3,0.3,0.4}`;
      const activeWeight = `SUMPRODUCT(${intraWeights},${counted},--ISNUMBER(${hps}),--(${hps}>0))`;
      percentage = `IFERROR(IF(${activeWeight}=0,"",SUMPRODUCT(${intraWeights},IFERROR(N(${scores})/${hps},0))/${activeWeight}*100),"")`;
    }
    return { total, percentage, weighted: `IFERROR(${percentage}*${weight}/100,"")` };
  }

  async function exportCurrentSheet() {
    try { await window.CSTRAssets.ensure("excel"); } catch (error) { setStatus(error.message, "error"); return; }
    if (!window.XLSX) {
      setStatus("The Excel exporter is still loading. Please try again in a moment.", "error");
      return;
    }
    const section = currentSection();
    const period = currentPeriod();
    const trimester = state.calendarMode === "trimester";
    const wwLen = period.wwDates.length;
    const ptLen = period.ptDates.length;
    const qaLen = period.qaDates.length;
    const wwStart = 2;
    const ptStart = wwStart + wwLen + 3;
    const qaStart = ptStart + ptLen + 3;
    const gradeCol = qaStart + qaLen + 3;
    const transmutedCol = trimester ? null : gradeCol + 1;
    const descriptorCol = trimester ? gradeCol + 1 : gradeCol + 2;
    const lastCol = descriptorCol;
    const headerRow = 5;
    const datesRow = 6;
    const hpsRow = 7;
    const firstLearnerRow = 8;
    const matrix = Array.from({ length: firstLearnerRow - 1 + period.roster.length }, () => Array(lastCol + 1).fill(""));
    matrix[0][0] = "COLEGIO DE STO. TOMÁS – RECOLETOS, INCORPORATED";
    matrix[1][0] = "CLASS RECORD — PRINT-READY EXPORT";
    matrix[2][0] = `${section.level} • ${section.subject}${section.section ? ` • ${section.section}` : ""}`;
    matrix[3][0] = `Grading period: ${period.name} | Weights: WW ${section.weights[0]}% - PT ${section.weights[1]}% - EX ${section.weights[2]}%`;
    matrix[3][Math.max(2, lastCol - 3)] = `Teacher: ${state.teacher.name || ""}`;
    matrix[headerRow - 1][0] = "#";
    matrix[headerRow - 1][1] = "Learner name";
    matrix[datesRow - 1][0] = "";
    matrix[datesRow - 1][1] = "Activity date";
    matrix[hpsRow - 1][0] = "";
    matrix[hpsRow - 1][1] = "Highest Possible Score (HPS)";
    const writeComponentHeader = (start, length, label, weight) => {
      matrix[headerRow - 1][start] = `${label} (${weight}%)`;
      matrix[datesRow - 1][start + length] = `Total ${label}`;
      matrix[datesRow - 1][start + length + 1] = "PS";
      matrix[datesRow - 1][start + length + 2] = `WS (${weight}%)`;
    };
    writeComponentHeader(wwStart, wwLen, "WW", section.weights[0]);
    writeComponentHeader(ptStart, ptLen, "PT", section.weights[1]);
    writeComponentHeader(qaStart, qaLen, "QA", section.weights[2]);
    matrix[headerRow - 1][gradeCol] = trimester ? "Term Grade" : "Initial Grade";
    if (!trimester) matrix[headerRow - 1][transmutedCol] = "Final Transmuted Grade";
    matrix[headerRow - 1][descriptorCol] = "Qualitative Descriptor";

    [[wwStart, period.wwDates, period.wwHps], [ptStart, period.ptDates, period.ptHps], [qaStart, period.qaDates, period.qaHps]].forEach(([start, dates, hps]) => {
      dates.forEach((value, index) => { matrix[datesRow - 1][start + index] = `${start === wwStart ? "WW" : start === ptStart ? "PT" : "QA"} ${index + 1}${value ? "\n" + value : ""}`; });
      hps.forEach((value, index) => { matrix[hpsRow - 1][start + index] = excelValue(value); });
    });
    const { numbering } = computeLearnerNumbering(period.roster);
    period.roster.forEach((learner, rowIndex) => {
      const row = firstLearnerRow - 1 + rowIndex;
      matrix[row][0] = numbering[rowIndex] === "—" ? "" : numbering[rowIndex];
      matrix[row][1] = learner.name || "";
      if (getLearnerCategory(learner.name)) return;
      [[wwStart, learner.ww], [ptStart, learner.pt], [qaStart, learner.qa]].forEach(([start, scores]) => scores.forEach((value, index) => { matrix[row][start + index] = excelValue(value); }));
    });
    const worksheet = XLSX.utils.aoa_to_sheet(matrix);
    const setFormula = (address, formula, value, type = "n") => { worksheet[address] = { t: type, f: formula, v: value }; };
    period.roster.forEach((learner, rowIndex) => {
      const excelRow = firstLearnerRow + rowIndex;
      if (getLearnerCategory(learner.name)) return;
      const result = learnerResult(learner, period, section.weights);
      const ww = componentExcelFormulas(wwStart, wwLen, excelRow, hpsRow, section.weights[0], false);
      const pt = componentExcelFormulas(ptStart, ptLen, excelRow, hpsRow, section.weights[1], false);
      const qa = componentExcelFormulas(qaStart, qaLen, excelRow, hpsRow, section.weights[2], true);
      [[wwStart + wwLen, ww, result.ww], [ptStart + ptLen, pt, result.pt], [qaStart + qaLen, qa, result.qa]].forEach(([start, formulas, component]) => {
        setFormula(`${excelColumn(start)}${excelRow}`, formulas.total, scoreTotal(component), "s");
        setFormula(`${excelColumn(start + 1)}${excelRow}`, formulas.percentage, Number.isFinite(component.percentage) ? component.percentage : "", Number.isFinite(component.percentage) ? "n" : "s");
        setFormula(`${excelColumn(start + 2)}${excelRow}`, formulas.weighted, Number.isFinite(component.weighted) ? component.weighted : "", Number.isFinite(component.weighted) ? "n" : "s");
      });
      const wsCells = [excelColumn(wwStart + wwLen + 2), excelColumn(ptStart + ptLen + 2), excelColumn(qaStart + qaLen + 2)].map((col) => `${col}${excelRow}`);
      setFormula(`${excelColumn(gradeCol)}${excelRow}`, `IF(COUNT(${wsCells.join(",")})<3,"",ROUND(SUM(${wsCells.join(",")}),3))`, Number.isFinite(result.initial.rounded) ? result.initial.rounded : "", Number.isFinite(result.initial.rounded) ? "n" : "s");
      [wwStart + wwLen + 1, wwStart + wwLen + 2, ptStart + ptLen + 1, ptStart + ptLen + 2, qaStart + qaLen + 1, qaStart + qaLen + 2, gradeCol].forEach((col) => {
        const cell = worksheet[`${excelColumn(col)}${excelRow}`];
        if (cell && cell.t === "n") cell.z = "0.000";
      });
      
      // Final grade and descriptor share the existing calculation result.
      if (Number.isFinite(result.initial.transmuted)) {
        if (!trimester) worksheet[`${excelColumn(transmutedCol)}${excelRow}`] = { t: "n", v: result.initial.transmuted };
        worksheet[`${excelColumn(descriptorCol)}${excelRow}`] = { t: "s", v: result.initial.descriptor };
      } else {
        if (!trimester) worksheet[`${excelColumn(transmutedCol)}${excelRow}`] = { t: "s", v: "" };
        worksheet[`${excelColumn(descriptorCol)}${excelRow}`] = { t: "s", v: "" };
      }
    });
    const border = { style: "thin", color: { rgb: "B7C2CC" } };
    const palette = { ww: "FFF0B3", pt: "D9EAF7", qa: "F7D3D0", gray: "EEF1F4", maroon: "6D1F32", gold: "D9A72E", goldLight: "FBF0CD", navy: "1E3853" };
    const baseStyle = { font: { name: "Arial", sz: 9, color: { rgb: "1E293B" } }, alignment: { vertical: "center", horizontal: "center", wrapText: true }, border: { top: border, bottom: border, left: border, right: border } };
    const fillFor = (col) => col >= wwStart && col < ptStart ? palette.ww : col >= ptStart && col < qaStart ? palette.pt : col >= qaStart && col < gradeCol ? palette.qa : col === gradeCol ? palette.goldLight : col === transmutedCol ? "FDEBD0" : "FFFFFF";
    
    for (let row = headerRow - 1; row < matrix.length; row += 1) {
      for (let col = 0; col <= lastCol; col += 1) {
        const address = `${excelColumn(col)}${row + 1}`;
        if (!worksheet[address]) worksheet[address] = { t: "s", v: "" };
        worksheet[address].s = { ...baseStyle, fill: { fgColor: { rgb: row === hpsRow - 1 ? palette.gray : fillFor(col) }, patternType: "solid" }, alignment: { ...baseStyle.alignment, horizontal: col === 1 || col === descriptorCol ? "left" : "center" } };
        if (row >= firstLearnerRow - 1 && col > 1 && col < gradeCol && (col === wwStart + wwLen || col === ptStart + ptLen || col === qaStart + qaLen)) worksheet[address].s.fill = { fgColor: { rgb: "F8FAFC" }, patternType: "solid" };
      }
    }
    for (let row = 0; row < 4; row += 1) {
      const address = `A${row + 1}`;
      worksheet[address].s = { font: { name: "Arial", sz: row === 0 ? 14 : 10, bold: true, color: { rgb: row < 2 ? "FFFFFF" : palette.navy } }, fill: { fgColor: { rgb: row < 2 ? palette.maroon : "FFFFFF" }, patternType: "solid" }, alignment: { vertical: "center", horizontal: "left" } };
    }
    worksheet[`${excelColumn(gradeCol)}${headerRow}`].s = { ...baseStyle, font: { ...baseStyle.font, bold: true }, fill: { fgColor: { rgb: palette.gold }, patternType: "solid" } };
    if (!trimester) worksheet[`${excelColumn(transmutedCol)}${headerRow}`].s = { ...baseStyle, font: { ...baseStyle.font, bold: true }, fill: { fgColor: { rgb: "F5B041" }, patternType: "solid" } };
    worksheet[`${excelColumn(descriptorCol)}${headerRow}`].s = { ...baseStyle, font: { ...baseStyle.font, bold: true }, fill: { fgColor: { rgb: "E2E8F0" }, patternType: "solid" } };

    worksheet["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: lastCol } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: lastCol } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: lastCol } },
      { s: { r: 3, c: 0 }, e: { r: 3, c: Math.max(1, lastCol - 4) } },
      { s: { r: 4, c: wwStart }, e: { r: 4, c: wwStart + wwLen + 2 } },
      { s: { r: 4, c: ptStart }, e: { r: 4, c: ptStart + ptLen + 2 } },
      { s: { r: 4, c: qaStart }, e: { r: 4, c: qaStart + qaLen + 2 } }
    ];
    worksheet["!cols"] = Array.from({ length: lastCol + 1 }, (_, col) => ({ wch: col === 0 ? 5 : col === 1 ? 28 : col === gradeCol ? 12 : col === transmutedCol ? 14 : col === descriptorCol ? 15 : 6 }));
    worksheet["!rows"] = Array.from({ length: matrix.length }, (_, row) => ({ hpt: row < 4 ? 20 : row < firstLearnerRow - 1 ? 28 : 19 }));
    worksheet["!pageSetup"] = { orientation: "landscape", paperSize: 5, fitToWidth: 1, fitToHeight: 1, horizontalCentered: true };
    worksheet["!margins"] = { left: 0.2, right: 0.2, top: 0.35, bottom: 0.35, header: 0.15, footer: 0.15 };
    worksheet["!printArea"] = `A1:${excelColumn(lastCol)}${matrix.length}`;
    worksheet["!sheetViews"] = [{ showGridLines: false }];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Class Record");
    workbook.Workbook = { CalcPr: { calcMode: "auto", fullCalcOnLoad: true, forceFullCalc: true } };
    const safeName = `${section.level}-${section.subject}-${section.section || "Section"}-${period.name}`.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
    period.roster.forEach((learner, index) => {
      const category = getLearnerCategory(learner.name);
      if (!category) return;
      const row = firstLearnerRow - 1 + index;
      worksheet["!merges"].push({ s: { r: row, c: 1 }, e: { r: row, c: lastCol } });
      for (let col = 0; col <= lastCol; col++) {
        worksheet[`${excelColumn(col)}${row + 1}`].s = {
          ...baseStyle, font: { ...baseStyle.font, bold: true, color: { rgb: category === "boys" ? "173F65" : "65325E" } },
          fill: { patternType: "solid", fgColor: { rgb: category === "boys" ? "D6E7F7" : "EEDCF0" } },
          alignment: { ...baseStyle.alignment, horizontal: "left" }
        };
      }
    });
    worksheet["!merges"].push({ s: { r: 3, c: Math.max(2, lastCol - 3) }, e: { r: 3, c: lastCol } });
    const activityRows = [
      ["ACTIVITY REGISTER"],
      [`${section.level} • ${section.section || ""} • ${section.subject} • ${period.name}`],
      ["Score column", "Activity title", "Learning competency", "Topic", "Date", "HPS"]
    ];
    ["ww", "pt", "qa"].forEach(kind => period[`${kind}Hps`].forEach((hps, index) => {
      const meta = period.activityMeta?.[kind]?.[index] || {};
      activityRows.push([`${kind.toUpperCase()} ${index + 1}`, meta.title || "", meta.competency || "", meta.topic || "", period[`${kind}Dates`][index] || "", excelValue(hps)]);
    }));
    const activities = XLSX.utils.aoa_to_sheet(activityRows);
    activities["!merges"] = [0, 1].map(r => ({ s: { r, c: 0 }, e: { r, c: 5 } }));
    activities["!cols"] = [13, 32, 48, 34, 14, 9].map(wch => ({ wch }));
    activities["!rows"] = activityRows.map((values, row) => ({ hpt: row < 3 ? 26 : Math.max(30, Math.max(...values.map((value, col) => Math.ceil(String(value).length / [13, 32, 48, 34, 14, 9][col]))) * 13 + 8) }));
    activityRows.forEach((values, row) => values.forEach((_, col) => {
      activities[XLSX.utils.encode_cell({ r: row, c: col })].s = {
        ...baseStyle, font: { ...baseStyle.font, sz: row === 0 ? 14 : 10, bold: row < 3, color: { rgb: row === 0 || row === 2 ? "FFFFFF" : "1E293B" } },
        alignment: { vertical: "center", horizontal: col === 5 ? "center" : "left", wrapText: true },
        fill: { patternType: "solid", fgColor: { rgb: row === 0 || row === 2 ? palette.maroon : row % 2 ? "F3F5F7" : "FFFFFF" } }
      };
    }));
    XLSX.utils.book_append_sheet(workbook, activities, "Activities");
    try {
      await window.CSTRExcelExport.download(workbook, `${safeName || "class-record"}.xlsx`);
      setStatus("Excel created: page 1 Class Record; page 2 Activities. Print Entire Workbook on Legal (8.5 × 14 in), landscape.");
    } catch (error) {
      console.error("Excel export failed", error);
      setStatus(`Excel export failed: ${error.message}`, "error");
    }
  }

  function currentSchoolYear() {
    const now = new Date();
    const calendarYear = now.getFullYear();
    const startYear = now.getMonth() >= 5 ? calendarYear : calendarYear - 1;
    return `${startYear}-${startYear + 1}`;
  }

  function renderOfficialExportModal() {
    const section = currentSection();
    const periodCount = state.calendarMode === "trimester" ? 3 : 4;
    if (!section) {
      setStatus("Open a class grade sheet before exporting the official e-gradesheet.", "error");
      return;
    }
    if (!window.CSTROfficialGradesheet) {
      setStatus("The official e-gradesheet exporter did not load. Refresh the page and try again.", "error");
      return;
    }
    document.querySelector(".modal-backdrop")?.remove();
    const modal = document.createElement("div");
    modal.className = "modal-backdrop official-export-backdrop";
    modal.innerHTML = `<section class="modal official-export-modal" role="dialog" aria-modal="true" aria-labelledby="officialExportTitle">
      <div class="section-heading">
        <div><p class="eyebrow">Official school format</p><h2 id="officialExportTitle">Export to Official E-Gradesheet</h2></div>
        ${button(icon("close"), "close-modal", "icon-button", 'aria-label="Close"')}
      </div>
      <p class="official-export-intro">This export uses the attached CST-R Form 1 layout and the live data from <strong>${escapeHtml(section.subject)}</strong>${section.section ? ` for <strong>${escapeHtml(section.section)}</strong>` : ""}. It includes the first ${periodCount === 4 ? "four grading periods" : "three terms"} and the computed final grade.</p>
      <div class="settings-grid official-export-grid">
        <label>School year
          <input id="officialSchoolYear" value="${safeValue(currentSchoolYear())}" inputmode="numeric" placeholder="2026-2027" aria-describedby="officialExportAccuracy">
        </label>
        <label>School principal
          <input id="officialPrincipalName" value="" placeholder="Principal's full name and credentials" aria-describedby="officialExportAccuracy">
        </label>
        <label>Subject teacher
          <input id="officialTeacherName" value="${safeValue(state.teacher.name || currentUserName() || "")}" placeholder="Teacher's full name" aria-describedby="officialExportAccuracy">
        </label>
      </div>
      <p id="officialExportAccuracy" class="official-export-accuracy">Check these official details before downloading. Blank or incomplete grades stay blank in the export; the exporter never invents missing scores.</p>
      <p id="officialExportMessage" class="official-export-message" role="status" aria-live="polite"></p>
      <div class="official-export-format-note"><strong>Output:</strong> Editable Word tables or searchable vector PDF; US Letter portrait, CST-R Form 1 headings, official 1-${periodCount} and F rows, principal and teacher signature area, and the selected class's current computed grades.</div>
      <div class="stack-actions official-export-actions">
        <button type="button" class="button button-secondary" data-action="export-official-word">Save Word (.docx)</button>
        <button type="button" class="button button-primary" data-action="export-official-pdf">Save PDF (.pdf)</button>
      </div>
    </section>`;
    document.body.append(modal);
    const readiness = officialExportReadiness(officialExportPayload());
    setOfficialExportMessage(readiness.message, readiness.type);
    modal.querySelector("#officialSchoolYear")?.focus();
  }

  function officialExportPayload() {
    const section = currentSection();
    const periodCount = state.calendarMode === "trimester" ? 3 : 4;
    const periods = (activeSections()[section.id] && activeSections()[section.id].periods) || [];

    // Each grading period has its own roster, so learners are matched by name,
    // not by row number. Someone who left after the 1st grading (or joined in
    // the 3rd) appears once, with blank grades for the periods they weren't in.
    // Repeated identical names inside one period stay separate learners.
    const listed = periods.map((period) => {
      const seen = new Map();
      const entries = [];
      (period.roster || []).forEach((learner) => {
        const name = String((learner && learner.name) || "").trim();
        if (!name || getLearnerCategory(name)) return;
        const base = normalizedName(name);
        const occurrence = seen.get(base) || 0;
        seen.set(base, occurrence + 1);
        entries.push({ key: `${base}#${occurrence}`, name, learner });
      });
      return entries;
    });
    // Ordered union: keep each period's own order; a learner missing from the
    // earlier lists slots in right after the learner who precedes them.
    const order = [];
    listed.forEach((entries) => {
      let insertAt = 0;
      entries.forEach((entry) => {
        const found = order.findIndex((item) => item.key === entry.key);
        if (found >= 0) { insertAt = found + 1; return; }
        order.splice(insertAt, 0, { key: entry.key, name: entry.name });
        insertAt += 1;
      });
    });

    const students = order.map(({ key, name }) => {
      const gradePeriods = Array.from({ length: periodCount }, (_, periodIndex) => {
        const period = periods[periodIndex];
        const entry = period && (listed[periodIndex] || []).find((item) => item.key === key);
        if (!entry) return {};
        const result = learnerResult(entry.learner, period, section.weights);
        return {
          ww: result.ww.weighted,
          pt: result.pt.weighted,
          qa: result.qa.weighted,
          initial: result.initial.rounded,
          periodical: result.initial.transmuted
        };
      });
      const periodicalGrades = gradePeriods.map((entry) => entry.periodical).filter(Number.isFinite);
      return {
        name,
        periods: gradePeriods,
        finalGrade: periodicalGrades.length === periodCount
          ? state.calendarMode === "trimester"
            ? Math.round(periodicalGrades.reduce((sum, value, index) => sum + value * TRIMESTER_FINAL_GRADE_WEIGHTS[index], 0) / TRIMESTER_FINAL_GRADE_WEIGHTS.reduce((sum, value) => sum + value, 0))
            : Math.round(periodicalGrades.reduce((sum, value) => sum + value, 0) / 4)
          : null
      };
    });

    return {
      schoolYear: document.querySelector("#officialSchoolYear")?.value.trim() || "",
      principalName: document.querySelector("#officialPrincipalName")?.value.trim() || "",
      teacherName: document.querySelector("#officialTeacherName")?.value.trim() || "",
      level: section.level,
      section: section.section,
      subject: section.subject,
      weights: section.weights,
      students,
      periodCount,
      calendarMode: state.calendarMode,
      sourcePeriodCount: Math.min(periods.length, periodCount)
    };
  }

  function officialExportReadiness(payload) {
    const learnerCount = payload.students.length;
    if (!learnerCount) {
      return {
        type: "info",
        message: "No named learners are currently in this class. Export is allowed and will create a blank official form."
      };
    }
    const expectedGrades = learnerCount * payload.periodCount;
    const completedGrades = payload.students.reduce((count, student) => count + student.periods.filter((period) => Number.isFinite(period.periodical)).length, 0);
    const finalGrades = payload.students.filter((student) => Number.isFinite(student.finalGrade)).length;
    if (completedGrades === expectedGrades && finalGrades === learnerCount) {
      return {
        type: "success",
        message: `Ready to export: all ${payload.periodCount === 4 ? "four period" : "three term"} grades and final grades are calculated for ${learnerCount} learner${learnerCount === 1 ? "" : "s"}.`
      };
    }
    const missingGrades = expectedGrades - completedGrades;
    return {
      type: "warning",
      message: `This class record is incomplete, but it is still exportable. ${missingGrades} of ${expectedGrades} period grade field${expectedGrades === 1 ? " is" : "s are"} not yet calculated. Missing component, initial, period, and final grades will remain blank; no grade will be invented.`
    };
  }

  function setOfficialExportMessage(message, type = "info") {
    const messageBox = document.querySelector("#officialExportMessage");
    if (!messageBox) return;
    messageBox.textContent = message;
    messageBox.className = `official-export-message ${type}`;
  }

  function officialSavePickerOptions(formatName, suggestedName) {
    const pdf = formatName === "pdf";
    return {
      suggestedName,
      types: [{
        description: pdf ? "PDF document" : "Microsoft Word document",
        accept: pdf
          ? { "application/pdf": [".pdf"] }
          : { "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"] }
      }]
    };
  }

  async function exportOfficialGradeSheet(formatName, trigger) {
    const payload = officialExportPayload();
    const schoolYearMatch = payload.schoolYear.match(/^(\d{4})-(\d{4})$/);
    if (!schoolYearMatch || Number(schoolYearMatch[2]) !== Number(schoolYearMatch[1]) + 1) {
      const message = "Enter the school year as YYYY-YYYY before exporting. No file was created.";
      setOfficialExportMessage(message, "error");
      showSaveToast(message, "error");
      document.querySelector("#officialSchoolYear")?.focus();
      return;
    }
    if (!payload.principalName || !payload.teacherName) {
      const message = "Enter both the principal and subject teacher names before exporting. No file was created.";
      setOfficialExportMessage(message, "error");
      showSaveToast(message, "error");
      return;
    }
    const formatLabel = formatName === "pdf" ? "PDF" : "Word";
    const extension = formatName === "pdf" ? "pdf" : "docx";
    const exporter = window.CSTROfficialGradesheet;
    const suggestedName = exporter.officialFilename(payload, extension);
    const originalLabel = trigger.textContent;
    const exportButtons = [...document.querySelectorAll('[data-action="export-official-pdf"], [data-action="export-official-word"]')];
    exportButtons.forEach((buttonElement) => { buttonElement.disabled = true; });
    let fileHandle = null;
    let writable = null;
    let writeStarted = false;
    const useSavePicker = typeof window.showSaveFilePicker === "function";
    try {
      if (useSavePicker) {
        trigger.textContent = "Choose save location...";
        setOfficialExportMessage(`Choose where to save the official ${formatLabel} file. Nothing has been saved yet.`, "working");
        fileHandle = await window.showSaveFilePicker(officialSavePickerOptions(formatName, suggestedName));
      }
      trigger.textContent = formatName === "pdf" ? "Preparing PDF..." : "Preparing Word file...";
      setOfficialExportMessage(`Preparing the official ${formatLabel} from the current class record. Please keep this page open.`, "working");
      await window.CSTRAssets.ensure(formatName === "pdf" ? "pdf" : "word");
      const artifact = formatName === "pdf"
        ? await exporter.createPdf(payload)
        : await exporter.createWord(payload);
      if (fileHandle) {
        trigger.textContent = `Saving ${formatLabel}...`;
        setOfficialExportMessage(`The ${formatLabel} is ready and is now being written to the selected location.`, "working");
        writable = await fileHandle.createWritable();
        writeStarted = true;
        await writable.write(artifact.blob);
        await writable.close();
        writable = null;
      } else {
        exporter.downloadBlob(artifact.blob, artifact.filename);
      }
      document.querySelector(".official-export-backdrop")?.remove();
      if (fileHandle) {
        setStatus(`Official e-gradesheet ${formatLabel} saved successfully as ${fileHandle.name || artifact.filename}.`);
        showSaveToast(`Official e-gradesheet ${formatLabel} saved successfully.`);
      } else {
        const message = `Official e-gradesheet ${formatLabel} was prepared and sent to the browser's Downloads. If no download appears, allow downloads for this page and try again.`;
        setStatus(message);
        showSaveToast(message, "info");
      }
    } catch (error) {
      if (writable && typeof writable.abort === "function") {
        try { await writable.abort(); } catch (_) {}
      }
      exportButtons.forEach((buttonElement) => { buttonElement.disabled = false; });
      trigger.textContent = originalLabel;
      if (error && error.name === "AbortError") {
        const message = "Export canceled. No file was saved.";
        setOfficialExportMessage(message, "info");
        showSaveToast(message, "info");
        return;
      }
      console.error("Official e-gradesheet export failed", error);
      const detail = error && error.message ? ` ${error.message}` : "";
      const message = writeStarted
        ? `The ${formatLabel} could not be saved completely.${detail} Check the selected location and try again.`
        : fileHandle
          ? `The official ${formatLabel} could not be created.${detail} Nothing was written to the selected file.`
          : `The official ${formatLabel} could not be created.${detail} No file was saved.`;
      setOfficialExportMessage(message, "error");
      setStatus(message, "error");
      showSaveToast(message, "error");
    }
  }

  function normalizedName(value) {
    return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
  }

  function searchNameKey(value) {
    const words = String(value || "").normalize("NFD").replace(/\p{M}/gu, "")
      .toLocaleLowerCase().replace(/[’']/g, "").match(/[\p{L}\p{N}]+/gu) || [];
    // A single letter in a full-name lookup is ordinarily an optional middle
    // initial. Keep every substantive name word exact, regardless of order.
    const substantive = words.filter(word => word.length > 1);
    return substantive.length >= 2 ? substantive.sort().join("|") : "";
  }

  function isPeriodFinalized(period, section) {
    const learners = period.roster.filter((learner) => learner.name.trim() && !getLearnerCategory(learner.name));
    return recordCompletion(period).complete;
  }

  function isLearnerAssessmentComplete(learner, period) {
    return ["ww", "pt", "qa"].every((kind) => learner[kind].every((score, index) => {
      const hpsValue = period[`${kind}Hps`][index];
      const hpsPresent = hpsValue !== "" && hpsValue !== null && hpsValue !== undefined;
      const hps = Number(hpsValue);
      if (!hpsPresent || !Number.isFinite(hps) || hps <= 0) return false;
      if (isZeroScoreCode(score)) return true;
      if (isExcludedCode(score)) return true;
      const raw = Number(score);
      const scorePresent = score !== "" && score !== null && score !== undefined && !isAttendanceCode(score);
      return scorePresent && Number.isFinite(raw) && raw >= 0 && raw <= hps;
    }));
  }

  function searchStudent() {
    const input = document.querySelector("#studentSearch");
    const query = searchNameKey(input && input.value);
    if (!query) { showSearchModal("Enter the student's complete name to check a grade."); return; }

    // Group matches by section (not by section+period) so a learner who has
    // several grading periods in the same class shares ONE performance chart built
    // from all of them, instead of one flat, disconnected card per period.
    const bySection = new Map();
    activeRegistry().forEach((section) => {
      activeSections()[section.id].periods.forEach((period) => {
        period.roster.forEach((learner) => {
          if (searchNameKey(learner.name) !== query || getLearnerCategory(learner.name)) return;
          const result = learnerResult(learner, period, section.weights);
          const complete = isLearnerAssessmentComplete(learner, period);
          if (!bySection.has(section.id)) bySection.set(section.id, { section, entries: [] });
          bySection.get(section.id).entries.push({ period, learner, result, complete });
        });
      });
    });

    if (!bySection.size) { showSearchModal("No student matching '" + String(input.value).trim() + "' was found. Please verify the name and try again."); return; }

    const blocks = [...bySection.values()].map(({ section, entries }, index) => {
      const learnerName = entries[0].learner.name;
      return `<div class="student-perf-block">
        <div class="student-report-actions"><p>Grade report for ${escapeHtml(learnerName)} · ${escapeHtml(section.subject)}</p><button type="button" class="button button-primary" data-action="export-student-png" data-report-id="${index}" data-report-name="${escapeHtml(learnerName)}" data-report-section="${escapeHtml(section.section || section.level)}">${icon("download")} Save as PNG image</button></div>
        ${renderStudentReportSvg(section, entries, index)}
      </div>`;
    }).join("");

    showSearchModal(blocks, true);
  }

  function reportLines(value, limit = 48) {
    const words = String(value || "").split(/\s+/).filter(Boolean);
    const lines = [];
    let current = "";
    words.forEach(word => {
      if (current && `${current} ${word}`.length > limit) { lines.push(current); current = word; }
      else current = current ? `${current} ${word}` : word;
    });
    if (current) lines.push(current);
    return lines.length ? lines : ["—"];
  }

  function renderStudentReportSvg(section, entries, reportId) {
    const width = 960;
    const learnerName = entries[0].learner.name;
    const nameLines = reportLines(learnerName, 38);
    const classLines = reportLines(`${section.level} · ${section.subject}${section.section ? ` · ${section.section}` : ""}${section.archived ? " · Archived" : ""}`, 76);
    const headerHeight = 110 + nameLines.length * 40 + classLines.length * 22;
    const chartTop = headerHeight + 32;
    const plotTop = chartTop + 76;
    const plotBottom = plotTop + 150;
    const statsTop = chartTop + 282;
    const cardsTop = statsTop + 138;
    const cardStep = 226;
    const footerTop = cardsTop + entries.length * cardStep + 5;
    const height = footerTop + 100;
    const ink = "#202833", muted = "#5d6874", line = "#dfe4e8", crimson = "#8f1d31";
    const categories = [
      { key: "ww", label: "Written Works", color: "#846b1d", weight: section.weights[0] },
      { key: "pt", label: "Performance Tasks", color: "#326f89", weight: section.weights[1] },
      { key: "qa", label: state.calendarMode === "trimester" ? "Term Assessment" : "Quarterly Assessment", color: "#a13d49", weight: section.weights[2] }
    ];
    const t = (x, y, value, size = 16, color = ink, weight = 400, extra = "") => `<text x="${x}" y="${y}" fill="${color}" font-family="Arial, sans-serif" font-size="${size}" font-weight="${weight}" ${extra}>${escapeHtml(value)}</text>`;
    const pct = value => Number.isFinite(value) ? `${format(value, 1)}%` : "—";
    const start = `<svg xmlns="http://www.w3.org/2000/svg" class="student-report-svg" data-report-id="${reportId}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Grade report for ${escapeHtml(learnerName)} in ${escapeHtml(section.subject)}"><rect width="${width}" height="${height}" fill="#fff"/><rect width="${width}" height="9" fill="${crimson}"/>`;
    const header = `${t(44, 44, "INDIVIDUAL GRADE REPORT", 13, crimson, 700, 'letter-spacing="2"')}
      ${nameLines.map((value, index) => t(44, 87 + index * 40, value, 35, ink, 700)).join("")}
      ${classLines.map((value, index) => t(44, 96 + nameLines.length * 40 + index * 22, value, 16, muted, 400)).join("")}
      <line x1="44" y1="${headerHeight}" x2="916" y2="${headerHeight}" stroke="${line}" stroke-width="2"/>`;
    const chartTitle = `${t(44, chartTop, "Assessment performance", 23, ink, 700)}${t(44, chartTop + 25, "Percentage scored by component and grading period", 14, muted)}`;
    const legends = categories.map((cat, index) => `<rect x="${44 + index * 280}" y="${chartTop + 41}" width="12" height="12" rx="2" fill="${cat.color}"/>${t(62 + index * 280, chartTop + 52, `${cat.label} (${cat.weight}%)`, 13, ink, 500)}`).join("");
    const chartLeft = 82, chartRight = 914, chartWidth = chartRight - chartLeft;
    const grids = [0, 25, 50, 75, 100].map(value => {
      const y = plotBottom - value * 1.5;
      return `<line x1="${chartLeft}" y1="${y}" x2="${chartRight}" y2="${y}" stroke="${line}"/>${t(44, y + 5, `${value}`, 11, muted)}`;
    }).join("");
    const groupWidth = chartWidth / entries.length;
    const barWidth = Math.min(30, Math.max(7, (groupWidth - 36) / 4));
    const bars = entries.map(({ period, result }, index) => {
      const center = chartLeft + groupWidth * (index + 0.5);
      const barSet = categories.map((cat, catIndex) => {
        const value = result[cat.key].percentage;
        if (!Number.isFinite(value)) return "";
        const barHeight = Math.max(0, Math.min(100, value)) * 1.5;
        const x = center + (catIndex - 1.5) * (barWidth + 5);
        return `<rect x="${x}" y="${plotBottom - barHeight}" width="${barWidth}" height="${barHeight}" rx="3" fill="${cat.color}"/>`;
      }).join("");
      return `${barSet}${t(center, plotBottom + 27, shortenPeriodLabel(period.name), 12, ink, 600, 'text-anchor="middle"')}`;
    }).join("");
    const stats = categories.map((cat, index) => {
      const values = entries.map(({ result }) => result[cat.key].percentage).filter(Number.isFinite);
      const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
      const x = 44 + index * 294;
      return { label: cat.label, average, count: values.length, html: `<rect x="${x}" y="${statsTop}" width="280" height="90" rx="12" fill="#f6f8fa" stroke="${line}"/><rect x="${x}" y="${statsTop}" width="5" height="90" rx="2" fill="${cat.color}"/>${t(x + 19, statsTop + 26, cat.label, 13, muted, 600)}${t(x + 19, statsTop + 66, pct(average), 29, ink, 700)}${t(x + 158, statsTop + 65, `${values.length} period${values.length === 1 ? "" : "s"}`, 12, muted)}` };
    });
    const ranked = stats.filter(item => Number.isFinite(item.average)).sort((a, b) => b.average - a.average);
    const interpretation = ranked.length > 1
      ? `Highest recorded component mean: ${ranked[0].label} (${pct(ranked[0].average)}); lowest: ${ranked[ranked.length - 1].label} (${pct(ranked[ranked.length - 1].average)}).`
      : ranked.length ? `Only ${ranked[0].label} has a recorded component percentage so far.` : "No component percentages are available yet.";
    const summary = `${t(44, statsTop - 16, "Component means across recorded periods", 17, ink, 700)}${stats.map(item => item.html).join("")}${t(44, statsTop + 113, interpretation, 13, muted)}`;
    const cards = entries.map(({ period, result, complete }, index) => {
      const y = cardsTop + index * cardStep;
      const status = complete ? "Complete requirements" : "Provisional · incomplete requirements";
      const finalLabel = state.calendarMode === "trimester" ? "Transmutation" : "Final transmuted";
      const finalValue = state.calendarMode === "trimester" ? "Not used" : format(result.initial.transmuted, 0);
      const components = categories.map((cat, catIndex) => {
        const component = result[cat.key];
        const x = 65 + catIndex * 294;
        return `${t(x, y + 146, cat.label, 12, cat.color, 700)}${t(x, y + 170, `${pct(component.percentage)} · ${Number.isFinite(component.weighted) ? `${format(component.weighted, 2)} weighted` : "— weighted"}`, 14, ink, 600)}${t(x, y + 191, `${scoreTotal(component)} raw / HPS`, 12, muted)}`;
      }).join("");
      return `<rect x="44" y="${y}" width="872" height="209" rx="14" fill="#fff" stroke="${line}"/><rect x="44" y="${y}" width="6" height="209" rx="3" fill="${complete ? "#327657" : "#b47a22"}"/>
        ${t(65, y + 35, period.name, 21, ink, 700)}${t(895, y + 34, status, 13, complete ? "#327657" : "#8a5d16", 600, 'text-anchor="end"')}
        ${t(65, y + 70, state.calendarMode === "trimester" ? "Term grade" : "Initial grade", 12, muted, 600)}${t(65, y + 109, format(result.initial.rounded, 3), 32, ink, 700)}
        ${t(350, y + 70, finalLabel, 12, muted, 600)}${t(350, y + 109, finalValue, 32, crimson, 700)}
        ${t(620, y + 70, "Qualitative descriptor", 12, muted, 600)}${t(620, y + 105, result.initial.descriptor, 21, ink, 700)}
        <line x1="65" y1="${y + 126}" x2="895" y2="${y + 126}" stroke="${line}"/>${components}`;
    }).join("");
    const footer = `<line x1="44" y1="${footerTop}" x2="916" y2="${footerTop}" stroke="${line}"/>${t(44, footerTop + 27, "Component means are unweighted averages of available period percentages; they are not final grades.", 12, muted)}${t(44, footerTop + 47, "A/M count as zero. E/L are excluded. A provisional grade has missing or incomplete requirements.", 12, muted)}${t(44, footerTop + 70, "Source: this teacher's current class record view", 12, crimson, 600)}`;
    return `${start}${header}${chartTitle}${legends}${grids}${bars}${summary}${cards}${footer}</svg>`;
  }

  async function exportStudentReportPng(button) {
    const svg = document.querySelector(`.student-report-svg[data-report-id="${button.dataset.reportId}"]`);
    if (!svg) return;
    const clone = svg.cloneNode(true);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    const source = new XMLSerializer().serializeToString(clone);
    const url = URL.createObjectURL(new Blob([source], { type: "image/svg+xml;charset=utf-8" }));
    try {
      const image = new Image();
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url; });
      const canvas = document.createElement("canvas");
      canvas.width = Number(svg.getAttribute("width")) * 2;
      canvas.height = Number(svg.getAttribute("height")) * 2;
      const context = canvas.getContext("2d");
      context.scale(2, 2);
      context.drawImage(image, 0, 0);
      const png = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
      if (!png) throw new Error("PNG conversion failed");
      const download = document.createElement("a");
      const filename = `${button.dataset.reportName}-${button.dataset.reportSection}-grades`.normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 100);
      const pngUrl = URL.createObjectURL(png);
      download.href = pngUrl;
      download.download = `${filename || "student-grades"}.png`;
      document.body.append(download);
      download.click();
      download.remove();
      setTimeout(() => URL.revokeObjectURL(pngUrl), 1000);
    } catch (error) {
      showSaveToast(`Image export failed: ${error.message}`, "error");
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function shortenPeriodLabel(name) {
    const short = {
      "1st Grading": "Q1", "2nd Grading": "Q2", "3rd Grading": "Q3", "4th Grading": "Q4",
      "1st Quarter, 1st Semester": "Q1", "2nd Quarter, 1st Semester": "Q2",
      "1st Quarter, 2nd Semester": "Q3", "2nd Quarter, 2nd Semester": "Q4"
    };
    if (short[name]) return short[name];
    return name.length > 14 ? name.slice(0, 13) + "…" : name;
  }

  function showSearchModal(message, isHtml = false) {
    const modal = document.createElement("div");
    modal.className = "modal-backdrop";
    modal.innerHTML = `<section class="modal search-result-modal" role="dialog" aria-modal="true" aria-labelledby="studentSearchTitle"><div class="section-heading"><div><p class="eyebrow">Teacher-assisted grade check</p><h2 id="studentSearchTitle">Student result</h2></div>${button(icon("close"), "close-modal", "icon-button", 'aria-label="Close"')}</div><div class="student-results">${isHtml ? message : `<p class="muted">${escapeHtml(message)}</p>`}</div></section>`;
    document.body.append(modal);
  }

  // One-time welcome notice — shown the single first time ANY teacher account
  // successfully logs in on a given device. Every account has identical full
  // functionality; this is purely an informational greeting/disclaimer.
  function showWelcomeModal() {
    document.querySelector(".modal-backdrop.welcome-modal")?.remove();
    const modal = document.createElement("div");
    modal.className = "modal-backdrop welcome-modal";
    modal.innerHTML = `<section class="modal welcome-modal-card" role="dialog" aria-modal="true" aria-labelledby="welcomeModalTitle">
      <p class="eyebrow">First time on this device</p>
      <h2 id="welcomeModalTitle">Before you begin</h2>
      <p class="welcome-modal-subtitle">This independent, unofficial tool helps you manage classes, scores, and grade exports. Confirm the grading rules and weights with your school, review calculated grades before submission, and check that changes are saved before switching devices.</p>
      <div class="stack-actions" style="justify-content:flex-end; margin-top:20px;">${button("Got it, let's start", "close-modal", "button button-primary")}</div>
    </section>`;
    document.body.append(modal);
    modal.querySelector(".welcome-modal-card")?.focus();
  }

  function renderAddClass() {
    const modal = document.createElement("div");
    modal.className = "modal-backdrop";
    modal.innerHTML = `
      <section class="modal" role="dialog" aria-modal="true">
        <div class="section-heading">
          <div><p class="eyebrow">Class Record</p><h2>Add New Class</h2></div>
          ${button(icon("close"), "close-modal", "icon-button", 'aria-label="Close"')}
        </div>
        <div class="settings-grid" style="margin-top: 15px;">
          <label>Grade Level 
            <input id="addClassLevel" placeholder="e.g. Grade 8 or Grade 11" value="${activeGroup === "SHS" ? "Grade 11" : "Grade 8"}">
          </label>
          <label>Subject / Grading Distribution
            <select id="addClassSubjectPreset">
              ${SUBJECT_PRESETS.map(p => `<option value="${p.name}">${p.label}</option>`).join("")}
              <option value="custom">Other / Custom Subject...</option>
            </select>
          </label>
          <label id="customSubjectWrap" style="display:none;">Custom Subject Name
            <input id="addClassCustomSubject" placeholder="e.g. Robotics & Applied Technology">
          </label>
          <div id="customWeightsWrap" style="display:none;">
            <p class="custom-weights-heading">Custom Grading Distribution</p>
            <div class="custom-weights-row">
              <label>Written Work (WW) %
                <input id="addClassWW" type="number" min="0" max="100" step="any" inputmode="decimal" autocomplete="off" value="20">
              </label>
              <label>Performance Task (PT) %
                <input id="addClassPT" type="number" min="0" max="100" step="any" inputmode="decimal" autocomplete="off" value="50">
              </label>
              <label>Quarterly Assessment (QA) %
                <input id="addClassQA" type="number" min="0" max="100" step="any" inputmode="decimal" autocomplete="off" value="30">
              </label>
            </div>
            <p id="addClassWeightTotal" class="form-note"></p>
            <p class="form-note">Quarterly Assessment keeps its built-in Summative Test 1 / Summative Test 2 / Term Exam split of 30% / 30% / 40% — only the overall WW / PT / QA shares above are yours to set.</p>
          </div>
          <label>Section Name
            <input id="addClassSection" placeholder="e.g. Saint Alfonso de Orozco">
          </label>
          <label>Color Code Theme
            <select id="addClassTheme">
              ${["purple","green","blue","red","charcoal","baby-blue","deep-red","yellow","orange","pink","gray","black","brown"].map(c => 
                `<option value="${c}">${c.charAt(0).toUpperCase() + c.slice(1)}</option>`
              ).join("")}
            </select>
          </label>
        </div>
        <div class="stack-actions" style="margin-top:24px;">
          <button type="button" class="button button-primary" data-action="save-new-class">Create Class</button>
        </div>
      </section>
    `;
    document.body.append(modal);

    const presetSelect = modal.querySelector("#addClassSubjectPreset");
    const customWrap = modal.querySelector("#customSubjectWrap");
    const customWeightsWrap = modal.querySelector("#customWeightsWrap");
    presetSelect.addEventListener("change", () => {
      const isCustom = presetSelect.value === "custom";
      customWrap.style.display = isCustom ? "grid" : "none";
      customWeightsWrap.style.display = isCustom ? "block" : "none";
    });
    attachCustomWeightLiveTotal(modal, ["addClassWW", "addClassPT", "addClassQA"], "addClassWeightTotal");
  }

  function renderEditSection(sectionId) {
    const section = activeRegistry().find(s => s.id === sectionId);
    if (!section) return;
    const modal = document.createElement("div");
    modal.className = "modal-backdrop";
    const isPreset = SUBJECT_PRESETS.some(p => p.name === section.subject);

    modal.innerHTML = `
      <section class="modal" role="dialog" aria-modal="true">
        <div class="section-heading">
          <div><p class="eyebrow">Settings</p><h2>Edit Class Section</h2></div>
          ${button(icon("close"), "close-modal", "icon-button", 'aria-label="Close"')}
        </div>
        <div class="settings-grid" style="margin-top: 15px;">
          <label>Grade Level <input id="editSectionLevel" value="${safeValue(section.level)}"></label>
          <label>Subject / Grading Distribution
            <select id="editSectionSubjectPreset">
              ${SUBJECT_PRESETS.map(p => `<option value="${p.name}" ${section.subject === p.name ? "selected" : ""}>${p.label}</option>`).join("")}
              <option value="custom" ${!isPreset ? "selected" : ""}>Other / Custom Subject...</option>
            </select>
          </label>
          <label id="editCustomSubjectWrap" style="display:${isPreset ? "none" : "grid"};">Custom Subject Name
            <input id="editSectionCustomSubject" value="${isPreset ? "" : safeValue(section.subject)}">
          </label>
          <div id="editCustomWeightsWrap" style="display:${isPreset ? "none" : "block"};">
            <p class="custom-weights-heading">Custom Grading Distribution</p>
            <div class="custom-weights-row">
              <label>Written Work (WW) %
                <input id="editSectionWW" type="number" min="0" max="100" step="any" inputmode="decimal" autocomplete="off" value="${isPreset ? 20 : section.weights[0]}">
              </label>
              <label>Performance Task (PT) %
                <input id="editSectionPT" type="number" min="0" max="100" step="any" inputmode="decimal" autocomplete="off" value="${isPreset ? 50 : section.weights[1]}">
              </label>
              <label>Quarterly Assessment (QA) %
                <input id="editSectionQA" type="number" min="0" max="100" step="any" inputmode="decimal" autocomplete="off" value="${isPreset ? 30 : section.weights[2]}">
              </label>
            </div>
            <p id="editSectionWeightTotal" class="form-note"></p>
            <p class="form-note">Quarterly Assessment keeps its built-in Summative Test 1 / Summative Test 2 / Term Exam split of 30% / 30% / 40% — only the overall WW / PT / QA shares above are yours to set.</p>
          </div>
          <label>Section Name <input id="editSectionSection" value="${safeValue(section.section)}" placeholder="e.g. Saint Alfonso de Orozco"></label>
          <label>Color Code Theme
            <select id="editSectionTheme">
              ${["purple","green","blue","red","charcoal","baby-blue","deep-red","yellow","orange","pink","gray","black","brown"].map(c => 
                `<option value="${c}" ${(section.accent || section.theme) === c ? "selected" : ""}>${c.charAt(0).toUpperCase() + c.slice(1)}</option>`
              ).join("")}
            </select>
          </label>
        </div>
        <div class="stack-actions" style="margin-top:24px; justify-content:space-between; align-items:center;">
          <div>
            ${section.archived 
              ? `<button type="button" class="button button-secondary" data-action="unarchive-section" data-section="${safeValue(section.id)}">${icon("archive")} Restore Class</button> <button type="button" class="button button-danger" data-action="request-delete-section" data-section="${safeValue(section.id)}">${icon("trash")} Delete Permanently</button>`
              : `<button type="button" class="button button-secondary" data-action="archive-section" data-section="${safeValue(section.id)}">${icon("archive")} Archive Class</button>`}
          </div>
          <button type="button" class="button button-primary" data-action="save-section-edit" data-section="${safeValue(section.id)}">Save Changes</button>
        </div>
      </section>
    `;
    document.body.append(modal);

    const presetSelect = modal.querySelector("#editSectionSubjectPreset");
    const customWrap = modal.querySelector("#editCustomSubjectWrap");
    const customWeightsWrap = modal.querySelector("#editCustomWeightsWrap");
    presetSelect.addEventListener("change", () => {
      const isCustom = presetSelect.value === "custom";
      customWrap.style.display = isCustom ? "grid" : "none";
      customWeightsWrap.style.display = isCustom ? "block" : "none";
    });
    attachCustomWeightLiveTotal(modal, ["editSectionWW", "editSectionPT", "editSectionQA"], "editSectionWeightTotal");
  }

  function renderDeleteSectionConfirmation(sectionId) {
    const section = activeRegistry().find((entry) => entry.id === sectionId);
    if (!section || !section.archived) return;
    document.querySelector(".modal-backdrop")?.remove();
    const className = `${section.level} — ${section.subject}${section.section ? ` — ${section.section}` : ""}`;
    const modal = document.createElement("div");
    modal.className = "modal-backdrop";
    modal.innerHTML = `<section class="modal delete-confirmation" role="dialog" aria-modal="true" aria-labelledby="deleteClassTitle">
      <div class="section-heading"><div><p class="eyebrow">Archived class</p><h2 id="deleteClassTitle">Delete permanently?</h2></div>${button(icon("close"), "close-modal", "icon-button", 'aria-label="Close"')}</div>
      <p>This permanently removes <strong>${escapeHtml(className)}</strong>, including every grading period and learner record in this class. A session checkpoint is kept; download a backup first for durable recovery.</p>
      <label class="delete-confirmation-label">Type <strong>DELETE PERMANENTLY</strong> to confirm
        <input id="deleteClassConfirmation" autocomplete="off" spellcheck="false" aria-label="Type DELETE PERMANENTLY to confirm permanent deletion">
      </label>
      <div class="stack-actions delete-confirmation-actions">${button("Cancel", "close-modal", "button button-secondary")} ${button("Delete Permanently", "confirm-delete-section", "button button-danger", `data-section="${safeValue(section.id)}"`)}</div>
    </section>`;
    document.body.append(modal);
    modal.querySelector("#deleteClassConfirmation")?.focus();
  }

  function applyCalendarMode(mode) {
    if (mode !== "legacy" && mode !== "trimester") return;
    state.calendarMode = mode;
    if (mode === "trimester") state.trimesterModeSeen = true;
    const first = activeRegistry().find((section) => !section.archived) || activeRegistry()[0];
    activeSectionId = first ? first.id : "";
    activeGroup = first ? first.group : "JHS";
    activePeriodIndex = 0;
    archiveFilter = "active";
    currentView = "chooser";
    document.querySelector(".modal-backdrop")?.remove();
    markStateDirty();
    render();
  }

  function renderTrimesterConfirmation() {
    document.querySelector(".modal-backdrop")?.remove();
    const modal = document.createElement("div");
    modal.className = "modal-backdrop";
    modal.innerHTML = `<section class="modal" role="dialog" aria-modal="true" aria-labelledby="trimesterSwitchTitle">
      <div class="section-heading"><div><p class="eyebrow">Grading system</p><h2 id="trimesterSwitchTitle">Start trimester classes?</h2></div>${button(icon("close"), "close-modal", "icon-button", 'aria-label="Close"')}</div>
      <p>This starts a new, empty set of classes for the three-term, zero-based system.</p>
      <p>Your quarterly and semestral classes are untouched. Switch back to them anytime from the same control.</p>
      <p>Nothing is invented or converted from your existing records.</p>
      <div class="stack-actions">${button("Cancel", "close-modal", "button button-secondary")} ${button("Start empty trimester classes", "confirm-calendar-mode", "button button-primary")}</div>
    </section>`;
    document.body.append(modal);
    modal.querySelector('[data-action="confirm-calendar-mode"]')?.focus();
  }

  function permanentlyDeleteArchivedSection(sectionId) {
    const sectionIndex = activeRegistry().findIndex((entry) => entry.id === sectionId);
    const section = activeRegistry()[sectionIndex];
    const confirmation = document.querySelector("#deleteClassConfirmation")?.value.trim().toUpperCase();
    if (!section || !section.archived) {
      setStatus("Only archived classes can be deleted permanently.", "error");
      return;
    }
    if (confirmation !== "DELETE PERMANENTLY") {
      showSaveToast("Type DELETE PERMANENTLY to confirm this deletion.", "error");
      return;
    }

    const deletedName = `${section.level} ${section.subject}${section.section ? ` — ${section.section}` : ""}`;
    activeRegistry().splice(sectionIndex, 1);
    delete activeSections()[sectionId];
    const nextSection = activeRegistry().find((entry) => !entry.archived) || activeRegistry()[0];
    activeSectionId = nextSection ? nextSection.id : "";
    activeGroup = nextSection ? nextSection.group : "JHS";
    activePeriodIndex = 0;
    currentView = "chooser";
    archiveFilter = "archived";
    document.querySelector(".modal-backdrop")?.remove();
    markStateDirty();
    render();
    setStatus(`Permanently deleted archived class "${deletedName}".`);
    showSaveToast("Archived class permanently deleted. Autosave is queued.", "info");
  }

  function updateLiveSummary(rowIndex) {
    const period = currentPeriod();
    const section = currentSection();
    const learner = period.roster[rowIndex];
    const row = document.querySelector(`[data-learner-row="${rowIndex}"]`);
    if (!row) return;
    const result = learnerResult(getLearnerCategory(learner.name) ? {
      ww: learner.ww.map(() => ""),
      pt: learner.pt.map(() => ""),
      qa: learner.qa.map(() => "")
    } : learner, period, section.weights);
    
    const wwTot = row.querySelector(".summary-ww-total"); if (wwTot) wwTot.textContent = scoreTotal(result.ww);
    const wwPs = row.querySelector(".summary-ww-ps"); if (wwPs) wwPs.textContent = format(result.ww.percentage, 3);
    const wwWs = row.querySelector(".summary-ww-ws"); if (wwWs) wwWs.textContent = format(result.ww.weighted, 3);
    
    const ptTot = row.querySelector(".summary-pt-total"); if (ptTot) ptTot.textContent = scoreTotal(result.pt);
    const ptPs = row.querySelector(".summary-pt-ps"); if (ptPs) ptPs.textContent = format(result.pt.percentage, 3);
    const ptWs = row.querySelector(".summary-pt-ws"); if (ptWs) ptWs.textContent = format(result.pt.weighted, 3);
    
    const qaTot = row.querySelector(".summary-qa-total"); if (qaTot) qaTot.textContent = scoreTotal(result.qa);
    const qaPs = row.querySelector(".summary-qa-ps"); if (qaPs) qaPs.textContent = format(result.qa.percentage, 3);
    const qaWs = row.querySelector(".summary-qa-ws"); if (qaWs) qaWs.textContent = format(result.qa.weighted, 3);
    
    const initCell = row.querySelector(".summary-initial"); if (initCell) initCell.textContent = format(result.initial.rounded, 3);
    const transCell = row.querySelector(".summary-transmuted"); if (transCell) transCell.textContent = format(result.initial.transmuted, 0);
    const descCell = row.querySelector(".summary-descriptor"); if (descCell) descCell.innerHTML = renderDescriptorBadge(result.initial.descriptor);

    ["ww", "pt", "qa"].forEach((kind) => row.querySelectorAll(`[data-score="${kind}"]`).forEach((input) => {
      const index = Number(input.dataset.index);
      const cellValue = learner[kind][index];
      const bad = hasRawAboveHps(cellValue, period[kind + "Hps"][index]) || (cellValue !== "" && !isAttendanceCode(cellValue) && (!Number.isFinite(Number(cellValue)) || Number(cellValue) < 0));
      input.classList.toggle("invalid", bad);
      input.setAttribute("aria-invalid", String(bad));
      input.classList.toggle("code-cell", isAttendanceCode(cellValue));
      input.classList.toggle("code-cell-missing", typeof cellValue === "string" && cellValue.trim().toUpperCase() === "M");
    }));
  }

  function updateAllSummaries() { currentPeriod().roster.forEach((_, index) => updateLiveSummary(index)); }

  function setStatus(message, type = "") {
    const status = document.querySelector("#statusMessage");
    if (status) { status.textContent = message; status.className = `save-status ${type}`; }
    const btn = document.querySelector("#saveChanges");
    if (btn) { btn.classList.toggle("saving", type === "saving"); btn.classList.toggle("error", type === "error"); }
  }

  function syncSaveControl() {
    const btn = document.querySelector("#saveChanges");
    if (!btn) return;

    if (!isSyncConfigured()) {
      btn.disabled = false;
      setStatus("Cloud save isn't ready. Changes save on this device only.");
    } else if (isLoading) {
      btn.disabled = true;
      setStatus("Connecting to live sync... Please wait.", "saving");
    } else if (!isDataLoaded) {
      btn.disabled = true;
      setStatus(lastLoadError
        ? ` DATA LOCKED — connection failed: ${lastLoadError}`
        : " DATA LOCKED: waiting for the live database to respond.", "error");
    } else if (isStale) {
      btn.disabled = false;
      setStatus(" Another device saved changes here. Open Settings to resolve before saving.", "error");
    } else {
      btn.disabled = false;
      setStatus("Ready to save. ✓ (live sync on)");
    }
  }

  async function saveToFirebase({ automatic = false } = {}) {
    const focused = document.activeElement;
    if (focused?.dataset?.hps && hpsEdits.has(focused)) {
      if (automatic) { scheduleAutoSaveMaxWait(); return false; }
      commitHpsField(focused);
    }
    commitPendingBulkFill();
    if (!isSignedIn()) { setStatus("Sign in before saving.", "error"); return false; }
    if (!isSyncConfigured()) {
      if (!automatic) setStatus("Live sync isn't set up yet — see FIREBASE_SETUP.md.", "error");
      return false;
    }
    if (!isDataLoaded) {
      if (!automatic) {
        setStatus(" BLOCKED: Cannot save unsynchronized data. Waiting for live sync to connect.", "error");
        alert("SAFETY BLOCK:\n\nYou are attempting to save before this device has confirmed the current saved data.\n\nTo avoid overwriting and losing class records, saving has been blocked until live sync finishes connecting.");
      }
      return false;
    }
    if (isStale) {
      if (!automatic) {
        setStatus(" BLOCKED: another device saved newer changes here.", "error");
        alert("SAFETY BLOCK:\n\nAnother device saved changes to this same account while you had unsaved edits open here.\n\nTo avoid silently overwriting their changes, saving has been blocked. Open Settings to review and choose which version to keep.");
      }
      return false;
    }

    if (isSaving) {
      saveQueued = true;
      if (!automatic) setStatus("Save queued — finishing the current save first.", "saving");
      return false;
    }

    const savedRevision = stateRevision;
    const savedChangeCount = pendingAutoSaveChanges;
    const stateSnapshot = cloneState(state);
    const currentUser = currentUserKey();
    isSaving = true;
    updateSaveIndicators();
    setStatus(automatic ? "Autosaving..." : "Saving...", "saving");
    try {
      await window.CSTRSync.ready;
      cloudRevision = await window.CSTRSync.save(currentUser, stateSnapshot, cloudRevision);
      lastCloudSavedAt = new Date();
      lastCloudVerifiedAt = lastCloudSavedAt;
      lastSavedRevision = Math.max(lastSavedRevision, savedRevision);
      if (stateRevision === savedRevision) {
        sessionStorage.removeItem(localDraftKey());
        finalizeSavedBatch();
      } else {
        // Edits made during this network request belong to the NEXT save.
        // Never mark them clean or discard their device recovery copy.
        if (preBatchSnapshot) pushVersionSnapshot(preBatchSnapshot);
        preBatchSnapshot = stateSnapshot;
        pendingAutoSaveChanges = Math.max(1, pendingAutoSaveChanges - savedChangeCount);
        lastSavedAt = new Date();
        persistLocalDraft(); updateSaveIndicators(); scheduleAutoSaveMaxWait();
        saveQueued = true;
      }
      const newerEditsPending = pendingAutoSaveChanges > 0;
      setStatus(newerEditsPending ? "Earlier edits saved to cloud; newer edits are still pending." : automatic ? "Autosaved ✓ (live on every device)" : "Saved ✓ (live on every device)");
      showSaveToast(newerEditsPending ? "Earlier edits saved to cloud; newer edits still need saving." : automatic ? "All changes autosaved — live on every device." : "Changes saved — live on every device.");
      return true;
    } catch (error) {
      if (error.code === "sync/conflict") {
        isStale = true; pendingRemoteState = error.remoteState; pendingRemoteRevision = error.revision;
        pendingRemoteAt = error.savedAt;
      }
      setStatus(error.code === "sync/conflict" ? "Newer cloud changes detected. Open Settings to review both versions." : `Save failed: ${error.message}`, "error");
      if (automatic) showSaveToast("Autosave could not reach the live database. Your recovery copy remains on this device.", "error");
      return false;
    } finally {
      isSaving = false;
      updateSaveIndicators();
      refreshLogoutModal();
      if (saveQueued) {
        saveQueued = false;
        queueAutoSave();
      }
    }
  }

  // Starts (or restarts, e.g. after logging in as a different account) a
  // real-time subscription to this account's data. The first update received
  // is treated as the initial load (same job loadFromGist() used to do);
  // every update after that is a genuine live push from another device and
  // is handled by handleRemoteUpdate().
  function subscribeToSync() {
    if (unsubscribeSync) { unsubscribeSync(); unsubscribeSync = null; }
    isStale = false;
    pendingRemoteState = null;
    pendingRemoteAt = null;
    const requestId = ++loadRequestId;
    isLoading = true;
    lastLoadError = "";
    isDataLoaded = false;
    lastCloudSavedAt = null;
    lastCloudVerifiedAt = null;
    syncSaveControl();
    setStatus("Connecting to live sync...", "saving");

    if (!isSyncConfigured()) {
      // FIREBASE_SETUP.md hasn't been completed yet — fall back to exactly
      // what the app did before any sync existed: this device's own copy.
      const localDraft = restoreLocalDraft();
      if (localDraft) state = localDraft;
      isDataLoaded = true; isLoading = false; pendingAutoSaveChanges = 0;
      commitActiveFieldEdit(); establishCleanBaseline(); render(); updateSaveIndicators(); syncSaveControl();
      if (localDraft) showSaveToast("Restored the latest autosaved copy from this device.", "info");
      return;
    }

    let firstUpdateHandled = false;
    const localDraft = restoreLocalDraft(); // offline fallback only, used only if the network never answers in time

    const offlineFallbackTimer = setTimeout(() => {
      if (firstUpdateHandled || requestId !== loadRequestId) return;
      firstUpdateHandled = true;
      if (localDraft) state = localDraft;
      isDataLoaded = false; isLoading = false; pendingAutoSaveChanges = localDraft ? 1 : 0;
      commitActiveFieldEdit(); establishCleanBaseline(); updateSaveIndicators();
      lastLoadError = "Could not reach the live database (offline?). Working from this device's last saved copy.";
      setStatus(` ${lastLoadError}`, "error");
      if (localDraft) showSaveToast("Offline — restored this tab's draft. Reconnect and review the cloud version before saving.", "info");
      render();
    }, 6000);

    unsubscribeSync = window.CSTRSync.subscribe(
      currentUserKey(),
      (remoteState, meta) => {
        if (requestId !== loadRequestId) return; // a newer subscribe has since started
        clearTimeout(offlineFallbackTimer);
        if (!firstUpdateHandled) {
          firstUpdateHandled = true;
          cloudRevision = meta.revision || 0;
          if (localDraft) pushVersionSnapshot(localDraft);
      state = normalizeState(remoteState || {});
          activePeriodIndex = 0;
          isDataLoaded = true; isLoading = false; lastLoadError = "";
          lastCloudVerifiedAt = new Date();
          pendingAutoSaveChanges = 0;
          commitActiveFieldEdit();
          if (autoSaveMaxWaitTimer) { clearTimeout(autoSaveMaxWaitTimer); autoSaveMaxWaitTimer = null; }
          establishCleanBaseline();
          lastSavedAt = new Date();
          startSaveIndicatorTicker();
          try {
            render();
            setStatus(localDraft ? "Cloud loaded. A recovered draft is available in Settings > Restore a previous version." : "Live sync connected ✓");
          } catch (renderError) {
            console.error("Render after initial sync failed:", renderError);
            setStatus("Data loaded, but the screen didn't refresh. Try switching views (Home / Class Record).", "error");
          }
          return;
        }
        handleRemoteUpdate(remoteState, meta);
      },
      (error) => {
        if (requestId !== loadRequestId) return;
        clearTimeout(offlineFallbackTimer);
        if (firstUpdateHandled) return;
        firstUpdateHandled = true;
        if (localDraft) state = localDraft;
        isDataLoaded = false; isLoading = false; pendingAutoSaveChanges = localDraft ? 1 : 0;
        commitActiveFieldEdit(); establishCleanBaseline(); updateSaveIndicators();
        lastLoadError = error.message;
        setStatus(` Live sync error: ${error.message}. Working from this device's last saved copy.`, "error");
        render();
      }
    );
  }

  // Handles a push that arrives AFTER the initial load — i.e. a genuine
  // change saved from another browser/device for this same account.
  function handleRemoteUpdate(remoteState, meta) {
    isDataLoaded = true; // A real server response is required before cloud writes.
    if (meta.isOwnEcho) return; // hearing our own save reflected back — already applied locally
    lastCloudVerifiedAt = new Date();
    if (pendingAutoSaveChanges === 0 && !isSaving && !isStale) {
      // Nothing unsaved on this device — safe to take the newer copy immediately.
      cloudRevision = meta.revision || 0;
      state = normalizeState(remoteState || {});
      isDataLoaded = true;
      establishCleanBaseline();
      lastSavedAt = new Date();
      try { render(); } catch (renderError) { console.error("Render after live update failed:", renderError); }
      showSaveToast("Updated with changes saved from another device.", "info");
    } else {
      // This device has edits in progress (or is already showing a conflict) —
      // never silently overwrite either side. Stash it for Settings to resolve.
      isStale = true;
      pendingRemoteState = remoteState;
      pendingRemoteAt = meta.savedAt;
      pendingRemoteRevision = meta.revision || 0;
      setStatus(" Another device just saved changes here. Open Settings to review before your next save.", "error");
      showSaveToast("Heads up: another device saved changes while you were editing.", "error");
    }
  }

  // Settings action: keep what's on THIS screen and overwrite the other
  // device's save on the next Save Changes.
  function keepLocalOverRemote() {
    if (!confirm("Replace the reviewed cloud version with this device's entire record? Export backups of both versions first. Newer intervening saves will still be blocked.")) return;
    pushVersionSnapshot(pendingRemoteState);
    cloudRevision = pendingRemoteRevision;
    isStale = false;
    pendingRemoteState = null;
    pendingRemoteAt = null;
    document.querySelector(".modal-backdrop")?.remove();
    render();
    setStatus("Keeping this device's version. Save Changes will now overwrite the other device's copy.", "info");
  }

  // Settings action: discard this device's unsaved edits and take the other
  // device's saved version instead.
  function takeRemoteOverLocal() {
    if (!pendingRemoteState) return;
    const confirmed = confirm("Discard your unsaved edits on THIS device and load the version saved from the other device instead?\n\nA session checkpoint is kept; download a backup first for durable recovery.");
    if (!confirmed) return;
    pushVersionSnapshot(cloneState(state));
    sessionStorage.removeItem(localDraftKey());
    cloudRevision = pendingRemoteRevision;
    state = normalizeState(pendingRemoteState);
    activePeriodIndex = 0;
    isStale = false;
    pendingRemoteState = null;
    pendingRemoteAt = null;
    pendingAutoSaveChanges = 0;
    commitActiveFieldEdit();
    if (autoSaveMaxWaitTimer) { clearTimeout(autoSaveMaxWaitTimer); autoSaveMaxWaitTimer = null; }
    establishCleanBaseline();
    document.querySelector(".modal-backdrop")?.remove();
    render();
    setStatus("Loaded the other device's version ✓");
    showSaveToast("Switched to the version saved from the other device.", "info");
  }

  function renderVersionHistoryList() {
    const history = loadVersionHistory();
    if (!history.length) return `<p class="settings-note">No previous versions saved yet on this device. A restore point is captured automatically each time changes are saved.</p>`;
    const rows = history.slice().reverse().map((entry, reversedIndex) => {
      const index = history.length - 1 - reversedIndex; // real index into the stored array
      const when = new Date(entry.savedAt);
      const label = Number.isNaN(when.getTime()) ? entry.savedAt : when.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
      return `<li class="version-history-row"><span>${safeValue(label)}</span>${button("Restore", "restore-version", "button button-secondary", `data-version-index="${index}"`)}</li>`;
    }).join("");
    return `<ul class="version-history-list">${rows}</ul>`;
  }

  function renderAccountSection() {
    const user = window.CSTRSync.getCurrentUser ? window.CSTRSync.getCurrentUser() : null;
    const hasPassword = window.CSTRSync.hasPasswordProvider ? window.CSTRSync.hasPasswordProvider(user) : false;
    const isGoogle = Boolean(user && user.providerData && user.providerData.some((p) => p.providerId === "google.com"));
    const emailStr = safeValue(currentUserEmail() || (user && user.email) || "");
    const nameStr = safeValue(currentUserName() || (user && user.displayName) || state.teacher.name || "Teacher");
    const accountType = isGoogle ? "Google / Gmail Account" : hasPassword ? "Email & Password Account" : "Registered Account";

    return `<div class="section-heading" style="margin-top: 22px;"><div><p class="eyebrow">Account</p><h2 style="font-size: 1.1rem;">Account &amp; Password</h2></div></div>
      <div class="settings-account-card">
        <div class="settings-account-avatar">${icon("users")}</div>
        <div class="settings-account-details">
          <span class="settings-account-provider-badge ${hasPassword && !isGoogle ? 'badge-password' : ''}">${escapeHtml(accountType)}</span>
          <p class="settings-account-status">Logged in as <strong>${nameStr}</strong> using <strong>${emailStr}</strong> in ${escapeHtml(accountType)}.</p>
        </div>
      </div>
      ${hasPassword ? `
        <form id="changePasswordForm" class="legacy-login-box" style="margin-top: 10px;">
          <label class="field-label" style="text-align: left;">Current Password
            <input id="currentPassword" type="password" autocomplete="current-password">
          </label>
          <label class="field-label" style="text-align: left; margin-top: 8px;">New Password
            <input id="newPassword" type="password" autocomplete="new-password" placeholder="At least 12 characters">
          </label>
          <label class="field-label" style="text-align: left; margin-top: 8px;">Confirm New Password
            <input id="newPasswordConfirm" type="password" autocomplete="new-password">
          </label>
          <button type="submit" class="button button-primary" data-action="change-password" style="margin-top: 10px;">Change Password</button>
        </form>
      ` : `
        <p class="settings-note">This account currently only signs in through Google. Set a password below to also be able to type in your email and password directly, like a typical login.</p>
        <form id="setPasswordForm" class="legacy-login-box" style="margin-top: 10px;">
          <label class="field-label" style="text-align: left;">New Password
            <input id="setPassword" type="password" autocomplete="new-password" placeholder="At least 12 characters">
          </label>
          <label class="field-label" style="text-align: left; margin-top: 8px;">Confirm Password
            <input id="setPasswordConfirm" type="password" autocomplete="new-password">
          </label>
          <button type="submit" class="button button-outline" data-action="set-password" style="margin-top: 10px;">Set Password</button>
        </form>
      `}
      <p id="passwordChangeMsg" class="login-error" role="alert" style="margin-top: 6px;"></p>`;
  }

  async function performChangePassword() {
    const currentInput = document.querySelector("#currentPassword");
    const newInput = document.querySelector("#newPassword");
    const confirmInput = document.querySelector("#newPasswordConfirm");
    const msg = document.querySelector("#passwordChangeMsg");
    const current = currentInput ? currentInput.value : "";
    const next = newInput ? newInput.value : "";
    const confirmValue = confirmInput ? confirmInput.value : "";
    if (msg) { msg.textContent = ""; msg.classList.remove("error"); msg.style.color = ""; }

    if (!current || !next) {
      if (msg) { msg.textContent = "Please fill in both password fields."; msg.classList.add("error"); }
      return;
    }
    if (next.length < 12) {
      if (msg) { msg.textContent = "New password must be at least 12 characters."; msg.classList.add("error"); }
      return;
    }
    if (next !== confirmValue) {
      if (msg) { msg.textContent = "New passwords do not match."; msg.classList.add("error"); }
      return;
    }

    try {
      await window.CSTRSync.changePassword(current, next);
      if (msg) { msg.textContent = "Password changed successfully."; msg.style.color = "#1a7f37"; }
      const form = document.querySelector("#changePasswordForm");
      if (form) form.reset();
    } catch (err) {
      console.error("Change password error:", err);
      if (msg) {
        msg.textContent = ["auth/wrong-password", "auth/invalid-credential"].includes(err.code)
          ? "Current password is incorrect."
          : friendlyAuthErrorMessage(err, "Couldn't change password");
        msg.classList.add("error");
      }
    }
  }

  async function performSetPassword() {
    const newInput = document.querySelector("#setPassword");
    const confirmInput = document.querySelector("#setPasswordConfirm");
    const msg = document.querySelector("#passwordChangeMsg");
    const next = newInput ? newInput.value : "";
    const confirmValue = confirmInput ? confirmInput.value : "";
    if (msg) { msg.textContent = ""; msg.classList.remove("error"); msg.style.color = ""; }

    if (!next || next.length < 12) {
      if (msg) { msg.textContent = "Password must be at least 12 characters."; msg.classList.add("error"); }
      return;
    }
    if (next !== confirmValue) {
      if (msg) { msg.textContent = "Passwords do not match."; msg.classList.add("error"); }
      return;
    }

    try {
      await window.CSTRSync.setInitialPassword(next);
      document.querySelector(".modal-backdrop")?.remove();
      renderSettings();
      const msg2 = document.querySelector("#passwordChangeMsg");
      if (msg2) { msg2.textContent = "Password set! You can now sign in with your email and this password, in addition to Google."; msg2.style.color = "#1a7f37"; }
    } catch (err) {
      console.error("Set password error:", err);
      if (msg) { msg.textContent = friendlyAuthErrorMessage(err, "Couldn't set password"); msg.classList.add("error"); }
    }
  }

  function renderSettings() {
    const modal = document.createElement("div");
    modal.className = "modal-backdrop";
    const syncStatusLine = !isSyncConfigured()
      ? `<p class="settings-note" style="color: var(--danger, #c0392b); border: 1px solid currentColor; border-radius: 8px; padding: 10px 12px;"> Live sync isn't set up yet. See FIREBASE_SETUP.md in the repo, fill in ASSETS/firebase-sync.js, and redeploy.</p>`
      : isStale
        ? `<p class="settings-note" style="color: var(--danger, #c0392b); border: 1px solid currentColor; border-radius: 8px; padding: 10px 12px;"> Another device saved changes here${pendingRemoteAt ? ` at ${safeValue(new Date(pendingRemoteAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }))}` : ""} while you had unsaved edits. Choose which version to keep:</p>
           <div class="stack-actions">${button("Keep the OTHER device's version", "take-remote-version", "button button-primary")} ${button("Keep THIS device's version", "keep-local-version")}</div>`
        : `<p class="settings-note"> Live sync connected. Changes saved here appear on every other device automatically — nothing to type in.</p>`;
    modal.innerHTML = `<section class="modal settings-modal" role="dialog" aria-modal="true" aria-labelledby="settingsTitle"><div class="section-heading"><div><p class="eyebrow">Workspace preferences</p><h2 id="settingsTitle">Settings</h2></div>${button(icon("close"), "close-modal", "icon-button", 'aria-label="Close"')}</div>
      ${syncStatusLine}
      ${lastLoadError ? `<p class="settings-note" style="color: var(--danger, #c0392b); border: 1px solid currentColor; border-radius: 8px; padding: 10px 12px;"> ${safeValue(lastLoadError)}</p>` : ""}
      ${renderAccountSection()}
      <section class="recovery-tools"><h3>Private recovery</h3><p>Drafts and up to eight checkpoints stay in this tab only. Logout clears them. Download an encrypted backup for durable recovery; keep the passphrase separately.</p><div class="stack-actions"><button type="button" class="button button-secondary" data-review-action="backup">Download encrypted backup</button><button type="button" class="button button-secondary" data-review-action="import">Restore encrypted backup</button><button type="button" class="button button-secondary" data-review-action="backup-cloud" ${!pendingRemoteState ? "disabled" : ""}>Back up conflicting cloud version</button><button type="button" class="button button-danger" data-review-action="clear">Clear local recovery</button></div><p><a href="mailto:SANCHEZRAMIL2202@GMAIL.COM">Developer support and privacy requests</a>. Do not email passwords or student records.</p></section>
      <div class="section-heading" style="margin-top: 22px;"><div><p class="eyebrow">Recovery</p><h2 style="font-size: 1.1rem;">Restore a previous version</h2></div></div>
      <p class="settings-note">Every time changes are saved, the state just before that save is kept here on this device — use this if a value was cleared or deleted by accident. Restoring loads and saves that version when connected. Recovery checkpoints stay in this tab and are cleared on logout. Download an encrypted backup before closing the tab if you need durable recovery.</p>
      ${renderVersionHistoryList()}
      </section>`;
    document.body.append(modal);
  }

  function restoreVersion(index) {
    const history = loadVersionHistory();
    const entry = history[index];
    if (!entry || !entry.state) { setStatus("That version could not be found.", "error"); return; }
    const when = new Date(entry.savedAt);
    const label = Number.isNaN(when.getTime()) ? entry.savedAt : when.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
    const confirmed = confirm(`Restore the version from ${label}?\n\nThis replaces everything currently on screen with that earlier version and saves right away.`);
    if (!confirmed) return;

    // Preserve whatever is currently on screen as its own checkpoint first,
    // in case this restore turns out to be the wrong call.
    const stateBeforeRestore = cloneState(state);

    state = normalizeState(entry.state);
    activePeriodIndex = 0;
    commitActiveFieldEdit();
    if (autoSaveMaxWaitTimer) { clearTimeout(autoSaveMaxWaitTimer); autoSaveMaxWaitTimer = null; }
    pendingAutoSaveChanges = 0;
    preBatchSnapshot = stateBeforeRestore;
    markStateDirty();
    document.querySelector(".modal-backdrop")?.remove();
    render();
    setStatus("Previous version restored ✓");
    if (isSyncConfigured() && isDataLoaded && !isStale) {
      saveToFirebase();
    } else {
      persistLocalDraft();
      showSaveToast("Previous version restored in this tab. Reconnect and resolve conflicts before cloud saving.", "info");
    }
  }

  function choosePhoto() { document.querySelector("#photoInput")?.click(); }

  function handlePhoto(file) {
    const allowedType = file && ["image/png", "image/jpeg"].includes(file.type);
    const allowedExtension = file && /\.(png|jpe?g)$/i.test(file.name);
    if (!allowedType || !allowedExtension) { showSaveToast("Only .png, .jpg, and .jpeg image files are accepted.", "error"); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const scale = Math.min(1, 500 / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
        canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
        state.photo = canvas.toDataURL(file.type === "image/png" ? "image/png" : "image/jpeg", 0.88);
        markStateDirty();
        render();
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  function fieldStartColumn(target, period = currentPeriod()) {
    const wwLen = period.wwDates.length;
    const ptLen = period.ptDates.length;
    if (target.dataset.nameRow !== undefined) return 0;
    if (target.dataset.score === "ww") return 1 + Number(target.dataset.index);
    if (target.dataset.score === "pt") return 1 + wwLen + Number(target.dataset.index);
    if (target.dataset.score === "qa") return 1 + wwLen + ptLen + Number(target.dataset.index);
    return null;
  }

  function getCellCoords(input) {
    const row = Number(input.dataset.nameRow !== undefined ? input.dataset.nameRow : input.dataset.row);
    const col = fieldStartColumn(input);
    return (Number.isFinite(row) && col !== null) ? { row, col } : null;
  }

  // True when `input` is the cell a multi-cell selection was dragged out
  // from (its "anchor") — the one cell where typing is still visible live
  // while the rest of the selected block waits to receive the same value
  // once the edit is committed.
  function isMultiSelectAnchor(input) {
    const bounds = getSelectionBounds();
    if (!bounds || (bounds.minRow === bounds.maxRow && bounds.minCol === bounds.maxCol)) return false;
    const coords = getCellCoords(input);
    if (!coords) return false;
    return coords.row === selectionState.startRow && coords.col === selectionState.startCol;
  }

  function getSelectionBounds() {
    if (!selectionState.active && selectionState.startRow === null) return null;
    const minRow = Math.min(selectionState.startRow, selectionState.endRow);
    const maxRow = Math.max(selectionState.startRow, selectionState.endRow);
    const minCol = Math.min(selectionState.startCol, selectionState.endCol);
    const maxCol = Math.max(selectionState.startCol, selectionState.endCol);
    return { minRow, maxRow, minCol, maxCol };
  }

  function highlightSelection() {
    const bounds = getSelectionBounds();
    document.querySelectorAll(".record-table tbody input").forEach((input) => {
      const coords = getCellCoords(input);
      if (!coords || !bounds) { input.classList.remove("cell-selected"); return; }
      const isSelected = coords.row >= bounds.minRow && coords.row <= bounds.maxRow &&
                         coords.col >= bounds.minCol && coords.col <= bounds.maxCol &&
                         (bounds.minRow !== bounds.maxRow || bounds.minCol !== bounds.maxCol);
      input.classList.toggle("cell-selected", isSelected);
    });
  }

  function clearSelection() {
    selectionState = { active: false, startRow: null, startCol: null, endRow: null, endCol: null };
    fillArmed = false;
    document.querySelectorAll(".cell-selected").forEach((el) => el.classList.remove("cell-selected"));
  }

  // Bulk-fill-by-typing: once a multi-cell block/row/column is selected and
  // the user types a new value into the anchor cell (the cell the drag
  // started from), committing that edit (Enter, Tab/click away, or starting
  // a new selection) copies the anchor's final value into every other cell
  // in the selected block — vertically down a column, horizontally across a
  // row, or across a rectangular block of both. Score/HPS-style cells run
  // the same sanitizeScoreValue() rule as normal typing and manual paste;
  // the name column copies the text as-is. "BOYS"/"GIRLS" divider rows are
  // always skipped so a sweeping selection can never overwrite a category
  // label or its (intentionally always-blank) score cells.
  //
  // Deliberately does NOT call render(): it patches only the affected rows'
  // existing <input> elements and recalculated summary cells directly, the
  // same lightweight approach normal single-cell typing already uses. This
  // keeps focus/scroll position on the rest of the page completely
  // undisturbed, and — critically — avoids replacing DOM nodes in the
  // middle of a click elsewhere on the page (e.g. clicking another button
  // right after typing a fill value), which could otherwise cause that
  // click to silently do nothing.
  function commitPendingBulkFill() {
    if (!fillArmed) return;
    fillArmed = false;

    const bounds = getSelectionBounds();
    const isMulti = bounds && (bounds.minRow !== bounds.maxRow || bounds.minCol !== bounds.maxCol);
    if (!isMulti) return;

    const period = currentPeriod();
    if (!period || !period.roster || period.locked) return;
    const srcRow = selectionState.startRow;
    const srcCol = selectionState.startCol;
    const wwLen = period.wwDates.length;
    const ptLen = period.ptDates.length;
    const qaLen = period.qaDates.length;
    const totalCols = 1 + wwLen + ptLen + qaLen;
    if (!Number.isFinite(srcRow) || srcCol === null || srcRow >= period.roster.length || srcCol >= totalCols) return;

    const srcLearner = period.roster[srcRow];
    let rawValue = "";
    if (srcCol === 0) rawValue = srcLearner.name || "";
    else if (srcCol <= wwLen) rawValue = srcLearner.ww[srcCol - 1] || "";
    else if (srcCol <= wwLen + ptLen) rawValue = srcLearner.pt[srcCol - 1 - wwLen] || "";
    else rawValue = srcLearner.qa[srcCol - 1 - wwLen - ptLen] || "";

    let cellsFilled = 0;
    let skippedCategoryRows = 0;
    let nameColumnTouched = false;
    const affectedRows = [];

    for (let r = bounds.minRow; r <= bounds.maxRow; r++) {
      if (r >= period.roster.length) continue;
      const learner = period.roster[r];
      if (getLearnerCategory(learner.name)) { skippedCategoryRows += 1; continue; }
      let rowChanged = false;
      for (let c = bounds.minCol; c <= bounds.maxCol; c++) {
        if (c >= totalCols) continue;
        if (c === 0) { learner.name = rawValue; nameColumnTouched = true; }
        else if (c <= wwLen) window.CSTRRecordTools.setScore(learner, "ww", c - 1, sanitizeScoreValue(rawValue));
        else if (c <= wwLen + ptLen) window.CSTRRecordTools.setScore(learner, "pt", c - 1 - wwLen, sanitizeScoreValue(rawValue));
        else window.CSTRRecordTools.setScore(learner, "qa", c - 1 - wwLen - ptLen, sanitizeScoreValue(rawValue));
        cellsFilled += 1;
        rowChanged = true;
      }
      if (rowChanged) affectedRows.push(r);
    }

    if (!cellsFilled) { clearSelection(); return; }

    // Re-sync each touched row's inputs and computed summaries straight from
    // state, exactly like a normal single-cell edit does for its own row.
    affectedRows.forEach((r) => {
      const rowEl = document.querySelector(`[data-learner-row="${r}"]`);
      if (!rowEl) return;
      const learner = period.roster[r];
      if (bounds.minCol === 0) {
        const nameInput = rowEl.querySelector("[data-name-row]");
        if (nameInput) nameInput.value = learner.name;
      }
      ["ww", "pt", "qa"].forEach((kind) => {
        rowEl.querySelectorAll(`[data-score="${kind}"]`).forEach((cellInput) => {
          const idx = Number(cellInput.dataset.index);
          cellInput.value = learner[kind][idx];
        });
      });
      updateLiveSummary(r);
    });

    if (nameColumnTouched) { updateAllNumberingAndCounts(); adjustNameColumnWidth(); }

    clearSelection();
    markStateDirty();

    const rowsCount = bounds.maxRow - bounds.minRow + 1;
    const colsCount = bounds.maxCol - bounds.minCol + 1;
    const label = rawValue === "" ? "(blank)" : rawValue;
    const note = skippedCategoryRows ? ` (${skippedCategoryRows} divider row${skippedCategoryRows === 1 ? "" : "s"} skipped)` : "";
    setStatus(`Bulk-filled "${label}" across ${rowsCount} row${rowsCount === 1 ? "" : "s"} × ${colsCount} column${colsCount === 1 ? "" : "s"}.${note}`);
  }

  app.addEventListener("mousedown", (event) => {
    // Flush any pending type-to-fill BEFORE reacting to this new mousedown —
    // whether it starts a fresh selection elsewhere or clicks a button — so
    // the previous selection's typed value is never silently dropped.
    commitPendingBulkFill();
    const input = event.target.closest(".record-table tbody input");
    if (!input || event.button !== 0) { if (!event.target.closest(".record-table tbody")) clearSelection(); return; }
    // A locked period's cells are all `disabled`, but this guards multi-cell
    // select/fill/paste/cut/copy too, since they all key off this selection.
    const activePeriod = currentPeriod();
    if (activePeriod && activePeriod.locked) return;
    const coords = getCellCoords(input);
    if (!coords) return;
    selectionState.active = true;
    selectionState.startRow = selectionState.endRow = coords.row;
    selectionState.startCol = selectionState.endCol = coords.col;
    highlightSelection();
  });

  app.addEventListener("mouseover", (event) => {
    if (!selectionState.active || event.buttons !== 1) return;
    const input = event.target.closest(".record-table tbody input");
    if (!input) return;
    const coords = getCellCoords(input);
    if (!coords) return;
    selectionState.endRow = coords.row;
    selectionState.endCol = coords.col;
    highlightSelection();
  });

  document.addEventListener("mouseup", () => { if (selectionState.active) selectionState.active = false; });

  document.addEventListener("keydown", (event) => {
    const bounds = getSelectionBounds();
    const hasMultiSelection = bounds && (bounds.minRow !== bounds.maxRow || bounds.minCol !== bounds.maxCol);
    if (!hasMultiSelection) return;

    if (event.key === "Escape") {
      document.querySelectorAll(".subject-picker[open],.sheet-help[open],.column-options[open],.period-settings[open],.roster-options[open]").forEach(node => node.removeAttribute("open")); clearSelection(); return; }

    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      fillArmed = false; // the block is being wiped, so any not-yet-committed typed fill is moot
      const period = currentPeriod();
      if (period.locked) { clearSelection(); return; }
      const wwLen = period.wwDates.length;
      const ptLen = period.ptDates.length;
      const qaLen = period.qaDates.length;
      const totalCols = 1 + wwLen + ptLen + qaLen;

      for (let r = bounds.minRow; r <= bounds.maxRow; r++) {
        const l = period.roster[r];
        for (let c = bounds.minCol; c <= bounds.maxCol; c++) {
          if (c >= totalCols) continue;
          if (c === 0) l.name = "";
          else if (c <= wwLen) window.CSTRRecordTools.setScore(l, "ww", c - 1, "");
          else if (c <= wwLen + ptLen) window.CSTRRecordTools.setScore(l, "pt", c - 1 - wwLen, "");
          else window.CSTRRecordTools.setScore(l, "qa", c - 1 - wwLen - ptLen, "");
        }
      }
      markStateDirty();
      render();
      setStatus(`Cleared selected block.`);
      return;
    }
  });

  document.addEventListener("copy", (event) => {
    const bounds = getSelectionBounds();
    if (!bounds || (bounds.minRow === bounds.maxRow && bounds.minCol === bounds.maxCol && document.activeElement.tagName === "INPUT")) return;
    const period = currentPeriod();
    const lines = [];
    const wwLen = period.wwDates.length;
    const ptLen = period.ptDates.length;
    const qaLen = period.qaDates.length;
    const totalCols = 1 + wwLen + ptLen + qaLen;

    for (let r = bounds.minRow; r <= bounds.maxRow; r++) {
      const rowVals = [];
      const l = period.roster[r];
      for (let c = bounds.minCol; c <= bounds.maxCol; c++) {
        if (c >= totalCols) continue;
        if (c === 0) rowVals.push(l.name || "");
        else if (c <= wwLen) rowVals.push(l.ww[c - 1] || "");
        else if (c <= wwLen + ptLen) rowVals.push(l.pt[c - 1 - wwLen] || "");
        else rowVals.push(l.qa[c - 1 - wwLen - ptLen] || "");
      }
      lines.push(rowVals.join("\t"));
    }
    event.clipboardData.setData("text/plain", lines.join("\n"));
    event.preventDefault();
    setStatus(`Copied ${bounds.maxRow - bounds.minRow + 1} rows × ${bounds.maxCol - bounds.minCol + 1} columns to clipboard.`);
  });

  document.addEventListener("cut", (event) => {
    const bounds = getSelectionBounds();
    if (!bounds || (bounds.minRow === bounds.maxRow && bounds.minCol === bounds.maxCol && document.activeElement.tagName === "INPUT")) return;
    fillArmed = false; // the block is being cut out, so any not-yet-committed typed fill is moot
    const period = currentPeriod();
    const lines = [];
    const wwLen = period.wwDates.length;
    const ptLen = period.ptDates.length;
    const qaLen = period.qaDates.length;
    const totalCols = 1 + wwLen + ptLen + qaLen;

    for (let r = bounds.minRow; r <= bounds.maxRow; r++) {
      const rowVals = [];
      const l = period.roster[r];
      for (let c = bounds.minCol; c <= bounds.maxCol; c++) {
        if (c >= totalCols) continue;
        if (c === 0) { rowVals.push(l.name || ""); l.name = ""; }
        else if (c <= wwLen) { rowVals.push(l.ww[c - 1] || ""); window.CSTRRecordTools.setScore(l, "ww", c - 1, ""); }
        else if (c <= wwLen + ptLen) { rowVals.push(l.pt[c - 1 - wwLen] || ""); window.CSTRRecordTools.setScore(l, "pt", c - 1 - wwLen, ""); }
        else { rowVals.push(l.qa[c - 1 - wwLen - ptLen] || ""); window.CSTRRecordTools.setScore(l, "qa", c - 1 - wwLen - ptLen, ""); }
      }
      lines.push(rowVals.join("\t"));
    }
    event.clipboardData.setData("text/plain", lines.join("\n"));
    event.preventDefault();
    markStateDirty();
    render();
    setStatus(`Cut ${bounds.maxRow - bounds.minRow + 1} rows × ${bounds.maxCol - bounds.minCol + 1} columns.`);
  });

  function summarizeUnsavedChanges() {
    if (pendingAutoSaveChanges === 0) return [];
    const before = preBatchSnapshot || createInitialState();
    const changes = [];
    const changed = (a, b) => JSON.stringify(a) !== JSON.stringify(b);
    if (changed(before.teacher, state.teacher)) {
      const fields = { name: "name", age: "age", specialization: "specialization", level: "school level", bio: "bio" };
      changes.push(`Teacher profile: ${Object.keys(fields).filter(key => changed(before.teacher?.[key], state.teacher?.[key])).map(key => fields[key]).join(", ")}`);
    }
    if (before.photo !== state.photo) changes.push("Teacher photo");
    if (before.calendarMode !== state.calendarMode) changes.push("Selected grading workspace");
    [["Quarterly / Semestral", "registry", "sections"], ["Trimester", "registryTri", "sectionsTri"]].forEach(([mode, registryKey, sectionsKey]) => {
      const oldRegistry = before[registryKey] || [];
      const newRegistry = state[registryKey] || [];
      const oldClasses = new Map(oldRegistry.map(item => [item.id, item]));
      const newClasses = new Map(newRegistry.map(item => [item.id, item]));
      new Set([...oldClasses.keys(), ...newClasses.keys()]).forEach(id => {
        const oldClass = oldClasses.get(id), newClass = newClasses.get(id);
        const label = newClass || oldClass;
        const className = `${label.subject || "Class"}${label.section ? ` · ${label.section}` : ""} (${mode})`;
        if (!oldClass || !newClass) { changes.push(`${!oldClass ? "Added" : "Removed"} class: ${className}`); return; }
        if (changed(oldClass, newClass)) {
          const fields = ["level", "subject", "section", "weights", "theme", "archived"].filter(key => changed(oldClass[key], newClass[key]));
          changes.push(`Class ${fields.join(", ") || "settings"}: ${className}`);
        }
        const oldPeriods = before[sectionsKey]?.[id]?.periods || [];
        const newPeriods = state[sectionsKey]?.[id]?.periods || [];
        if (oldPeriods.length !== newPeriods.length) changes.push(`Grading periods: ${className}`);
        for (let index = 0; index < Math.min(oldPeriods.length, newPeriods.length); index += 1) {
          const oldPeriod = oldPeriods[index], newPeriod = newPeriods[index];
          const periodLabel = `${className} · ${newPeriod.name || `period ${index + 1}`}`;
          if (oldPeriod.name !== newPeriod.name || oldPeriod.locked !== newPeriod.locked) changes.push(`Period settings: ${periodLabel}`);
          const kinds = ["ww", "pt", "qa"];
          const changedColumns = kinds.filter(kind => oldPeriod[`${kind}Dates`].length !== newPeriod[`${kind}Dates`].length);
          if (changedColumns.length) changes.push(`Score columns (${changedColumns.map(kind => kind.toUpperCase()).join(", ")}): ${periodLabel}`);
          const activityChanges = [];
          kinds.forEach(kind => {
            const oldDates = oldPeriod[`${kind}Dates`], newDates = newPeriod[`${kind}Dates`];
            const oldHps = oldPeriod[`${kind}Hps`], newHps = newPeriod[`${kind}Hps`];
            const oldMeta = oldPeriod.activityMeta?.[kind] || [], newMeta = newPeriod.activityMeta?.[kind] || [];
            for (let slot = 0; slot < Math.max(oldDates.length, newDates.length); slot += 1) {
              const prefix = `${kind.toUpperCase()} ${slot + 1}`;
              if (String(oldDates[slot] ?? "") !== String(newDates[slot] ?? "")) activityChanges.push(`${prefix} date`);
              if (String(oldHps[slot] ?? "") !== String(newHps[slot] ?? "")) activityChanges.push(`${prefix} HPS`);
              ["title", "competency", "topic"].forEach(field => { if (String(oldMeta[slot]?.[field] ?? "") !== String(newMeta[slot]?.[field] ?? "")) activityChanges.push(`${prefix} ${field}`); });
            }
          });
          if (activityChanges.length) changes.push(`Activities: ${activityChanges.slice(0, 3).join(", ")}${activityChanges.length > 3 ? ` +${activityChanges.length - 3} more` : ""} · ${periodLabel}`);
          if (changed(oldPeriod.roster.map(item => item.name), newPeriod.roster.map(item => item.name))) changes.push(`Learner names or rows: ${periodLabel}`);
          let scoreCount = 0;
          const scoreLearners = new Set();
          for (let row = 0; row < Math.max(oldPeriod.roster.length, newPeriod.roster.length); row += 1) {
            kinds.forEach(kind => {
              const oldScores = oldPeriod.roster[row]?.[kind] || [], newScores = newPeriod.roster[row]?.[kind] || [];
              for (let slot = 0; slot < Math.max(oldScores.length, newScores.length); slot += 1) {
                if (String(oldScores[slot] ?? "") !== String(newScores[slot] ?? "")) {
                  scoreCount += 1;
                  scoreLearners.add(newPeriod.roster[row]?.name || oldPeriod.roster[row]?.name || `row ${row + 1}`);
                }
              }
            });
          }
          if (scoreCount) changes.push(`${scoreCount} score entr${scoreCount === 1 ? "y" : "ies"}: ${periodLabel}${scoreLearners.size === 1 ? ` · ${[...scoreLearners][0]}` : ""}`);
        }
      });
    });
    return changes.length ? changes : ["Other class record changes"];
  }

  function logoutDialogContent() {
    const dirty = pendingAutoSaveChanges > 0;
    const cloudReady = isSyncConfigured() && isDataLoaded && !isStale;
    const unverifiedLocalCopy = !cloudReady && Boolean(restoreLocalDraft());
    const summary = dirty ? summarizeUnsavedChanges() : unverifiedLocalCopy ? ["Local recovery copy may contain changes that are not in cloud"] : [];
    const current = !dirty && cloudReady && !isSaving;
    const status = isSaving ? "A cloud save is in progress. Wait for its result before logging out."
      : isStale ? "Another device changed the cloud record. Review the conflict in Settings before deciding."
      : !isSyncConfigured() ? "Cloud save is unavailable. This browser may hold a recovery copy."
      : !isDataLoaded ? "The cloud copy is unverified on this device. A local recovery copy may exist."
      : dirty ? `${pendingAutoSaveChanges} change${pendingAutoSaveChanges === 1 ? " is" : "s are"} not saved to cloud.`
      : lastCloudSavedAt ? `All changes saved to cloud at ${lastCloudSavedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`
      : `This record was loaded and verified from cloud${lastCloudVerifiedAt ? ` at ${lastCloudVerifiedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}. No edits are pending.`;
    return `<div class="section-heading"><div><p class="eyebrow">Before you leave</p><h2 id="logoutTitle">Log out of your class record?</h2></div>${button(icon("close"), "close-modal", "icon-button", 'aria-label="Close"')}</div>
      <p class="logout-status ${current ? "is-current" : "is-pending"}" role="status">${escapeHtml(status)}</p>
      ${summary.length ? `<div class="logout-changes"><strong>${dirty ? "Changes since the last save" : "Local copy to check"}</strong><ul>${summary.slice(0, 6).map(item => `<li>${escapeHtml(item)}</li>`).join("")}${summary.length > 6 ? `<li>And ${summary.length - 6} more changed areas</li>` : ""}</ul></div>` : ""}
      ${!current ? '<p class="logout-recovery">Logging out clears local recovery for this account. Unsaved changes will be lost unless you first download an encrypted backup.</p>' : ""}
      <div class="logout-actions"><button type="button" class="button button-secondary" data-review-action="backup">Download encrypted backup</button>${current ? button("Cloud copy current — log out", "confirm-logout", "button button-primary") : cloudReady && dirty && !isSaving ? button("Save to cloud, then log out", "save-then-logout", "button button-primary") : ""}
        ${button("Double-check changes · cancel", "close-modal", "button button-secondary")}</div>
      ${!current && !isSaving ? `<div class="logout-destructive">${button("Discard unsaved changes and log out", "logout-without-save", "button button-danger")}</div>` : ""}`;
  }

  function showLogoutModal() {
    commitHpsField(document.activeElement);
    commitPendingBulkFill();
    document.querySelector("#logoutModal")?.remove();
    const modal = document.createElement("div");
    modal.id = "logoutModal";
    modal.className = "modal-backdrop";
    modal.innerHTML = `<section class="modal logout-modal" role="dialog" aria-modal="true" aria-labelledby="logoutTitle">${logoutDialogContent()}</section>`;
    document.body.append(modal);
    modal.querySelector("[data-action='close-modal']")?.focus();
  }

  function refreshLogoutModal() {
    const dialog = document.querySelector("#logoutModal .logout-modal");
    if (dialog) dialog.innerHTML = logoutDialogContent();
  }

  async function performLogout() {
    const recoveryKeys = [localDraftKey(), versionHistoryKey()];
    persistLocalDraft();
    try {
      if (window.CSTRSync?.signOut) await window.CSTRSync.signOut();
    } catch (error) {
      showSaveToast(`Could not log out: ${error.message}`, "error");
      return;
    }
    if (unsubscribeSync) { unsubscribeSync(); unsubscribeSync = null; }
    ++loadRequestId;
    if (autoSaveTimer) { clearTimeout(autoSaveTimer); autoSaveTimer = null; }
    if (autoSaveMaxWaitTimer) { clearTimeout(autoSaveMaxWaitTimer); autoSaveMaxWaitTimer = null; }
    commitActiveFieldEdit();
    isStale = false; pendingRemoteState = null; pendingRemoteAt = null; isDataLoaded = false; isLoading = false;
    lastCloudSavedAt = null; lastCloudVerifiedAt = null; lastSavedAt = null;
    pendingAutoSaveChanges = 0; stateRevision = 0; lastSavedRevision = 0; preBatchSnapshot = null;
    state = createInitialState();
    ["cstr-class-record-login", "cstr-class-record-user", "cstr-class-record-email", "cstr-class-record-name"].forEach(key => sessionStorage.removeItem(key));
    recoveryKeys.forEach(key => { sessionStorage.removeItem(key); localStorage.removeItem(key); });
    window.CSTRRegistration?.clear();
    document.querySelector("#logoutModal")?.remove();
    currentView = "home";
    render();
  }

  // Form submit listeners (Enter key on any of these forms). Attached to
  // `document`, not `app`, because Settings is a modal appended directly to
  // document.body — outside #app — so its forms wouldn't bubble to an
  // app-scoped listener.
  document.addEventListener("submit", (event) => {
    const id = event.target && event.target.id;
    if (id === "signinForm") { event.preventDefault(); performEmailSignIn(); }
    if (id === "signupForm") { event.preventDefault(); performEmailSignUp(); }
    if (id === "legacyClaimForm") { event.preventDefault(); performLegacyClaim(); }
    if (id === "changePasswordForm") { event.preventDefault(); performChangePassword(); }
    if (id === "setPasswordForm") { event.preventDefault(); performSetPassword(); }
  });

  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action]");
    if (!target) return;
    const action = target.dataset.action;
    if (action === "toggle-sidebar" || action === "expand-search") {
      sidebarCollapsed = action === "expand-search" ? false : !sidebarCollapsed;
      try { localStorage.setItem("cstr-sidebar-collapsed", String(sidebarCollapsed)); } catch (_) {}
      document.querySelector(".app-layout")?.classList.toggle("sidebar-collapsed", sidebarCollapsed);
      const toggle = document.querySelector('[data-action="toggle-sidebar"]');
      toggle?.setAttribute("aria-expanded", String(!sidebarCollapsed));
      toggle?.setAttribute("aria-label", sidebarCollapsed ? "Expand navigation" : "Retract navigation");
      if (action === "expand-search") document.querySelector("#studentSearch")?.focus();
      sizeSheetWorkspace();
      return;
    }
    if (action === "choose-sheet-subject") {
      const section = currentSection();
      if (sectionHasLockedPeriod(section)) { showSaveToast("Unlock all periods before changing grading weights.", "error"); return; }
      const value = target.dataset.subject;
      if (value === "custom") { renderEditSection(section.id); return; }
      const preset = SUBJECT_PRESETS.find(p => p.name === value);
      if (!preset) return;
      section.subject = preset.name;
      section.weights = [...preset.weights];
      document.querySelector(".subject-picker")?.removeAttribute("open");
      markStateDirty(); render();
      setStatus("Subject and grading weights updated.");
      return;
    }
    
    if (action === "google-login") {
      performGoogleLogin();
    }
    if (action === "legacy-continue-google") {
      const codeInput = document.querySelector("#legacyClaimCode");
      const legacyKey = codeInput ? codeInput.value.trim() : "";
      performGoogleLogin(legacyKey);
    }
    // Note: email-signin, email-signup, legacy-claim, change-password, and
    // set-password are NOT handled here even though their buttons carry
    // data-action — they're type="submit" buttons inside <form> elements,
    // so a click already triggers the form's native submit event. Handling
    // them here too would fire each action twice per click (once from this
    // click listener, once from the submit listener below). The submit
    // listener alone already covers both mouse clicks and Enter-key submits.
    if (action === "forgot-password") {
      event.preventDefault();
      performForgotPassword();
    }
    if (action === "show-signin") {
      event.preventDefault();
      showSignInPanel();
    }
    if (action === "show-signup") {
      event.preventDefault();
      showSignUpPanel();
    }
    if (action === "show-legacy-claim") {
      event.preventDefault();
      showLegacyClaimPanel();
    }
    if (action === "complete-new-teacher") {
      const user = window.CSTRSync.getCurrentUser();
      if (user) {
        completeNewTeacherSignup(user);
      } else {
        const err = document.querySelector("#onboardError");
        if (err) { err.textContent = "Your sign-in session expired. Please close this dialog and sign in with Google again."; err.classList.add("error"); }
      }
    }
    if (action === "complete-link-legacy") {
      const user = window.CSTRSync.getCurrentUser();
      if (user) {
        completeOnboardLegacyLink(user);
      } else {
        const err = document.querySelector("#onboardError");
        if (err) { err.textContent = "Your sign-in session expired. Please close this dialog and sign in with Google again."; err.classList.add("error"); }
      }
    }
    if (action === "onboard-cancel") {
      event.preventDefault();
      const onboarding = document.querySelector(".modal-backdrop.onboarding-modal");
      if (window.CSTRSync && window.CSTRSync.signOut) {
        window.CSTRSync.signOut().then(() => onboarding?.remove()).catch(error => showSaveToast(`Could not sign out: ${error.message}`, "error"));
      } else onboarding?.remove();
    }
    
    if (action === "add-col") {
      changeColumnCount(target.dataset.kind, 1);
    }
    if (action === "remove-col") {
      changeColumnCount(target.dataset.kind, -1);
    }
    if (action === "bulk-add-col" || action === "bulk-remove-col") {
      const kind = target.dataset.kind;
      const countInput = document.querySelector(`[data-column-count="${kind}"]`);
      const count = Math.min(50, Math.max(1, Number.parseInt(countInput && countInput.value, 10) || 1));
      changeColumnCount(kind, action === "bulk-add-col" ? count : -count);
    }
    if (action === "add-roster-slots") {
      const countInput = document.querySelector('[data-column-count="roster"]');
      const count = Math.min(100, Math.max(1, Number.parseInt(countInput && countInput.value, 10) || 10));
      addRosterSlots(count);
    }
    if (action === "delete-roster-row") {
      deleteRosterRow(Number(target.dataset.row));
    }
    if (action === "toggle-lock-period") {
      toggleLockPeriod();
    }
    if (action === "delete-period") {
      requestDeletePeriod();
    }
    if (action === "confirm-delete-period") {
      deletePeriod();
    }

    if (action === "export-excel") exportCurrentSheet();
    if (action === "export-official") { renderOfficialExportModal(); return; }
    if (action === "export-official-pdf") { exportOfficialGradeSheet("pdf", target); return; }
    if (action === "export-official-word") { exportOfficialGradeSheet("word", target); return; }

    if (action === "set-archive-filter") {
      archiveFilter = target.dataset.filter;
      render();
    }

    if (action === "archive-section") {
      const secId = target.dataset.section;
      const section = activeRegistry().find(s => s.id === secId);
      if (section) {
        section.archived = true;
        document.querySelector(".modal-backdrop")?.remove();
        markStateDirty();
        render();
        setStatus(`Class "${section.subject}" moved to archive storage.`);
      }
    }

    if (action === "unarchive-section") {
      const secId = target.dataset.section;
      const section = activeRegistry().find(s => s.id === secId);
      if (section) {
        section.archived = false;
        document.querySelector(".modal-backdrop")?.remove();
        markStateDirty();
        render();
        setStatus(`Class "${section.subject}" restored to active records.`);
      }
    }

    if (action === "request-delete-section") {
      renderDeleteSectionConfirmation(target.dataset.section);
    }

    if (action === "confirm-delete-section") {
      permanentlyDeleteArchivedSection(target.dataset.section);
    }

    if (action === "open-add-class") renderAddClass();
    if (action === "save-new-class") {
      const level = document.querySelector("#addClassLevel").value.trim() || "Grade 8";
      const presetSelect = document.querySelector("#addClassSubjectPreset");
      const isCustomSubject = presetSelect ? presetSelect.value === "custom" : false;
      let subject = presetSelect ? presetSelect.value : "Science";
      if (subject === "custom") {
        const customInput = document.querySelector("#addClassCustomSubject");
        subject = (customInput && customInput.value.trim()) || "General Subject";
      }
      const sectionName = document.querySelector("#addClassSection").value.trim();
      const theme = document.querySelector("#addClassTheme").value;

      let weights;
      if (isCustomSubject) {
        weights = readCustomWeightInputs(document, ["addClassWW", "addClassPT", "addClassQA"]);
        if (!weights) {
          showSaveToast("Custom grading weights must be zero or greater and add up to exactly 100% (WW + PT + QA).", "error");
          return;
        }
      } else {
        weights = matchSubjectWeights(subject);
      }
      const isSHS = String(level).includes("11") || String(level).includes("12");
      const group = isSHS ? "SHS" : "JHS";
      
      const newId = "class-" + Date.now();
      const newClass = { id: newId, group, level, subject, section: sectionName, weights, theme, accent: theme, rosterSize: 50, archived: false };
      
      activeRegistry().push(newClass);
      activeSections()[newId] = { periods: [initialPeriod(newClass, state.calendarMode)] };
      activeGroup = group;
      activeSectionId = newId;
      archiveFilter = "active";
      markStateDirty();
      render();
      setStatus(`New class "${subject}" created with ${weights.join("/")}% weights distribution.`);
      document.querySelector(".modal-backdrop")?.remove();
    }

    if (action === "open-edit-section") renderEditSection(target.dataset.section);
    if (action === "close-modal") document.querySelector(".modal-backdrop")?.remove();
    if (action === "save-section-edit") {
      const section = activeRegistry().find(s => s.id === target.dataset.section);
      if (section) {
        section.level = document.querySelector("#editSectionLevel").value.trim();
        const presetSelect = document.querySelector("#editSectionSubjectPreset");
        const isCustomSubject = presetSelect ? presetSelect.value === "custom" : false;
        let subject = presetSelect ? presetSelect.value : section.subject;
        if (subject === "custom") {
          const customInput = document.querySelector("#editSectionCustomSubject");
          subject = (customInput && customInput.value.trim()) || section.subject;
        }
        if (isCustomSubject) {
          const customWeights = readCustomWeightInputs(document, ["editSectionWW", "editSectionPT", "editSectionQA"]);
          if (!customWeights) {
            showSaveToast("Custom grading weights must be zero or greater and add up to exactly 100% (WW + PT + QA).", "error");
            return;
          }
          section.subject = subject;
          section.weights = customWeights;
        } else {
          section.subject = subject;
          section.weights = matchSubjectWeights(subject);
        }
        section.section = document.querySelector("#editSectionSection").value.trim();
        const theme = document.querySelector("#editSectionTheme").value;
        section.theme = theme;
        section.accent = theme;
        
        const isSHS = String(section.level).includes("11") || String(section.level).includes("12");
        section.group = isSHS ? "SHS" : "JHS";
        
        markStateDirty();
        render();
        setStatus(`Section "${section.subject}" updated. Grading weights: ${section.weights.join("/")}%.`);
      }
      document.querySelector(".modal-backdrop")?.remove();
    }

    if (action === "logout") showLogoutModal();
    if (action === "confirm-logout") {
      if (pendingAutoSaveChanges || isSaving || !isDataLoaded || isStale || !isSyncConfigured()) { refreshLogoutModal(); return; }
      performLogout();
    }
    if (action === "logout-without-save") performLogout();
    if (action === "save-then-logout") {
      const logoutModal = document.querySelector("#logoutModal");
      target.disabled = true;
      target.textContent = "Saving to cloud…";
      saveToFirebase().then(saved => {
        if (document.querySelector("#logoutModal") !== logoutModal) return;
        if (saved && pendingAutoSaveChanges === 0 && !isSaving && !isStale) performLogout();
        else refreshLogoutModal();
      });
    }
    if (action === "go-home") { currentView = "home"; render(); }
    if (action === "go-records") { currentView = "chooser"; render(); }
    if (action === "select-calendar-mode") {
      const mode = target.dataset.mode;
      if (mode === state.calendarMode || (mode !== "legacy" && mode !== "trimester")) return;
      if (mode === "trimester" && !state.trimesterModeSeen && !state.registryTri.length) renderTrimesterConfirmation();
      else applyCalendarMode(mode);
      return;
    }
    if (action === "confirm-calendar-mode") { applyCalendarMode("trimester"); return; }
    if (action === "select-group") { 
      activeGroup = target.dataset.group; 
      const firstInGroup = activeRegistry().find((section) => section.group === activeGroup && !section.archived) || activeRegistry().find((section) => section.group === activeGroup) || activeRegistry()[0];
      activeSectionId = firstInGroup ? firstInGroup.id : ""; 
      activePeriodIndex = 0; 
      currentView = "chooser"; 
      render(); 
    }
    if (action === "select-section") { activeSectionId = target.dataset.section; activeGroup = currentSection().group; activePeriodIndex = 0; currentView = "record"; render(); }
    if (action === "select-period") { activePeriodIndex = Number(target.dataset.period); render(); }
    if (action === "add-period") addPeriod();
    if (action === "save-changes") saveToFirebase();
    if (action === "open-settings") renderSettings();
    if (action === "take-remote-version") takeRemoteOverLocal();
    if (action === "keep-local-version") keepLocalOverRemote();
    if (action === "restore-version") restoreVersion(Number(target.dataset.versionIndex));
    if (action === "choose-photo") choosePhoto();
    if (action === "search-student") searchStudent();
    if (action === "export-student-png") exportStudentReportPng(target);
  });

  // Keydown shortcuts
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      const openPanels = document.querySelectorAll(".subject-picker[open],.sheet-help[open],.column-options[open],.period-settings[open],.roster-options[open]");
      openPanels.forEach(panel => { if (panel.contains(document.activeElement)) panel.querySelector("summary")?.focus({ preventScroll: true }); panel.removeAttribute("open"); });
      const registrationModal = document.querySelector(".regcode-modal-backdrop");
      const standardModal = document.querySelector(".modal-backdrop");
      if (registrationModal || standardModal) {
        event.preventDefault();
        (registrationModal || standardModal).remove();
        return;
      }
    }
    if (event.key === "Enter") {
      if (event.target && event.target.id === "studentSearch") {
        event.preventDefault();
        searchStudent();
        return;
      }
      // Note: login-screen fields no longer need special-casing here — they're
      // all inside real <form> elements now, so Enter already triggers the
      // native submit event, which the document "submit" listener handles.

      // Pressing Enter right after typing into a multi-cell selection's
      // anchor cell commits the bulk fill immediately, without needing to
      // click away or Tab out first.
      if (fillArmed && event.target && isMultiSelectAnchor(event.target)) {
        event.preventDefault();
        commitPendingBulkFill();
      }
    }
  });

  // Identifies which logical cell/field a text input belongs to, so repeated
  // keystrokes (typing, backspacing, clearing) on the SAME cell are grouped
  // into one logical change instead of one per keystroke.
  function getFieldKeyForInput(input) {
    if (input.dataset.nameRow !== undefined) return `name:${activeSectionId}:${activePeriodIndex}:${input.dataset.nameRow}`;
    if (input.dataset.teacher !== undefined) return `teacher:${input.dataset.teacher}`;
    if (input.dataset.periodName !== undefined) return `periodName:${activeSectionId}:${activePeriodIndex}`;
    if (input.dataset.date) return `date:${activeSectionId}:${activePeriodIndex}:${input.dataset.date}:${input.dataset.index}`;
    if (input.dataset.activityField) return `activity:${activeSectionId}:${activePeriodIndex}:${input.dataset.activityKind}:${input.dataset.activityIndex}:${input.dataset.activityField}`;
    if (input.dataset.score) return `score:${activeSectionId}:${activePeriodIndex}:${input.dataset.score}:${input.dataset.row}:${input.dataset.index}`;
    if (input.dataset.hps) return `hps:${activeSectionId}:${activePeriodIndex}:${input.dataset.hps}:${input.dataset.index}`;
    return null;
  }

  function sizeSheetWorkspace() {
    const wrap = document.querySelector(".table-wrap");
    if (!wrap || wrap.hidden) return;
    // Desktop uses a viewport-height flex workspace; DOM edits cannot collapse it.
    if (window.innerWidth >= 1000) wrap.style.removeProperty("height");
    else wrap.style.height = Math.max(340, window.innerHeight - (wrap.getBoundingClientRect().top + window.scrollY) - 18) + "px";
  }
  // Enter narrow layouts with navigation retracted, keeping the sheet visible.
  matchMedia("(max-width: 760px)").addEventListener("change", event => {
    if (!event.matches || sidebarCollapsed) return;
    sidebarCollapsed = true;
    document.querySelector(".app-layout")?.classList.add("sidebar-collapsed");
    const toggle = document.querySelector('[data-action="toggle-sidebar"]');
    toggle?.setAttribute("aria-expanded", "false");
    toggle?.setAttribute("aria-label", "Expand navigation");
    sizeSheetWorkspace();
  });
  window.addEventListener("resize", sizeSheetWorkspace, { passive: true });
  window.addEventListener("resize", fitSectionName, { passive: true });
  function commitHpsField(input) {
    if (!input?.dataset?.hps || !hpsEdits.has(input)) return;
    const previous = hpsEdits.get(input);
    hpsEdits.delete(input);
    const period = currentPeriod();
    if (!period || period.locked) return;
    const result = adjustRecordHps(period, input.dataset.hps, Number(input.dataset.index), previous, input.value);
    document.querySelectorAll(`input[data-score="${input.dataset.hps}"][data-index="${input.dataset.index}"]`).forEach(cell => {
      cell.value = period.roster[Number(cell.dataset.row)][input.dataset.hps][Number(input.dataset.index)];
    });
    updateAllSummaries();
    refreshEditableStudentReport();
    markFieldEditDirty(getFieldKeyForInput(input));
    if (result.capped || result.restored) showSaveToast(`${result.capped} score(s) capped; ${result.restored} restored. Original scores retained unless explicitly edited.`, "info");
  }
  app.addEventListener("focusin", event => {
    const input = event.target;
    if (input.dataset?.hps) hpsEdits.set(input, currentPeriod()[input.dataset.hps + "Hps"][Number(input.dataset.index)]);
  });
  app.addEventListener("change", event => commitHpsField(event.target));
  app.addEventListener("change", event => {
    if (event.target.matches('[data-entry-view]')) {
      sheetEntryView = event.target.value === 'one' ? 'one' : 'sheet';
      render();
    }
    if (event.target.matches('[data-entry-row]')) {
      activeOneLearnerRowIndex = Number(event.target.value);
      render();
    }
    if (event.target.matches('.editable-student-report [data-name-row]')) render();
  });
  document.addEventListener("click", event => {
    document.querySelectorAll(".subject-picker[open],.sheet-help[open],.column-options[open],.period-settings[open],.roster-options[open]").forEach(node => {
      if (!node.contains(event.target)) node.removeAttribute("open");
    });
  });

  // Real-time input handling
  app.addEventListener("input", (event) => {
    const input = event.target;
    let stateChanged = false;
    if (input.dataset.nameRow !== undefined) { 
      const rowIndex = Number(input.dataset.nameRow);
      const learner = currentPeriod().roster[rowIndex];
      learner.name = input.value;
      stateChanged = true;
      const cat = getLearnerCategory(learner.name);
      if (cat) {
        learner.hpsOriginals = {};
        learner.ww.fill("");
        learner.pt.fill("");
        learner.qa.fill("");
        render();
      } else {
        const rowEl = document.querySelector(`[data-learner-row="${rowIndex}"]`);
        if (rowEl && rowEl.classList.contains("row-category")) {
          render();
        } else {
          updateLiveSummary(rowIndex);
          updateAllNumberingAndCounts();
        }
      }
      adjustNameColumnWidth();
    }
    if (input.dataset.teacher !== undefined) { state.teacher[input.dataset.teacher] = input.value; stateChanged = true; }
    if (input.dataset.periodName !== undefined) { currentPeriod().name = input.value; stateChanged = true; }
    if (input.dataset.date) {
      currentPeriod()[`${input.dataset.date}Dates`][Number(input.dataset.index)] = input.value;
      document.querySelectorAll(`[data-date="${input.dataset.date}"][data-index="${input.dataset.index}"]`).forEach(peer => { if (peer !== input) peer.value = input.value; });
      stateChanged = true;
    }
    if (input.dataset.activityField) {
      currentPeriod().activityMeta[input.dataset.activityKind][Number(input.dataset.activityIndex)][input.dataset.activityField] = input.value;
      document.querySelectorAll(`textarea[data-activity-kind="${input.dataset.activityKind}"][data-activity-index="${input.dataset.activityIndex}"][data-activity-field="${input.dataset.activityField}"]`).forEach(peer => {
        if (peer !== input) peer.value = input.value;
        sizeActivityTextarea(peer);
      });
      stateChanged = true;
    }
    if (input.dataset.score) {
      const kind = input.dataset.score; const row = Number(input.dataset.row); const index = Number(input.dataset.index);
      const sanitized = sanitizeScoreValue(input.value);
      if (sanitized !== input.value) input.value = sanitized;
      window.CSTRRecordTools.setScore(currentPeriod().roster[row], kind, index, sanitized); updateLiveSummary(row);
      if (input.closest('.editable-student-report')) {
        const hps = currentPeriod()[kind + 'Hps'][index];
        const bad = hasRawAboveHps(sanitized, hps) || (sanitized !== '' && !isAttendanceCode(sanitized) && (!Number.isFinite(Number(sanitized)) || Number(sanitized) < 0));
        input.classList.toggle('invalid', bad);
        input.setAttribute('aria-invalid', String(bad));
      }
      refreshEditableStudentReport(); stateChanged = true;
    }
    if (input.dataset.hps) {
      if (!hpsEdits.has(input)) hpsEdits.set(input, currentPeriod()[input.dataset.hps + "Hps"][Number(input.dataset.index)]);
      currentPeriod()[input.dataset.hps + "Hps"][Number(input.dataset.index)] = input.value;
      document.querySelectorAll(`[data-hps="${input.dataset.hps}"][data-index="${input.dataset.index}"]`).forEach(peer => { if (peer !== input) peer.value = input.value; });
      input.classList.toggle("invalid", input.value !== "" && (!Number.isFinite(Number(input.value)) || Number(input.value) <= 0));
      input.setAttribute("aria-invalid", String(input.classList.contains("invalid")));
      updateAllSummaries(); refreshEditableStudentReport(); stateChanged = true;
    }
    if (stateChanged) {
      const fieldKey = getFieldKeyForInput(input);
      if (fieldKey) markFieldEditDirty(fieldKey); else markStateDirty();
      // A real edit landed on the cell a multi-cell selection was dragged
      // from — arm the bulk fill so the rest of the selected row/column/
      // block picks up this same value once the edit is committed.
      if (isMultiSelectAnchor(input)) fillArmed = true;
    }
  });

  // Leaving a field (click elsewhere, Tab, etc.) closes its logical-edit
  // grouping right away, instead of waiting for the idle timeout, and — if
  // a multi-cell selection is waiting on a typed fill value — commits that
  // bulk fill now.
  app.addEventListener("focusout", (event) => {
    commitHpsField(event.target);
    commitActiveFieldEdit();
    commitPendingBulkFill();
  });

  // Change events (such as interactive subject switcher in class sheet)
  app.addEventListener("change", (event) => {
    if (event.target.id === "photoInput") handlePhoto(event.target.files[0]);
    if (event.target.dataset.teacher !== undefined) { state.teacher[event.target.dataset.teacher] = event.target.value; markStateDirty(); }
    
    if (event.target.dataset.action === "change-sheet-subject") {
      const section = currentSection();
      const val = event.target.value;
      if (val === "custom") {
        renderEditSection(section.id);
        return;
      }
      section.subject = val;
      section.weights = matchSubjectWeights(val);
      markStateDirty();
      render();
      setStatus(`Class subject changed to ${val}. Weights updated to ${section.weights.join("/")}%.`);
    }
  });

  function applyBulkPaste(startRow, startCol, text) {
    const section = currentSection();
    const period = currentPeriod();
    if (period && period.locked) { setStatus("This grading period is locked and can't be edited.", "error"); return; }
    if (!Number.isFinite(startRow) || startCol === null) return;

    const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    while (lines.length && lines[lines.length - 1] === "") lines.pop();
    if (!lines.length) return;

    let rowsFilled = 0;
    let truncated = false;

    const wwLen = period.wwDates.length;
    const ptLen = period.ptDates.length;
    const qaLen = period.qaDates.length;
    const totalCols = 1 + wwLen + ptLen + qaLen;

    lines.forEach((line, lineOffset) => {
      const rowIndex = startRow + lineOffset;
      if (rowIndex >= period.roster.length) { truncated = true; return; }
      const learner = period.roster[rowIndex];
      const cells = line.split("\t");
      cells.forEach((cellValue, cellOffset) => {
        const column = startCol + cellOffset;
        if (column >= totalCols) { truncated = true; return; }
        const value = cellValue.trim();
        if (column === 0) { learner.name = value; return; }
        if (column <= wwLen) { window.CSTRRecordTools.setScore(learner, "ww", column - 1, sanitizeScoreValue(value)); return; }
        if (column <= wwLen + ptLen) { window.CSTRRecordTools.setScore(learner, "pt", column - 1 - wwLen, sanitizeScoreValue(value)); return; }
        window.CSTRRecordTools.setScore(learner, "qa", column - 1 - wwLen - ptLen, sanitizeScoreValue(value));
      });
      rowsFilled += 1;
    });

    period.roster.forEach((l) => {
      if (getLearnerCategory(l.name)) {
        l.hpsOriginals = {};
        l.ww.fill("");
        l.pt.fill("");
        l.qa.fill("");
      }
    });

    clearSelection();
    markStateDirty();
    render();
    const overflowNote = truncated ? " Some pasted data went past the roster size or the last QA column and was left out." : "";
    setStatus(`Bulk paste filled ${rowsFilled} row${rowsFilled === 1 ? "" : "s"}.${overflowNote}`);
  }

  app.addEventListener("paste", (event) => {
    const target = event.target;
    const isPasteable = target && target.dataset && (target.dataset.nameRow !== undefined || target.dataset.score !== undefined);
    if (!isPasteable && !selectionState.active) return;
    const text = (event.clipboardData || window.clipboardData).getData("text");
    if (!text || !/[\t\n\r]/.test(text)) return;
    event.preventDefault();

    const bounds = getSelectionBounds();
    if (bounds) {
      applyBulkPaste(bounds.minRow, bounds.minCol, text);
    } else {
      const coords = getCellCoords(target);
      if (coords) applyBulkPaste(coords.row, coords.col, text);
    }
  });

  function startSaveIndicatorTicker() {
    if (saveIndicatorTicker) return;
    // Refreshes the relative "X minutes ago" wording even when nothing new is edited.
    saveIndicatorTicker = setInterval(updateSaveIndicators, 30 * 1000);
  }

  function initApp() {
    sessionStorage.removeItem("cstr-class-record-login");
    render();
    if (window.CSTRSync && window.CSTRSync.onAuthStateChanged) {
      window.CSTRSync.onAuthStateChanged(async (firebaseUser) => {
        if (firebaseUser) {
          if (isLinkingLegacyInProgress) return;
          try {
            const approved = await window.CSTRRegistration.isApproved(firebaseUser);
            if (!approved) {
              sessionStorage.removeItem("cstr-class-record-login");
              render();
              return;
            }
            const profile = await window.CSTRSync.getUserProfile(firebaseUser.uid);
            if (profile && profile.dataKey) {
              sessionStorage.setItem("cstr-class-record-login", "true");
              sessionStorage.setItem("cstr-class-record-user", profile.dataKey);
              sessionStorage.setItem("cstr-class-record-email", firebaseUser.email || "");
              sessionStorage.setItem("cstr-class-record-name", profile.name || firebaseUser.displayName || "");
              // Only start the sync if it's not already in progress.
              // performGoogleLogin() may have already called subscribeToSync() a moment ago,
              // so we guard here to avoid kicking off a second redundant subscription.
              if (!isDataLoaded && !isLoading) {
                render();
                subscribeToSync();
              }
            } else if (sessionStorage.getItem("cstr-class-record-login") !== "true") {
              // Don't show onboarding modal if we're in the middle of an email
              // sign-up or legacy claim — performEmailSignUp()/performLegacyClaim()
              // set this flag first, since onAuthStateChanged can fire before
              // their own profile write finishes.
              if (!isLinkingLegacyInProgress) {
                showOnboardingModal(firebaseUser);
              }
            }
          } catch (err) {
            console.error("Auth state restore error:", err);
          }
        } else {
          if (unsubscribeSync) { unsubscribeSync(); unsubscribeSync = null; }
          ++loadRequestId; isDataLoaded = false; isLoading = false;
          if (autoSaveTimer) { clearTimeout(autoSaveTimer); autoSaveTimer = null; }
          if (autoSaveMaxWaitTimer) { clearTimeout(autoSaveMaxWaitTimer); autoSaveMaxWaitTimer = null; }
          state = createInitialState(); pendingAutoSaveChanges = 0;
          if (sessionStorage.getItem("cstr-class-record-login") === "true") {
            sessionStorage.removeItem("cstr-class-record-login");
            sessionStorage.removeItem("cstr-class-record-user");
            sessionStorage.removeItem("cstr-class-record-email");
            sessionStorage.removeItem("cstr-class-record-name");
            render();
          }
        }
      });
    } else if (sessionStorage.getItem("cstr-class-record-login") === "true") {
      subscribeToSync();
      startSaveIndicatorTicker();
    }
  }


  document.addEventListener("click", async event => {
    const action = event.target.closest("[data-review-action]")?.dataset.reviewAction;
    if (!action) return;
    try {
      if (action === "backup" || action === "backup-cloud") {
        await CSTRBackup.download(action === "backup-cloud" ? pendingRemoteState : cloneState(state));
      } else if (action === "import") {
        if (!isDataLoaded || isStale || isSaving) throw new Error("Connect and resolve pending saves or conflicts before importing.");
        const imported = await CSTRBackup.importFile();
        if (!imported || !confirm("Replace this workspace with the selected backup? Its grades and learners will replace the current record and autosave. Download a backup of the current workspace first.")) return;
        pushVersionSnapshot(cloneState(state)); state = normalizeState(imported); markStateDirty(); render();
      } else if (action === "clear" && confirm("Clear recovery drafts and checkpoints for this account on this browser? Cloud records and downloaded backups remain available.")) {
        for (const key of [localDraftKey(), versionHistoryKey()]) { sessionStorage.removeItem(key); localStorage.removeItem(key); }
        document.querySelector(".settings-modal")?.parentElement.remove(); renderSettings();
      }
    } catch (error) { alert(error.message); }
  });

  initApp();
})();


