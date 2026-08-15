# WP-K2 Frontend Discovery Report

## Classification

`ready_for_wp_k2_frontend_implementation`

The merged backend contract is sufficient for a presentation-only frontend. All product decisions needed for the minimum UI were already approved in the canonical backend plan. No frontend source, configuration, package, lockfile, deployment, or activation change was made during this discovery pass.

## 1. Certified baselines and authority

- Frontend worktree: `frontend-wp-k2`
- Branch: `feat/wp-k2-dungeon-mastery`
- HEAD: `3f99b483554ece976fd1bd391cbfe8a1f3bb9a50`
- Starting index: empty
- Starting worktree: clean
- Protected frontend HEAD: `80bb395ed71a5bcc613414c76a83ba62f9bf648d`
- Protected frontend index: empty
- Protected frontend status: 13 pre-existing untracked paths
- Backend authority: `TNX6/tnx6-backend` live `main` at `6323966c135abe5adf2c6e57fcfca56c77c327c7`
- Backend PR: #7, merged
- Public route: exact `GET /api/dungeon/mastery`

Backend sources inspected at the merge commit:

- `src/dungeon/mastery-routes.ts`
- `src/dungeon/mastery-controller.ts`
- `src/dungeon/mastery-types.ts`
- `src/dungeon/mastery-errors.ts`
- `src/dungeon/mastery-validation.ts`
- `src/economy/mastery/view.ts`
- `src/economy/mastery/types.ts`
- `src/economy/mastery/repository.ts`
- `src/economy/mastery/catalog.ts`
- `docs/dungeon-economy-v1/WP_K2_IMPLEMENTATION_PLAN.md`
- `docs/dungeon-economy-v1/WP_K2_BACKEND_IMPLEMENTATION_REPORT.md`
- `docs/dungeon-economy-v1/WP_K2_BACKEND_INTEGRITY_REVIEW_REPORT.md`

## 2. Frontend architecture discovery

| Concern | Existing convention | WP-K2 consequence |
|---|---|---|
| Framework | Astro `^5.12.9`, static output, TypeScript, Tailwind `3.4.17`, AstroWind integration | Use an Astro component plus framework-free TypeScript client/model; do not introduce a client framework. |
| Routing | File routes under `src/pages`; `dashboard.astro` redirects to `/profile`; header account links currently point to `/profile` | The approved K2-04 decision nevertheless fixes this work package to `src/pages/profile-v2.astro`; no routing/navigation migration is added to WP-K2. |
| Profile V2 | Large existing page with skeleton, auth/login view, profile view, two-column `.v2-content`, `.v2-main-stack`, `.v2-side-stack` | Mount an isolated component rather than adding more Mastery behavior to the profile monolith. |
| Dungeon profile UI | `DungeonEquipmentPanel.astro` plus model/client/scoped CSS; mounted after inventory in `.v2-main-stack` | Reuse its component lifecycle and state architecture, not its mutation behavior. |
| API origin | Production clients use `https://api.tnx6.xyz`; Astro dev proxies `/api/dungeon` to the same origin | Give the component an `apiBase` prop defaulting to that origin, matching Dungeon Equipment. |
| Authentication | Signed backend session discovered through credentialed `/api/me`; authenticated API calls use `credentials: 'include'` and usually `cache: 'no-store'` | Mastery calls the self-only endpoint with the session cookie. It never reads, accepts, or sends a user ID. |
| Login | Existing Twitch login URL is `https://api.tnx6.xyz/auth/twitch/login` | Reuse it as a component prop/default for the 401 state. |
| Public profiles | `profile-v2` supports `?user=...`; owner controls and Dungeon Equipment are suppressed for public-profile URLs | Mastery must remain hidden and make no request whenever the `user` parameter exists, even if it names the signed-in account. |
| Loading/error UI | No generic shared state component; Dungeon Equipment has dedicated hidden/loading/login/error/retry/content regions and a polite announcer | Create a dedicated Mastery panel following that proven pattern; a generic abstraction would not have real reuse. |
| Cards and layout | Profile V2 uses dark translucent, gold-accented cards and grid stacks; Dungeon Equipment is a scoped full panel | Mastery uses a scoped panel consistent with those colors, radius, spacing, and typography. |
| Responsive behavior | Profile columns collapse at `940px`; mobile refinements appear at `600px`; Equipment uses `720px` and `420px` plus overflow-safe content | Desktop panel stays in the main column; tablet/mobile naturally stack main before side content; internal grids collapse without horizontal page overflow. |
| RTL/localization | Global site config is English/LTR, while TNX6 account pages explicitly set Arabic `dir="rtl"`; utility components support RTL; backend supplies Arabic and English unlock labels | Arabic is primary. English labels are isolated with `lang="en" dir="ltr"`. No new translation system is warranted. |
| Theme | Site supports system light/dark globally, but profile-v2 and Dungeon UI use a bespoke dark/gold visual system | Match the profile/dungeon surface; keep selectors scoped and preserve global theme behavior. |
| Testing | Permanent frontend tests use Node's built-in `node:test`, `node:assert/strict`, direct `.ts` imports, and source-contract assertions; no DOM/component harness is installed | Unit-test normalization/API behavior directly, assert component/client/style integration from source, and use manual browser verification for actual responsive visuals. |
| Fixtures | Existing tests build local fixtures; approved WP-K2 plan mandates a cross-repository canonical JSON fixture | Add the exact backend fixture under `test/fixtures` and require byte/hash parity during cross-contract review. |

