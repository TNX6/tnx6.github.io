# WP-K2 Frontend Independent Integrity Review Report

## Classification

`wp_k2_frontend_integrity_review_clean`

The final independent continuation re-reviewed K2F-F09-R02 without deriving its oracle from the repair helper, completed UX states 14–20 and all cross-state transitions, and reran every final sentinel and recertification gate. F04, F07, F09, and F12 are fully closed, the complete UX matrix is 20/20, no finding remains open, and the frontend is ready for the controlled commit/PR readiness audit.

## 1. Review baseline

- Worktree: `C:\Users\Admin\Desktop\tnx6-release\20260723-181249\frontend-wp-k2`
- Branch: `feat/wp-k2-dungeon-mastery`
- HEAD: `3f99b483554ece976fd1bd391cbfe8a1f3bb9a50`
- Pre-review index: empty
- Pre-review status: exactly nine approved paths
- Tracked implementation diff: only the two-line `src/pages/profile-v2.astro` integration
- Discovery report SHA-256: `d9e4190071bd19aa72c63c2b3e0f738cc3c993df50bf84103726f5e53d0f2344`
- Implementation plan SHA-256: `96fdbba1d477b77ec96bcd157caf8988369d69e759fe65126c7b98ae47553ef1`
- Package, lockfile, configuration, navigation, asset, and backend changes: none

## 2. Backend and fixture authority completed before the stop

The backend contract was read independently from merge `6323966c135abe5adf2c6e57fcfca56c77c327c7`, including:

- `src/dungeon/mastery-routes.ts`
- `src/dungeon/mastery-controller.ts`
- `src/dungeon/mastery-types.ts`
- `src/dungeon/mastery-errors.ts`
- `src/dungeon/mastery-validation.ts`
- `src/economy/mastery/view.ts`
- `src/economy/mastery/types.ts`
- `src/economy/mastery/repository.ts`
- `src/economy/mastery/catalog.ts`

The public success/error DTO, exact credentialed GET route, no-query/no-body constraints, error codes, terminal Rank representation, nullable Legacy representation, bilingual labels, and ten-row recent-grant bound agree with the approved frontend plan through the completed contract review.

The frontend fixture was compared against the raw merged backend Git blob using binary buffers:

- Frontend bytes: `17046`
- Backend blob bytes: `17046`
- Byte-identical: yes
- Frontend/backend SHA-256: `c672b4de461c309f2634edb2db61228c3d46105fba4f21e991a77f812dfe1a06`
- Frontend/backend Git blob: `018ce8afc5ffe0a521e0ede03e04ef14d629c4b2`

## 3. Request construction completed before the stop

`DungeonMasteryApi.getOverview()` constructs only:

- `GET https://api.tnx6.xyz/api/dungeon/mastery`
- `credentials: 'include'`
- `cache: 'no-store'`
- caller-owned abort signal

No query string, body, user ID, username, identity override header, or mutation method is constructed for the Mastery API.

## 4. First finding

### K2F-F04-R01 — In-place public-profile transition does not notify or invalidate Mastery

- Severity: **High**
- Review area: Step 4 — Public Profile Zero-Request Proof
- Invariant: entering any `?user=` public profile must synchronously abort/invalidate an in-flight self request, clear already rendered self Mastery, and prevent a late self response from rendering.

### Reproduction

1. Open `profile-v2` as the authenticated self profile and allow the Mastery controller to start or complete its self-only read.
2. Select a public profile from the existing profile search results.
3. `src/pages/profile-v2.astro` executes `history.replaceState(null, '', profileLink(user))` and then `renderProfileFromD1(user)` in the same document.
4. `history.replaceState` does not emit `popstate` and does not trigger Astro's `astro:page-load` event.
5. The Mastery controller is reconciled only when `installDungeonMasteryPanels()` runs; the implementation registers that installer for `astro:page-load`, but the in-place profile transition emits no event that reaches it.
6. If self Mastery was already rendered, the panel remains visible while the selected public profile renders.
7. If the self request was still in flight, it is neither aborted nor invalidated. A transport that resolves late passes the existing `disposed`, `signal.aborted`, and request-identity checks because none changed, and `renderOverview()` can paint self Mastery after the public URL is active.

### Expected

The in-place public transition must notify Mastery before rendering the selected user. Mastery must synchronously abort/invalidate the old request, clear all self-only content, and hide the root.

### Actual

No transition notification exists between the profile's `history.replaceState` path and `DungeonMasteryPanelController.reconcileRoute()`. The initial-load `?user=` guard is correct, but it does not cover this existing same-document public transition.

### Privacy impact

Authenticated self-only Mastery progress, Rank, Legacy Stars, unlocks, and recent grants can remain visible or render late on another user's public-profile view. This is a cross-profile-context disclosure of the signed-in viewer's private Mastery state.

### Affected production sources

- `src/pages/profile-v2.astro`
- `src/scripts/dungeon-mastery-client.ts`

No production source was modified during this review.

## 5. Retained permanent regression

One source-contract regression was added to the existing approved test file:

`in-place public-profile replaceState notifies Mastery before the selected user renders`

It independently identifies the existing `history.replaceState` public transition and requires a synchronous route signal that the Mastery client consumes. Current result:

- Tests: `20`
- Passed: `19`
- Failed: `1`
- Failure: the retained K2F-F04-R01 regression only
- Pre-review test SHA-256: `72a284290977f886e0f127891b6e6ed4a618cf955f3ab0002402b298d1fc8b5d`
- Retained test SHA-256: `f9f5f0bdd3742110247a114ca66c71bf80da475ad9ea377ae9954c9e4194563c`

No fixture or implementation file was changed to produce the failure.

## 6. Review stop

Per the first-defect rule, Steps 5–24 and final clean recertification were not performed. In particular, no broader stale matrix, dormancy/error/XSS matrix, presentation completeness review, responsive review, diagnostic baseline comparison, production build recertification, or 20-state signoff is claimed by this report.

The defect was repaired in the separately authorized pass recorded below. The full independent review must still resume from the retained exact working-tree state.

## 7. Prohibited-operation audit

- Frontend implementation repair: not performed
- Backend modification: not performed
- Package/dependency/configuration modification: not performed
- Staging/commit/push: not performed
- Deployment/activation/migration/seed/production-data mutation: not performed
- Protected frontend modification: not performed

HISTORICAL REVIEW STOP: STOPPED BEFORE FRONTEND REPAIR.

## 8. K2F-F04-R01 repair pass

### Root cause and exact repair

The same-document public-profile selection updated `location.search` through `history.replaceState` but emitted no lifecycle signal. The Mastery controller therefore had no opportunity to invalidate, abort, and clear its authenticated self context before `renderProfileFromD1(user)` rendered the selected public user.

The repair adds one narrowly scoped `tnx:profile-route-change` signal immediately after the existing `history.replaceState` call and before `renderProfileFromD1(user)`. The Mastery client registers one module-level listener for that signal and reuses its existing controller installation/reconciliation path. No global History API monkey-patch or second navigation system was introduced. Dungeon Equipment had no existing shared profile-context subscription, so it was not changed.

Every Mastery request now captures a monotonically increasing request generation. A public transition performs these synchronous operations in order:

1. increments the request generation;
2. aborts the active request;
3. clears the active request reference;
4. clears Rank, progress, Legacy, unlock, grant, error, status, progressbar, and control state and hides the root;
5. marks the route ineligible for self Mastery.

A completion may render only when its generation is current, its request remains the active request, it is not aborted or disposed, and the live URL is still a self profile. Generation mismatch therefore rejects a late fulfilled response even when the transport ignores `AbortController`.

Production paths changed by the repair:

- `src/scripts/dungeon-mastery-client.ts`
- `src/pages/profile-v2.astro`

No model, component, fixture, Dungeon Equipment, package, lockfile, configuration, backend, or other production path was changed by this repair.

### Permanent regression matrix

The retained regression was not weakened and now passes. The existing test path also contains a permanent 15-case runtime matrix covering:

- initial self: exactly one canonical request;
- initial public: zero requests and empty Mastery state;
- rendered self to public: synchronous full DOM/state clearing;
- in-flight self to public: abort plus no late render;
- fulfilled late response from a transport that ignores abort: discarded by generation;
- request A, public, self request B: late A cannot overwrite B;
- same-context out-of-order A/B: B wins;
- public retry/refresh suppression;
- public to self: exactly one fresh request;
- repeated transitions: no listener or request multiplication;
- teardown: late completion discarded;
- progressbar, list, label, error, status, and control clearing;
- 404 dormancy retained across the page lifecycle;
- network/error UI removal on public transition;
- no public username, user ID, query, header, or body in the Mastery request.

Runtime results:

- Retained regression: pass
- F04 matrix: `15/15` pass
- Complete WP-K2 frontend test file: `36/36` pass
- Dungeon Equipment regression: `13/13` pass
- Initial public request count: `0`
- In-place public new-request count: `0`
- Public-to-self fresh-request count: exactly `1`
- Late fulfilled stale-response render count: `0`
- Focused TypeScript: pass
- Focused ESLint: pass
- Focused Prettier for repaired TypeScript and test: pass
- `profile-v2.astro`: the one inserted line follows its surrounding format; the repository's pre-existing whole-file Prettier baseline remains outside this repair
- Production Astro build: pass, 24 pages built
- Package, lockfile, and configuration changes: none

### Repair hashes and closing state

- Pre-repair integrity report SHA-256: `f6c72a6b9f0fe6554bda6f01a3c85fde22611e37e5f4f99884a0e88b9d63f218`
- Retained pre-repair test SHA-256: `f9f5f0bdd3742110247a114ca66c71bf80da475ad9ea377ae9954c9e4194563c`
- Repaired test SHA-256: `b789ca63308d19e411154a3da19348227ab5f7c2246bd08939520044ea756980`
- Repaired Mastery client SHA-256: `739a24497d8406addca2963ba4ecbd1009f3074e42025b800ca0a69384af240d`
- Repaired `profile-v2.astro` SHA-256: `1e70f7a1dc6a7be4f9e9c873a023d55f1b72ff6a8acafe51000e2070317dc735`
- Fixture SHA-256, unchanged: `c672b4de461c309f2634edb2db61228c3d46105fba4f21e991a77f812dfe1a06`
- Branch: `feat/wp-k2-dungeon-mastery`
- HEAD: `3f99b483554ece976fd1bd391cbfe8a1f3bb9a50`
- Index: empty
- Final approved worktree paths: `10`
- Protected frontend: unchanged at `80bb395ed71a5bcc613414c76a83ba62f9bf648d`, with its 13 pre-existing untracked status entries preserved

### Repair-pass prohibited-operation audit

- Staging, commit, and push: not performed
- Deployment, activation, migration, seed, and production-data mutation: not performed
- Backend, package, dependency, lockfile, and configuration modification: not performed
- Protected frontend modification: not performed
- Independent integrity review Step 5 onward: not resumed

K2F-F04-R01 REPAIRED.
INDEPENDENT FRONTEND INTEGRITY REVIEW MUST RESUME BEFORE COMMIT.

## 9. Independent continuation — K2F-F04-R02 exposed

### Continuation baseline

- Review type: independent integrity-review continuation
- Branch: `feat/wp-k2-dungeon-mastery`
- HEAD: `3f99b483554ece976fd1bd391cbfe8a1f3bb9a50`
- Starting index: empty
- Starting worktree: exactly 10 approved paths
- Starting test SHA-256: `b789ca63308d19e411154a3da19348227ab5f7c2246bd08939520044ea756980`
- Starting integrity-report SHA-256: `fa82c9ad6cc9b65321aa34a93b028aa37eca2c896ddbD91ef6b7211f409e4a7c`
- Package, lockfile, configuration, backend, and unrelated navigation changes: none
- Protected frontend: `80bb395ed71a5bcc613414c76a83ba62f9bf648d`, empty index, 13 original untracked status entries

