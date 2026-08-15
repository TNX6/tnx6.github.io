# WP-K2 Frontend Implementation Plan

## 1. Status and immutable scope

Planning classification: `ready_for_wp_k2_frontend_implementation`.

Implementation baseline:

- Repository: `TNX6/tnx6.github.io`
- Worktree: `frontend-wp-k2`
- Branch: `feat/wp-k2-dungeon-mastery`
- HEAD: `3f99b483554ece976fd1bd391cbfe8a1f3bb9a50`
- Backend public authority: `TNX6/tnx6-backend` merge `6323966c135abe5adf2c6e57fcfca56c77c327c7`
- Endpoint: exact credentialed self-only `GET /api/dungeon/mastery`

The implementation is one dormant, read-only, self-only Mastery panel. It does not include grants, mutations, account lookup, backend changes, deployment, activation, migration, seed, assets, navigation migration, or production configuration.

## 2. Frozen product decisions

| Decision | Required implementation |
|---|---|
| Audience | Backend-authorized owner/optional server allowlist only; frontend never authorizes. |
| History | Preserve newest-first response order, maximum 10, no pagination or limit input. |
| Identity | Signed-session self-only; no account selector, user ID, or public-profile request. |
| Location | `src/pages/profile-v2.astro`, immediately after Dungeon Equipment in `.v2-main-stack`. |
| Dormancy | Root hidden by default; 404 remains invisible for the page lifecycle; no coming-soon UI. |
| Rank 10 | Terminal complete Rank; no Rank 11; separate server-supplied Legacy interval. |
| Unlock content | Stable key, bilingual short label, granting rank, earned state only; no invented effect description. |
| Dependencies | No new npm dependency. |

## 3. Exact proposed file manifest

Only these implementation paths are proposed after a separate implementation authorization:

| Path | Existing/new | Purpose | Exact change | Dependencies / reason |
|---|---|---|---|---|
| `src/scripts/dungeon-mastery-model.ts` | new | Public contract, strict normalizer, read API, safe error classification | Define exact DTO types; reject missing/unknown/unsafe fields; enforce array bounds and cross-entry consistency; implement exact credentialed GET; expose safe local error predicates/copy | Browser Fetch/Abort APIs only. Keeps authority and network contract testable outside the DOM. |
| `src/components/profile/DungeonMasteryPanel.astro` | new | Accessible static state markup | Add hidden root with loading, login, safe error/retry, summary, Rank/Legacy progress, unlock, grant, empty-state, and polite announcer regions; accept `apiBase`/`loginUrl` props | Mirrors the successful Equipment component boundary without sharing mutation UI. |
| `src/scripts/dungeon-mastery-client.ts` | new | Lifecycle and safe rendering | Install panels once; suppress public profiles; wait for visible `#profileView`; abort on navigation/pagehide; load on demand; hide on 404; login on 401; clear stale state; render through text nodes only | Uses only the Mastery model and DOM APIs. No polling/storage. |
| `src/assets/styles/dungeon-mastery.css` | new | Scoped profile-consistent responsive styling | Style panel states, summary, bars, unlock/grant lists, RTL/LTR labels, breakpoints, focus, contrast, overflow, and reduced motion | Imported only by the component; no global asset/font/dependency. |
| `src/pages/profile-v2.astro` | existing | Canonical mount | Import `DungeonMasteryPanel`; mount `<DungeonMasteryPanel />` directly after `<DungeonEquipmentPanel />`, still inside `.v2-main-stack` and before `.v2-side-stack` | Two minimal lines/placements; no unrelated monolith edits. |
| `test/dungeon-mastery-ui.test.mjs` | new | Permanent frontend contract and privacy coverage | Unit-test normalizer/API/error classes; consume canonical fixture; inspect component/client/style/profile source for lifecycle, placement, accessibility, and prohibited patterns | Node built-in `node:test` and `node:assert/strict`; follows Equipment tests. |
| `test/fixtures/dungeon-mastery-overview-v1.json` | new | Cross-repository contract drift sentinel | Add byte-identical UTF-8/LF copy of the backend canonical comprehensive fixture | Hash must equal backend fixture before review signoff. |

No change is proposed to `package.json`, `package-lock.json`, Astro config, navigation, deployment files, static APIs, images, or backend code.

## 4. Model and strict contract design

### Public types

Define literal/readonly types matching the backend exactly:

- `DungeonMasteryRank = 0 | 1 | ... | 10`
- `DungeonMasteryResponse`
- `DungeonMasteryOverview`
- `DungeonMasteryRankProgress`
- `DungeonMasteryLegacyProgress`
- `DungeonMasteryUnlock`
- `DungeonMasteryRecentGrant`
- `DungeonMasteryErrorCode`
- `DungeonMasteryFetch`

### Strict normalization rules

1. Require a non-array record at every object boundary.
2. Require exact key sets at response, overview, Rank progress, Legacy progress, unlock, label, recent-grant, and error levels.
3. Require `ok === true`, exact `curveVersion`, safe integers, rank ranges, booleans/literals, and bounded strings.
4. Require `rankProgress.percent` in `0..100`; require terminal nulls and zero sentinels when `complete` is true.
5. Require `legacyProgress === null` below Rank 10 and a strict object at Rank 10; require literal `progressRequired === 250` without using that literal to derive Stars or progress.
6. Require at most 13 unlock entries, unique keys, `earned === true`, valid granting ranks, safe labels, and canonical response order as supplied.
7. Require at most 10 recent grants, canonical timestamps, positive deltas, safe post-state values, duplicate-free ascending crossed ranks, and duplicate-free semantic keys.
8. Require recent semantic keys to resolve to returned earned unlock entries; this is referential validation, not a client-side catalog.
9. Reject all partial/unknown/malformed responses before rendering anything.
10. Freeze or return fresh immutable normalized values so external code cannot mutate cached authority.

The normalizer must not contain Rank threshold arrays, `rankForProgress`, Legacy formulas, percent arithmetic, or fallback business defaults.

## 5. Exact API client

`DungeonMasteryApi.getOverview(signal)` performs:

```text
URL:    ${normalizedBaseUrl}/api/dungeon/mastery
method: GET
credentials: include
cache: no-store
signal: caller-owned AbortSignal
query: none
body: none
identity headers: none
```

Behavior:

- `200`: parse JSON, strictly normalize, return canonical overview.
- `401 + MASTERY_UNAUTHENTICATED`: throw typed unauthenticated error.
- `404 + NOT_FOUND`: throw typed feature-unavailable error.
- `400/405`: typed non-retryable contract failure with local safe copy.
- `500`, network error, JSON error, or malformed success: typed retryable safe failure.
- Never return or display backend `message`, response text, request ID, stack, or internal object.

The base URL prop is deployment wiring only. No account identifier can alter the endpoint.

## 6. Component markup plan

`DungeonMasteryPanel.astro` follows the Equipment component boundary but remains read-only.

Required regions:

1. Hidden root `<section data-dungeon-mastery-root hidden>` with a unique labelled heading.
2. Header with Arabic title, short explanatory copy, and optional manual refresh button only after successful/temporary-error states.
3. Polite atomic announcer.
4. Loading skeleton/status.
5. Login state with the existing Twitch login URL.
6. Safe error region with a retry button that is shown only for retryable local classifications.
7. Content region containing:
   - canonical Rank and total progress summary;
   - Rank interval progress or terminal Rank-10 completion;
   - separate Legacy Stars and interval when `legacyProgress` exists;
   - earned semantic unlock list/empty state;
   - newest grant list/empty state.

All buttons use `type="button"`. All response-driven strings use `textContent`/text nodes. The component contains no form, account input, data attribute carrying an identity/key, mutation button, entitlement claim, or response-driven HTML.

## 7. Client lifecycle and state machine

### Installation

- Export `installDungeonMasteryPanels()`.
- Install each root once using a dataset installation marker or instance registry.
- Register cleanup for `pagehide` and `astro:before-swap`; reinstall on `astro:page-load`.
- Use no timer or polling loop.

### Eligibility before request

1. If `new URLSearchParams(location.search).has('user')`, leave root hidden and return without constructing the API request.
2. Find `#profileView`; if absent, remain hidden.
3. Observe only the profile view's class until it becomes visible, matching Equipment behavior.
4. Begin a single read when the self profile becomes visible.

### State transitions

| From | Event | To | Required clearing |
|---|---|---|---|
| hidden | self profile visible | loading | Clear previous overview and visible content. |
| loading | strict success | content | Render complete overview atomically. |
| loading/content | manual retry | loading | Abort prior request and clear/hide old content first. |
| loading | 401 | login | Clear overview; show only login. |
| loading | 404 | hidden-final | Clear overview; disconnect observer; root remains non-focusable. |
| loading | retryable error | error-retryable | Clear overview; show safe local copy and retry. |
| loading | 400/405 | error-terminal | Clear overview; safe local copy, no retry. |
| any | pagehide/Astro swap | destroyed | Abort, disconnect observers, clear references. |
| any | public/account route transition | hidden/destroyed | Abort and clear; never retain another account's view. |