No reusable generic authenticated-fetch wrapper exists. The closest correct convention is the domain-specific `DungeonEquipmentApi`, which owns its exact endpoint behavior and safe error classification. Mastery should follow that pattern with a smaller read-only API class.

## 3. Canonical UI location

### Selected location

- Page: `src/pages/profile-v2.astro` (`/profile-v2`)
- Component: new `src/components/profile/DungeonMasteryPanel.astro`
- Exact mount: immediately after `<DungeonEquipmentPanel />` inside `.v2-main-stack`, before `<aside class="v2-side-stack">`
- Desktop: after the inventory and equipment panels in the primary profile column; badges and next-badge content remain in the side column.
- Tablet: once `.v2-content` collapses, the primary stack remains first; Mastery follows Equipment and precedes the former side-stack content.
- Mobile: one-column panel; summary, progress, unlocks, and grants stack vertically with wrapping labels and no horizontal page scroll.

### Placement comparison

| Candidate | Finding | Decision |
|---|---|---|
| `profile-v2` | Already contains authenticated account state and the Dungeon Equipment panel architecture; supports the necessary owner/public-profile distinction | Selected by approved owner decision K2-04. |
| `/dungeon` | Primarily a live/public run viewer; its viewer reads intentionally omit credentials and it is not the account progression hierarchy | Rejected for the canonical panel. No duplicate summary is added. |
| `/dashboard` | Redirect-only page to `/profile` | Rejected. |
| `/profile` | Current header/dashboard destination but older, duplicated profile implementation without the approved Equipment panel architecture | Not changed by this work package. K2-04 explicitly selected `profile-v2`; navigation migration is outside this minimum panel. |

## 4. Exact public success contract

Every listed property is required unless explicitly marked nullable. Objects must contain only the documented keys; arrays must contain only strictly validated items. Numeric values are non-negative safe integers unless a narrower range is shown.

### Response and overview

| JSON path | Backend type | Presence | Meaning | Frontend presentation and permitted derivation | Zero state | Rank 10 / Legacy behavior |
|---|---|---|---|---|---|---|
| `ok` | literal `true` | required | Success discriminator | Validate only; do not display | `true` | unchanged |
| `mastery` | `MasteryOverviewView` | required | Canonical public projection | Sole content authority | canonical object | canonical object |
| `mastery.curveVersion` | `'dungeon_mastery_curve_v1'` | required | Immutable curve identity | Validate exact literal; normally not user-visible | same literal | same literal |
| `mastery.progress` | `number` | required | Canonical accumulated Mastery progress | Display formatted number; never recalculate from grants | `0` | `>=1100`; remains canonical beyond Rank 10 |
| `mastery.rank` | `0\|1\|...\|10` | required | Canonical earned rank | Display exactly; do not derive from progress | `0` | exactly `10`; never invent Rank 11 |
| `mastery.legacyStars` | `number` | required | Canonical Legacy Stars | Display exactly; do not derive from progress | `0` | `0+`, server-derived |
| `mastery.rankProgress` | object | required | Canonical progress within/through Rank track | Drive Rank text/bar only from its fields | see below | complete terminal state |
| `mastery.legacyProgress` | object or `null` | required, nullable | Canonical progress toward the next Legacy Star | Render only when non-null; never derive interval locally | `null` | required object for valid Rank 10 state |
| `mastery.unlocks` | readonly unlock array | required | Canonical cumulative earned semantic unlocks | Preserve backend order; display earned labels only | `[]` | exact 13 entries at Rank 10 |
| `mastery.recentGrants` | readonly grant array | required | Newest safe grant summaries | Preserve server order; no pagination | `[]` | remains newest-first and bounded |