### K2F-F04-R01 independent re-review evidence

The production diff and runtime behavior independently confirm the core R01 public-context repair:

- `profile-v2.astro` executes the relevant sequence as `history.replaceState`, synchronous `tnx:profile-route-change` dispatch, then `renderProfileFromD1(user)`.
- `profile-v2.astro` contains no alternate `history.pushState` and no second relevant `history.replaceState` profile-context transition.
- Mastery ignores event payload authority and re-reads `window.location.search`.
- Public invalidation advances the request generation before aborting and clearing the active request.
- Rank, progress, Legacy, unlock, recent-grant, error, status, progressbar, and control state are cleared synchronously.
- Generation, active-request identity, URL context, abort state, and disposed state jointly gate completion.
- A fulfilled stale promise remains unable to render when its transport ignores abort.
- Public-to-self request B cannot be overwritten by pre-public request A.
- Repeated events while a live controller remains registered do not multiply controllers or requests.
- Public mode suppresses retry and refresh request paths.
- Public identity is never consumed from event detail or included in Mastery request construction.

The retained R01 matrix remains `15/15` passing. The new defect below is a distinct teardown/listener interaction discovered at the Step 3 event-spoof/disposed-state gate.

### K2F-F04-R02 — Route event reconstructs Mastery after page-lifecycle disposal

- Severity: **Medium**
- Review area: Step 3 — Event Spoof / Duplicate Event Safety
- Invariant: after `astro:before-swap` disposes a Mastery page lifecycle, a later route event must not reconstruct that disposed lifecycle or start new authenticated work on the retiring root.

#### Reproduction

1. Install Mastery in an authenticated self context. Request count becomes `1`.
2. Dispatch `astro:before-swap` through the production cleanup listener.
3. The controller increments its generation, aborts request 1, clears state, removes control listeners, and deletes its root from the `controllers` WeakMap.
4. Dispatch `tnx:profile-route-change` while the retiring root is still queryable from the document.
5. The module-level route listener calls `installDungeonMasteryPanels()`.
6. Because disposal deleted the WeakMap entry, the installer constructs a new controller for the same retiring root and starts request 2.

Expected request count after disposal and the route event: `1`.

Actual request count: `2`.

#### Root cause

The module-level profile-route listener intentionally persists across Astro page lifecycles, but no page-lifecycle/swap guard prevents it from installing controllers between `astro:before-swap` disposal and the next valid `astro:page-load`. Deleting the disposed controller's WeakMap entry makes the retiring root appear installable again.

#### Impact

An unrelated or repeated same-origin route event during teardown can restart an authenticated self Mastery fetch, attach a new controller to retiring DOM, and leave work outside the disposed lifecycle. Public URL revalidation prevents the original cross-profile R01 disclosure, but teardown guarantees, request boundedness, and detached-DOM lifecycle integrity are violated.

### Retained permanent regression and stop

Retained test:

`disposed Mastery lifecycle ignores a subsequent profile route event`

- Test path: `test/dungeon-mastery-ui.test.mjs`
- Retained test SHA-256: `e6800c8d1452d9d51bc0cd4dc844400ddb90f5a10dea67e220229bfdcbcb6cd5`
- Test total: `37`
- Passed: `36`
- Failed: `1`
- Sole failure: K2F-F04-R02 regression

Per the first-defect rule, no production repair was made and Steps 5–24 were not started. No clean final recertification is claimed.

### Finding inventory at stop

- K2F-F04-R01 — High — repaired; core public-transition behavior independently recertified
- K2F-F04-R02 — Medium — open

Open severity totals:

- Blocker: `0`
- High: `0`
- Medium: `1`
- Low: `0`

### Continuation prohibited-operation audit

- Production/frontend source repair: not performed
- Staging, commit, push, and deployment: not performed
- Backend, package, dependency, lockfile, and configuration modification: not performed
- Activation, migration, seed, and production-data mutation: not performed
- Protected frontend modification: not performed
- Review Steps 5–24: not performed

REVIEW STOPPED BEFORE FRONTEND REPAIR.

## 20. K2F-F09-R02 repair pass

### Repair baseline and retained reproduction

- Branch: `feat/wp-k2-dungeon-mastery`
- HEAD: `3f99b483554ece976fd1bd391cbfe8a1f3bb9a50`
- Starting index: empty
- Starting worktree: exactly 10 approved paths
- Starting client SHA-256: `4fe61f0b2707c442f22307c219363e168c5efb5a4d656b7d94e6174558af8b3b`
- Starting test SHA-256: `2d86ce58e3179fa7a46bbf21a932d8ec7b9818c7a97beb0d46562d257f617703`
- Starting report SHA-256: `ac7ffa6dac40cc44014e2f5a8a90fb239d2aeca27487143092a9a26a9a000fed`
- Starting index: empty
- `git diff --check`: pass
- Package, lockfile, configuration, backend, fixture, model, component, CSS, and profile changes from this repair: none

The retained regression was reproduced unchanged before repair. Eligible pending set `[data-dma-announcer].textContent` to `جاري تحميل تقدم الإتقان.`; the `404 NOT_FOUND` completion set `root.hidden = true` but retained that loading text instead of the required empty string. The pre-repair suite reported `135` tests, `133` passing, and two TAP failure entries for the one failing child assertion and its aggregate F09 parent.

### Root cause and exact repair

`prepareForRequest()` correctly owns eligible pending state and sets the loading announcement. Success, ordinary error, and `401` renderers explicitly replace it with current-state status. Public mode explicitly cleared it, but the 404 branch hid the root and returned without an announcer mutation; disposal likewise hid its root without clearing the node.

The repair adds a narrowly scoped `clearForDormancy()` method in `src/scripts/dungeon-mastery-client.ts`. It reuses `clearOverview()`, hides and disables loading/body/Login/error/Retry/Refresh state, clears the announcer, and hides the root. The 404, public-profile, and disposal paths now use this one dormant-state transition. `prepareForRequest()` remains separate and still exposes the pending root, skeleton, and polite loading announcement.

Production path changed by this repair:

- `src/scripts/dungeon-mastery-client.ts`

No model, profile, component, stylesheet, fixture, package, lockfile, configuration, or backend production path changed.

### Permanent F09-R02 matrix — 18/18 passing

1. Initial pending retains the meaningful loading announcement.
2. Pending to success replaces loading with the success announcement.
3. Pending to `500` replaces loading with the bounded failure announcement.
4. Pending to `400` replaces loading with the terminal failure announcement.
5. Pending to `401` replaces loading with the Login-required announcement.
6. Pending to `404` hides the root and clears the announcer.
7. Valid success to `404` hides the root and clears the announcer.
8. Retryable error to Retry pending to `404` clears the announcer.
9. Valid success to Refresh pending to `404` clears the announcer.
10. A late stale completion after `404` cannot repopulate the announcer.
11. Public/self route interaction during the same dormant-404 lifecycle remains silent and creates no request.
12. Repeated internal route events cannot resurrect the dormant announcer.
13. Public transition clears the announcer.
14. Before-swap/disposal clears the announcer.
15. Retired-root late route event and completion remain silent.
16. A new eligible root after Astro swap announces its own fresh pending request.
17. Repeated A-to-B-to-C roots retain empty announcers on retired roots while the current root announces its fresh request.
18. Repeated lifecycle changes create no duplicate announcer, `role=status`, or `aria-live=polite` node.

The original state-8 retained regression remains present and passes without weakening.

### Preservation validation

- K2F-F09-R01 pending/accessibility matrix: `20/20` pass
- K2F-F04-R01 privacy/lifecycle matrix: `15/15` pass
- K2F-F04-R02 retired-root matrix: `15/15` pass
- K2F-F07-R01 Retry-policy matrix: `16/16` pass
- K2F-F07-R02 Refresh-policy matrix: `20/20` pass
- K2F-F12-R01 recent-grant ordering matrix: `18/18` pass
- Complete WP-K2 frontend suite: `154/154` pass
- Dungeon Equipment regression: `13/13` pass
- Focused TypeScript with `DOM.Iterable`: pass
- Focused ESLint: pass
- Focused Prettier: pass
- Fresh production build: pass
- `git diff --check`: pass

### Repair hashes and finding state

- Client SHA-256: `4b55b7cdf24f35991ce1df9cc4eb7a37991185ddba3e3fec281311b933c283cc`
- Test SHA-256: `e42db62e1d53b656b2dc29c4a32b145f6ee356b067646ab1c32b394b2cca8099`
- Fixture SHA-256: `c672b4de461c309f2634edb2db61228c3d46105fba4f21e991a77f812dfe1a06`
- K2F-F09-R02 — Low — repaired; independent continuation required before overall signoff
- Open Blocker: `0`
- Open High: `0`
- Open Medium: `0`
- Open Low: `0`

### Repair-pass prohibited-operation audit

- Staging, commit, push, deployment, activation, migration, seed, and production-data mutation: not performed
- Backend, model, profile, component, CSS, fixture, package, dependency, lockfile, and configuration modification: not performed
- Protected frontend modification: not performed
- Independent states 15–20, cross-state final checks, and final integrity recertification: not resumed

K2F-F09-R02 REPAIRED.
INDEPENDENT FRONTEND INTEGRITY REVIEW MUST RESUME BEFORE COMMIT.

## 22. Final independent integrity closure

This section supersedes the historical stopping language above. It records the independent continuation after the separately authorized K2F-F09-R02 repair.

### F09-R02 independent re-review

Static inspection independently located the single polite status element, loading setter, dormant clear, 404 path, public-profile path, disposal path, success path, retryable/terminal error paths, and authentication path. `clearForDormancy()` clears the overview, loading, Login, error, body, Retry, Refresh, announcer, and root visibility. The 404, public, and disposal paths all use that canonical clear after invalidating and aborting outstanding work.

Independently authored harness results:

- Announcer state matrix: `9/9`
- Stale-announcer attacks: `12/12`
- Permanent K2F-F09-R02 matrix: `18/18`
- Exactly one `[data-dma-announcer]`, one `role="status"`, and one `aria-live="polite"` element
- Late successes/failures, retired-root events, public transitions, disposal, and A-to-B-to-C swaps cannot repopulate a dormant announcer
- A new eligible root may create only its own fresh pending announcement

K2F-F09-R02 is independently closed. K2F-F09-R01 remains closed, so F09 is fully closed.

### UX states 14–20

All requests below used the exact canonical credentialed no-store GET with no query, body, identity override, or custom headers.

| State | Input and requests                                                             | Panel / announcer / content                                                                               | Controls                                                  | Lifecycle result                                          | Result |
| ----- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------- | ------ |
| 14    | Eligible self; one GET; `404 NOT_FOUND`                                        | Hidden; announcer empty; overview, error, Rank/Legacy, unlocks, and grants empty                          | Retry, Refresh, Login hidden; Refresh disabled            | Dormant; unrelated route event starts no retry or revival | Pass   |
| 15    | Eligible self; one GET; `401 MASTERY_UNAUTHENTICATED`                          | Visible bounded auth shell; auth announcement; no stale content or backend text                           | Login visible; Retry and Refresh hidden; Refresh disabled | Bounded authentication state                              | Pass   |
| 16    | Eligible non-owner outside allowlist; one GET; backend returns `404 NOT_FOUND` | Intentionally indistinguishable from state 14; hidden and silent with no stale content                    | Retry, Refresh, Login hidden; Refresh disabled            | Dormant                                                   | Pass   |
| 17    | Eligible self; one GET; `400 MASTERY_VALIDATION_ERROR`                         | Visible bounded terminal error; announcer replaced; body and stale content empty; raw backend text hidden | Retry, Refresh, Login hidden; Refresh disabled            | Terminal, non-retrying                                    | Pass   |
| 18    | Eligible self; one GET; `500 MASTERY_READ_UNAVAILABLE`                         | Visible bounded safe error; announcer replaced; body and stale content empty                              | Retry and Refresh visible/enabled; Login hidden           | Retry issues exactly one canonical GET                    | Pass   |
| 19    | Eligible self; one GET rejected by network                                     | Visible bounded safe error; no raw exception or stale content                                             | Retry and Refresh visible/enabled; Login hidden           | Retryable                                                 | Pass   |
| 20    | Eligible self; one GET; malformed success DTO                                  | Strict DTO rejection; no partial render or crash; bounded safe error; no private contract detail          | Retry and Refresh visible/enabled; Login hidden           | Retryable according to the approved plan                  | Pass   |