No stale Mastery content remains visible after failure, session/account transition, or navigation.

## 8. Rendering rules

### Summary and Rank 0-9

- Render `rank` and `progress` with Arabic number formatting.
- Use `rankProgress.percent` verbatim for CSS/ARIA.
- Use `progressIntoRank`, `progressRequired`, `remaining`, `nextRank`, and `nextRankThreshold` verbatim in visible text.
- Exact-threshold transitions are represented by the new server response, never detected locally.

### Rank 10 and Legacy

- When `rankProgress.complete`, announce Mastery Rank completion and suppress all next-Rank UI.
- Display exact `legacyStars`.
- When `legacyProgress` is non-null, render a separate Star interval with its own server values and ARIA.
- Never divide the Rank-10 zero denominator or construct a Rank 11.

### Unlocks

- Preserve array order.
- Render each entry as an earned semantic item with Arabic label, isolated English label, and granting Rank.
- Do not render keys as user-facing effects.
- Do not build locked/future entries from a client catalog.

### Recent grants

- Preserve response order and render no more than the already bounded response.
- Use locale date formatting and localized numeric formatting only.
- Show progress delta and canonical post-grant totals.
- Show supplied crossed ranks.
- Resolve supplied semantic keys against the response unlock map.
- Do not infer Star crossings or reconstruct progress-before.

## 9. Responsive and visual implementation

### Desktop

- Panel uses full width of `.v2-main-stack` after Equipment.
- Summary may use two columns: Rank/progress and Legacy/unlock count.
- Rank/Legacy bars remain full width with textual values.
- Unlocks may use a compact two-column grid where width permits.
- Grants use a vertical semantic list.

### Tablet

- At profile's existing collapse near `940px`, the main stack remains ahead of the side stack.
- Internal panel grid reduces columns without altering page structure.

### Mobile

- At `720px`/`600px`, all panel regions become one column.
- Grant metadata wraps; labels use `min-width: 0` and `overflow-wrap: anywhere`.
- English labels remain LTR within the RTL panel.
- Avoid nested horizontal scrolling; only a deliberately bounded chip row may wrap.

### Accessibility

- Semantic headings/lists.
- Text alternatives for every progress value; color is never the only signal.
- Progress ARIA reflects server values.
- Native login/retry/refresh controls with visible focus.
- Polite live announcements for loading, loaded, and safe failure state.
- Reduced-motion rule disables nonessential transitions.
- Hidden states contain no focusable descendants in the active accessibility tree.

## 10. Permanent test plan

### Unit tests: model/API

Add to `test/dungeon-mastery-ui.test.mjs`:

- exact canonical zero-state normalization;
- representative Rank 1 and intermediate Rank 2-9 normalization;
- just-before/exact-threshold fixtures accepted only as supplied;
- Rank 10 complete at 1100 with no next Rank;
- first and multiple Legacy Star cases with separate interval;
- exact 13-entry unlock state and ordering;
- empty/populated recent grants, maximum 10, supplied order preserved;
- rejection of unknown/missing keys, unsafe integers, invalid ranks/percent/nullability/timestamps, duplicate keys, over-bound arrays, and broken recent-unlock references;
- exact GET URL/options with `credentials: 'include'`, `cache: 'no-store'`, signal, and no query/body/identity headers;
- 401, 404, 400, 405, 500, network, invalid JSON, and unexpected DTO classifications;
- proof that backend raw text never reaches local UI messages.

### Component/client source-contract tests

- root hidden by default;
- loading/login/error/retry/content and polite live regions present;
- native button/link semantics and progress ARIA hooks;
- component imported and mounted directly after Equipment before side stack;
- public `?user` guard occurs before API construction/request;
- AbortController, pagehide, Astro swap/load, and observer cleanup present;
- no `setInterval`, polling, `localStorage`, `sessionStorage`, `innerHTML`, `set:html`, account input, `userId`, mutation method, or grant control;
- no threshold array, rank formula, Legacy formula, or percent arithmetic;
- responsive breakpoints, focus-visible, overflow protection, RTL/LTR isolation, and reduced-motion rule present.

### Integration checks

- Canonical frontend fixture bytes/SHA-256 equal the merged backend fixture.
- Strict frontend normalizer accepts that fixture.
- Existing `test/dungeon-equipment-ui.test.mjs` remains green.
- `npm run check` and `npm run build` pass.

### Manual visual verification