### Rank progress

| JSON path | Type | Presence | Meaning / presentation | Zero state | Rank 10 |
|---|---|---|---|---|---|
| `rankProgress.complete` | `boolean` | required | Selects active Rank progress versus terminal completion copy | `false` | `true` |
| `rankProgress.currentRankThreshold` | `number` | required | Canonical lower threshold; display only if useful | `0` | `1100` |
| `rankProgress.nextRank` | `1..10 \| null` | required, nullable | Next rank label | `1` | `null`; no fake next rank |
| `rankProgress.nextRankThreshold` | `number \| null` | required, nullable | Canonical next threshold | `20` | `null` |
| `rankProgress.progressIntoRank` | `number` | required | Numerator text/ARIA for current interval | `0` | `0` terminal sentinel |
| `rankProgress.progressRequired` | `number` | required | Denominator text/ARIA for current interval | `20` | `0` terminal sentinel; never divide by it |
| `rankProgress.remaining` | `number` | required | Canonical amount remaining | `20` | `0` |
| `rankProgress.percent` | integer `0..100` | required | Width and `aria-valuenow`; use verbatim | `0` | `100` |

For Rank 0-9, the frontend may format and interpolate these values into copy. It may not reconstruct thresholds, remaining progress, percentage, or rank from `progress`. At an exact threshold, it renders the new rank and the new server-provided interval. At Rank 10, the Rank area announces completion and does not render a Rank 11 target.

### Legacy progress

| JSON path | Type | Presence | Meaning / presentation | First Rank-10 state at 1100 | After Stars |
|---|---|---|---|---|---|
| `legacyProgress.nextStar` | `number` | required when object | Canonical next Star number | `1` | `legacyStars + 1`, but frontend uses field directly |
| `legacyProgress.nextStarThreshold` | `number` | required when object | Canonical threshold label | `1350` | server value |
| `legacyProgress.progressIntoInterval` | `number` | required when object | Interval numerator | `0` | server value |
| `legacyProgress.progressRequired` | literal `250` | required when object | Interval denominator | `250` | `250` |
| `legacyProgress.remaining` | `number` | required when object | Canonical amount remaining | `250` | server value |
| `legacyProgress.percent` | integer `0..99` | required when object | Legacy bar width and ARIA | `0` | server value; resets after a Star |

The UI may display and format these values only. It must not calculate `floor((progress - 1100) / 250)` or reconstruct an interval.

### Semantic unlock entries

| JSON path | Type | Presence | Meaning | Presentation / derivation |
|---|---|---|---|---|
| `unlocks[].key` | non-empty bounded `string` | required | Stable semantic identity | Internal list key and recent-grant label lookup only; do not expose as gameplay prose. |
| `unlocks[].grantingRank` | `1..10` | required | Canonical granting rank | Display as “رتبة N” if useful. |
| `unlocks[].earned` | literal `true` | required | Confirms entry is earned | Render earned styling; no client entitlement claim beyond this value. |
| `unlocks[].label.ar` | bounded `string` | required | Authoritative Arabic label | Primary visible label via `textContent`. |
| `unlocks[].label.en` | bounded `string` | required | Authoritative English label | Secondary visible label with `lang="en" dir="ltr"`. |

The public response contains earned entries only. It does not expose the complete future catalog to lower ranks, so the frontend must not fabricate locked entries, gameplay effects, or descriptions. Rank 10 canonically contains all 13 cumulative unlocks. Zero state shows an empty earned-unlocks message.

### Recent grant entries