Backend source at merge `6323966c135abe5adf2c6e57fcfca56c77c327c7` confirms that an authenticated non-owner outside `DUNGEON_MASTERY_READ_ALLOWLIST_USER_IDS` is intentionally mapped to `NOT_FOUND` with HTTP 404. The frontend therefore must not invent a separately observable forbidden state.

States 1–13 retain their earlier independent clean adjudication. State 14 passed the post-repair independent recheck and states 15–20 passed the final continuation: complete UX matrix `20/20`.

### Cross-state transition matrix

Independently exercised transitions passed `13/13`:

1. valid -> Refresh pending -> valid
2. valid -> Refresh pending -> 500
3. 500 -> Retry pending -> valid
4. 500 -> 400
5. 400 -> new eligible root -> valid
6. 401 -> new authenticated eligible root -> valid
7. valid -> 404
8. valid -> public
9. public -> self -> exactly one fresh request
10. pending -> public -> late success ignored
11. pending -> disposal -> late completion ignored
12. 404 -> unrelated route event -> no retry or revival
13. retired root A -> active root B -> late A event/completion leaves B unchanged

No content, announcer, error, Retry, Refresh, or Login state crossed a lifecycle boundary.

### Prior-finding, CSS, and oracle sentinels

- K2F-F04-R01: `15/15`
- K2F-F04-R02: `15/15`
- K2F-F07-R01: `16/16`
- K2F-F07-R02: `20/20`
- K2F-F09-R01: `20/20`
- K2F-F09-R02: `18/18`
- K2F-F12-R01: `18/18`
- Public zero-request, in-place public invalidation, stale-response suppression, retired-root terminality, Retry/Refresh policy, pending skeleton/live region, dormant announcement clearing, and recent-grant server order remain clean.
- CSS SHA-256 remains `eaa5d1c83a9e184ec069bd0536f3c766b288abc4c26b9f59b991de05e98be96d`; no CSS diff followed the prior independent 77-selector Mastery-scope review.
- The new F09-R02 expectations use independently authored literal lifecycle expectations. They do not call production `clearForDormancy()` or another production helper to generate expected output.
- Unchanged older test oracles retain their prior independent adjudication.

### Diagnostic baseline and build artifact

The disposable isolated baseline at `3f99b483554ece976fd1bd391cbfe8a1f3bb9a50` and current worktree both produced 208 normalized substantive diagnostic entries. The baseline covered 157 files and the current tree 161 files.

- New WP-K2 diagnostic identities: `0`
- Missing/worsened unrelated diagnostic identities: `0`
- Repository-wide Astro check remains red only because of the byte-identical pre-existing baseline diagnostics
- Disposable baseline worktree and dependency junction: removed

Fresh production build passed. The generated Mastery bundle contains the production base `https://api.tnx6.xyz` and exact route `/api/dungeon/mastery`, which compose to `https://api.tnx6.xyz/api/dungeon/mastery`. It contains only method `GET` for Mastery and contains no localhost, loopback, Windows path, fixture/report/finding identifier, user identity query/override, mutation method, debug payload, or source map. The profile build contains exactly one Mastery root and one reference to the Mastery bundle. No deployment occurred.

### Final recertification and parity

- Complete WP-K2 frontend suite: `154/154`
- Dungeon Equipment suite: `13/13`
- Focused TypeScript: passed
- Focused ESLint: passed
- Focused Prettier: passed before this report update; report formatting is rechecked after finalization
- Production build: passed
- `git diff --check`: passed
- New/untracked WP-K2 path trailing whitespace: `0`
- Pre-existing unrelated full-file trailing-whitespace lines in `src/pages/profile-v2.astro`: `16`, untouched
- Client SHA-256: `4b55b7cdf24f35991ce1df9cc4eb7a37991185ddba3e3fec281311b933c283cc`
- Test SHA-256: `e42db62e1d53b656b2dc29c4a32b145f6ee356b067646ab1c32b394b2cca8099`
- Fixture SHA-256: `c672b4de461c309f2634edb2db61228c3d46105fba4f21e991a77f812dfe1a06`
- Frontend fixture blob: `018ce8afc5ffe0a521e0ede03e04ef14d629c4b2`
- Backend merge fixture blob: `018ce8afc5ffe0a521e0ede03e04ef14d629c4b2`
- Fixture parity: byte-identical
- Integrity-report final SHA-256: captured after report finalization in the handoff evidence

### Complete finding inventory and final boundary

- K2F-F04-R01 — High — closed
- K2F-F04-R02 — Medium — closed
- K2F-F07-R01 — Medium — closed
- K2F-F07-R02 — Low — closed
- K2F-F09-R01 — Medium — closed
- K2F-F09-R02 — Low — closed
- K2F-F12-R01 — Medium — closed

Open severity totals: Blocker `0`, High `0`, Medium `0`, Low `0`.

The final worktree contains exactly 10 approved paths: seven implementation paths plus the discovery, implementation-plan, and integrity-review documents. The index is empty. `package.json`, lockfiles, Astro/Tailwind configuration, navigation outside the approved profile integration, backend, and environment/activation configuration are unchanged.

Protected frontend sentinel: HEAD `80bb395ed71a5bcc613414c76a83ba62f9bf648d`, index empty, and all 13 pre-existing status entries preserved. No staging, commit, push, deployment, activation, migration, seed, production-data mutation, backend modification, or protected-worktree modification occurred.

Final classification: `wp_k2_frontend_integrity_review_clean`.

WP-K2 FRONTEND INTEGRITY REVIEW COMPLETE.
FRONTEND IS READY FOR COMMIT/PR READINESS AUDIT.

## 18. K2F-F09-R01 repair pass

### Repair baseline and reproduction

- Branch: `feat/wp-k2-dungeon-mastery`
- HEAD: `3f99b483554ece976fd1bd391cbfe8a1f3bb9a50`
- Starting index: empty
- Starting worktree: exactly 10 approved paths
- Pre-repair test SHA-256: `a0ca076b641ac717e0cf4a1ddfd1c68107e7efcfbf49ccc9c92fab51bf15284e`
- Pre-repair integrity-report SHA-256: `34dd30d499eb5d531d12bc6cc8f4954ed31fccd773c1551c128541e95ef77b38`
- Retained reproduction: `114` total, `113` pass, `1` fail
- Expected eligible pending `root.hidden`: `false`
- Actual eligible pending `root.hidden`: `true`
- Sole pre-repair failure: K2F-F09-R01 regression

The same root-hidden state was reproduced through initial load, Refresh pending, and Retry pending. Before repair, the 20-case matrix had five direct subcase failures at initial root visibility, accessible pending status, Refresh pending visibility, Retry pending visibility, and live-region accessibility. All other lifecycle transitions already behaved correctly.

### Exact root cause

`DungeonMasteryPanelController.prepareForRequest()` is the shared pending transition for initial, Refresh, and Retry loads. It correctly clears the prior overview and hides stale Login, error, body, Retry, and Refresh states. It then assigned `this.root.hidden = true` immediately before making the descendant loading skeleton visible and populating the descendant polite live region.

The component root's native `hidden` attribute and scoped `.dma-panel[hidden] { display: none !important; }` rule suppress the entire descendant tree. The skeleton and live status were therefore internally configured but visually and accessibly absent.

### Minimal production repair

Production scope is only `src/scripts/dungeon-mastery-client.ts`.

The repair changes the shared pending transition from:

`this.root.hidden = true`

to:

`this.root.hidden = false`

No helper, markup, CSS, model, profile lifecycle, API contract, or other production path changed. The existing pending reset sequence still:

- clears Rank, progress, Legacy, unlock, grant, and raw-error content;
- hides content, Login, error, and Retry;
- hides and disables Refresh;
- exposes the loading skeleton;
- writes one meaningful loading message to the existing `role="status"`, `aria-live="polite"`, `aria-atomic="true"` region.

The public-profile guard, dormant `404` branch, and disposal path remain separate whole-panel hiding transitions. The pending-visible rule applies only after all eligibility guards pass.

### Permanent F09-R01 matrix

The retained regression passes unchanged. The permanent `F09-R01 pending loading and accessibility matrix` passes all 20 cases:

1. initial eligible pending request keeps root visible;
2. initial pending exposes the skeleton;
3. initial pending keeps meaningful polite status accessible;
4. pending success hides loading and shows valid content;
5. pending `500` clears loading and shows bounded retryable error;
6. pending `400` clears loading and shows terminal error without controls;
7. pending `401` clears loading and shows only auth state;
8. pending `404` hides the entire panel;
9. pending public transition hides immediately and aborts;
10. pending disposal hides and makes the root inert;
11. valid state to Refresh pending exposes only loading-safe UI;
12. retryable error to Retry pending exposes only loading-safe UI;
13. Refresh pending success renders only fresh content;
14. Retry pending success renders fresh content;
15. replaced pending request cannot overwrite the replacement result;
16. public transition suppresses a late response from abort-ignoring transport;
17. pending Retry, Refresh, and Login controls remain hidden/disabled;
18. Refresh pending clears all stale overview content;
19. loading uses one meaningful polite live region without duplication;
20. repeated Refresh cycles do not multiply rows or requests.

Matrix result: `20/20` subcases pass (`21/21` including the parent test).

### Accessibility and lifecycle preservation

During eligible pending state:

- root: visible;
- skeleton: visible;
- body and stale content: hidden and cleared;
- live region: one meaningful polite status in the active accessibility tree;
- Retry: hidden;
- Refresh: hidden and disabled;
- Login: hidden.

After resolution, loading is hidden before success, retryable error, terminal error, auth, or dormancy presentation. `404`, public-profile, and disposed/retired states still hide the root and all descendants. Generation, abort-signal, and controller-identity guards still reject replaced, public, and retired late results.

### Validation and preservation results

- Retained K2F-F09-R01 regression: pass
- F09-R01 loading/accessibility matrix: `20/20` pass
- Complete WP-K2 frontend file: `135/135` pass
- K2F-F04-R01 preservation matrix: `15/15` pass
- K2F-F04-R02 preservation matrix: `15/15` pass
- K2F-F07-R01 Retry matrix: `16/16` pass
- K2F-F07-R02 Refresh matrix: `20/20` pass
- K2F-F12-R01 ordering matrix: `18/18` pass
- Dungeon Equipment regression: `13/13` pass
- Focused TypeScript with DOM iterable support: pass
- Focused ESLint: pass
- Focused Prettier: pass
- Production Astro build: pass, 24 pages built
- `git diff --check`: pass
- Scoped trailing whitespace: clean
- Dependency installation: none; the existing sibling dependency directory was exposed only through a temporary validation junction

### Repair hashes and state

