# Faculty ledger visual remaster

Self-authored implementation decisions under the user's visual-overhaul request. No interview or invented user quotations. Existing workflows and record data take precedence over marketing-site recipes.

## Evidence and decisions

1. **Vibe:** composed, academic, precise. Authored direction, informed by the existing school crest, campus photograph, faculty audience and editable ledger.
2. **Journey:** existing sign-in, teaching desk, class directory, assessment entry, learner reports and exports. Preserve destinations, labels, event hooks and account approval. On phones, sign-in comes before the campus cover.
3. **Energy:** the public campus cover is expressive; the signed-in workspace is quiet. No scroll hijacking, cinematic detour or pointer capture.
4. **Feeling:** recognition at the campus cover; orientation at the teaching desk; confidence in the grade sheet; resolution through existing review and export controls. The peak is the actual class record, not an invented marketing sequence.
5. **Signature:** the campus photograph sits in a moving record-cover window while the surrounding typeset cover stays grounded. The real teaching ledger supplies the visual system used by class covers and working panels.
6. **Aesthetic range:** editorial institutional identity outside; practical live surface inside. Navy spine, silver paper, burgundy actions. Retain the authentic crest, campus photograph and self-hosted CSTR Sans/Serif fonts.
7. **Continuity:** distinct existing screens with native navigation. Preserve the app's scrolling, sticky grade-sheet geometry and phone assessment mode. Continuous world, video scrubbing and pinned stories would change how it works and are excluded.
8. **Assets:** existing `ASSETS/campus.webp`, `ASSETS/logo-compact.png` and self-hosted fonts only. No generated imagery, invented statistics, external media or runtime animation dependency.

## Concept and grammar

On this page, CST-R's campus prospectus and faculty class record become the cover and working pages of a digital ledger.

**Grammar:** live surface. The app itself remains operable. Filmic, continuous-world, split-stage and cutlist grammars would impose an unrelated timeline; gallery would turn entries into display objects; poster would sacrifice data density; chaptered editorial fits supporting prose rather than score entry. The public cover uses the taste direction “The page is the object”, seed **1398753112**, with palette and type retained from the school system. No redraws.

**Tell-someone sentence:** “It's the class record with the campus on its cover and my teaching desk inside.”

## Feeling curve and interaction score

| Existing destination | Intended feeling | Presentation device |
| --- | --- | --- |
| Sign-in | Recognition | Campus cover, stable typography, a restrained photograph window and short entrance |
| Overview | Orientation | Teaching-desk heading, real class totals, class list before editable teacher details |
| Class directory | Clarity | School-level covers, existing class colors and active/archive controls |
| Grade sheet | Confidence; the peak | Real score entry with clear component/readout contrast, existing sticky cells and period controls |
| Reports and exports | Resolution | Existing review, provisional labeling and export outcomes |

The controls are the live interaction. Four cinematic device families, artificial scroll spans, a photographic hero inside the dashboard and video generation would conflict with preserving the working interface. They are deliberately not introduced. The shared Scrollcraft engine is not modified or shipped as unused code.

## Motion, accessibility and constraints

Entrance: 12px translate to rest, 650ms `cubic-bezier(.22,1,.36,1)`, delays 0–220ms. Content remains readable throughout. Photograph travel is capped at 18px each direction, scheduled once per animation frame from passive scroll/resize listeners. Reduced-motion disables all transitions and entrance animation and leaves the campus crop complete.

Use native forms, visible focus, existing keyboard/clipboard behavior and original action attributes. No new storage, account, sync or grading calls. All remaster styles are in `@media screen` so grade-sheet print styling remains unchanged. Existing responsive task layouts remain authoritative; public composition adapts at 1000px and 700px.

## References and limits

MotionSites free examples studied: Email Landing Page (product surface, staged entrance and responsive precision) and USD Halo (clear type, large flat fields, restrained action hierarchy). Brand names, testimonials, videos, glass and gradients are not copied. No promotional content is placed in the application.

Scrollcraft preflight: Node 24, Chrome and Playwright available; full FFmpeg missing; no Kie key. No video encoding or generated assets are needed. No paid media services used.