| JSON path | Type | Presence | Meaning | Presentation / derivation |
|---|---|---|---|---|
| `recentGrants[].createdAt` | canonical UTC timestamp `string` | required | Grant time | Format with `Intl.DateTimeFormat` for Arabic locale; preserve server ordering. |
| `recentGrants[].progressDelta` | positive safe integer | required | Progress added by this grant | Display with a localized leading `+`; formatting only. |
| `recentGrants[].progressAfter` | non-negative safe integer | required | Canonical progress after grant | Optional secondary total; do not sum history. |
| `recentGrants[].rankAfter` | `0..10` | required | Canonical rank after grant | Display result state. |
| `recentGrants[].legacyStarsAfter` | non-negative safe integer | required | Canonical Stars after grant | At Rank 10, display as post-grant total; do not claim a Star crossing because “before” is not public. |
| `recentGrants[].crossedRanks` | readonly ascending `1..10[]` | required | Canonical ranks crossed by this grant | Render rank chips/text in supplied order. |
| `recentGrants[].semanticUnlockKeys` | readonly `string[]` | required | Canonical unlock keys earned by this grant | Resolve labels only against the authoritative `unlocks` array in the same response; no local catalog. |

The repository hard-bounds the result to 10 rows, ordered by `created_at DESC, grant_id DESC`. `grant_id` is not public. The frontend preserves array order, does not re-sort, paginate, or request a limit.

### Explicitly absent public evidence

The frontend must reject or ignore no extra success properties; strict normalization should reject contract drift. The public DTO intentionally omits account/Twitch identity, state version, state timestamps, grant/source/transaction/audit/request IDs, correlation IDs, curve fingerprint, snapshots, reconciliation/idempotency facts, provenance, `progressBefore`, and `rankBefore`.

## 5. Error contract and UI classification

Errors have the wire shape `{ ok: false, error: { code, message } }`. The frontend classifies by HTTP status plus stable code and never displays the backend message or response body.

| Condition | HTTP | Code | Frontend result |
|---|---:|---|---|
| Flag disabled | 404 | `NOT_FOUND` | Keep panel fully hidden for the page lifecycle; no retry. |
| Authenticated but not owner/allowlisted | 404 | `NOT_FOUND` | Indistinguishable from disabled; keep hidden. |
| Session absent/expired | 401 | `MASTERY_UNAUTHENTICATED` | Show bounded login state and Twitch login action. |
| Query/body/untrusted credentialed origin | 400 | `MASTERY_VALIDATION_ERROR` | Conforming client should never cause this; show safe unavailable state without raw details or automatic retry. |
| Wrong method | 405 | `MASTERY_METHOD_NOT_ALLOWED` | Contract/client defect; safe unavailable state, no raw details. |
| D1/evidence/curve/internal failure | 500 | `MASTERY_READ_UNAVAILABLE` | Safe retryable error; clear/hide content first. |
| Network failure | n/a | local classification | Safe retryable error; no stale data. |
| Malformed/unknown success DTO | 200 but invalid | local `invalid_response` classification | Fail closed into safe retryable error; no partial rendering. |

No externally visible state attempts to distinguish ineligible users from a disabled route.

## 6. Authentication and session integration

1. Component default API origin is `https://api.tnx6.xyz`; the browser request is cross-origin even when the site uses a custom TNX6 host.
2. `DungeonMasteryApi.getOverview(signal)` sends exactly one `GET` to `${apiBase}/api/dungeon/mastery` with `credentials: 'include'`, `cache: 'no-store'`, and the supplied abort signal.
3. It sends no query, body, account path segment, user ID, Twitch ID, authorization identity header, or mutation request.
4. The signed session cookie and backend `getAuthenticatedUser` resolve the canonical account. The frontend does not use profile data as authorization evidence.
5. Existing backend trusted-origin/CORS behavior remains authoritative. The client cannot loosen SameSite, CORS, allowlist, or owner checks.
6. `profile-v2` already calls credentialed `/api/me` to decide whether to show the self profile. Mastery still handles 401 independently because sessions can expire between calls.
7. If the URL has a `user` query parameter, the Mastery client makes no request and leaves the root hidden. It does not compare the parameter to the current account.
8. No Mastery response is stored in `localStorage`, `sessionStorage`, IndexedDB, or persistent cache.