- Repaired Mastery client SHA-256: `4fe61f0b2707c442f22307c219363e168c5efb5a4d656b7d94e6174558af8b3b`
- Repaired test SHA-256: `f2395ecfc9fc4d29a5651190ebf257fa2c98d59b99502f7622599c9e7de4ac25`
- Mastery model SHA-256, unchanged: `0e067836b10ccfa71bfbd88b2dde9973a29228b35f3aa95112c869e5b37890e0`
- Fixture SHA-256, unchanged: `c672b4de461c309f2634edb2db61228c3d46105fba4f21e991a77f812dfe1a06`
- Branch: `feat/wp-k2-dungeon-mastery`
- HEAD: `3f99b483554ece976fd1bd391cbfe8a1f3bb9a50`
- Index: empty
- Approved worktree paths: `10`
- Package, lockfile, configuration, backend, fixture, model, component, CSS, profile lifecycle, and protected frontend changes from this repair: none

### Finding inventory after repair

- K2F-F04-R01 — High — repaired and independently closed
- K2F-F04-R02 — Medium — repaired and independently closed
- K2F-F07-R01 — Medium — repaired and independently closed
- K2F-F07-R02 — Low — repaired and independently closed
- K2F-F09-R01 — Medium — repaired; independent continuation is required before overall signoff
- K2F-F12-R01 — Medium — repaired and independently closed

Current open severity totals for adjudicated findings:

- Blocker: `0`
- High: `0`
- Medium: `0`
- Low: `0`

No overall clean classification is claimed. Per the repair-pass boundary, the remaining independent responsive/accessibility, CSS, diagnostics, oracle, artifact, and 20-state gates did not resume.

### F09 repair-pass prohibited-operation audit

- Staging, commit, push, deployment, activation, migration, seed, and production-data mutation: not performed
- Backend, model, component, CSS, profile lifecycle, API contract, fixture, package, dependency, lockfile, and configuration modification: not performed
- Protected frontend modification: not performed
- Remaining independent integrity-review gates: not resumed

K2F-F09-R01 REPAIRED.
INDEPENDENT FRONTEND INTEGRITY REVIEW MUST RESUME BEFORE COMMIT.

## 16. K2F-F12-R01 repair pass

### Certified reproduction

- Branch: `feat/wp-k2-dungeon-mastery`
- HEAD: `3f99b483554ece976fd1bd391cbfe8a1f3bb9a50`
- Starting index: empty
- Starting worktree: exactly 10 approved paths
- Pre-repair test SHA-256: `06e1ab8074c1bbc60ca500a7884b56d1a0ad8572259eba2ade23c77911630386`
- Pre-repair integrity-report SHA-256: `12bfd22f956f226f311160b6c5901427155cc937d6fa17efa6151ceb7d3adf4d`
- Retained reproduction: `94` total, `93` pass, `1` fail
- Sole failure: `DungeonMasteryContractError` at `mastery.recentGrants.order`

The retained DTO contained two otherwise canonical grants in deliberate server order with timestamps `2026-07-19T12:00:00.000Z` then `2026-07-20T12:00:00.000Z`. All individual row fields and cross-references were structurally valid. The frontend rejected only the adjacent-row chronology relationship.

### Root cause and authority boundary

After mapping every ordering surface, the sole production chronology constraint was in `normalizeDungeonMasteryResponse()` in `src/scripts/dungeon-mastery-model.ts`. It compared adjacent normalized timestamps using `Date.parse` and rejected the array when a later timestamp followed an earlier timestamp.

That comparison duplicated backend ordering authority the public browser cannot reproduce. The backend owns selection and canonical ordering, including a persistence tie-break that is not public. The frontend contract is therefore:

`DTO input order == validated model order == rendered UI order`

The frontend validates each row's shape and presents the supplied sequence. It does not decide which grant is newest or reorder or omit rows based on chronology, progress, rank, or unlock content.

### Minimal production repair

Production scope is only `src/scripts/dungeon-mastery-model.ts`.

The repair removes only the adjacent-row `Date.parse` chronology block and its `mastery.recentGrants.order` rejection. It does not add sorting, cloning-and-sorting, reversal, normalization, pagination, inference, or a replacement ordering predicate. The existing `source.recentGrants.map(normalizeRecentGrant)` preserves source indexes exactly, and rendering continues its direct `for...of overview.recentGrants` traversal.

The following validators remain unchanged:

- `recentGrants` must be an array with at most 10 entries;
- every row must contain exactly the canonical public fields;
- `createdAt` must be a non-empty canonical UTC timestamp string;
- numeric fields retain their safe-integer, range, and positivity constraints;
- `crossedRanks` retains its canonical shape and order checks;
- `semanticUnlockKeys` retains its size, uniqueness, and authoritative unlock-reference checks.

Malformed, empty, and non-string timestamps remain rejected. Valid timestamps are accepted regardless of their position relative to adjacent rows.

### Permanent F12-R01 matrix

The retained regression passes unchanged. The permanent `F12-R01 recent-grant input-order preservation matrix` passes all 18 cases:

1. descending timestamps accepted and preserved;
2. ascending timestamps accepted and preserved;
3. non-monotonic timestamps accepted and preserved;
4. identical timestamps accepted and preserved;
5. timestamp order cannot override other supplied field order;
6. out-of-order `progressAfter` values are not sorted;
7. out-of-order structurally valid `rankAfter` values are not sorted;
8. `semanticUnlockKeys` differences do not change row order;
9. one grant accepted;
10. zero grants accepted;
11. exactly 10 grants accepted and preserved;
12. 11 grants rejected by the canonical maximum bound;
13. malformed and empty `createdAt` rejected;
14. non-string `createdAt` rejected;
15. every model row signature remains at its supplied index;
16. rendered DOM row order exactly matches DTO indexes `0, 1, 2`;
17. Refresh replaces the old rendered sequence with the new server sequence exactly;
18. production implementation contains no recent-grant sorting or chronology comparison.

Matrix result: `18/18` subcases pass (`19/19` including the parent test).

### Static ordering audit

There is no `.sort()`, `.toSorted()`, or `.reverse()` call in the WP-K2 model, client, or component. There is no `recentGrants.order` predicate and no comparison between rows' `createdAt` values.

Every remaining production timestamp occurrence is non-ordering:

- the model's one `Date.parse(text)` is the unchanged per-field canonical timestamp validator;
- `normalizeRecentGrant` passes each row's `createdAt` to that validator;
- the client copies `createdAt` to the `<time datetime>` property and constructs `new Date(grant.createdAt)` only for localized display formatting.

Semantic unlock order remains the exact supplied DTO order and its existing sentinel passes.

### Validation and preservation results

- Retained K2F-F12-R01 regression: pass
- F12-R01 ordering matrix: `18/18` pass
- Complete WP-K2 frontend file: `113/113` pass
- K2F-F04-R01 preservation matrix: `15/15` pass
- K2F-F04-R02 preservation matrix: `15/15` pass
- K2F-F07-R01 Retry matrix: `16/16` pass
- K2F-F07-R02 Refresh matrix: `20/20` pass
- Semantic-unlock ordering sentinel: pass
- Dungeon Equipment regression: `13/13` pass
- Focused TypeScript with DOM iterable support: pass
- Focused ESLint: pass
- Focused Prettier: pass
- Production Astro build: pass, 24 pages built
- `git diff --check`: pass
- Scoped trailing whitespace: clean
- Dependency installation: none; the existing sibling dependency directory was exposed only through a temporary validation junction

### Repair hashes and state

- Repaired Mastery model SHA-256: `0e067836b10ccfa71bfbd88b2dde9973a29228b35f3aa95112c869e5b37890e0`
- Repaired test SHA-256: `c3de88d65a7767649819a62efffe2b060e546c953fe7e0449c2f562e1b8b562f`
- Mastery client SHA-256, unchanged by F12-R01: `90d4091fd341bf899bda2a12474d39572f2f835b128f5c9ac41840c776378f58`
- Fixture SHA-256, unchanged: `c672b4de461c309f2634edb2db61228c3d46105fba4f21e991a77f812dfe1a06`
- Branch: `feat/wp-k2-dungeon-mastery`
- HEAD: `3f99b483554ece976fd1bd391cbfe8a1f3bb9a50`
- Index: empty
- Approved worktree paths: `10`
- Package, lockfile, configuration, backend, fixture, profile lifecycle, CSS, component, API client, and protected frontend changes from this repair: none

### Finding inventory after repair

- K2F-F04-R01 — High — repaired and independently closed
- K2F-F04-R02 — Medium — repaired and independently closed
- K2F-F07-R01 — Medium — repaired and independently closed
- K2F-F07-R02 — Low — repaired and independently closed
- K2F-F12-R01 — Medium — repaired; independent continuation is required before overall signoff

Current open severity totals for adjudicated findings:

- Blocker: `0`
- High: `0`
- Medium: `0`
- Low: `0`

No overall clean classification is claimed. Per the repair-pass boundary, the independent DTO-negative, zero-state, storage/logging, profile-integration, accessibility, CSS, diagnostics, artifact, and 20-state gates did not resume.

### F12 repair-pass prohibited-operation audit

- Staging, commit, push, deployment, activation, migration, seed, and production-data mutation: not performed
- Backend, canonical fixture, profile lifecycle, CSS, component, API client, package, dependency, lockfile, and configuration modification: not performed
- Protected frontend modification: not performed
- Remaining independent integrity-review gates: not resumed

K2F-F12-R01 REPAIRED.
INDEPENDENT FRONTEND INTEGRITY REVIEW MUST RESUME BEFORE COMMIT.

## 17. Independent F12 re-review and K2F-F09-R01 exposure

### Continuation baseline

- Branch: `feat/wp-k2-dungeon-mastery`
- HEAD: `3f99b483554ece976fd1bd391cbfe8a1f3bb9a50`
- Starting index: empty
- Starting worktree: exactly 10 approved paths
- Starting model SHA-256: `0e067836b10ccfa71bfbd88b2dde9973a29228b35f3aa95112c869e5b37890e0`
- Starting test SHA-256: `c3de88d65a7767649819a62efffe2b060e546c953fe7e0449c2f562e1b8b562f`
- Starting integrity-report SHA-256: `9bea808e89788f0cd32b5525544ba68177a632b8708464b5f06fe1d1ad9982cd`
- Fixture SHA-256: `c672b4de461c309f2634edb2db61228c3d46105fba4f21e991a77f812dfe1a06`
- Package, lockfile, configuration, backend, and unexpected implementation changes: none
- `git diff --check`: pass

### Independent F12 disposition

The repair was re-reviewed from production model and rendering paths rather than inferred from the repair-pass matrix. The only production `Date.parse` remains the per-field canonical timestamp validator. There is no `sort`, `toSorted`, `reverse`, `getTime`, `recentGrants.order`, adjacent timestamp comparison, or comparison of `progressAfter` or `rankAfter` in the model, client, or component.

Fresh independently authored DTOs proved exact model preservation for descending, ascending, non-monotonic, identical, out-of-order `progressAfter`, out-of-order structurally valid `rankAfter`, and differing `semanticUnlockKeys` sequences. Malformed, empty, impossible-calendar, and non-string timestamps were all rejected. An independently constructed DOM harness proved that a non-monotonic initial sequence and a completely different refetched sequence each rendered at DTO indexes `0, 1, 2` exactly.

K2F-F12-R01 is independently closed.

### Strict DTO-negative matrix

An independent 48-case model matrix attacked missing and false success discriminants, missing/extra objects and fields, wrong curve version, unsafe and negative integers, non-integer/out-of-range Rank, malformed and contradictory Rank progress, malformed and contradictory Legacy progress, malformed/missing labels, invalid earned/granting-Rank states, duplicate unlocks, malformed recent grants and timestamps, over-bound grants, malformed crossed Ranks and semantic keys, unsafe nested values, and wrong root/array/object/string/null types.

