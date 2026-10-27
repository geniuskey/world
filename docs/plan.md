# Implementation plan

Priority: a playable free MVP plus resource trading. External launch requirements are tracked separately.

## Phase 0

- [x] React/Vite, Workers/D1, migrations, environment examples, scripts
- [x] Shared schemas, strict types, CI and integration tests
- [x] Licensed static map asset and server feature gates

## Phase 1

- [x] Public world and regional chunks; ETags, drag/zoom/pinch
- [x] Google OAuth, secure sessions, local test login, profile
- [x] Atomic starter/claim, lazy energy/production, facilities
- [x] Account inventory/history, territory details, cached rankings
- [x] Rate limits, telemetry, authorized admin and reports
- [x] English/Korean, responsive layout, persistence and mobile E2E

## Phase 2

- [x] Escrow orders, buy/cancel, tax and immutable ledgers
- [x] Concurrency, retries and conservation tests
- [x] Season transition simulation and historical records
- [x] Reports and operator review
- [ ] Automated fraud heuristics (deferred)

## Phase 3

- [x] Display-only premium packs and cosmetic previews
- [ ] Provider/legal/refund/tax/age review (operator work)
- [ ] Payments/webhooks/refunds (deferred; disabled)

## Phase 4 (deferred)

- [ ] Alliances, invitations, share cards, regional expansion
- [ ] Broader localization, accessibility and cost/load review

## External launch gates

- [ ] Provision D1, OAuth, domain and production secrets
- [ ] Review terms/privacy/ratings for launch countries
- [ ] Verify live OAuth on two devices and collect actual retention data

## Validation

Validated locally on 2026-10-25:

- `npm run typecheck`: strict TypeScript passes.
- `npm test`: 28 scenarios pass under actual workerd/D1, including concurrent ownership and trades, escrow conservation, immutable ledgers, recovery/production, security boundaries, season transitions and persistent achievements.
- OAuth coverage uses a signed mock Google provider: PKCE, nonce, audience, signature, replay rejection and identity continuity across sessions pass.
- `npm run test:e2e`: 12 Chromium scenarios pass across desktop and 360px mobile, including signup/claim/build, reload persistence, separate buyer/seller browsers, localization, slow chunk responses, drag/pinch, hidden-tab polling and disabled payments/admin access.
- `npm run build`: production assets build; initial JavaScript is approximately 103 kB gzip, with secondary pages in a separate approximately 6 kB gzip chunk.
- `wrangler deploy --dry-run`: production Worker/assets package successfully; all unsafe feature flags and local authentication remain disabled.
- `npm audit`: zero known vulnerabilities in the installed dependency tree.
- Local D1 migrations and repeatable demo initialization execute successfully. A public chunk returns an ETag and a cache-hit response; conditional requests return 304.

Production OAuth/DNS/Cloudflare deployment and real-device/network measurements remain external launch checks. Automated fraud scoring, real payments and Phase 4 features remain deferred as specified above. Combat is dropped: land trading handles contested plots through bounded buyouts, protection and cooldowns.