## 7. Dormancy behavior

Approved decisions K2-01, K2-04, and K2-05 require behavior A: **no visible Mastery UI while the backend read feature is disabled**.

- Root markup starts `hidden`.
- The client waits until `#profileView` is visible before loading.
- A backend `404 NOT_FOUND` hides the panel permanently for that page lifecycle.
- Public-profile URLs make no request and remain hidden.
- There is no frontend feature flag, production configuration change, coming-soon copy, polling, or activation behavior.
- Backend grant functionality remains absent/off and no frontend grant operation exists.

## 8. UX state matrix

Raw backend text is hidden in every state. “Stale visible” is always **no**: before a request/account transition and on every non-success result, prior Mastery content is cleared or hidden.

| # | State | What the user sees | Retry | Login action | Stale visible |
|---:|---|---|---|---|---|
| 1 | Loading | Visible panel skeleton/status after self profile becomes visible; polite “loading” announcement | No | No | No |
| 2 | Authenticated canonical zero state | Rank 0, progress `0`, next Rank 1 at `20`, `0%`, no unlocks, no grants, “لم تبدأ رحلة الإتقان بعد” style copy | No | No | No |
| 3 | Rank 1 | Exact Rank 1, backend interval values, earned Rank-1 labels, grants if present | No | No | No |
| 4 | Rank 2-9 | Exact current Rank, next-rank target, remaining and percentage, cumulative earned labels | No | No | No |
| 5 | Just before next rank | Backend percentage (maximum 99 before crossing) and exact `remaining`, commonly 1 | No | No | No |
| 6 | Exact threshold | New server-provided rank and new interval; no client boundary inference | No | No | No |
| 7 | Rank 10 at 1100 | Rank track says complete, no Rank 11; zero Stars; separate next-Star 1 progress `0/250` | No | No | No |
| 8 | Rank 10 before first Star | Rank complete plus server Legacy interval, up to `99%` and exact remaining | No | No | No |
| 9 | First Legacy Star | `1` Star and newly reset server interval toward Star 2 | No | No | No |
| 10 | Multiple Legacy Stars | Exact Star count and separate next-Star interval | No | No | No |
| 11 | All 13 unlocks | Ordered cumulative 13-entry earned list with Arabic/English labels and granting ranks | No | No | No |
| 12 | Recent grants empty | Bounded empty copy; no pagination affordance | No | No | No |
| 13 | Recent grants populated | Up to 10 server-ordered entries with localized time, delta, post-state, crossed ranks, and authoritative unlock labels | No | No | No |
| 14 | Backend disabled | No Mastery panel or focus target | No | No | No |
| 15 | Unauthenticated | Login state with Twitch action | No | Yes | No |
| 16 | Forbidden/not allowlisted | Same invisible state as disabled; distinction is not exposed | No | No | No |
| 17 | Validation error | Safe generic unavailable copy; no raw reason | No | No | No |
| 18 | Read unavailable/integrity failure | Safe temporary error with retry | Yes | No | No |
| 19 | Network error | Safe connectivity error with retry | Yes | No | No |
| 20 | Unexpected response | Fail-closed safe error with retry; no partial fields | Yes | No | No |

## 9. Presentation rules

### Rank and progress

- Render `rank`, `progress`, `rankProgress.nextRank`, `nextRankThreshold`, `progressIntoRank`, `progressRequired`, `remaining`, and `percent` directly.
- Pure presentation calculations are limited to number formatting, date formatting, string interpolation, choosing complete/active templates, and setting a CSS percentage from the already canonical `percent`.
- Forbidden calculations include threshold lookup, rank derivation, remaining subtraction, percent computation, or rebuilding the curve.
- Rank 0 is a valid canonical zero state, not an error.
- At Rank 10, use `rankProgress.complete` and terminal copy; do not divide by the zero `progressRequired` sentinel and do not show Rank 11.

### Legacy Stars

- Visible only when `legacyProgress` is non-null.
- Display exact `legacyStars` separately from Rank.
- Drive next-Star number, threshold, interval numerator/denominator, remaining, and percentage from `legacyProgress`.
- No client implementation of the 1100/250 formulas.

### Semantic unlocks