Result: `48/48` rejected with `DungeonMasteryContractError` and no weakening of valid unusual presentation values.

The API has one fail-closed mapping for every such contract error. Runtime evidence beginning from populated content confirmed that an invalid success response:

- clears old summary, unlock, and grant content before the request;
- renders no partial DTO;
- exposes only bounded retryable local copy;
- never renders the raw internal sentinel;
- retains no stale content through subsequent success, error, public, or dormant transitions.

### Canonical zero state

The canonical fixture zero state rendered only after a strict success response and remained distinct from `404` dormancy:

- panel/body visible after valid zero success;
- supplied Rank `0`, progress `0`, next Rank 1 interval, and `0%` semantics used directly;
- unlock and recent-grant lists empty with both bounded empty-state messages visible;
- no fabricated entries, `NaN`, or `undefined` output;
- progress ARIA value remained `0`;
- subsequent temporary error cleared the zero state;
- public transition cleared and hid it with no request;
- subsequent `404` kept the entire panel and controls hidden.

The zero-state gate is clean.

### Storage, logging, and profile integration

The WP-K2 model, client, and component contain no `localStorage`, `sessionStorage`, IndexedDB, cookie, console, analytics, telemetry, or window-global payload write. Module state is limited to weak controller/retired-root lifecycle collections; neither retains Mastery DTO data. The per-render unlock-label map is local and short-lived. Unrelated pre-existing profile storage/logging code is outside the three-line WP-K2 profile diff.

The complete `profile-v2.astro` diff remains exactly three additions:

1. one component import;
2. one component mount directly after Equipment and before the side stack;
3. one route-change dispatch immediately after the sole `history.replaceState` public-profile transition and before public rendering.

There is no `pushState`, duplicate integration, direct Mastery endpoint, second request path, or unrelated profile behavior change in the diff. The storage/logging and profile-integration gates are clean.

### K2F-F09-R01 — pending load hides approved visual and accessible status

- Severity: **Medium**
- Review area: Step 9 — Responsive / Accessibility
- Invariant: after an eligible self profile begins a Mastery request, the visible loading skeleton and polite loading status must remain in the active visual and accessibility trees until the request resolves or the context becomes ineligible.

The approved discovery state matrix requires a visible loading panel/skeleton with a polite loading announcement. The implementation calls `prepareForRequest()` for every initial, Refresh, and Retry load. That method:

1. clears stale overview data;
2. sets `this.root.hidden = true`;
3. sets the loading element itself to visible;
4. writes the loading message into the descendant `role="status"` live region.

The component's root carries the native `hidden` attribute, and `.dma-panel[hidden]` uses `display: none !important`. Consequently, making the descendant skeleton visible cannot override the hidden ancestor. The skeleton is not visually rendered, and the polite live region is removed from the accessibility tree. Users receive no loading feedback during initial load, Refresh, or Retry.

### Retained regression

Retained test:

`pending Mastery load keeps its skeleton and polite status in the accessibility tree`

The test starts one eligible self request and leaves it pending. It independently expects the root visible, the loading skeleton visible, content hidden, and the polite announcer populated. Actual result:

- expected `root.hidden`: `false`
- actual `root.hidden`: `true`

- Test path: `test/dungeon-mastery-ui.test.mjs`
- Test SHA-256: `a0ca076b641ac717e0cf4a1ddfd1c68107e7efcfbf49ccc9c92fab51bf15284e`
- Total tests: `114`
- Passed: `113`
- Failed: `1`
- Sole failure: K2F-F09-R01 regression

### Stop and finding inventory

Per the first-defect rule, no production repair was made. The review stopped inside Step 9 before completing the remaining responsive/accessibility checks and before CSS scope, baseline diagnostics, the full oracle audit, build artifact audit, 20-state matrix, prior-gate sentinel recertification, and final validation.

- K2F-F04-R01 — High — repaired and independently closed
- K2F-F04-R02 — Medium — repaired and independently closed
- K2F-F07-R01 — Medium — repaired and independently closed
- K2F-F07-R02 — Low — repaired and independently closed
- K2F-F09-R01 — Medium — open
- K2F-F12-R01 — Medium — repaired and independently closed

Open severity totals:

- Blocker: `0`
- High: `0`
- Medium: `1`
- Low: `0`

### Continuation prohibited-operation audit

- Frontend production source repair: not performed
- Staging, commit, push, deployment, activation, migration, seed, and production-data mutation: not performed
- Backend, package, dependency, lockfile, and configuration modification: not performed
- Protected frontend modification: not performed
- Review Steps 9 remainder through 15 after the finding: not performed

REVIEW STOPPED BEFORE FRONTEND REPAIR.

## 12. K2F-F07-R01 repair pass

### Repair baseline and scope

- Branch: `feat/wp-k2-dungeon-mastery`
- HEAD: `3f99b483554ece976fd1bd391cbfe8a1f3bb9a50`
- Starting index: empty
- Starting worktree: exactly 10 approved paths
- Pre-repair retained-test SHA-256: `ac7206bbbb6649435e26fe5501beab1118a19a1f426f8ade6b92267b980cb888`
- Pre-repair integrity-report SHA-256: `4bfc106858d17d314f2385143e90d507834eaa9f44195d9f4837c32af5ecf0d2`
- Reproduction before repair: `54` tests, `53` pass, `1` fail; the sole failure was the retained F07-R01 regression
- Authorized production scope: `src/scripts/dungeon-mastery-client.ts` only
- Model, component, CSS, profile integration, package, lockfile, configuration, dependency, and backend changes: none

### Root cause and minimal repair

`renderFailure()` used the retryability predicate directly as the Retry button's `hidden` value. Because `hidden=true` removes the control, retryable failures hid Retry while terminal failures exposed it. Error classification, model mapping, safe-copy handling, request generation, stale-response protection, and markup were not the cause.

The repair computes one local `retryable` boolean and applies a single unambiguous policy:

- Retry visibility: `this.retry.hidden = !retryable`
- Refresh enablement: `this.refresh.disabled = !retryable`

The already-correct Refresh polarity is preserved. No request contract, error classification, dormancy, public-profile, or lifecycle behavior changed.

### Permanent F07-R01 coverage

The retained two-case regression now passes unchanged in intent. A permanent 16-case F07 matrix additionally proves:

1. `500 MASTERY_READ_UNAVAILABLE` exposes Retry.
2. Network failure exposes Retry.
3. `400 MASTERY_VALIDATION_ERROR` hides Retry.
4. `405 MASTERY_METHOD_NOT_ALLOWED` hides Retry.
5. Malformed success DTO exposes Retry.
6. `401` exposes Login only and hides Retry.
7. `404 NOT_FOUND` hides the entire panel and Retry.
8. Retryable → terminal clears Retry.
9. Terminal → retryable exposes Retry.
10. Retryable → success clears error controls.
11. Retryable → public clears Retry and starts no request.
12. `astro:before-swap` prevents Retry from restarting or rendering the retired panel.
13. Repeated completed Retry actions create exactly one bounded replacement request per action.
14. Retry after a completed failure issues one canonical GET.
15. Retry preserves the exact URL, method, credentials, cache, signal, no-query, no-body, and no-headers contract.
16. Valid → retryable clears all previously rendered Mastery content before exposing Retry.

### Validation results

- Retained F07-R01 regression: pass
- F07-R01 matrix: `16/16` pass
- R01 preservation matrix: `15/15` pass
- R02 preservation matrix: `15/15` pass
- Complete WP-K2 frontend test file: `71/71` pass
- Dungeon Equipment regression: `13/13` pass
- Focused TypeScript: pass
- Focused ESLint: pass
- Focused Prettier: pass
- Production Astro build: pass, 24 pages built
- Static request/privacy audit: pass
- Dependency installation: none; existing sibling dependency directory was exposed through a temporary junction for validation only

### Repair hashes and state

- Repaired Mastery client SHA-256: `17172c759acef34538c65617794dfe745bcdee339aca10ccf77df9ec9e27542c`
- Repaired test SHA-256: `1a1222b8e9323297bf3db3b923ba507bd21802d76df5d72c34a787d12aa2a3cc`
- `profile-v2.astro` SHA-256, unchanged by F07: `1e70f7a1dc6a7be4f9e9c873a023d55f1b72ff6a8acafe51000e2070317dc735`
- Fixture SHA-256, unchanged: `c672b4de461c309f2634edb2db61228c3d46105fba4f21e991a77f812dfe1a06`
- Branch: `feat/wp-k2-dungeon-mastery`
- HEAD: `3f99b483554ece976fd1bd391cbfe8a1f3bb9a50`
- Index: empty
- Approved worktree paths: `10`
- Package, lockfile, and configuration changes: none
- Protected frontend: unchanged at `80bb395ed71a5bcc613414c76a83ba62f9bf648d`, with empty index and 13 original top-level status entries

### Finding inventory after the repair

- K2F-F04-R01 — High — repaired and independently closed
- K2F-F04-R02 — Medium — repaired and independently closed
- K2F-F07-R01 — Medium — repaired; independent continuation is required before overall signoff

Current open severity totals for adjudicated findings:

- Blocker: `0`
- High: `0`
- Medium: `0`
- Low: `0`

No overall clean classification is claimed because the independent review gates after the F07 stop have not run.

### F07 repair-pass prohibited-operation audit

- Staging, commit, push, and deployment: not performed
- Backend, model, component, CSS, profile, package, dependency, lockfile, and configuration modification: not performed
- Activation, migration, seed, and production-data mutation: not performed
- Protected frontend modification: not performed
- Remaining independent integrity-review gates: not resumed

K2F-F07-R01 REPAIRED.
INDEPENDENT FRONTEND INTEGRITY REVIEW MUST RESUME BEFORE COMMIT.

## 10. K2F-F04-R02 repair pass

### Repair classification and scope

`K2F-F04-R02` is repaired by the separately authorized R02-only pass. `K2F-F04-R01` remains repaired and its full 15-case matrix remains clean. This repair does not resume the independent review at Step 5 and does not mark the overall frontend integrity review clean.

Production path changed by R02:

- `src/scripts/dungeon-mastery-client.ts`

The R02 pass did not change `profile-v2.astro`, the component, model, CSS, fixture, API contract, backend, package, lockfile, or configuration.

### Terminal retired-root mechanism

The Mastery panel root is the lifecycle identity. A module-level `WeakSet<HTMLElement>` now distinguishes a never-seen eligible root from a retired root without strongly retaining retired DOM.

The sole controller-construction path, `installDungeonMasteryPanels()`, checks the retired-root registry before consulting the controller WeakMap or constructing a controller. Initial component installation, `astro:page-load`, and `tnx:profile-route-change` all converge on this guarded installer, so no alternate construction path bypasses retirement.

On `astro:before-swap`, every currently queryable Mastery root is marked retired before its controller is disposed. Controller disposal also idempotently records retirement before it:

1. marks the controller disposed;
2. advances request generation;
3. aborts the active request;
4. clears the active request and visibility observer;
5. clears and hides Mastery DOM/state;
6. removes retry/refresh listeners and deletes the active WeakMap entry.

The retired WeakSet entry remains observable after WeakMap deletion, closing the reconstruction window. A new Astro root is a different object, is absent from the WeakSet, and initializes normally on the next `astro:page-load`.

### R02 lifecycle matrix

The permanent 15-case R02 matrix covers:

- one request for a normal initial self root;
- active-request and controller-DOM disposal on `astro:before-swap`;
- one and multiple route events after disposal;
- a synchronous route event immediately after disposal;
- public/self URL changes after disposal;
- retired retry/refresh controls;
- late completion after disposal;
- old root A retirement followed by new root B initialization;
- late event and late response from A after B exists;
- repeated A → B → C Astro swaps;
- duplicate events on the active current root;
- active public-root zero-request behavior;
- public → self on a new active root;
- bounded module-level listener registration across swaps.