Because the repository has no browser component-test dependency, manually inspect after implementation at representative widths (desktop >= 1280px, tablet around 768-940px, mobile 360-430px):

- zero state;
- Rank 5/intermediate state;
- Rank 10 at 1100;
- one/multiple Legacy Stars;
- 13 unlocks;
- 10 recent grants with long bilingual labels;
- loading, login, 404-hidden, retryable failure;
- keyboard focus, screen-reader labels, RTL/LTR ordering, reduced motion, and no horizontal page overflow.

## 11. Security and privacy gates

Implementation is rejected if any of the following appears:

- `user`, `userId`, Twitch ID, or account selector in the Mastery request;
- an arbitrary account path/query/header;
- a non-GET Mastery call or mutation/grant control;
- client thresholds, rank derivation, Legacy Star formula, or unlock catalog authority;
- persistent Mastery response storage;
- raw error body/message display or console dump of the DTO;
- response-driven HTML or unsafe URLs;
- polling, background refresh while hidden, or stale response visibility;
- a request from a public `?user` profile;
- new dependency, config, backend, migration, asset, or activation scope.

Trust boundaries:

1. Browser/session cookie is opaque transport evidence; backend authentication is authoritative.
2. HTTP status/code controls local state classification only.
3. Strictly normalized success DTO is the only rendering input.
4. Formatting may change representation, never economic meaning.
5. Backend remains sole authority for eligibility, Rank, progress, Legacy, unlocks, and grant evidence.

## 12. Implementation phases and gates

### Phase A — reverify and establish contract

1. Reverify feature/protected worktree sentinels.
2. Copy the canonical backend fixture byte-for-byte and verify its SHA-256.
3. Add exact DTO types, strict normalizer, API, and focused model tests.
4. Gate: no threshold/Legacy/unlock catalog logic; focused tests pass.

### Phase B — component shell and presentation

1. Add the hidden Astro component and scoped CSS.
2. Implement loading/login/error/content regions and accessible progress structures.
3. Gate: no mutation/account input/assets; source-contract tests pass.

### Phase C — lifecycle client

1. Add public-profile suppression, profile visibility observer, abortable read, and cleanup.
2. Implement atomic safe rendering and stale-state clearing.
3. Implement 404 hidden, 401 login, terminal contract error, and retryable failure states.
4. Gate: no polling/storage/unsafe HTML; lifecycle tests pass.

### Phase D — profile integration

1. Import `DungeonMasteryPanel` in `profile-v2.astro`.
2. Mount directly after `<DungeonEquipmentPanel />` before the side stack.
3. Gate: no unrelated profile diff; Equipment tests remain green.

### Phase E — responsive and accessibility polish

1. Verify desktop/tablet/mobile hierarchy and overflow.
2. Verify RTL Arabic, LTR English labels, focus, progress ARIA, contrast, and reduced motion.
3. Gate: manual visual checklist completed without profile redesign.

### Phase F — validation

Run:

```text
node --test test/dungeon-mastery-ui.test.mjs
node --test test/dungeon-equipment-ui.test.mjs
npm run check
npm run build
git diff --check
```

Then verify the implementation diff contains exactly the seven planned paths, with no package/config/backend/protected changes.

### Phase G — frontend integrity and cross-contract review

1. Independently compare every public field/type/nullability/error with backend merge `6323966...`.
2. Compare fixture SHA-256 values and require byte identity.
3. Adversarially test privacy, identity, stale-data, malformed DTO, unsafe rendering, and dormancy boundaries.
4. Reverify protected frontend and backend sentinels.
5. Leave changes unstaged until a separate controlled commit/publish authorization.

## 13. Stop conditions

Stop implementation without compensating locally if:

- backend fixture/DTO differs from the merged public contract;
- a required presentation value is absent and would require business derivation;
- the clean feature worktree or protected frontend sentinel changes unexpectedly;
- implementation would require a dependency, config, backend, migration, navigation migration, or production change;
- any privacy/security gate cannot be satisfied;
- required focused tests fail for a relevant reason.

Record `backend_contract_gap` only for an objectively missing public value. No such gap exists at discovery completion.

## 14. Definition of frontend implementation complete

Implementation is complete only when the seven-path manifest is exact; the canonical fixture matches the backend; all user-visible Mastery values are server-authoritative; public profiles and 404 dormancy remain invisible; 401/retry/error states are safe; no stale or persistent data exists; Rank 10 has no Rank 11; Legacy is separate and server-driven; the 13 unlocks and newest 10 grants render without invented content; focused tests, checks, and build pass; and all protected worktrees remain unchanged.