- Preserve backend ordering.
- Show only earned entries returned by the backend.
- Primary Arabic and secondary English labels are authoritative; optional granting-rank text uses `grantingRank`.
- Do not show invented effects, descriptions, assets, entitlement fulfillment, or locked future items.
- At zero, show a short empty earned-unlocks state. At Rank 10, the normal response contains all 13 entries.

### Recent grants

- Preserve newest-first order and maximum 10 entries.
- Format timestamps with `Intl.DateTimeFormat`; invalid timestamps are rejected by strict normalization instead of rendered as raw strings.
- Show `+progressDelta`, `progressAfter`, `rankAfter`, and `legacyStarsAfter` as canonical post-grant facts.
- Render `crossedRanks` directly.
- Resolve each `semanticUnlockKey` through the response's earned-unlock map. If referential consistency fails, reject the response rather than invent a label.
- Do not infer Legacy Star crossings from delta/progress, and do not add pagination.

## 10. Responsive and accessibility strategy

- Desktop: panel occupies the profile V2 primary column after Equipment. A compact summary header leads to Rank/Legacy progress, then unlocks and recent grants.
- Tablet: internal summary/unlock grids reduce columns; the page's existing `940px` collapse keeps main-stack order ahead of the side stack.
- Mobile: single-column blocks; grant metadata wraps; English labels use isolated LTR spans; long labels use `overflow-wrap: anywhere`; no horizontal page scroll.
- Bars provide visible text and `role="progressbar"`, `aria-valuemin`, `aria-valuemax`, `aria-valuenow`, and accurate `aria-valuetext`.
- Rank 10 is announced as complete, not as a 100% journey to an absent Rank 11.
- Loading/errors use a polite live region. Unlocks and grants are semantic sections/lists.
- Login and retry are native keyboard-accessible controls with visible `:focus-visible` treatment.
- Contrast follows profile/equipment gold-on-dark conventions.
- Nonessential transitions are disabled under `prefers-reduced-motion: reduce`.

## 11. Security and privacy proof

| Boundary | Planned proof |
|---|---|
| Identity | Endpoint URL is constant and contains no identity. No user/account input or identity header exists. Public `?user` pages perform no request. |
| Method | Only GET is implemented; no POST/PUT/PATCH/DELETE path or grant control exists. |
| Economic authority | Rank, progress, thresholds, percent, remaining, Stars, unlocks, and grant summaries come from the strict backend DTO. |
| Privacy | DTO normalizer permits only public keys. No response persistence, analytics payload, console dump, or cross-account cache is added. |
| Error privacy | UI maps status/code to local bounded copy and never renders backend messages, SQL, stack, request IDs, or internal evidence. |
| DOM safety | Every response string is assigned through `textContent` or text nodes. No response-driven `innerHTML`, `set:html`, or unsafe URL is used. |
| Lifecycle | Abort in-flight reads on page hide/Astro swap; clear state before reload and after account/navigation change; no polling. |
| Dormancy | 404 and public-profile states leave the entire root hidden and non-focusable. |

## 12. Dependency decision

No new npm dependency is required. Astro, TypeScript, browser DOM APIs, `Intl`, and Node's built-in test runner cover the complete scope. `package.json` and `package-lock.json` must remain unchanged.

## 13. Backend contract gaps

None.

The DTO exposes every objectively necessary presentation value. It intentionally does not expose locked future unlocks, rich effect descriptions, or Legacy crossing-before values; the minimum UI does not require them and must not compensate with client-side business logic.

## 14. Owner decisions

None outstanding.

The authoritative implementation plan records K2-01 through K2-08 as owner-approved. In particular:

- K2-04 fixes the page and component architecture to `profile-v2` after Dungeon Equipment.
- K2-05 fixes hidden-by-default dormancy through exact backend 404 behavior.
- K2-02 fixes newest 10 grants without pagination.
- K2-06 fixes terminal Rank 10 plus separate server-derived Legacy progress.
- K2-07 fixes semantic keys with short bilingual labels only.

## 15. Discovery conclusion

The frontend can proceed without backend work, package installation, production configuration, or further product decisions. Implementation must remain the minimum isolated panel described here and in `WP_K2_FRONTEND_IMPLEMENTATION_PLAN.md`.