Results:

- Retained R02 regression: pass
- R02 matrix: `15/15` pass
- R01 preservation matrix: `15/15` pass
- Complete WP-K2 frontend test file: `53/53` pass
- Request count after disposal plus route event: unchanged at `1`
- Five repeated post-disposal route events: `0` new requests
- A → B → C: exactly one request per eligible root; A and B remain terminal
- Late completion after disposal: `0` renders
- Retired-root DOM resurrection: none
- Module-level `tnx:profile-route-change` listener count across swaps: `1`
- Dungeon Equipment regression: `13/13` pass
- Focused TypeScript: pass
- Focused ESLint: pass
- Focused Prettier: pass
- Production Astro build: pass, 24 pages built
- Build dependency installation: none; existing sibling dependency junction used temporarily for validation only

### Repair hashes and state

- Pre-repair R02 test SHA-256: `e6800c8d1452d9d51bc0cd4dc844400ddb90f5a10dea67e220229bfdcbcb6cd5`
- Repaired test SHA-256: `1ffc9063e3cf32b569fa954018a33d9accf2fef33c73546168873613d4b0ade7`
- Repaired Mastery client SHA-256: `0c4655ab9c1f50ce80b631245920c19b8a9fb8e7d8ab207d27ffb9d0d98e9e33`
- `profile-v2.astro` SHA-256, unchanged by R02: `1e70f7a1dc6a7be4f9e9c873a023d55f1b72ff6a8acafe51000e2070317dc735`
- Fixture SHA-256, unchanged: `c672b4de461c309f2634edb2db61228c3d46105fba4f21e991a77f812dfe1a06`
- Branch: `feat/wp-k2-dungeon-mastery`
- HEAD: `3f99b483554ece976fd1bd391cbfe8a1f3bb9a50`
- Index: empty
- Approved worktree paths: `10`
- Package, lockfile, and configuration changes: none
- Protected frontend: unchanged at `80bb395ed71a5bcc613414c76a83ba62f9bf648d`, with empty index and 13 original untracked status entries

### Current finding inventory

- K2F-F04-R01 — High — repaired; independently recertified core behavior
- K2F-F04-R02 — Medium — repaired

Current open severity totals:

- Blocker: `0`
- High: `0`
- Medium: `0`
- Low: `0`

### R02 repair-pass prohibited-operation audit

- Staging, commit, push, and deployment: not performed
- Backend, package, dependency, lockfile, and configuration modification: not performed
- Activation, migration, seed, and production-data mutation: not performed
- Protected frontend modification: not performed
- Independent review Steps 5–24: not resumed

K2F-F04-R02 REPAIRED.
INDEPENDENT FRONTEND INTEGRITY REVIEW MUST RESUME BEFORE COMMIT.

## 11. Independent continuation — K2F-F07-R01 exposed

### Continuation baseline

- Branch: `feat/wp-k2-dungeon-mastery`
- HEAD: `3f99b483554ece976fd1bd391cbfe8a1f3bb9a50`
- Starting index: empty
- Starting worktree: exactly 10 approved paths
- Starting test SHA-256: `1ffc9063e3cf32b569fa954018a33d9accf2fef33c73546168873613d4b0ade7`
- Starting integrity-report SHA-256: `5caad5a7e0318a7cd84378779d15f0e21a6e3dcda9617f170792df3e92c3519d`
- Package, lockfile, configuration, and backend changes: none
- Protected frontend: `80bb395ed71a5bcc613414c76a83ba62f9bf648d`, empty index, 13 original untracked status entries

### Independent R02 re-review and final F04 decision

The R02 repair is independently clean:

- The panel root is the lifecycle identity.
- Active controllers use a `WeakMap`; retired roots use a separate weak-keyed `WeakSet`.
- `installDungeonMasteryPanels()` is the sole controller-construction path and checks retirement before WeakMap lookup or construction.
- Component initialization, `astro:page-load`, and the module-level `tnx:profile-route-change` listener all converge on the guarded installer.
- `astro:before-swap` marks every current root retired before controller disposal can delete the active WeakMap entry.
- Direct installer calls, page-load callbacks, retry/refresh controls, identical route events, and self/public URL changes cannot reinstall a retired root.
- A new root object remains eligible and initializes once; repeated A → B → C swaps preserve terminal retirement for A and B.
- The module listener remains singular, reads current document/URL state, retains no root in its closure, and trusts no event detail identity.
- Retirement storage is weak-keyed; no permanent strong `Set`, `Map`, or array of old roots exists.

Combined R01/R02 sequences remain correct: public transitions invalidate before render, stale promises cannot commit, retired roots cannot restart, public new roots make zero requests, self new roots make one request, and late work from A cannot affect B.

Final F04 status: **clean and closed**.

- K2F-F04-R01 — High — repaired and independently closed
- K2F-F04-R02 — Medium — repaired and independently closed

### Resumed stale/out-of-order and 404 gates

The stale/out-of-order gate is independently clean. Every replacement increments `requestGeneration` before aborting the prior request; completion additionally requires current generation, active-request identity, non-aborted state, non-disposed state, and a current self URL. `prepareForRequest()` clears prior content before the replacement begins, so a replacement failure cannot retain old content.

The 404 dormancy gate is independently clean. Request preparation clears prior data; exact `404 NOT_FOUND` sets page-lifecycle dormancy, hides the root, and blocks interaction loads. Stale earlier success cannot pass the generation guard. Public/self transitions do not clear dormancy on the same root, while a new Astro root receives a fresh controller lifecycle.

### K2F-F07-R01 — Retry-button visibility is inverted

- Severity: **Medium**
- Review area: original Step 7 / resumed Step 11 — Auth / Error / XSS
- Invariant: the Retry button is visible only for retryable local classifications; terminal `400/405` classifications expose safe copy with no retry.

#### Contract evidence

The approved implementation plan requires:

- safe error region with Retry shown only for retryable local classifications;
- retryable error → safe copy and retry;
- `400/405` terminal error → safe copy, no retry.

#### Production behavior

`renderFailure()` assigns:

`this.retry.hidden = isDungeonMasteryRetryable(error)`

Because `hidden=true` removes the control, this expression implements the inverse of the contract. Refresh-button enablement uses the correct polarity and isolates the finding to Retry visibility.

#### Reproduction

1. Return `500 MASTERY_READ_UNAVAILABLE`, classified retryable.
2. Actual: `retry.hidden === true`; expected `false`.
3. Return `400 MASTERY_VALIDATION_ERROR`, classified terminal.
4. Actual: `retry.hidden === false`; expected `true`.

The terminal Retry control retains its click listener and can issue another request, while the dedicated Retry control is absent for retryable failure.

#### Impact

Retryable failure recovery does not expose the approved Retry action, while terminal validation/method failures expose an action that can repeatedly reissue a non-retryable request. This violates the approved bounded error state and can cause needless request repetition, though local safe-copy and raw-error privacy remain intact.

### Retained regression and stop

Retained test:

`retry button is exposed only for retryable safe failures`

- Test path: `test/dungeon-mastery-ui.test.mjs`
- Test SHA-256: `ac7206bbbb6649435e26fe5501beab1118a19a1f426f8ade6b92267b980cb888`
- Total tests: `54`
- Passed: `53`
- Failed: `1`
- Sole failure: K2F-F07-R01 regression

Per the first-defect rule, no production repair was made. The remainder of the auth/error/XSS gate and Steps 12–27 were not continued. No clean final recertification is claimed.

### Finding inventory at stop

- K2F-F04-R01 — High — repaired and independently closed
- K2F-F04-R02 — Medium — repaired and independently closed
- K2F-F07-R01 — Medium — open

Open severity totals:

- Blocker: `0`
- High: `0`
- Medium: `1`
- Low: `0`

### Continuation prohibited-operation audit

- Production/frontend source repair: not performed
- Staging, commit, push, and deployment: not performed
- Backend, package, dependency, lockfile, and configuration modification: not performed
- Activation, migration, seed, and production-data mutation: not performed
- Protected frontend modification: not performed
- Review Steps 12–27: not performed

REVIEW STOPPED BEFORE FRONTEND REPAIR.

## 13. Independent F07 re-review — K2F-F07-R02 exposed

### Continuation baseline

- Branch: `feat/wp-k2-dungeon-mastery`
- HEAD: `3f99b483554ece976fd1bd391cbfe8a1f3bb9a50`
- Starting index: empty
- Starting worktree: exactly 10 approved paths
- Starting test SHA-256: `1a1222b8e9323297bf3db3b923ba507bd21802d76df5d72c34a787d12aa2a3cc`
- Starting integrity-report SHA-256: `6af48b0cdce38333130085c94d50adaa1cd3d6ec7fdaa8653f79c7964d6c10fa`
- Fixture SHA-256: `c672b4de461c309f2634edb2db61228c3d46105fba4f21e991a77f812dfe1a06`
- Package, lockfile, configuration, and backend changes: none
- Protected frontend: `80bb395ed71a5bcc613414c76a83ba62f9bf648d`, empty index, 13 original top-level status entries

### Independent F07-R01 recertification

Expected policy was derived directly from the approved discovery report and implementation plan, not from the production predicate:

- exact `500 MASTERY_READ_UNAVAILABLE`, network failure, invalid JSON, and malformed success DTO are retryable;
- exact `400 MASTERY_VALIDATION_ERROR` and `405 MASTERY_METHOD_NOT_ALLOWED` are terminal;
- exact `401 MASTERY_UNAUTHENTICATED` selects the bounded login state;
- exact `404 NOT_FOUND` makes the entire panel dormant for the root lifecycle.

Independent source inspection found the model classification consistent with that policy. `renderFailure()` computes a plainly named `retryable` boolean, sets Retry to `hidden = !retryable`, and separately sets Refresh eligibility to `disabled = !retryable`. Login and 404 take dedicated branches before the generic error region. The Retry listener delegates to the existing `load` path; that path rejects disposed, dormant, and public contexts, invalidates generations, aborts replacements, and uses only the canonical API client.

The pre-finding preservation run passed all `71/71` existing WP-K2 frontend tests, including the 16-case F07 matrix and both 15-case F04 matrices. Retry visibility, classification, transition clearing, public suppression, retired-root suppression, and exact credentialed no-store GET behavior are independently consistent with the approved contract.

Final K2F-F07-R01 status: **repaired and independently closed**.

### K2F-F07-R02 — Refresh remains visible in ineligible states

- Severity: **Low**
- Review area: continuation Step 3 — Control Polarity Independence
- Invariant: the manual Refresh control is present only after successful content or a temporary retryable error; authentication and terminal contract failures must not expose it.

#### Contract evidence

The approved implementation plan requires a manual Refresh button “only after successful/temporary-error states.” Its state machine separates success, retryable error, login, 404 dormancy, and terminal `400/405` error states.

#### Production behavior

The component emits `<button data-dma-refresh disabled>` without `hidden`. The client changes only `disabled` and never changes Refresh visibility:

- success: visible and enabled — correct;
- retryable failure: visible and enabled — correct;
- `400/405` terminal failure: visible and disabled — expected hidden;
- `401` authentication state: visible and disabled — expected hidden;
- `404`/public: the whole root is hidden, so no external exposure.

Retry and Refresh no longer have inverted eligibility, but Refresh presentation is incomplete. A disabled “تحديث التقدم” control remains visibly adjacent to the Login or terminal-error state, contrary to the approved bounded UI contract.

#### Retained regression

Retained test:

`Refresh is visible only after success or a temporary retryable error`

