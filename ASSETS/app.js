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

  let currentView = "home";
  let activeGroup = "JHS";
  let activeSectionId = DEFAULT_REGISTRY[0]?.id || "";
  let activePeriodIndex = 0;
  let archiveFilter = "active"; // "active" | "archived"
  let state = createInitialState();

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
    return wrap ? wrap.scrollLeft : null;
  }

  function restoreTableScroll(scrollLeft) {
    if (scrollLeft === null) return;
    requestAnimationFrame(() => {
      const wrap = document.querySelector(".table-wrap");
      if (wrap) wrap.scrollLeft = scrollLeft;
    });
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
      localStorage.setItem(localDraftKey(), JSON.stringify({ savedAt: new Date().toISOString(), state }));
    } catch (error) {
      // Cloud saves remain available even if the browser has no space for a recovery copy.
    }
  }

  function restoreLocalDraft() {
    try {
      const saved = JSON.parse(localStorage.getItem(localDraftKey()) || "null");
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
      const raw = JSON.parse(localStorage.getItem(versionHistoryKey()) || "[]");
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
      localStorage.setItem(versionHistoryKey(), JSON.stringify(history));
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
    const changeLabel = pendingAutoSaveChanges === 0
      ? "All changes saved"
      : `${pendingAutoSaveChanges} unsaved change${pendingAutoSaveChanges === 1 ? "" : "s"}`;
    meta.textContent = `${changeLabel} • ${formatSavedAt(lastSavedAt)}`;
    meta.classList.toggle("has-unsaved", pendingAutoSaveChanges > 0);
  }

  function emptyRoster(size, wwLen = 10, ptLen = 8, qaLen = 3) {
    return Array.from({ length: size }, () => ({ name: "", ww: Array(wwLen).fill(""), pt: Array(ptLen).fill(""), qa: Array(qaLen).fill("") }));
  }

  function initialPeriod(section) {
    return {
      name: section.group === "JHS" ? "1st Grading" : "1st Quarter, 1st Semester",
      wwDates: Array(10).fill(""),
      ptDates: Array(8).fill(""),
      qaDates: Array(3).fill(""),
      wwHps: Array(10).fill(""),
      ptHps: Array(8).fill(""),
      qaHps: Array(3).fill(""),
      roster: emptyRoster(section.rosterSize || 50, 10, 8, 3)
    };
  }

  function createInitialState() {
    return {
      version: 2,
      photo: "",
      teacher: {
        name: "Juan Dela Cruz",
        age: "25",
        specialization: "Science and Research",
        level: "Secondary",
        bio: "Full-time faculty member and research adviser."
      },
      registry: JSON.parse(JSON.stringify(DEFAULT_REGISTRY)),
      sections: Object.fromEntries(DEFAULT_REGISTRY.map((section) => [section.id, { periods: [initialPeriod(section)] }]))
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

  function normalizeState(saved) {
    const base = createInitialState();
    if (!saved || typeof saved !== "object") return base;
    base.photo = typeof saved.photo === "string" ? saved.photo : "";
    base.teacher = saved.teacher && typeof saved.teacher === "object" ? saved.teacher : base.teacher;
    
    if (Array.isArray(saved.registry) && saved.registry.length > 0) {
      base.registry = JSON.parse(JSON.stringify(saved.registry));
    }
    base.registry.forEach(ensureSectionField);

    base.registry.forEach((section) => {
      const loaded = saved.sections && saved.sections[section.id];
      if (!base.sections[section.id]) base.sections[section.id] = { periods: [] };

      if (!loaded || !Array.isArray(loaded.periods) || !loaded.periods.length) {
        base.sections[section.id].periods = [initialPeriod(section)];
        return;
      }

      base.sections[section.id].periods = loaded.periods.map((period) => {
        const wwLen = Array.isArray(period.wwDates) ? period.wwDates.length : 10;
        const ptLen = Array.isArray(period.ptDates) ? period.ptDates.length : 8;
        const qaLen = Array.isArray(period.qaDates) ? period.qaDates.length : 3;

        return {
          name: typeof period.name === "string" && period.name.trim() ? period.name : initialPeriod(section).name,
          wwDates: fitArray(period.wwDates, wwLen),
          ptDates: fitArray(period.ptDates, ptLen),
          qaDates: fitArray(period.qaDates, qaLen),
          wwHps: fitArray(period.wwHps, wwLen),
          ptHps: fitArray(period.ptHps, ptLen),
          qaHps: fitArray(period.qaHps, qaLen),
          roster: Array.from({ length: section.rosterSize || 50 }, (_, index) => {
            const learner = Array.isArray(period.roster) ? period.roster[index] : null;
            return {
              name: learner && typeof learner.name === "string" ? learner.name : "",
              ww: fitArray(learner && learner.ww, wwLen),
              pt: fitArray(learner && learner.pt, ptLen),
              qa: fitArray(learner && learner.qa, qaLen)
            };
          })
        };
      });
    });
    return base;
  }

  function fitArray(values, length) {
    return Array.from({ length }, (_, index) => Array.isArray(values) && values[index] !== undefined ? values[index] : "");
  }

  function currentSection() { return state.registry.find((section) => section.id === activeSectionId) || state.registry[0]; }

  // Resolves through currentSection()'s own fallback rather than indexing
  // state.sections[activeSectionId] directly, and never throws. Whenever the
  // whole `state` object gets swapped out (loading from GitHub, restoring a
  // version, restoring a local draft) activeSectionId can briefly point at a
  // section that no longer exists in the new data — this must degrade to
  // "no current period" instead of crashing every render() in between.
  function currentPeriod() {
    const section = currentSection();
    const bucket = section && state.sections[section.id];
    return bucket && Array.isArray(bucket.periods) ? bucket.periods[activePeriodIndex] : undefined;
  }

  // Call right after anything replaces `state` wholesale (data load, version
  // restore, local draft restore). If activeSectionId no longer matches a
  // section in the new registry, snap it back to a real section (or clear it
  // if there are none) and back out of the "record" view for that vanished
  // section instead of leaving the app pointed at data that doesn't exist.
  function ensureActiveSelectionValid() {
    const stillExists = state.registry.some((section) => section.id === activeSectionId);
    if (stillExists) return;
    const fallback = state.registry[0];
    activeSectionId = fallback ? fallback.id : "";
    activeGroup = fallback ? fallback.group : activeGroup;
    activePeriodIndex = 0;
    if (currentView === "record") currentView = state.registry.length ? "chooser" : "home";
  }
  function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]); }
  function safeValue(value) { return escapeHtml(value === undefined || value === null ? "" : value); }
  function button(label, action, className = "button", extra = "") { return `<button type="button" class="${className}" data-action="${action}" ${extra}>${label}</button>`; }

  function themeColorHex(name) {
    const shades = {
      purple: "#7763a4",
      green: "#3c8a58",
      blue: "#2980b9",
      red: "#c0392b",
      charcoal: "#374151",
      "baby-blue": "#2587be",
      "deep-red": "#87232b",
      black: "#1f2937",
      brown: "#8b4513",
      orange: "#d35400",
      pink: "#d81b60",
      gray: "#546e7a",
      yellow: "#b78103"
    };
    return shades[name] || shades.blue;
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
    if (typeof name !== "string") return null;
    const clean = name.trim().toLowerCase();
    if (clean.includes("boys")) return "boys";
    if (clean.includes("girls")) return "girls";
    return null;
  }

  function sectionNameShade(accent) {
    const shades = {
      purple: ["#eeeafd", "#4c3f7b"],
      green: ["#e7f4eb", "#2f6542"],
      blue: ["#e7f1fb", "#245d88"],
      red: ["#fae9e8", "#823c3c"],
      charcoal: ["#eaedf0", "#344150"],
      "baby-blue": ["#e5f3fa", "#285f7c"],
      "deep-red": ["#f7e7e8", "#792e35"],
      black: ["#ebedef", "#30343a"],
      brown: ["#f5ece5", "#71452e"],
      orange: ["#fff0e1", "#8a4b12"],
      pink: ["#fcebf0", "#88445f"],
      gray: ["#eef1f2", "#4b5961"],
      yellow: ["#fff7d6", "#705911"]
    };
    const [background, color] = shades[accent] || shades.blue;
    return { background, color };
  }

  function computeLearnerNumbering(roster) {
    let count = 0;
    const numbering = roster.map((learner) => {
      const name = (learner.name || "").trim();
      if (!name) return ""; 
      if (getLearnerCategory(name)) return "—"; 
      count += 1;
      return count;
    });
    return { numbering, totalLearners: count };
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
    let maxLen = 14;
    period.roster.forEach((learner) => {
      const len = (learner.name || "").length;
      if (len > maxLen) maxLen = len;
    });
    document.querySelectorAll(".name-cell input").forEach((input) => {
      if (input.value.length > maxLen) maxLen = input.value.length;
    });
    const newWidth = Math.max(220, Math.ceil(maxLen * 8.8 + 36));
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

  function updateSiteBackground() {
    const bg = document.querySelector("#siteBg");
    if (!bg) return;
    const isLoggedIn = sessionStorage.getItem("cstr-class-record-login") === "true";
    bg.className = isLoggedIn ? "bg-sheets" : "bg-login";
  }

  // Cryptographic registration code verification (salted SHA-256).
  // The secret code is NEVER hardcoded in plaintext in this repository.
  const REGISTRATION_CODE_SALT = "cstr_reg_salt_2026_";
  const REGISTRATION_CODE_HASH = "5bda9bb6cb78722954ba192da3ddf9f3f5a7181b6e2fe034718088f43602ce35";

  function sha256Fallback(ascii) {
    function rightRotate(value, amount) {
      return (value >>> amount) | (value << (32 - amount));
    }
    const mathPow = Math.pow;
    const maxWord = mathPow(2, 32);
    let i, j;
    let result = "";
    const words = [];
    const asciiBitLength = ascii.length * 8;
    let hash = [
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
    ];
    const k = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];
    let composite = ascii + "\x80";
    while (composite.length % 64 - 56) composite += "\x00";
    for (i = 0; i < composite.length; i++) {
      j = composite.charCodeAt(i);
      words[i >> 2] |= j << ((3 - i % 4) * 8);
    }
    words[words.length] = ((asciiBitLength / maxWord) | 0);
    words[words.length] = (asciiBitLength | 0);
    for (j = 0; j < words.length;) {
      const w = words.slice(j, j += 16);
      const oldHash = hash.slice(0);
      for (i = 0; i < 64; i++) {
        const w15 = w[i - 15], w2 = w[i - 2];
        const s0 = rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3);
        const s1 = rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10);
        w[i] = (i < 16) ? w[i] : (w[i - 16] + s0 + w[i - 7] + s1) | 0;
        const s1_ = rightRotate(hash[4], 6) ^ rightRotate(hash[4], 11) ^ rightRotate(hash[4], 25);
        const ch = (hash[4] & hash[5]) ^ (~hash[4] & hash[6]);
        const temp1 = (hash[7] + s1_ + ch + k[i] + w[i]) | 0;
        const s0_ = rightRotate(hash[0], 2) ^ rightRotate(hash[0], 13) ^ rightRotate(hash[0], 22);
        const maj = (hash[0] & hash[1]) ^ (hash[0] & hash[2]) ^ (hash[1] & hash[2]);
        const temp2 = (s0_ + maj) | 0;
        hash = [(temp1 + temp2) | 0, hash[0], hash[1], hash[2], (hash[3] + temp1) | 0, hash[4], hash[5], hash[6]];
      }
      for (i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
    }
    for (i = 0; i < 8; i++) {
      for (let b = 3; b >= 0; b--) {
        const byte = (hash[i] >> (b * 8)) & 255;
        result += (byte < 16 ? "0" : "") + byte.toString(16);
      }
    }
    return result;
  }

  async function computeSha256Hex(str) {
    try {
      if (window.crypto && window.crypto.subtle && window.crypto.subtle.digest) {
        const encoder = new TextEncoder();
        const data = encoder.encode(str);
        const hashBuffer = await window.crypto.subtle.digest("SHA-256", data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
      }
    } catch (e) {
      console.warn("SubtleCrypto unavailable or restricted, using fallback", e);
    }
    return sha256Fallback(str);
  }

  async function verifySecretRegistrationCode(inputCode) {
    const trimmed = String(inputCode || "").trim();
    if (!trimmed) return false;
    const computed = await computeSha256Hex(REGISTRATION_CODE_SALT + trimmed);
    return computed === REGISTRATION_CODE_HASH;
  }

  function isRegistrationAuthorized() {
    return sessionStorage.getItem("cstr_reg_auth") === "true";
  }

  function showRegistrationCodeModal(onAuthorized) {
    document.querySelector(".regcode-modal-backdrop")?.remove();
    const backdrop = document.createElement("div");
    backdrop.className = "regcode-modal-backdrop";
    backdrop.id = "regCodeBackdrop";
    backdrop.innerHTML = `<div class="regcode-modal" role="dialog" aria-modal="true" aria-labelledby="regCodeTitle">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px;">
        <div>
          <span class="regcode-badge">🛡️ Official Account Registration Gateway</span>
          <h2 id="regCodeTitle">Input Secret Code for Official Account Registration</h2>
        </div>
        <button type="button" class="button" data-action="close-regcode-modal" style="min-height: 32px; padding: 4px 10px; border-radius: 6px;" title="Close">✕</button>
      </div>
      
      <div class="regcode-formal-box">
        <strong>Official Authorization Notice:</strong><br>
        To register a new official CSTR Class Record account, an authorized registration code is strictly required. You must possess the authorized code if you are the system developer, or if you have been officially granted access and settled the one-time account registration fee directly with the system developer, <strong>Sir Johnmil Sanchez</strong>.
      </div>

      <form id="regCodeForm">
        <label class="field-label" style="text-align: left; margin: 10px 0 6px;">
          Secret Admin Registration Code
          <div class="regcode-input-wrap" style="margin-top: 6px;">
            <input id="regSecretCodeInput" type="password" autocomplete="off" placeholder="Enter registration secret code..." required autofocus>
            <button type="button" class="regcode-toggle-pw" data-action="toggle-regcode-pw" title="Toggle visibility" aria-label="Toggle code visibility">👁️</button>
          </div>
        </label>

        <div class="regcode-actions">
          <button type="submit" class="button button-primary" data-action="submit-regcode">🔐 Verify Code &amp; Proceed to Registration</button>
          <button type="button" class="button button-outline" data-action="close-regcode-modal">← Cancel &amp; Back to Sign In</button>
        </div>
      </form>

      <p id="regCodeError" class="login-error" role="alert" style="margin-top: 12px;"></p>
    </div>`;

    document.body.appendChild(backdrop);
    const input = backdrop.querySelector("#regSecretCodeInput");
    if (input) input.focus();

    const form = backdrop.querySelector("#regCodeForm");
    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const codeVal = input ? input.value : "";
        const errEl = backdrop.querySelector("#regCodeError");
        if (errEl) { errEl.textContent = ""; errEl.classList.remove("error"); }

        const submitBtn = backdrop.querySelector('button[data-action="submit-regcode"]');
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Verifying authorization..."; }

        try {
          const isValid = await verifySecretRegistrationCode(codeVal);
          if (isValid) {
            sessionStorage.setItem("cstr_reg_auth", "true");
            backdrop.remove();
            if (typeof onAuthorized === "function") {
              onAuthorized();
            } else {
              showSignUpPanel();
            }
          } else {
            if (errEl) {
              errEl.textContent = "Invalid registration secret code. Please verify the code or contact developer Sir Johnmil Sanchez (sanchezramil2202@gmail.com) for official registration authorization.";
              errEl.classList.add("error");
            }
            if (input) {
              input.select();
              input.focus();
            }
          }
        } catch (verifyErr) {
          if (errEl) {
            errEl.textContent = "Verification encountered an error. Please try again.";
            errEl.classList.add("error");
          }
        } finally {
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "🔐 Verify Code & Proceed to Registration"; }
        }
      });
    }

    const toggleBtn = backdrop.querySelector('button[data-action="toggle-regcode-pw"]');
    if (toggleBtn && input) {
      toggleBtn.addEventListener("click", () => {
        if (input.type === "password") {
          input.type = "text";
          toggleBtn.textContent = "🙈";
        } else {
          input.type = "password";
          toggleBtn.textContent = "👁️";
        }
      });
    }

    const closeBtns = backdrop.querySelectorAll('button[data-action="close-regcode-modal"]');
    closeBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        backdrop.remove();
      });
    });
  }

  function render() {
    updateSiteBackground();
    ensureActiveSelectionValid();
    const scrollLeft = currentView === "record" ? rememberTableScroll() : null;
    app.innerHTML = sessionStorage.getItem("cstr-class-record-login") === "true" ? renderApp() : renderLogin();
    if (sessionStorage.getItem("cstr-class-record-login") === "true") {
      syncSaveControl();
      updateSaveIndicators();
      adjustNameColumnWidth();
      updateAllNumberingAndCounts();
      updateHeaderScroll();
    }
    restoreTableScroll(scrollLeft);
  }

  function renderLogin() {
    const titles = { signin: "Teacher Sign In", signup: "Create Your Account", legacy: "Claim Your Legacy Account" };
    const panelBody = loginPanel === "signup" ? renderSignUpPanel()
      : loginPanel === "legacy" ? renderLegacyClaimPanel()
      : renderSignInPanel();

    return `<section class="login-screen">
      <div class="login-card">
        <div class="login-header-logo">
          <img src="ASSETS/cstr-logo.png" alt="Colegio de Sto. Tomás – Recoletos crest" class="login-logo-img">
        </div>
        <p class="eyebrow">Colegio de Sto. Tomás – Recoletos</p>
        <h1>${titles[loginPanel]}</h1>
        <p class="muted">Website for Class Record, with respect to DepEd Order No. 15, s. 2026.</p>

        ${panelBody}

        <p id="loginError" class="login-error" role="alert"></p>
        <p id="loginSuccess" class="login-success" role="status" style="display: none;"></p>
      </div>
    </section>`;
  }

  function renderSignInPanel() {
    return `<form id="signinForm" class="legacy-login-box">
        <label class="field-label" style="text-align: left; margin: 10px 0 6px;">Email
          <input id="signinEmail" type="email" autocomplete="username" placeholder="you@example.com">
        </label>
        <label class="field-label" style="text-align: left; margin: 10px 0 6px;">Password
          <input id="signinPassword" type="password" autocomplete="current-password" placeholder="Your password">
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
          <span>Sign in with Google</span>
        </button>
      </div>

      <div class="login-divider"><span>NEW HERE?</span></div>
      <p style="text-align: center;">
        <a href="#" class="legacy-toggle-link" data-action="show-signup">✨ Create a brand-new account</a>
      </p>
      <p style="text-align: center; margin-top: 6px;">
        <a href="#" class="legacy-toggle-link" data-action="show-legacy-claim">🔐 Have an account from before this upgrade? Claim it here</a>
      </p>`;
  }

  function renderSignUpPanel() {
    return `<p class="legacy-helper-text" style="text-align: left;">Enter your details below to create your official CSTR Class Record workspace.</p>
      <form id="signupForm" class="legacy-login-box">
        <label class="field-label" style="text-align: left; margin: 10px 0 6px;">Full Name
          <input id="signupName" type="text" placeholder="e.g. Maria Santos">
        </label>
        <label class="field-label" style="text-align: left; margin: 10px 0 6px;">Email
          <input id="signupEmail" type="email" autocomplete="username" placeholder="you@example.com">
        </label>
        <label class="field-label" style="text-align: left; margin: 10px 0 6px;">Password
          <input id="signupPassword" type="password" autocomplete="new-password" placeholder="At least 6 characters">
        </label>
        <label class="field-label" style="text-align: left; margin: 10px 0 6px;">Confirm Password
          <input id="signupPasswordConfirm" type="password" autocomplete="new-password" placeholder="Re-enter password">
        </label>
        <button type="submit" class="button button-primary" data-action="email-signup" style="width: 100%; margin-top: 6px;">✨ Create My Class Record</button>
      </form>
      <p style="text-align: center; margin-top: 10px;"><a href="#" class="legacy-toggle-link" data-action="show-signin">← Back to Sign In</a></p>`;
  }

  function renderLegacyClaimPanel() {
    return `<p class="legacy-helper-text" style="text-align: left;">Have class records from before this upgrade? Claim them below to set up a normal email + password login.</p>
      <form id="legacyClaimForm" class="legacy-login-box">
        <label class="field-label" style="text-align: left; margin: 10px 0 6px;">Your Email
          <input id="legacyClaimEmail" type="email" autocomplete="username" placeholder="you@example.com">
        </label>
        <label class="field-label" style="text-align: left; margin: 10px 0 6px;">Account Code (becomes your password)
          <input id="legacyClaimCode" type="password" autocomplete="off" placeholder="Enter your account code...">
        </label>
        <button type="submit" class="button button-outline" data-action="legacy-claim" style="width: 100%; margin-top: 6px;">🔐 Claim & Set Up Login</button>
      </form>
      <p style="text-align: center; margin-top: 10px;"><a href="#" class="legacy-toggle-link" data-action="show-signin">← Back to Sign In</a></p>`;
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

  async function performGoogleLogin(prefillAccountCode) {
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

  async function performEmailSignIn() {
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

  async function performEmailSignUp() {
    const nameInput = document.querySelector("#signupName");
    const emailInput = document.querySelector("#signupEmail");
    const passwordInput = document.querySelector("#signupPassword");
    const confirmInput = document.querySelector("#signupPasswordConfirm");
    const name = nameInput ? nameInput.value.trim() : "";
    const email = emailInput ? emailInput.value.trim() : "";
    const password = passwordInput ? passwordInput.value : "";
    const confirmPassword = confirmInput ? confirmInput.value : "";
    const error = document.querySelector("#loginError");
    if (error) { error.textContent = ""; error.classList.remove("error"); }

    if (!name || !email || !password) {
      if (error) { error.textContent = "Please fill in your name, email, and password."; error.classList.add("error"); }
      return;
    }
    if (password.length < 6) {
      if (error) { error.textContent = "Password must be at least 6 characters."; error.classList.add("error"); }
      return;
    }
    if (password !== confirmPassword) {
      if (error) { error.textContent = "Passwords do not match."; error.classList.add("error"); }
      return;
    }

    // Guards against a race with the global onAuthStateChanged listener: it
    // fires as soon as the new account is created, possibly before
    // registerNewTeacher() below finishes writing the profile — without this
    // flag it could briefly show the Google-oriented onboarding modal on top
    // of this native email signup.
    isLinkingLegacyInProgress = true;
    try {
      setStatus("Creating your account...", "saving");
      const user = await window.CSTRSync.signUpWithEmail(email, password);
      const profile = await window.CSTRSync.registerNewTeacher(user, name);
      state = createInitialState();
      state.teacher.name = profile.name;
      completeSignInSession(profile, user);
    } catch (err) {
      console.error("Email sign-up error:", err);
      if (error) {
        if (err.code === "auth/email-already-in-use") {
          error.textContent = "An account with this email already exists. Try signing in instead.";
        } else if (err.code === "auth/weak-password") {
          error.textContent = "Password is too weak — please use at least 6 characters.";
        } else if (err.code === "auth/invalid-email") {
          error.textContent = "Please enter a valid email address.";
        } else {
          error.textContent = friendlyAuthErrorMessage(err, "Account creation failed");
        }
        error.classList.add("error");
      }
    } finally {
      isLinkingLegacyInProgress = false;
    }
  }

  async function performLegacyClaim() {
    const emailInput = document.querySelector("#legacyClaimEmail");
    const codeInput = document.querySelector("#legacyClaimCode");
    const email = emailInput ? emailInput.value.trim() : "";
    const legacyKey = codeInput ? codeInput.value.trim() : "";
    const error = document.querySelector("#loginError");
    const success = document.querySelector("#loginSuccess");
    if (error) { error.textContent = ""; error.classList.remove("error"); }
    if (success) { success.textContent = ""; success.style.display = "none"; }

    if (!email || !legacyKey) {
      if (error) { error.textContent = "Please enter your email and your account code."; error.classList.add("error"); }
      return;
    }
    if (legacyKey.length < 6) {
      if (error) { error.textContent = "That code looks too short to use as a password (Firebase requires 6+ characters). Double-check your exact account code."; error.classList.add("error"); }
      return;
    }

    isLinkingLegacyInProgress = true;
    try {
      setStatus("Setting up your login...", "saving");
      const user = await window.CSTRSync.signUpWithEmail(email, legacyKey);
      const profile = await window.CSTRSync.bindLegacyAccount(legacyKey, user);
      completeSignInSession(profile, user);
      alert(`ACCOUNT CLAIMED:\n\nFrom now on you can sign in with:\nEmail: ${email}\nPassword: your account code\n\nYou can change this password anytime from Settings.`);
    } catch (err) {
      console.error("Legacy claim error:", err);
      // If the auth account got created but the bind step failed (wrong code,
      // already bound elsewhere, etc.), that new auth account is orphaned —
      // remove it so the person can retry with the same email instead of
      // hitting "email already in use".
      const newUser = window.CSTRSync.getCurrentUser();
      if (newUser && (!err.code || !err.code.startsWith("auth/"))) {
        try { await newUser.delete(); } catch (cleanupErr) { console.warn("Cleanup of orphaned auth account failed", cleanupErr); }
      }
      if (error) {
        if (err.code === "auth/email-already-in-use") {
          // This email already has SOME account — almost always because the
          // person (or someone) already used "Sign in with Google" here
          // before ever claiming a legacy code. Firebase won't let us create
          // a second, separate password-only account for the same email, so
          // route them through Google instead: signing in there resolves to
          // that same account, and — since it has no records bound yet —
          // lands them on the onboarding modal, which now also sets this
          // typed code as their password (see completeOnboardLegacyLink).
          error.innerHTML = `This email is already linked to an account — most likely from signing in with Google before. <button type="button" class="button-link" data-action="legacy-continue-google" style="padding:0; background:none; border:none; color:inherit; font:inherit; text-decoration:underline; cursor:pointer;">Continue with Google</button> to link it, or <a href="#" class="legacy-toggle-link" data-action="show-signin">sign in</a> if you already set a password before.`;
        } else if (err.code === "auth/weak-password") {
          error.textContent = "Firebase requires that code/password to be at least 6 characters.";
        } else {
          error.textContent = friendlyAuthErrorMessage(err, "Claim failed");
        }
        error.classList.add("error");
      }
    } finally {
      isLinkingLegacyInProgress = false;
    }
  }

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

  function showOnboardingModal(user, prefillAccountCode) {
    document.querySelector(".modal-backdrop.onboarding-modal")?.remove();
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop onboarding-modal";
    backdrop.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="onboardTitle">
      <h2 id="onboardTitle">Set Up Your Account</h2>
      <p class="muted">Signed in as <strong>${safeValue(user.email || "")}</strong>. Please select your account type:</p>
      
      <div class="onboard-choice-card" style="border: 2px solid var(--blue, #16364a); background: #f0f7fb;">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
          <span style="font-size: 1.2rem;">📂</span>
          <h3 style="margin: 0; color: #16364a;">Existing CSTR Teacher (Link Your Records)</h3>
        </div>
        <p class="muted" style="margin-bottom: 10px; font-size: 0.88rem;"><strong>Safe & Guaranteed:</strong> Enter your previous account code below to connect your existing classes, learners, and grades to this Google Account, and to set that code as your password for normal email sign-in too. <em>None of your data will be changed or deleted.</em></p>
        <label class="field-label" style="text-align: left; margin: 6px 0;">Account Code
          <input id="onboardLegacyCode" type="password" placeholder="Enter your account code..." value="${prefillAccountCode ? safeValue(prefillAccountCode) : ""}">
        </label>
        <button type="button" class="button button-primary" data-action="complete-link-legacy" style="width: 100%; margin-top: 10px;">🔐 Link & Open My Existing Records</button>
      </div>

      <div class="onboard-divider"><span>OR IF YOU ARE BRAND NEW</span></div>

      <div class="onboard-choice-card" style="border: 1px dashed var(--border);">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
          <span style="font-size: 1.2rem;">✨</span>
          <h3 style="margin: 0;">New User Account (Create Fresh Workspace)</h3>
        </div>
        <p class="muted" style="margin-bottom: 10px; font-size: 0.88rem;">Create a fresh, empty workspace for your classes, subjects, and learners.</p>
        <label class="field-label" style="text-align: left; margin: 6px 0;">Teacher Full Name
          <input id="onboardTeacherName" type="text" value="${safeValue(user.displayName || '')}" placeholder="e.g. Maria Santos">
        </label>
        <button type="button" class="button button-outline" data-action="complete-new-teacher" style="width: 100%; margin-top: 10px;">Create Brand-New Class Record</button>
      </div>

      <p style="text-align: center; margin-top: 16px;">
        <a href="#" class="legacy-toggle-link" data-action="onboard-cancel">Wrong Google Account? Sign out and try again</a>
      </p>

      <p id="onboardError" class="login-error" role="alert" style="margin-top: 15px;"></p>
    </div>`;

    document.body.appendChild(backdrop);
  }

  async function completeNewTeacherSignup(user) {
    if (!isRegistrationAuthorized()) {
      showRegistrationCodeModal(() => completeNewTeacherSignup(user));
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

  async function completeOnboardLegacyLink(user) {
    const codeInput = document.querySelector("#onboardLegacyCode");
    const legacyKey = codeInput ? codeInput.value.trim() : "";
    const error = document.querySelector("#onboardError");

    if (!legacyKey) {
      if (error) {
        error.textContent = "Please enter your account code.";
        error.classList.add("error");
      }
      return;
    }
    if (legacyKey.length < 6) {
      if (error) {
        error.textContent = "That code looks too short to use as a password (Firebase requires 6+ characters). Double-check your exact account code.";
        error.classList.add("error");
      }
      return;
    }

    // This account is only signed in with Google so far. Attach the account
    // code as a real password credential too — the missing piece that used
    // to leave people unable to sign in later with email + password — before
    // binding the class-record data itself.
    const alreadyHadPassword = window.CSTRSync.hasPasswordProvider(user);
    let justLinkedPassword = false;
    try {
      if (!alreadyHadPassword) {
        await window.CSTRSync.setInitialPassword(legacyKey);
        justLinkedPassword = true;
      }
      const profile = await window.CSTRSync.bindLegacyAccount(legacyKey, user);
      document.querySelector(".modal-backdrop")?.remove();

      completeSignInSession(profile, user);
      alert(`SECURITY UPGRADE COMPLETE:\n\nYour account has been linked to ${user.email}.\nFrom now on you can also sign in with:\nEmail: ${user.email}\nPassword: your account code\n\nYou can change this password anytime from Settings.\n\nLoading your existing class records...`);
    } catch (err) {
      // If we just attached a password but the bind step failed right after
      // (wrong code, no data found, etc.), undo the password so a bad
      // attempt doesn't leave a stray/incorrect credential on the account.
      if (justLinkedPassword) {
        try { await window.CSTRSync.unlinkPasswordProvider(); } catch (cleanupErr) { console.warn("Cleanup of linked password failed", cleanupErr); }
      }
      if (error) {
        if (err.code === "auth/credential-already-in-use" || err.code === "auth/email-already-in-use") {
          error.textContent = "That code is already used as a password by another account. Please double-check your exact account code.";
        } else {
          error.textContent = friendlyAuthErrorMessage(err, "Linking failed");
        }
        error.classList.add("error");
      }
    }
  }

  function renderApp() {
    const content = currentView === "home" ? renderHome() : currentView === "chooser" ? renderClassRecord() : renderSectionRecord();
    return `<div class="aura-bg"><div class="aura-layer-1" aria-hidden="true"></div><div class="aura-layer-2" aria-hidden="true"></div><div class="aura-content"><header class="app-header"><div class="app-header-inner">
      <div class="app-header-brand">
        <span class="header-logo"><img src="ASSETS/cstr-logo.png" alt="Colegio de Sto. Tomás – Recoletos crest"></span>
        <div><p class="eyebrow">CSTR • San Carlos City, Negros Occidental</p>
        <h1 class="app-title">Colegio de Sto. Tomás – Recoletos, Incorporated</h1>
        <p class="muted">Website for Class Record, with respect to DepEd Order No. 15, s. 2026.</p></div>
      </div>
      <div class="header-actions-wrap">
        <div class="header-actions">
          ${button("💾 Save Changes", "save-changes", "button button-primary", `id="saveChanges"`)} ${button("Settings", "open-settings")} ${button("Log out", "logout")}
        </div>
        <p id="statusMessage" class="save-status" role="status" aria-live="polite"></p>
        <p id="saveMeta" class="save-meta" aria-live="polite"></p>
      </div>
    </div></header>
    <div class="search-bar"><div class="search-bar-inner">
      <div class="header-search" role="search"><label class="sr-only" for="studentSearch">Search student by full name</label><input id="studentSearch" type="search" autocomplete="off" placeholder="Search student's full name"><button type="button" class="button" data-action="search-student">Search</button></div>
    </div></div>
    <div class="app-shell">
      <nav class="tabs" aria-label="Main navigation">
        <button class="tab" type="button" data-action="go-home" aria-selected="${currentView === "home"}">Home</button>
        <button class="tab" type="button" data-action="go-records" aria-selected="${currentView === "chooser" || currentView === "record"}">Class Record</button>
      </nav>${content}</div></div></div>`;
  }

  function renderHome() {
    const portrait = state.photo ? `<img class="profile-photo" src="${state.photo}" alt="Teacher portrait">` : `<span class="silhouette" aria-hidden="true"></span><span class="photo-caption">Upload photo</span>`;
    return `<section class="home-grid"><div><input id="photoInput" type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" hidden>
      <button class="photo-frame" type="button" data-action="choose-photo" aria-label="Upload teacher photo">${portrait}</button></div>
      <div>
        <p class="eyebrow" style="margin: 0 0 10px;">Class record owner</p>
        <div class="teacher-block">
          <label class="teacher-name-field">
            <span class="sr-only">Name</span>
            <input type="text" class="teacher-name-input" data-teacher="name" value="${safeValue(state.teacher.name)}" placeholder="Full name">
          </label>
          <dl class="teacher-meta">
            <div><dt>Age</dt><dd><input type="number" min="0" class="teacher-meta-input" data-teacher="age" value="${safeValue(state.teacher.age)}" placeholder="Age" aria-label="Age"></dd></div>
            <div><dt>Specialization</dt><dd><input type="text" class="teacher-meta-input" data-teacher="specialization" value="${safeValue(state.teacher.specialization)}" placeholder="e.g. Science and Research" aria-label="Specialization"></dd></div>
            <div><dt>School Level</dt><dd>
              <select class="teacher-meta-input" data-teacher="level" aria-label="School level">
                <option value="Elementary" ${state.teacher.level === "Elementary" ? "selected" : ""}>Elementary</option>
                <option value="Secondary" ${state.teacher.level === "Secondary" ? "selected" : ""}>Secondary</option>
              </select>
            </dd></div>
          </dl>
          <label class="teacher-bio-field">
            <span class="sr-only">Bio</span>
            <textarea class="teacher-bio-input" data-teacher="bio" placeholder="Short bio, role description...">${safeValue(state.teacher.bio)}</textarea>
          </label>
          <p class="teacher-edit-hint">Changes save automatically after a brief pause. You can still use <strong>💾 Save Changes</strong> at any time.</p>
        </div>
        <div class="home-cta">${button("Proceed to Class Record →", "go-records", "button button-primary")}</div>
        <p id="photoNote" class="form-note">Photo uploads accept PNG and JPEG files only.</p>
      </div></section>`;
  }

  function renderClassRecord() {
    const edge = (group) => group === "JHS" ? `<span class="level-edge edge-green"></span><span class="level-edge edge-yellow"></span><span class="level-edge edge-red"></span><span class="level-edge edge-blue"></span>` : `<span class="level-edge edge-charcoal"></span><span class="level-edge edge-baby-blue"></span><span class="level-edge edge-deep-red"></span>`;
    const groupCards = ["JHS", "SHS"].map((group) => `<button type="button" class="level-card level-card-${group.toLowerCase()} ${activeGroup === group ? "is-active" : ""}" data-action="select-group" data-group="${group}">${edge(group)}<span class="level-card-kicker">${group}</span><strong>${group === "JHS" ? "Junior High School" : "Senior High School"}</strong><small>Choose a level to view its sections</small></button>`).join("");
    
    const groupSections = state.registry.filter((section) => section.group === activeGroup);
    const activeCount = groupSections.filter((section) => !section.archived).length;
    const archivedCount = groupSections.filter((section) => Boolean(section.archived)).length;
    
    const visibleSections = groupSections.filter((section) => archiveFilter === "archived" ? Boolean(section.archived) : !section.archived);

    const sectionCards = visibleSections.length > 0 ? visibleSections.map((section) => `
      <div class="section-card-wrap">
        <button type="button" class="kebab-btn" data-action="open-edit-section" data-section="${section.id}" aria-label="Edit or Archive Section">⋮</button>
        <button type="button" class="section-card accent-${section.accent || section.theme}" data-action="select-section" data-section="${section.id}">
          <div class="section-card-header">
            <span class="card-level-badge">${escapeHtml(section.level)}</span>
            ${section.archived ? `<span class="card-archived-badge">📦 Archived</span>` : ""}
          </div>
          <strong>${escapeHtml(section.subject)}</strong>
          ${section.section ? `<span class="section-card-section">${escapeHtml(section.section)}</span>` : ""}
          <div class="section-card-weights">
            <span class="weight-pill">WW: ${section.weights[0]}%</span>
            <span class="weight-pill">PT: ${section.weights[1]}%</span>
            <span class="weight-pill">EX: ${section.weights[2]}%</span>
          </div>
          <small>Open grade sheet &rarr;</small>
        </button>
      </div>`).join("") : `<div style="grid-column: 1 / -1; padding: 32px; text-align: center; color: var(--muted); background: #fff; border: 1.5px dashed var(--border); border-radius: 12px;">No ${archiveFilter === "archived" ? "archived" : "active"} ${activeGroup} classes found.</div>`;
      
    return `<section class="record-chooser">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Class Record</p>
          <h2>Select a level and section</h2>
          <p class="muted">Choose a school level first, then open the specific section. Grade sheets stay hidden until a section is selected.</p>
        </div>
        ${button("+ Add Class", "open-add-class", "button button-primary")}
      </div>
      <div class="level-grid" aria-label="School levels">${groupCards}</div>
      
      <div class="archive-toggle-bar">
        <div class="archive-pills">
          <button type="button" class="archive-pill" data-action="set-archive-filter" data-filter="active" aria-selected="${archiveFilter === "active"}">Active Classes (${activeCount})</button>
          <button type="button" class="archive-pill" data-action="set-archive-filter" data-filter="archived" aria-selected="${archiveFilter === "archived"}">📦 Archived Classes (${archivedCount})</button>
        </div>
        ${archiveFilter === "archived" ? `<span style="font-size:0.8rem;color:var(--muted);">Showing archived records. Stored safely for future reference.</span>` : ""}
      </div>

      <div class="chooser-divider"><span>${activeGroup === "JHS" ? "Junior High School sections" : "Senior High School sections"} (${archiveFilter === "archived" ? "Archived" : "Active"})</span></div>
      <div class="section-card-grid" aria-label="${activeGroup} sections">${sectionCards}</div>
    </section>`;
  }

  function renderSectionRecord() {
    const section = currentSection();
    const periods = state.sections[section.id].periods;
    if (activePeriodIndex >= periods.length) activePeriodIndex = 0;
    const period = currentPeriod();
    const { totalLearners } = computeLearnerNumbering(period.roster);
    const periodTabs = periods.map((entry, index) => `<button type="button" class="tab theme-${section.theme}" data-action="select-period" data-period="${index}" aria-selected="${activePeriodIndex === index}">${escapeHtml(entry.name)}</button>`).join("");
    
    const sectionColorHex = themeColorHex(section.accent || section.theme);

    return `<div class="record-section">
      <div class="record-back">${button("← Back to sections", "go-records")}</div>
      
      <div class="section-accent-bar" style="--section-accent-color: ${sectionColorHex}; background: ${sectionColorHex};"></div>
      
      <div class="class-header-card">
        ${section.archived ? `<div class="archive-banner"><span>📦 This class record is currently archived in storage.</span><button type="button" class="button button-secondary" data-action="unarchive-section" data-section="${section.id}">Restore Class</button></div>` : ""}
        <div class="class-header-top">
          <div class="section-title-wrap">
            <h2>${escapeHtml(section.subject)}</h2>
            <span id="liveLearnerCount" class="learner-count-badge">${totalLearners} Learner${totalLearners === 1 ? "" : "s"}</span>
            ${section.archived ? `<span class="card-archived-badge">Archived</span>` : ""}
          </div>
          <div>
            <label style="font-size:0.82rem; font-weight:700; color:var(--muted); margin-right:6px;" for="sheetSubjectSelect">Grading System / Subject:</label>
            <select id="sheetSubjectSelect" class="subject-interactive-select" data-action="change-sheet-subject" title="Click to assign or change subject and weight distribution">
              ${SUBJECT_PRESETS.map(p => `<option value="${p.name}" ${section.subject === p.name ? "selected" : ""}>${p.label}</option>`).join("")}
              <option value="custom" ${!SUBJECT_PRESETS.some(p => p.name === section.subject) ? "selected" : ""}>Other / Custom (${section.weights.join("/")}%)</option>
            </select>
          </div>
        </div>
        ${section.section ? `<p class="section-subtitle" style="margin: 4px 0 0; font-weight:600; color:#475569;">Section: ${escapeHtml(section.section)}</p>` : ""}
        <div class="class-header-meta">
          <span>Level: <strong>${section.level}</strong></span>
          <span>Weights: <strong>WW ${section.weights[0]}% | PT ${section.weights[1]}% | EX ${section.weights[2]}%</strong></span>
          <span>Roster capacity: <strong>${section.rosterSize}</strong></span>
        </div>
      </div>

      <div class="period-tabs" aria-label="Grading period tabs">${periodTabs}</div>
      <div class="period-toolbar"><label for="periodName">Period name</label><input id="periodName" class="period-name" value="${safeValue(period.name)}" data-period-name>
      ${button("+ Add Grading Period", "add-period", "button button-yellow")} ${button("⇩ Print-ready Excel", "export-excel", "button button-primary")}</div>
      <div class="bulk-column-tools" aria-label="Bulk column controls">
        <span class="bulk-column-label">Columns — edit only the last activity columns; all other scores stay in place.</span>
        ${renderBulkColumnControl("ww", "WW", period.wwDates.length)}
        ${renderBulkColumnControl("pt", "PT", period.ptDates.length)}
        ${renderBulkColumnControl("qa", "QA", period.qaDates.length)}
      </div>
      <p class="paste-hint"><strong>Bulk multi-select & paste tip:</strong> click and drag across input cells vertically or horizontally to select blocks. Use <strong>Ctrl+C</strong> to copy, <strong>Ctrl+X</strong> to cut, <strong>Delete</strong> to clear, or paste (Ctrl+V) copied spreadsheet blocks straight from Excel/Sheets. <strong>Bulk type-to-fill:</strong> after selecting a row, column, or block, just type a value into the first cell and press <strong>Enter</strong> (or click/tab away) — it fills that same value into every other cell in your selection.</p>
      <div class="legend"><span><i class="dot dot-red"></i>Raw score above HPS - correct before finalizing</span><span><i class="dot dot-code"></i>A = Absent (scored 0/HPS) · E = Excused (excluded) · L = Late (excluded)</span><span><i class="dot dot-missing"></i>M = Missing, no excuse (scored 0/HPS)</span><span>QA slots calculate uniformly across entered values.</span></div>
      ${renderRecordTable(section, period)}
      <div class="bulk-column-tools roster-slots-tools" aria-label="Add more name slots">
        <span class="bulk-column-label">Roster fits ${section.rosterSize} learners — need more rows?</span>
        <div class="bulk-column-control">
          <label class="sr-only" for="rosterSlotCount">Number of name slots to add</label>
          <input id="rosterSlotCount" type="number" min="1" max="100" value="10" data-column-count="roster" aria-label="Number of name slots to add">
          <button type="button" class="col-btn col-btn-wide" data-action="add-roster-slots" title="Add name slots">+ Add slots</button>
          <small>${section.rosterSize} active</small>
        </div>
      </div>
      </div>`;
  }

  function renderBulkColumnControl(kind, label, count) {
    return `<div class="bulk-column-control"><strong>${label}</strong><label class="sr-only" for="${kind}ColumnCount">Number of ${label} columns</label><input id="${kind}ColumnCount" type="number" min="1" max="50" value="1" data-column-count="${kind}" aria-label="Number of ${label} columns"><button type="button" class="col-btn col-btn-wide" data-action="bulk-add-col" data-kind="${kind}" title="Add columns">Add</button><button type="button" class="col-btn col-btn-wide" data-action="bulk-remove-col" data-kind="${kind}" title="Remove last columns">Remove</button><small>${count} active</small></div>`;
  }

  function renderRecordTable(section, period) {
    const dateHeaders = (kind, values, labels = []) => values.map((value, index) => {
      const label = labels[index] ? `<span>${labels[index]}</span>` : "";
      const borderClass = (index === 0 && kind === "pt") ? "border-start-pt" : (index === 0 && kind === "qa") ? "border-start-qa" : "";
      return `<th scope="col" class="activity-date-cell ${borderClass}">${label}<input class="activity-date" type="text" maxlength="12" placeholder="Date" data-date="${kind}" data-index="${index}" value="${safeValue(value)}" aria-label="${kind.toUpperCase()} activity ${index + 1} date"></th>`;
    }).join("");
    const hpsInputs = (kind, values) => values.map((value, index) => {
      const borderClass = (index === 0 && kind === "pt") ? "border-start-pt" : (index === 0 && kind === "qa") ? "border-start-qa" : "";
      return `<td class="${borderClass}"><input type="number" min="0" step="any" inputmode="decimal" data-hps="${kind}" data-index="${index}" value="${safeValue(value)}" aria-label="${kind.toUpperCase()} ${index + 1} highest possible score"></td>`;
    }).join("");
    const { numbering } = computeLearnerNumbering(period.roster);
    
    const wwLen = period.wwDates.length;
    const ptLen = period.ptDates.length;
    const qaLen = period.qaDates.length;
    const qaLabels = qaLen === 3 ? ["ST 1 (30%)", "ST 2 (30%)", "Term Exam (40%)"] : [];

    const rows = period.roster.map((learner, rowIndex) => renderLearnerRow(learner, rowIndex, period, section, numbering[rowIndex])).join("");
    
    return `<div class="table-wrap"><table class="record-table compact-record"><thead>
      <tr class="component-row">
        <th class="number-cell" scope="col" rowspan="3">#</th>
        <th class="name-cell" scope="col" rowspan="3">Learner name</th>
        <th class="component-header component-ww" scope="colgroup" colspan="${wwLen + 3}">
          Written Works (${section.weights[0]}%)
          <button type="button" class="col-btn" data-action="add-col" data-kind="ww" title="Add Column">+</button>
          <button type="button" class="col-btn" data-action="remove-col" data-kind="ww" title="Remove Column">-</button>
        </th>
        <th class="component-header component-pt border-start-pt" scope="colgroup" colspan="${ptLen + 3}">
          Performance Tasks (${section.weights[1]}%)
          <button type="button" class="col-btn" data-action="add-col" data-kind="pt" title="Add Column">+</button>
          <button type="button" class="col-btn" data-action="remove-col" data-kind="pt" title="Remove Column">-</button>
        </th>
        <th class="component-header component-qa border-start-qa" scope="colgroup" colspan="${qaLen + 3}">
          Quarterly Assessment (${section.weights[2]}%)
          <button type="button" class="col-btn" data-action="add-col" data-kind="qa" title="Add Column">+</button>
          <button type="button" class="col-btn" data-action="remove-col" data-kind="qa" title="Remove Column">-</button>
        </th>
        <th class="initial-header" scope="col" rowspan="3">Initial<br>Grade</th>
        <th class="transmuted-header" scope="col" rowspan="3">Final Transmuted<br>Grade</th>
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
        <th colspan="2" scope="row">Enter HPS</th>
        ${hpsInputs("ww", period.wwHps)}<td colspan="3">&nbsp;</td>
        ${hpsInputs("pt", period.ptHps)}<td colspan="3">&nbsp;</td>
        ${hpsInputs("qa", period.qaHps)}<td colspan="3">&nbsp;</td><td colspan="3">&nbsp;</td>
      </tr>
      </thead><tbody>${rows}</tbody></table></div>`;
  }

  function renderLearnerRow(learner, rowIndex, period, section, numDisplay) {
    const cat = getLearnerCategory(learner.name);
    const catClass = cat ? `row-category row-category-${cat}` : "";
    const nameShade = sectionNameShade(section.accent || section.theme);

    const scoreInputs = (kind, values, hpsValues) => values.map((value, index) => {
      const tdBorderClass = (index === 0 && kind === "pt") ? "border-start-pt" : (index === 0 && kind === "qa") ? "border-start-qa" : "";
      const codeValue = typeof value === "string" ? value.trim().toUpperCase() : "";
      const inputClasses = [hasRawAboveHps(value, hpsValues[index]) ? "invalid" : "", isAttendanceCode(value) ? "code-cell" : "", codeValue === "M" ? "code-cell-missing" : ""].filter(Boolean).join(" ");
      return `<td class="${tdBorderClass}"><input class="${inputClasses}" type="text" inputmode="text" maxlength="6" autocomplete="off" data-score="${kind}" data-row="${rowIndex}" data-index="${index}" value="${safeValue(cat ? "" : value)}" ${cat ? 'disabled tabindex="-1"' : ''} title="Enter a numeric score, or A (Absent, scored 0/HPS), E (Excused, excluded), L (Late, excluded), M (Missing, no excuse, scored 0/HPS)" aria-label="Learner ${rowIndex + 1} ${kind.toUpperCase()} ${index + 1}"></td>`;
    }).join("");
    const result = learnerResult(learner, period, section.weights);
    return `<tr class="${catClass}" data-learner-row="${rowIndex}"><th class="number-cell" scope="row">${numDisplay !== undefined ? numDisplay : ""}</th><td class="name-cell" style="--section-name-bg:${nameShade.background};--section-name-color:${nameShade.color};"><input class="text-input" data-name-row="${rowIndex}" value="${safeValue(learner.name)}" aria-label="Learner ${rowIndex + 1} name"></td>${scoreInputs("ww", learner.ww, period.wwHps)}${summaryCells(result, "ww")}${scoreInputs("pt", learner.pt, period.ptHps)}${summaryCells(result, "pt")}${scoreInputs("qa", learner.qa, period.qaHps)}${summaryCells(result, "qa")}<td class="summary-cell initial-cell summary-initial">${format(result.initial.rounded, 3)}</td><td class="summary-cell transmuted-cell summary-transmuted">${format(result.initial.transmuted, 0)}</td><td class="summary-cell descriptor-cell summary-descriptor">${renderDescriptorBadge(result.initial.descriptor)}</td></tr>`;
  }

  function learnerResult(learner, period, weights) {
    const ww = calculateComponent(learner.ww, period.wwHps, weights[0]);
    const pt = calculateComponent(learner.pt, period.ptHps, weights[1]);
    const qa = calculateQuarterlyAssessment(learner.qa, period.qaHps, weights[2]);
    return { ww, pt, qa, initial: calculateInitialGrade(ww, pt, qa) };
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
    const jhs = ["1st Grading", "2nd Grading", "3rd Grading", "4th Grading"];
    const shs = ["1st Quarter, 1st Semester", "2nd Quarter, 1st Semester", "1st Quarter, 2nd Semester", "2nd Quarter, 2nd Semester"];
    const choices = section.group === "JHS" ? jhs : shs;
    return choices[count] || `Additional Grading Period ${count + 1}`;
  }

  function addPeriod() {
    const section = currentSection();
    const periods = state.sections[section.id].periods;
    const period = initialPeriod(section);
    period.name = nextPeriodName(section, periods.length);
    periods.push(period);
    activePeriodIndex = periods.length - 1;
    markStateDirty();
    render();
  }

  // Adds more empty name slots to every grading period in the current
  // section (keeping every period's roster the same length, same as
  // normalizeState already enforces on load) — for classes that grow past
  // the default 50-learner capacity. New rows use each period's own current
  // WW/PT/QA column counts, so the same scoring math (HPS, weights,
  // percentages) applies to them exactly like every other row.
  function addRosterSlots(amount) {
    if (!Number.isInteger(amount) || amount <= 0) return;
    const section = currentSection();
    const periods = state.sections[section.id].periods;
    periods.forEach((period) => {
      const wwLen = period.wwDates.length;
      const ptLen = period.ptDates.length;
      const qaLen = period.qaDates.length;
      for (let i = 0; i < amount; i += 1) {
        period.roster.push({ name: "", ww: Array(wwLen).fill(""), pt: Array(ptLen).fill(""), qa: Array(qaLen).fill("") });
      }
    });
    section.rosterSize = (section.rosterSize || periods[0].roster.length - amount) + amount;
    markStateDirty();
    render();
    setStatus(`Added ${amount} more name slot${amount === 1 ? "" : "s"}. Roster capacity is now ${section.rosterSize}.`);
  }

  function changeColumnCount(kind, amount) {
    if (!["ww", "pt", "qa"].includes(kind) || !Number.isInteger(amount) || amount === 0) return;
    const period = currentPeriod();
    const dates = period[`${kind}Dates`];
    const hps = period[`${kind}Hps`];
    if (amount > 0) {
      for (let index = 0; index < amount; index += 1) {
        dates.push("");
        hps.push("");
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
    period.roster.forEach((learner) => learner[kind].splice(-removable, removable));
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

  function exportCurrentSheet() {
    if (!window.XLSX) {
      setStatus("The Excel exporter is still loading. Please try again in a moment.", "error");
      return;
    }
    const section = currentSection();
    const period = currentPeriod();
    const wwLen = period.wwDates.length;
    const ptLen = period.ptDates.length;
    const qaLen = period.qaDates.length;
    const wwStart = 2;
    const ptStart = wwStart + wwLen + 3;
    const qaStart = ptStart + ptLen + 3;
    const gradeCol = qaStart + qaLen + 3;
    const transmutedCol = gradeCol + 1;
    const descriptorCol = gradeCol + 2;
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
    matrix[headerRow - 1][gradeCol] = "Initial Grade";
    matrix[headerRow - 1][transmutedCol] = "Final Transmuted Grade";
    matrix[headerRow - 1][descriptorCol] = "Qualitative Descriptor";

    [[wwStart, period.wwDates, period.wwHps], [ptStart, period.ptDates, period.ptHps], [qaStart, period.qaDates, period.qaHps]].forEach(([start, dates, hps]) => {
      dates.forEach((value, index) => { matrix[datesRow - 1][start + index] = value || `Activity ${index + 1}`; });
      hps.forEach((value, index) => { matrix[hpsRow - 1][start + index] = excelValue(value); });
    });
    const { numbering } = computeLearnerNumbering(period.roster);
    period.roster.forEach((learner, rowIndex) => {
      const row = firstLearnerRow - 1 + rowIndex;
      matrix[row][0] = numbering[rowIndex] === "—" ? "" : numbering[rowIndex];
      matrix[row][1] = learner.name || "";
      [[wwStart, learner.ww], [ptStart, learner.pt], [qaStart, learner.qa]].forEach(([start, scores]) => scores.forEach((value, index) => { matrix[row][start + index] = excelValue(value); }));
    });
    const worksheet = XLSX.utils.aoa_to_sheet(matrix);
    const setFormula = (address, formula, value, type = "n") => { worksheet[address] = { t: type, f: formula, v: value }; };
    period.roster.forEach((learner, rowIndex) => {
      const excelRow = firstLearnerRow + rowIndex;
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
      
      // Transmuted Grade and Descriptor
      if (Number.isFinite(result.initial.transmuted)) {
        worksheet[`${excelColumn(transmutedCol)}${excelRow}`] = { t: "n", v: result.initial.transmuted };
        worksheet[`${excelColumn(descriptorCol)}${excelRow}`] = { t: "s", v: result.initial.descriptor };
      } else {
        worksheet[`${excelColumn(transmutedCol)}${excelRow}`] = { t: "s", v: "" };
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
    worksheet[`${excelColumn(transmutedCol)}${headerRow}`].s = { ...baseStyle, font: { ...baseStyle.font, bold: true }, fill: { fgColor: { rgb: "F5B041" }, patternType: "solid" } };
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
    worksheet["!cols"] = Array.from({ length: lastCol + 1 }, (_, col) => ({ wch: col === 0 ? 5 : col === 1 ? 28 : col === gradeCol ? 12 : col === transmutedCol ? 14 : col === descriptorCol ? 18 : 10 }));
    worksheet["!rows"] = Array.from({ length: matrix.length }, (_, row) => ({ hpt: row < 4 ? 20 : row < firstLearnerRow - 1 ? 28 : 19 }));
    worksheet["!pageSetup"] = { orientation: "landscape", paperSize: 9, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true };
    worksheet["!margins"] = { left: 0.2, right: 0.2, top: 0.35, bottom: 0.35, header: 0.15, footer: 0.15 };
    worksheet["!printArea"] = `A1:${excelColumn(lastCol)}${matrix.length}`;
    worksheet["!sheetViews"] = [{ showGridLines: false }];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Class Record");
    workbook.Workbook = { CalcPr: { calcMode: "auto", fullCalcOnLoad: true, forceFullCalc: true } };
    const safeName = `${section.level}-${section.subject}-${section.section || "Section"}-${period.name}`.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
    XLSX.writeFile(workbook, `${safeName || "class-record"}.xlsx`, { cellStyles: true });
    setStatus("Print-ready Excel file created with live formulas, Transmuted Grades, and Descriptors.");
  }

  function normalizedName(value) {
    return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
  }

  function isPeriodFinalized(period, section) {
    const learners = period.roster.filter((learner) => learner.name.trim() && !getLearnerCategory(learner.name));
    return learners.length > 0 && learners.every((learner) => Number.isFinite(learnerResult(learner, period, section.weights).initial.rounded));
  }

  function isLearnerAssessmentComplete(learner, period) {
    return ["ww", "pt", "qa"].every((kind) => learner[kind].every((score, index) => {
      const hpsValue = period[`${kind}Hps`][index];
      const hpsPresent = hpsValue !== "" && hpsValue !== null && hpsValue !== undefined;
      const hps = Number(hpsValue);
      if (!hpsPresent || !Number.isFinite(hps) || hps <= 0) return false;
      if (isZeroScoreCode(score)) return true;
      if (isExcludedCode(score)) return false;
      const raw = Number(score);
      const scorePresent = score !== "" && score !== null && score !== undefined && !isAttendanceCode(score);
      return scorePresent && Number.isFinite(raw);
    }));
  }

  function searchStudent() {
    const input = document.querySelector("#studentSearch");
    const query = normalizedName(input && input.value);
    if (!query) { showSearchModal("Enter the student's complete name to check a grade."); return; }

    // Group matches by section (not by section+period) so a learner who has
    // several grading periods in the same class shares ONE performance chart built
    // from all of them, instead of one flat, disconnected card per period.
    const bySection = new Map();
    state.registry.forEach((section) => {
      state.sections[section.id].periods.forEach((period) => {
        period.roster.forEach((learner) => {
          if (!normalizedName(learner.name).includes(query) || getLearnerCategory(learner.name)) return;
          const result = learnerResult(learner, period, section.weights);
          const complete = isLearnerAssessmentComplete(learner, period);
          if (!bySection.has(section.id)) bySection.set(section.id, { section, entries: [] });
          bySection.get(section.id).entries.push({ period, learner, result, complete });
        });
      });
    });

    if (!bySection.size) { showSearchModal("No student matching '" + escapeHtml(query) + "' was found. Please verify the name and try again."); return; }

    const blocks = [...bySection.values()].map(({ section, entries }) => {
      // entries[].period follows state.sections[section.id].periods order (real grading-period order)
      const learnerName = entries[0].learner.name;
      const scoreSeries = entries.map(({ period, result }) => ({
        periodName: period.name,
        ww: result.ww.percentage,
        pt: result.pt.percentage,
        qa: result.qa.percentage
      }));
      const cardsHtml = entries.map(({ period, result, complete }) => renderStudentGradeCard(period, result, complete)).join("");
      return `<div class="student-perf-block">
        <p class="eyebrow">${escapeHtml(section.level)} &bull; ${escapeHtml(section.subject)}${section.section ? ` — ${escapeHtml(section.section)}` : ""} ${section.archived ? "(Archived)" : ""}</p>
        <h3 class="student-perf-name">${escapeHtml(learnerName)}</h3>
        ${renderStudentPerformanceChart(scoreSeries)}
        <div class="student-grade-cards">${cardsHtml}</div>
      </div>`;
    }).join("");

    showSearchModal(blocks, true);
  }

  function renderStudentGradeCard(period, result, complete) {
    const initialGrade = format(result.initial.rounded, 3);
    const transmutedGrade = format(result.initial.transmuted, 0);
    const descriptor = result.initial.descriptor;
    const label = complete ? "Validated Grade — Complete Requirements" : "Current Grade — Provisional (Incomplete Requirements)";
    const note = complete ? "All entered WW, PT, and QA requirements are complete for this learner." : "This grade updates live as scores are entered; missing or incomplete requirements prevent final validation.";
    return `<article class="student-grade-result ${complete ? "grade-complete" : "grade-provisional"}">
      <p class="student-period-name">${escapeHtml(period.name)}</p>
      <div class="student-grade-grid">
        <div class="student-grade-box">
          <p class="student-grade-label">Initial Grade</p>
          <p class="student-grade">${initialGrade}</p>
        </div>
        <div class="student-grade-box">
          <p class="student-grade-label">Final Transmuted</p>
          <p class="student-grade transmuted">${transmutedGrade}</p>
        </div>
        <div class="student-grade-box">
          <p class="student-grade-label">Descriptor</p>
          <div style="margin-top:6px;">${renderDescriptorBadge(descriptor)}</div>
        </div>
      </div>
      <p class="student-grade-label" style="margin-top:12px;">${label}</p>
      <p class="grade-status-note">${note}</p>
    </article>`;
  }

  // ---- Private per-student WW/PT/QA performance chart, used only inside the search popup ----
  //
  // Deliberately a grouped bar chart, not a trendline. A class record only has
  // a handful of grading periods (often just one or two at a time), and a
  // line chart with 1–2 points either can't draw a line at all or draws one
  // sharp diagonal that misreads as a dramatic swing. Bars compare cleanly at
  // any number of periods and let a parent read "how did each area score
  // this period" at a glance, without needing several data points to make
  // sense of it.
  //
  // Tips are generated only from the recorded WW/PT/QA percentages — never
  // from assumptions about behavior (deadlines, submission habits, effort).
  // A learner can submit everything on time and still score lower in one
  // component than another; the copy below only ever describes what that
  // component measures and suggests generic, content-focused next steps.

  const PERF_CATS = [
    { key: "ww", label: "Written Works", dot: "var(--yellow)", line: "var(--ww-line)" },
    { key: "pt", label: "Performance Tasks", dot: "var(--blue)", line: "var(--pt-line)" },
    { key: "qa", label: "Quarterly Assessment", dot: "var(--red)", line: "var(--qa-line)" }
  ];

  function shortenPeriodLabel(name) {
    const short = {
      "1st Grading": "Q1", "2nd Grading": "Q2", "3rd Grading": "Q3", "4th Grading": "Q4",
      "1st Quarter, 1st Semester": "Q1", "2nd Quarter, 1st Semester": "Q2",
      "1st Quarter, 2nd Semester": "Q3", "2nd Quarter, 2nd Semester": "Q4"
    };
    if (short[name]) return short[name];
    return name.length > 14 ? name.slice(0, 13) + "…" : name;
  }

  function categoryScoreStats(series, key) {
    const points = series.map((p, i) => ({ i, value: p[key] })).filter((p) => Number.isFinite(p.value));
    if (!points.length) return null;
    const avg = points.reduce((sum, p) => sum + p.value, 0) / points.length;
    const first = points[0].value;
    const last = points[points.length - 1].value;
    return { avg, first, last, delta: points.length > 1 ? last - first : 0, count: points.length };
  }

  // What each component actually measures, in plain terms — used to keep
  // every tip tied to the score itself rather than a guess about why the
  // score is what it is.
  const COMPONENT_FOCUS = {
    ww: "Written Works reflects day-to-day seatwork and quizzes. Reviewing the specific topics covered and practicing similar items can help raise this score.",
    pt: "Performance Tasks reflects projects and hands-on, applied work. Practicing the specific skills those tasks call for can help raise this score.",
    qa: "Quarterly Assessment reflects one comprehensive exam covering the whole quarter. Reviewing the full range of topics and taking practice tests can help raise this score."
  };

  function performanceInterpretation(catsWithStats) {
    if (!catsWithStats.length) return { interpretation: "", tip: "" };

    const labels = { ww: "Written Works", pt: "Performance Tasks", qa: "Quarterly Assessment" };

    if (catsWithStats.length === 1) {
      const only = catsWithStats[0];
      const missing = Object.keys(labels).filter((k) => k !== only.key).map((k) => labels[k]);
      return {
        interpretation: `Only ${only.label} has recorded scores so far, averaging ${format(only.stats.avg, 1)}%. ${missing.join(" and ")} don't have entries yet for this learner.`,
        tip: `Once the remaining components are scored, a fuller picture of this learner's strengths will show here.`
      };
    }

    const sorted = [...catsWithStats].sort((a, b) => b.stats.avg - a.stats.avg);
    const strongest = sorted[0];
    const focusArea = sorted[sorted.length - 1];
    const periodCount = Math.max(...catsWithStats.map((c) => c.stats.count));

    const moved = catsWithStats.filter((c) => c.stats.count > 1).sort((a, b) => Math.abs(b.stats.delta) - Math.abs(a.stats.delta))[0];
    let movementSentence = "";
    if (moved && Math.abs(moved.stats.delta) >= 1) {
      const dir = moved.stats.delta > 0 ? "improved" : "went down";
      movementSentence = ` Their ${moved.label} score ${dir} from ${format(moved.stats.first, 1)}% to ${format(moved.stats.last, 1)}% across the periods recorded.`;
    } else if (moved) {
      movementSentence = ` ${moved.label} has stayed fairly steady across the periods recorded.`;
    }

    const interpretation = `Based on ${periodCount} grading period${periodCount > 1 ? "s" : ""} of recorded scores, ${strongest.label} is this learner's strongest component at ${format(strongest.stats.avg, 1)}%, while ${focusArea.label} is comparatively lower at ${format(focusArea.stats.avg, 1)}%.${movementSentence}`;

    const tip = `${strongest.label} at ${format(strongest.stats.avg, 1)}% is a genuine strength, worth recognizing. For ${focusArea.label}, ${COMPONENT_FOCUS[focusArea.key]}`;

    return { interpretation, tip };
  }

  function renderStudentPerformanceChart(series) {
    if (!series.length) return "";
    const stats = PERF_CATS.map((c) => ({ ...c, stats: categoryScoreStats(series, c.key) }));
    const withData = stats.filter((c) => c.stats);
    if (!withData.length) return "";

    const w = 560, h = 230, padL = 34, padR = 16, padT = 22, padB = 40;
    const plotW = w - padL - padR, plotH = h - padT - padB;
    const n = series.length;
    const groupW = plotW / n;
    const groupPad = Math.min(16, groupW * 0.18);
    const barGap = 4;
    const barW = Math.max(8, (groupW - groupPad * 2 - barGap * (PERF_CATS.length - 1)) / PERF_CATS.length);
    const baseline = padT + plotH;

    const yFor = (v) => padT + plotH - (plotH * Math.max(0, Math.min(100, v))) / 100;

    const gridLines = [0, 25, 50, 75, 100].map((v) => {
      const y = yFor(v);
      return `<line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" stroke="var(--border)" stroke-width="1"/><text x="${padL - 8}" y="${y + 4}" font-size="10" fill="var(--muted)" text-anchor="end">${v}</text>`;
    }).join("");

    const bars = series.map((p, i) => {
      const groupX = padL + groupW * i + groupPad;
      return PERF_CATS.map((c, ci) => {
        const v = p[c.key];
        if (!Number.isFinite(v)) return "";
        const x = groupX + ci * (barW + barGap);
        const y = yFor(v);
        const barH = Math.max(0, baseline - y);
        const valueLabel = `<text x="${(x + barW / 2).toFixed(1)}" y="${(y - 5).toFixed(1)}" font-size="9" fill="var(--muted)" text-anchor="middle">${format(v, 0)}</text>`;
        return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" rx="2" fill="${c.dot}" stroke="${c.line}" stroke-width="1.2"/>${valueLabel}`;
      }).join("");
    }).join("");

    const xLabels = series.map((p, i) => {
      const groupCenter = padL + groupW * i + groupW / 2;
      return `<text x="${groupCenter.toFixed(1)}" y="${h - padB + 16}" font-size="10" fill="var(--muted)" text-anchor="middle">${escapeHtml(shortenPeriodLabel(p.periodName))}</text>`;
    }).join("");

    const legend = withData.map((c) => `<span class="perf-legend-item"><span class="perf-swatch" style="background:${c.line}"></span>${c.label} <strong>${format(c.stats.avg, 1)}%</strong></span>`).join("");
    const analysis = performanceInterpretation(withData);

    return `<div class="student-perf-chart">
      <svg viewBox="0 0 ${w} ${h}" class="perf-chart-svg" role="img" aria-label="Written Work, Performance Task, and Quarterly Assessment scores by grading period for this learner">${gridLines}${bars}${xLabels}</svg>
      <div class="perf-chart-legend">${legend}</div>
      <p class="perf-interpretation">${analysis.interpretation}</p>
      <p class="perf-tip"><strong>Tip:</strong> ${analysis.tip}</p>
    </div>`;
  }

  function showSearchModal(message, isHtml = false) {
    const modal = document.createElement("div");
    modal.className = "modal-backdrop";
    modal.innerHTML = `<section class="modal search-result-modal" role="dialog" aria-modal="true" aria-labelledby="studentSearchTitle"><div class="section-heading"><div><p class="eyebrow">Private grade check</p><h2 id="studentSearchTitle">Student result</h2></div>${button("✕ Close", "close-modal")}</div><div class="student-results">${isHtml ? message : `<p class="muted">${escapeHtml(message)}</p>`}</div></section>`;
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
      <h2 id="welcomeModalTitle">WELCOME TO CST-R CLASS RECORD WEBSITE DEVELOPED BY SIR JOHNMIL SANCHEZ, LPT!</h2>
      <p class="welcome-modal-subtitle">This is an UNOFFICIAL class record — not an official DepEd or school-issued system — but it is fully functional, built to follow all necessary DepEd grading guidelines and details, and supports all the necessary class record functions.</p>
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
          ${button("✕ Close", "close-modal")}
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
    presetSelect.addEventListener("change", () => {
      customWrap.style.display = presetSelect.value === "custom" ? "grid" : "none";
    });
  }

  function renderEditSection(sectionId) {
    const section = state.registry.find(s => s.id === sectionId);
    if (!section) return;
    const modal = document.createElement("div");
    modal.className = "modal-backdrop";
    const isPreset = SUBJECT_PRESETS.some(p => p.name === section.subject);

    modal.innerHTML = `
      <section class="modal" role="dialog" aria-modal="true">
        <div class="section-heading">
          <div><p class="eyebrow">Settings</p><h2>Edit Class Section</h2></div>
          ${button("✕ Close", "close-modal")}
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
              ? `<button type="button" class="button button-secondary" data-action="unarchive-section" data-section="${section.id}">📦 Restore Class</button> <button type="button" class="button button-danger" data-action="request-delete-section" data-section="${section.id}">Delete Permanently</button>`
              : `<button type="button" class="button button-secondary" data-action="archive-section" data-section="${section.id}">📦 Archive Class</button>`}
          </div>
          <button type="button" class="button button-primary" data-action="save-section-edit" data-section="${section.id}">Save Changes</button>
        </div>
      </section>
    `;
    document.body.append(modal);

    const presetSelect = modal.querySelector("#editSectionSubjectPreset");
    const customWrap = modal.querySelector("#editCustomSubjectWrap");
    presetSelect.addEventListener("change", () => {
      customWrap.style.display = presetSelect.value === "custom" ? "grid" : "none";
    });
  }

  function renderDeleteSectionConfirmation(sectionId) {
    const section = state.registry.find((entry) => entry.id === sectionId);
    if (!section || !section.archived) return;
    document.querySelector(".modal-backdrop")?.remove();
    const className = `${section.level} — ${section.subject}${section.section ? ` — ${section.section}` : ""}`;
    const modal = document.createElement("div");
    modal.className = "modal-backdrop";
    modal.innerHTML = `<section class="modal delete-confirmation" role="dialog" aria-modal="true" aria-labelledby="deleteClassTitle">
      <div class="section-heading"><div><p class="eyebrow">Archived class</p><h2 id="deleteClassTitle">Delete permanently?</h2></div>${button("✕ Close", "close-modal")}</div>
      <p>This permanently removes <strong>${escapeHtml(className)}</strong>, including every grading period and learner record in this class. This cannot be undone.</p>
      <label class="delete-confirmation-label">Type <strong>DELETE PERMANENTLY</strong> to confirm
        <input id="deleteClassConfirmation" autocomplete="off" spellcheck="false" aria-label="Type DELETE PERMANENTLY to confirm permanent deletion">
      </label>
      <div class="stack-actions delete-confirmation-actions">${button("Cancel", "close-modal", "button button-secondary")} ${button("Delete Permanently", "confirm-delete-section", "button button-danger", `data-section="${section.id}"`)}</div>
    </section>`;
    document.body.append(modal);
    modal.querySelector("#deleteClassConfirmation")?.focus();
  }

  function permanentlyDeleteArchivedSection(sectionId) {
    const sectionIndex = state.registry.findIndex((entry) => entry.id === sectionId);
    const section = state.registry[sectionIndex];
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
    state.registry.splice(sectionIndex, 1);
    delete state.sections[sectionId];
    const nextSection = state.registry.find((entry) => !entry.archived) || state.registry[0];
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
    const result = learnerResult(learner, period, section.weights);
    
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
      input.classList.toggle("invalid", hasRawAboveHps(cellValue, period[`${kind}Hps`][index]));
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
      setStatus("⚠️ Live sync isn't set up yet — see FIREBASE_SETUP.md. Saving on this device only.");
    } else if (isLoading) {
      btn.disabled = true;
      setStatus("Connecting to live sync... Please wait.", "saving");
    } else if (!isDataLoaded) {
      btn.disabled = true;
      setStatus(lastLoadError
        ? `⚠️ DATA LOCKED — connection failed: ${lastLoadError}`
        : "⚠️ DATA LOCKED: waiting for the live database to respond.", "error");
    } else if (isStale) {
      btn.disabled = false;
      setStatus("⚠️ Another device saved changes here. Open Settings to resolve before saving.", "error");
    } else {
      btn.disabled = false;
      setStatus("Ready to save. ✓ (live sync on)");
    }
  }

  async function saveToFirebase({ automatic = false } = {}) {
    if (!isSignedIn()) { setStatus("Sign in before saving.", "error"); return false; }
    if (!isSyncConfigured()) {
      if (!automatic) setStatus("Live sync isn't set up yet — see FIREBASE_SETUP.md.", "error");
      return false;
    }
    if (!isDataLoaded) {
      if (!automatic) {
        setStatus("⚠️ BLOCKED: Cannot save unsynchronized data. Waiting for live sync to connect.", "error");
        alert("SAFETY BLOCK:\n\nYou are attempting to save before this device has confirmed the current saved data.\n\nTo avoid overwriting and losing class records, saving has been blocked until live sync finishes connecting.");
      }
      return false;
    }
    if (isStale) {
      if (!automatic) {
        setStatus("⚠️ BLOCKED: another device saved newer changes here.", "error");
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
    const stateSnapshot = cloneState(state);
    const currentUser = currentUserKey();
    isSaving = true;
    setStatus(automatic ? "Autosaving..." : "Saving...", "saving");
    try {
      await window.CSTRSync.ready;
      await window.CSTRSync.save(currentUser, stateSnapshot);
      lastSavedRevision = Math.max(lastSavedRevision, savedRevision);
      if (stateRevision === savedRevision) localStorage.removeItem(localDraftKey());
      finalizeSavedBatch();
      setStatus(automatic ? "Autosaved ✓ (live on every device)" : "Saved ✓ (live on every device)");
      showSaveToast(automatic ? "All changes autosaved — live on every device." : "Changes saved — live on every device.");
      return true;
    } catch (error) {
      setStatus(`Error - check your connection: ${error.message}`, "error");
      if (automatic) showSaveToast("Autosave could not reach the live database. Your recovery copy remains on this device.", "error");
      return false;
    } finally {
      isSaving = false;
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
    syncSaveControl();
    setStatus("Connecting to live sync...", "saving");

    if (!isSyncConfigured()) {
      // FIREBASE_SETUP.md hasn't been completed yet — fall back to exactly
      // what the app did before any sync existed: this device's own copy.
      const localDraft = restoreLocalDraft();
      if (localDraft) state = localDraft;
      isDataLoaded = true; isLoading = false; pendingAutoSaveChanges = 0;
      commitActiveFieldEdit(); establishCleanBaseline(); updateSaveIndicators(); syncSaveControl();
      if (localDraft) showSaveToast("Restored the latest autosaved copy from this device.", "info");
      return;
    }

    let firstUpdateHandled = false;
    const localDraft = restoreLocalDraft(); // offline fallback only, used only if the network never answers in time

    const offlineFallbackTimer = setTimeout(() => {
      if (firstUpdateHandled || requestId !== loadRequestId) return;
      firstUpdateHandled = true;
      if (localDraft) state = localDraft;
      isDataLoaded = true; isLoading = false; pendingAutoSaveChanges = 0;
      commitActiveFieldEdit(); establishCleanBaseline(); updateSaveIndicators();
      lastLoadError = "Could not reach the live database (offline?). Working from this device's last saved copy.";
      setStatus(`⚠️ ${lastLoadError}`, "error");
      if (localDraft) showSaveToast("Offline — restored the latest local copy. Will sync once back online.", "info");
      render();
    }, 6000);

    unsubscribeSync = window.CSTRSync.subscribe(
      currentUserKey(),
      (remoteState, meta) => {
        if (requestId !== loadRequestId) return; // a newer subscribe has since started
        clearTimeout(offlineFallbackTimer);
        if (!firstUpdateHandled) {
          firstUpdateHandled = true;
          state = normalizeState(remoteState || localDraft || {});
          activePeriodIndex = 0;
          isDataLoaded = true; isLoading = false; lastLoadError = "";
          pendingAutoSaveChanges = 0;
          commitActiveFieldEdit();
          if (autoSaveMaxWaitTimer) { clearTimeout(autoSaveMaxWaitTimer); autoSaveMaxWaitTimer = null; }
          establishCleanBaseline();
          lastSavedAt = new Date();
          startSaveIndicatorTicker();
          try {
            render();
            setStatus("Live sync connected ✓");
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
        isDataLoaded = true; isLoading = false; pendingAutoSaveChanges = 0;
        commitActiveFieldEdit(); establishCleanBaseline(); updateSaveIndicators();
        lastLoadError = error.message;
        setStatus(`⚠️ Live sync error: ${error.message}. Working from this device's last saved copy.`, "error");
        render();
      }
    );
  }

  // Handles a push that arrives AFTER the initial load — i.e. a genuine
  // change saved from another browser/device for this same account.
  function handleRemoteUpdate(remoteState, meta) {
    if (meta.isOwnEcho) return; // hearing our own save reflected back — already applied locally
    if (pendingAutoSaveChanges === 0 && !isSaving && !isStale) {
      // Nothing unsaved on this device — safe to take the newer copy immediately.
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
      setStatus("⚠️ Another device just saved changes here. Open Settings to review before your next save.", "error");
      showSaveToast("Heads up: another device saved changes while you were editing.", "error");
    }
  }

  // Settings action: keep what's on THIS screen and overwrite the other
  // device's save on the next Save Changes.
  function keepLocalOverRemote() {
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
    const confirmed = confirm("Discard your unsaved edits on THIS device and load the version saved from the other device instead?\n\nThis cannot be undone.");
    if (!confirmed) return;
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
        <div class="settings-account-avatar">👤</div>
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
            <input id="newPassword" type="password" autocomplete="new-password" placeholder="At least 6 characters">
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
            <input id="setPassword" type="password" autocomplete="new-password" placeholder="At least 6 characters">
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
    if (next.length < 6) {
      if (msg) { msg.textContent = "New password must be at least 6 characters."; msg.classList.add("error"); }
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

    if (!next || next.length < 6) {
      if (msg) { msg.textContent = "Password must be at least 6 characters."; msg.classList.add("error"); }
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
      ? `<p class="settings-note" style="color: var(--danger, #c0392b); border: 1px solid currentColor; border-radius: 8px; padding: 10px 12px;">⚠️ Live sync isn't set up yet. See FIREBASE_SETUP.md in the repo, fill in ASSETS/firebase-sync.js, and redeploy.</p>`
      : isStale
        ? `<p class="settings-note" style="color: var(--danger, #c0392b); border: 1px solid currentColor; border-radius: 8px; padding: 10px 12px;">⚠️ Another device saved changes here${pendingRemoteAt ? ` at ${safeValue(new Date(pendingRemoteAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }))}` : ""} while you had unsaved edits. Choose which version to keep:</p>
           <div class="stack-actions">${button("Keep the OTHER device's version", "take-remote-version", "button button-primary")} ${button("Keep THIS device's version", "keep-local-version")}</div>`
        : `<p class="settings-note">🟢 Live sync connected. Changes saved here appear on every other device automatically — nothing to type in.</p>`;
    modal.innerHTML = `<section class="modal" role="dialog" aria-modal="true" aria-labelledby="settingsTitle"><div class="section-heading"><div><p class="eyebrow">Live sync</p><h2 id="settingsTitle">Settings</h2></div>${button("✕ Close", "close-modal")}</div>
      ${syncStatusLine}
      ${lastLoadError ? `<p class="settings-note" style="color: var(--danger, #c0392b); border: 1px solid currentColor; border-radius: 8px; padding: 10px 12px;">⚠️ ${safeValue(lastLoadError)}</p>` : ""}
      ${renderAccountSection()}
      <div class="section-heading" style="margin-top: 22px;"><div><p class="eyebrow">Recovery</p><h2 style="font-size: 1.1rem;">Restore a previous version</h2></div></div>
      <p class="settings-note">Every time changes are saved, the state just before that save is kept here on this device — use this if a value was cleared or deleted by accident. Restoring loads that version into the app; you'll still need to save it to sync the rollback to every device.</p>
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
      finalizeSavedBatch();
      showSaveToast("Previous version restored on this device.", "info");
    }
  }

  function choosePhoto() { document.querySelector("#photoInput")?.click(); }

  function handlePhoto(file) {
    const allowedType = file && ["image/png", "image/jpeg"].includes(file.type);
    const allowedExtension = file && /\.(png|jpe?g)$/i.test(file.name);
    const note = document.querySelector("#photoNote");
    if (!allowedType || !allowedExtension) { if (note) { note.textContent = "Only .png, .jpg, and .jpeg image files are accepted."; note.classList.add("error"); } return; }
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
    if (!period || !period.roster) return;
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
        else if (c <= wwLen) learner.ww[c - 1] = sanitizeScoreValue(rawValue);
        else if (c <= wwLen + ptLen) learner.pt[c - 1 - wwLen] = sanitizeScoreValue(rawValue);
        else learner.qa[c - 1 - wwLen - ptLen] = sanitizeScoreValue(rawValue);
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

    if (event.key === "Escape") { clearSelection(); return; }

    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      fillArmed = false; // the block is being wiped, so any not-yet-committed typed fill is moot
      const period = currentPeriod();
      const wwLen = period.wwDates.length;
      const ptLen = period.ptDates.length;
      const qaLen = period.qaDates.length;
      const totalCols = 1 + wwLen + ptLen + qaLen;

      for (let r = bounds.minRow; r <= bounds.maxRow; r++) {
        const l = period.roster[r];
        for (let c = bounds.minCol; c <= bounds.maxCol; c++) {
          if (c >= totalCols) continue;
          if (c === 0) l.name = "";
          else if (c <= wwLen) l.ww[c - 1] = "";
          else if (c <= wwLen + ptLen) l.pt[c - 1 - wwLen] = "";
          else l.qa[c - 1 - wwLen - ptLen] = "";
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
        else if (c <= wwLen) { rowVals.push(l.ww[c - 1] || ""); l.ww[c - 1] = ""; }
        else if (c <= wwLen + ptLen) { rowVals.push(l.pt[c - 1 - wwLen] || ""); l.pt[c - 1 - wwLen] = ""; }
        else { rowVals.push(l.qa[c - 1 - wwLen - ptLen] || ""); l.qa[c - 1 - wwLen - ptLen] = ""; }
      }
      lines.push(rowVals.join("\t"));
    }
    event.clipboardData.setData("text/plain", lines.join("\n"));
    event.preventDefault();
    markStateDirty();
    render();
    setStatus(`Cut ${bounds.maxRow - bounds.minRow + 1} rows × ${bounds.maxCol - bounds.minCol + 1} columns.`);
  });

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
      document.querySelector(".modal-backdrop.onboarding-modal")?.remove();
      if (window.CSTRSync && window.CSTRSync.signOut) {
        window.CSTRSync.signOut();
      }
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

    if (action === "export-excel") exportCurrentSheet();

    if (action === "set-archive-filter") {
      archiveFilter = target.dataset.filter;
      render();
    }

    if (action === "archive-section") {
      const secId = target.dataset.section;
      const section = state.registry.find(s => s.id === secId);
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
      const section = state.registry.find(s => s.id === secId);
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
      let subject = presetSelect ? presetSelect.value : "Science";
      if (subject === "custom") {
        const customInput = document.querySelector("#addClassCustomSubject");
        subject = (customInput && customInput.value.trim()) || "General Subject";
      }
      const sectionName = document.querySelector("#addClassSection").value.trim();
      const theme = document.querySelector("#addClassTheme").value;
      
      const weights = matchSubjectWeights(subject);
      const isSHS = String(level).includes("11") || String(level).includes("12");
      const group = isSHS ? "SHS" : "JHS";
      
      const newId = "class-" + Date.now();
      const newClass = { id: newId, group, level, subject, section: sectionName, weights, theme, accent: theme, rosterSize: 50, archived: false };
      
      state.registry.push(newClass);
      state.sections[newId] = { periods: [initialPeriod(newClass)] };
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
      const section = state.registry.find(s => s.id === target.dataset.section);
      if (section) {
        section.level = document.querySelector("#editSectionLevel").value.trim();
        const presetSelect = document.querySelector("#editSectionSubjectPreset");
        let subject = presetSelect ? presetSelect.value : section.subject;
        if (subject === "custom") {
          const customInput = document.querySelector("#editSectionCustomSubject");
          subject = (customInput && customInput.value.trim()) || section.subject;
        }
        section.subject = subject;
        section.weights = matchSubjectWeights(subject);
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

    if (action === "logout") {
      if (unsubscribeSync) { unsubscribeSync(); unsubscribeSync = null; }
      isStale = false; pendingRemoteState = null; pendingRemoteAt = null; isDataLoaded = false;
      sessionStorage.removeItem("cstr-class-record-login");
      sessionStorage.removeItem("cstr-class-record-user");
      sessionStorage.removeItem("cstr-class-record-email");
      sessionStorage.removeItem("cstr-class-record-name");
      sessionStorage.removeItem("cstr_reg_auth");
      if (window.CSTRSync && window.CSTRSync.signOut) {
        window.CSTRSync.signOut();
      }
      currentView = "home";
      render();
    }
    if (action === "go-home") { currentView = "home"; render(); }
    if (action === "go-records") { currentView = "chooser"; render(); }
    if (action === "select-group") { 
      activeGroup = target.dataset.group; 
      const firstInGroup = state.registry.find((section) => section.group === activeGroup && !section.archived) || state.registry.find((section) => section.group === activeGroup) || state.registry[0];
      activeSectionId = firstInGroup.id; 
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
  });

  // Keydown shortcuts
  document.addEventListener("keydown", (event) => {
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
    if (input.dataset.score) return `score:${activeSectionId}:${activePeriodIndex}:${input.dataset.score}:${input.dataset.row}:${input.dataset.index}`;
    if (input.dataset.hps) return `hps:${activeSectionId}:${activePeriodIndex}:${input.dataset.hps}:${input.dataset.index}`;
    return null;
  }

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
    if (input.dataset.date) { currentPeriod()[`${input.dataset.date}Dates`][Number(input.dataset.index)] = input.value; stateChanged = true; }
    if (input.dataset.score) {
      const kind = input.dataset.score; const row = Number(input.dataset.row); const index = Number(input.dataset.index);
      const sanitized = sanitizeScoreValue(input.value);
      if (sanitized !== input.value) input.value = sanitized;
      currentPeriod().roster[row][kind][index] = sanitized; updateLiveSummary(row); stateChanged = true;
    }
    if (input.dataset.hps) { currentPeriod()[`${input.dataset.hps}Hps`][Number(input.dataset.index)] = input.value; updateAllSummaries(); stateChanged = true; }
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
  app.addEventListener("focusout", () => {
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
      if (rowIndex >= section.rosterSize) { truncated = true; return; }
      const learner = period.roster[rowIndex];
      const cells = line.split("\t");
      cells.forEach((cellValue, cellOffset) => {
        const column = startCol + cellOffset;
        if (column >= totalCols) { truncated = true; return; }
        const value = cellValue.trim();
        if (column === 0) { learner.name = value; return; }
        if (column <= wwLen) { learner.ww[column - 1] = sanitizeScoreValue(value); return; }
        if (column <= wwLen + ptLen) { learner.pt[column - 1 - wwLen] = sanitizeScoreValue(value); return; }
        learner.qa[column - 1 - wwLen - ptLen] = sanitizeScoreValue(value);
      });
      rowsFilled += 1;
    });

    period.roster.forEach((l) => {
      if (getLearnerCategory(l.name)) {
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
    render();
    if (window.CSTRSync && window.CSTRSync.onAuthStateChanged) {
      window.CSTRSync.onAuthStateChanged(async (firebaseUser) => {
        if (firebaseUser) {
          try {
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

  initApp();
})();