The test authors expected visibility directly from the approved plan and covered success, retryable `500`, terminal `400`, and authentication `401` without consulting the production retry predicate.

- Test path: `test/dungeon-mastery-ui.test.mjs`
- Test SHA-256: `59fa09b525e9a5d67113a3d09b6d142fa2abdde06ff4c6f647e877ba1b8ba94a`
- Expected `refresh.hidden`: `[false, false, true, true]`
- Actual `refresh.hidden`: `[false, false, false, false]`
- Total tests: `72`
- Passed: `71`
- Failed: `1`
- Sole failure: K2F-F07-R02 regression

### Stop and finding inventory

Per the first-defect rule, no production repair was made. The review stopped at Step 3 before the Step 4 transition matrix and before XSS/DOM, business-authority, Rank, Legacy, ordering, DTO, zero-state, storage/logging, integration, accessibility, CSS, diagnostics, oracle, artifact, and 20-state gates.

- K2F-F04-R01 — High — repaired and independently closed
- K2F-F04-R02 — Medium — repaired and independently closed
- K2F-F07-R01 — Medium — repaired and independently closed
- K2F-F07-R02 — Low — open

Open severity totals:

- Blocker: `0`
- High: `0`
- Medium: `0`
- Low: `1`

### Continuation prohibited-operation audit

- Frontend production source repair: not performed
- Staging, commit, push, and deployment: not performed
- Backend, package, dependency, lockfile, and configuration modification: not performed
- Activation, migration, seed, and production-data mutation: not performed
- Protected frontend modification: not performed
- Review Steps 4–23 after the finding: not performed

REVIEW STOPPED BEFORE FRONTEND REPAIR.

## 14. K2F-F07-R02 repair pass

### Repair baseline and reproduction

- Branch: `feat/wp-k2-dungeon-mastery`
- HEAD: `3f99b483554ece976fd1bd391cbfe8a1f3bb9a50`
- Starting index: empty
- Starting worktree: exactly 10 approved paths
- Pre-repair test SHA-256: `59fa09b525e9a5d67113a3d09b6d142fa2abdde06ff4c6f647e877ba1b8ba94a`
- Pre-repair integrity-report SHA-256: `e2db456aa80848a28545fdefd421ae8d62d95aab40a32b155f058acc46341f31`
- Retained reproduction: `72` total, `71` pass, `1` fail
- Expected Refresh visibility for success, retryable `500`, terminal `400`, and auth `401`: `[false, false, true, true]`
- Actual pre-repair `refresh.hidden`: `[false, false, false, false]`
- Sole pre-repair failure: K2F-F07-R02 regression
- Package, lockfile, configuration, fixture, model, component, CSS, profile, and backend changes: none

### Exact root cause

The component initialized Refresh as disabled but not hidden. Every client state changed only `refresh.disabled`; no path assigned `refresh.hidden`. Consequently, success and retryable states were correct by inheritance, while authentication and terminal states remained visibly present despite being disabled. The R01 Retry repair correctly fixed Retry eligibility but did not add the separate Refresh presentation policy.

### Minimal repair

Production scope is only `src/scripts/dungeon-mastery-client.ts`.

The client now owns an explicit two-dimensional Refresh state:

`setRefreshState(refreshVisible, refreshEnabled)`

The helper maps visibility and interactivity separately:

- `refresh.hidden = !refreshVisible`
- `refresh.disabled = !refreshEnabled`

Every relevant lifecycle renderer now assigns an explicit state rather than inheriting prior DOM properties:

- construction/loading: hidden and disabled;
- strict success: visible and enabled;
- retryable `500`, network, invalid JSON, or malformed success: visible and enabled;
- terminal `400/405`: hidden and disabled;
- `401`: hidden and disabled while Login is visible;
- `404`: hidden and disabled before whole-panel dormancy;
- public profile: hidden and disabled;
- disposal/retirement: hidden and disabled with all other controls cleared.

Retry remains independently mapped through `retry.hidden = !retryable`. Refresh continues to delegate to the same guarded `load` callback and canonical API client; no second fetch path was added.

### Permanent R02 matrix

The retained R02 regression now passes. A permanent 20-case Refresh matrix proves:

1. success exposes enabled Refresh and the exact canonical GET path;
2. retryable `500` exposes Refresh and Retry;
3. network failure exposes Refresh and Retry;
4. terminal `400` hides/disables Refresh and hides Retry;
5. terminal `405` hides/disables Refresh and hides Retry;
6. `401` hides Refresh/Retry and exposes Login;
7. `404` hides the panel and both controls;
8. malformed success uses the approved retryable presentation;
9. success → terminal hides Refresh;
10. terminal → fresh success exposes Refresh;
11. retryable → terminal hides Refresh;
12. terminal → fresh retryable exposes Refresh;
13. success → `401` hides Refresh;
14. retryable → `404` hides the panel and Refresh;
15. public transition clears and hides Refresh with no extra request;
16. before-swap disposal clears and hides Refresh;
17. a retired-root late event cannot re-expose Refresh;
18. public → self exposes Refresh only after fresh eligible success;
19. repeated transitions retain no stale Refresh state;
20. hidden Refresh remains disabled and cannot receive native click activation.

The Refresh action contract remains exactly:

- `GET https://api.tnx6.xyz/api/dungeon/mastery`
- `credentials: 'include'`
- `cache: 'no-store'`
- caller-owned abort signal
- no query, body, user ID, identity header, or mutation

### Validation results

- Retained K2F-F07-R02 regression: pass
- F07-R02 Refresh matrix: `20/20` pass
- F07-R01 Retry matrix: `16/16` pass
- F04-R01 preservation matrix: `15/15` pass
- F04-R02 preservation matrix: `15/15` pass
- Complete WP-K2 frontend test file: `93/93` pass
- Dungeon Equipment regression: `13/13` pass
- Focused TypeScript: pass
- Focused ESLint: pass
- Focused Prettier: pass
- Production Astro build: pass, 24 pages built
- `git diff --check`: pass
- Scoped trailing whitespace: clean
- Dependency installation: none; the existing sibling dependency directory was exposed only through a temporary validation junction

### Repair hashes and state

- Repaired Mastery client SHA-256: `90d4091fd341bf899bda2a12474d39572f2f835b128f5c9ac41840c776378f58`
- Repaired test SHA-256: `b7508b2de3bb77b284f5e845b7c57cbbcd3852ba072117b45305e5dbd6650d45`
- `profile-v2.astro` SHA-256, unchanged by R02: `1e70f7a1dc6a7be4f9e9c873a023d55f1b72ff6a8acafe51000e2070317dc735`
- Fixture SHA-256, unchanged: `c672b4de461c309f2634edb2db61228c3d46105fba4f21e991a77f812dfe1a06`
- Branch: `feat/wp-k2-dungeon-mastery`
- HEAD: `3f99b483554ece976fd1bd391cbfe8a1f3bb9a50`
- Index: empty
- Approved worktree paths: `10`
- Package, lockfile, and configuration changes: none
- Protected frontend: unchanged at `80bb395ed71a5bcc613414c76a83ba62f9bf648d`, empty index, 13 original top-level status entries

### Finding inventory after repair

- K2F-F04-R01 — High — repaired and independently closed
- K2F-F04-R02 — Medium — repaired and independently closed
- K2F-F07-R01 — Medium — repaired and independently closed
- K2F-F07-R02 — Low — repaired; independent continuation is required before overall signoff

Current open severity totals for adjudicated findings:

- Blocker: `0`
- High: `0`
- Medium: `0`
- Low: `0`

No overall clean classification is claimed because the independent review gates after the R02 stop have not run.

### R02 repair-pass prohibited-operation audit

- Staging, commit, push, and deployment: not performed
- Backend, model, component, CSS, profile, package, dependency, lockfile, and configuration modification: not performed
- Activation, migration, seed, and production-data mutation: not performed
- Protected frontend modification: not performed
- Remaining independent integrity-review gates: not resumed

K2F-F07-R02 REPAIRED.
INDEPENDENT FRONTEND INTEGRITY REVIEW MUST RESUME BEFORE COMMIT.

## 15. Independent F07-R02 re-review and K2F-F12-R01 exposure

### Continuation baseline

- Branch: `feat/wp-k2-dungeon-mastery`
- HEAD: `3f99b483554ece976fd1bd391cbfe8a1f3bb9a50`
- Starting index: empty
- Starting worktree: exactly 10 approved paths
- Starting test SHA-256: `b7508b2de3bb77b284f5e845b7c57cbbcd3852ba072117b45305e5dbd6650d45`
- Starting integrity-report SHA-256: `4520ac36116e693cd7d94fd91691e08e3ee6cdfb83360a3d3ffc85c695858dde`
- Discovery report SHA-256: `d9e4190071bd19aa72c63c2b3e0f738cc3c993df50bf84103726f5e53d0f2344`
- Implementation plan SHA-256: `96fdbba1d477b77ec96bcd157caf8988369d69e759fe65126c7b98ae47553ef1`
- Fixture SHA-256: `c672b4de461c309f2634edb2db61228c3d46105fba4f21e991a77f812dfe1a06`
- Package, lockfile, configuration, backend, and unexpected implementation changes: none
- `git diff --check`: pass

### Independent F07 disposition

The approved discovery and implementation plan, rather than the repaired booleans or their tests, establish malformed success as a temporary retryable safe failure. Independent source inspection and transition/action exercises confirmed:

- success and temporary retryable failures expose enabled Refresh;
- `500`, network failure, and malformed success expose Retry;
- `400` and `405` hide and disable Refresh and hide Retry;
- `401` hides Refresh and Retry and exposes the approved Login action;
- `404`, public-profile mode, and retired/disposed roots leave all Mastery controls absent or inactive;
- every active Refresh or Retry action converges on the one credentialed, no-store canonical GET;
- stale callbacks after public transition or retirement issue zero requests;
- transitions clear stale controls, error copy, status, and progress state.

Fresh pre-finding execution passed the complete WP-K2 frontend file at `93/93`, including F07-R02 `20/20`, F07-R01 `16/16`, F04-R01 `15/15`, and F04-R02 `15/15`. K2F-F07-R02 is independently closed, F07 is fully closed, and the F04 preservation sentinels remain clean.

### Clean gates completed before the finding

#### XSS and DOM sinks

All materially rendered backend strings use `textContent`. The implementation contains no `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `set:html`, `document.write`, dynamic HTML interpolation, or backend-derived executable attribute sink. Adversarial Arabic/English labels containing `<script>`, `<img onerror>`, SVG-event markup, and HTML entities remained literal normalized text in all four cases. Raw backend error text never reaches the DOM.

#### Frontend authority

The client contains no Rank threshold table, Rank/Legacy formula, percent or remaining calculation, unlock eligibility derivation, crossing derivation, or display sorting. The literal Legacy interval used by strict DTO validation is the approved wire-contract invariant, not a business calculation. Rendering consumes supplied values only.

#### Rank 1–9, Rank 10, and Legacy

Synthetic structurally valid values were preserved exactly for `rank`, `progress`, `currentRankThreshold`, `nextRank`, `nextRankThreshold`, `progressIntoRank`, `progressRequired`, `remaining`, and `percent`; total progress was not used to recompute them. Rank 10 remained terminal with no Rank 11 or next-rank bar for the canonical `1100`, `1349`, and `1410` states. Legacy remained a separate supplied interval, including unusual synthetic values and the nullable no-Legacy state. All Rank/Legacy authority checks passed.

#### Unlock order

A deliberately non-alphabetical 13-entry unlock sequence normalized and rendered in exact input order. No sorting, future-unlock generation, missing-unlock synthesis, or local descriptions were found; labels remained DTO-authoritative.

### K2F-F12-R01 — frontend rejects valid server order based on timestamp chronology

- Severity: **Medium**
- Review area: Step 12 — Recent-Grant Order
- Invariant: a structurally valid `recentGrants` array must retain its authoritative server/input order without frontend sorting or chronological-order adjudication.

The approved task deliberately requires a non-chronological timestamp sequence to remain valid and preserve input order. The discovery and implementation contracts say to preserve response/array order and do not authorize the browser to verify or reconstruct server ordering from public timestamps.

`src/scripts/dungeon-mastery-model.ts` nevertheless compares every adjacent `createdAt` value with `Date.parse` and throws `DungeonMasteryContractError` at `mastery.recentGrants.order` when a later timestamp follows an earlier one. This is frontend ordering authority, not structural DTO validation. It also cannot reproduce the backend's full ordering because the backend's tie-break `grant_id` is not public.

### Independent reproduction and retained regression

The retained test constructs two otherwise canonical grants in this supplied order:

1. `2026-07-19T12:00:00.000Z`
2. `2026-07-20T12:00:00.000Z`

Expected: both grants normalize and remain in that exact array order.

Actual: normalization throws `Invalid Dungeon Mastery contract at mastery.recentGrants.order.` before rendering. A valid response therefore becomes the bounded retryable malformed-success presentation and withholds the complete panel content.

Retained test:

`preserves authoritative recent-grant array order without imposing timestamp order`

- Test path: `test/dungeon-mastery-ui.test.mjs`
- Test SHA-256: `06e1ab8074c1bbc60ca500a7884b56d1a0ad8572259eba2ade23c77911630386`
- Total tests: `94`
- Passed: `93`
- Failed: `1`
- Sole failure: K2F-F12-R01 regression

The pre-existing test that expects a “reordered” grant to be rejected encodes the production chronology predicate and is not independent evidence for the approved preservation contract. It was not removed or weakened in this review-only pass.

### Stop and finding inventory

Per the first-defect rule, the review stopped at Step 12. The strict DTO negative matrix, zero-state continuation, storage/logging, profile integration, responsive/accessibility, CSS scope, baseline diagnostics, full oracle audit, build artifact audit, 20-state matrix, and final recertification were not run after this finding.

- K2F-F04-R01 — High — repaired and independently closed
- K2F-F04-R02 — Medium — repaired and independently closed
- K2F-F07-R01 — Medium — repaired and independently closed
- K2F-F07-R02 — Low — repaired and independently closed
- K2F-F12-R01 — Medium — open

Open severity totals:

- Blocker: `0`
- High: `0`
- Medium: `1`
- Low: `0`

### Continuation prohibited-operation audit

- Frontend production source repair: not performed
- Staging, commit, push, deployment, activation, migration, seed, and production-data mutation: not performed
- Backend, package, dependency, lockfile, and configuration modification: not performed
- Protected frontend modification: not performed
- Review Steps 13–23 after the finding: not performed

REVIEW STOPPED BEFORE FRONTEND REPAIR.

## 19. Final continuation — independent F09 re-review and K2F-F09-R02 exposure

### Exact continuation baseline

- Branch: `feat/wp-k2-dungeon-mastery`
- HEAD: `3f99b483554ece976fd1bd391cbfe8a1f3bb9a50`
- Starting index: empty
- Starting worktree: exactly 10 approved paths
- Starting client SHA-256: `4fe61f0b2707c442f22307c219363e168c5efb5a4d656b7d94e6174558af8b3b`
- Starting test SHA-256: `f2395ecfc9fc4d29a5651190ebf257fa2c98d59b99502f7622599c9e7de4ac25`
- Starting report SHA-256: `62e3dcf1ebb900465f995a5f3e35a6d494c721832c4e84f6516d57cbf0eb3ec6`
- Fixture SHA-256: `c672b4de461c309f2634edb2db61228c3d46105fba4f21e991a77f812dfe1a06`
- `git diff --check`: pass
- Package, lockfile, configuration, backend, and unexpected implementation changes: none

### Independent K2F-F09-R01 re-review

Fresh source inspection and an independently authored lifecycle harness verified the repaired pending contract without treating the repair matrix as proof:

- initial, Refresh, and Retry pending states keep the root and loading skeleton visible;
- the single polite status node remains meaningful and accessible while eligible and pending;
- pending state clears old body, error, login, Retry, Refresh, unlock, and recent-grant presentation;
- success, `500`, `400`, `401`, public transition, and disposal follow their approved visibility and stale-response rules;
- public-to-self creates exactly one fresh request;
- repeated cycles do not duplicate the announcer, `role=status`, `aria-live=polite`, IDs, skeletons, or rendered rows.

K2F-F09-R01 is independently **closed**. The later dormant-404 defect is recorded separately as K2F-F09-R02.

### CSS final review

The complete stylesheet contained 77 concrete selectors. Every concrete selector is rooted in a `.dma-` class; the three remaining inventory entries were only the `720px`, `480px`, and reduced-motion at-rules. Generic descendants, buttons, headings, focus rules, attribute selectors, RTL/LTR isolation, and responsive rules remain Mastery-scoped. No global typography, Equipment, inventory, badges, sidebar, or generic-button mutation was found. The fresh Dungeon Equipment regression remained `13/13` passing.

### Baseline diagnostic comparison

An isolated detached checkout at `3f99b483554ece976fd1bd391cbfe8a1f3bb9a50` and the current WP-K2 tree both returned the known nonzero repository-wide `npm run check` result. After normalizing worktree roots, locations, generated timing, file-count noise, and shifted source-context line numbers:

- WP-K2-specific new diagnostic identities: `0`
- Existing unrelated diagnostic identities worsened: `0`
- Raw file-count difference: baseline `157`, current `161`, explained by the four new checkable source files
- Disposable baseline checkout and its dependency junction: removed after comparison

### Test-oracle independence final review

The API request contract, privacy/lifecycle behavior, retired-root behavior, Retry/Refresh/loading policies, DTO strictness, Rank/Legacy presentation, unlock order, recent-grant order, and `404` behavior use literal contract expectations or independently authored synthetic inputs. Tests do not import production UI-policy constants, generate expected control state from production mappings, sort expected grants with production logic, or mutate the canonical fixture in place. Canonical fixture reuse is limited to approved byte parity and canonical DTO evidence. No material tautological oracle was found.

### Build-artifact audit

A fresh production build passed. The generated `profile-v2` HTML contains the Mastery component and loads exactly one Mastery browser bundle:

`dist/assets/DungeonMasteryPanel.astro_astro_type_script_index_0_lang.B90vWf1j.js`

The bundle contains `https://api.tnx6.xyz` and `/api/dungeon/mastery`, with no localhost, loopback, Windows path, fixture version/hash, finding ID, integrity-report text, user ID/username query, identity override, test/debug fixture, source map, or Mastery `POST`/`PUT`/`PATCH`/`DELETE` request. The legacy `profile-v2` HTML still contains unrelated pre-existing identity and mutation code; those tokens are absent from the isolated Mastery bundle. No deployment occurred.

### K2F-F09-R02 — dormant 404 retains the loading live-region text

- Severity: **Low**
- Review area: Step 9, state 14 — backend dormant `404 NOT_FOUND`
- Invariant: public, dormant-404, and disposed Mastery states must contain no stale live announcement after the panel is hidden.

Independent input:

- eligible self profile;
- exactly one canonical pending GET;
- response `HTTP 404` with `{ ok: false, error: { code: "NOT_FOUND", message: "not found" } }`.

Expected after completion:

- request count `1`;
- panel hidden;
- loading, body, Login, error, Retry, and Refresh hidden/inactive;
- Rank/Legacy, unlock, and grant state cleared;
- live-region text empty.

Actual after completion:

- request count `1`;
- panel and every control are correctly hidden/inactive;
- Rank/Legacy, unlock, and grant state are cleared;
- `[data-dma-announcer].textContent` remains `جاري تحميل تقدم الإتقان.`.

Because the root is hidden, the stale node is not currently exposed in the accessibility tree; severity is Low. It nevertheless violates the explicit dormant-state cleanup contract and leaves incorrect lifecycle state in the retained node.

### Retained smallest regression

One assertion was added to the existing F09 state-8 subtest:

`assert.equal(harness.node('[data-dma-announcer]').textContent, '');`

- Test path: `test/dungeon-mastery-ui.test.mjs`
- Retained test SHA-256: `2d86ce58e3179fa7a46bbf21a932d8ec7b9818c7a97beb0d46562d257f617703`
- Total tests: `135`
- Passed: `133`
- Failed: `2` TAP entries (the one failing child regression and its aggregate F09 parent)
- Sole root-cause failure: K2F-F09-R02

Production source was not changed and the defect was not repaired.

### 20-state matrix stopping point

States 1–13 passed their independently authored exact-input, one-request, visibility, loading, Rank/Legacy, unlock/grant, Retry, Refresh, Login, and lifecycle assertions. State 14 exposed K2F-F09-R02. Per the first-defect rule, states 15–20, cross-state transition spot checks, prior-gate sentinel reruns, and final full recertification were not continued after exposure.

### Complete finding inventory at stop

- K2F-F04-R01 — High — closed
- K2F-F04-R02 — Medium — closed
- K2F-F07-R01 — Medium — closed
- K2F-F07-R02 — Low — closed
- K2F-F09-R01 — Medium — closed
- K2F-F09-R02 — Low — open
- K2F-F12-R01 — Medium — closed

Open severity totals:

- Blocker: `0`
- High: `0`
- Medium: `0`
- Low: `1`

### Stop-state and prohibited-operation audit

- Frontend production-source repair: not performed
- Package, dependency, lockfile, configuration, backend, and protected-frontend modification: not performed
- Staging, commit, push, deployment, activation, migration, seed, and production-data mutation: not performed
- Broader defect hunting after the first confirmed defect: not performed
- Final clean classification and commit/PR readiness: not claimed

REVIEW STOPPED BEFORE FRONTEND REPAIR.

## 21. Current post-repair status

Section 19 is the preserved historical exposure record, section 20 records the authorized repair, and section 22 records the completed independent re-review and final recertification. Section 22 is the current authoritative disposition.

- Classification: `wp_k2_frontend_integrity_review_clean`
- K2F-F09-R02 — Low — independently closed
- F04, F07, F09, and F12: fully closed
- Complete UX matrix: `20/20`
- Cross-state transitions: `13/13`
- Open Blocker: `0`
- Open High: `0`
- Open Medium: `0`
- Open Low: `0`
- Complete WP-K2 frontend: `154/154`
- Dungeon Equipment: `13/13`
- Focused TypeScript, ESLint, Prettier, production build, artifact audit, fixture parity, and diagnostic comparison: clean
- New WP-K2 diagnostics: `0`
- Worsened unrelated diagnostics: `0`
- Overall frontend integrity closure and commit/PR readiness: confirmed

Final audit:

- Branch: `feat/wp-k2-dungeon-mastery`
- HEAD: `3f99b483554ece976fd1bd391cbfe8a1f3bb9a50`
- Index: empty
- Worktree: exactly 10 approved status paths
- `git diff --check`: pass
- New/untracked WP-K2 trailing whitespace: `0`
- Pre-existing unrelated trailing-whitespace lines in `src/pages/profile-v2.astro`: `16`, untouched
- Fixture/backend Git blob parity: `018ce8afc5ffe0a521e0ede03e04ef14d629c4b2`, byte-identical
- Dependency junction used for validation: removed
- Protected frontend: HEAD `80bb395ed71a5bcc613414c76a83ba62f9bf648d`, index empty, 13 existing status entries preserved

WP-K2 FRONTEND INTEGRITY REVIEW COMPLETE.
FRONTEND IS READY FOR COMMIT/PR READINESS AUDIT.
