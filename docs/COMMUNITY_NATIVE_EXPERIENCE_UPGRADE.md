# Native Community Experience Upgrade

Status: implemented locally; manual product QA, commit, push, tag, and release are on hold

Source contract: the canonical `docs/COMMUNITY_SURFACE_PARITY.md` remains only in the `sol-site` repository. It is intentionally not copied into this repository.

## Local implementation checkpoint — 2026-08-10

- Native onboarding, profile editing, affirmation sharing, reporting, blocking, and focused-window membership refresh are implemented.
- Community browser-handoff code has been removed and guarded by a source-level regression test.
- The typed website API client reuses the existing membership, profile, shareable-library, share, report, and block endpoints.
- Automated result: the full test suite passes; TypeScript and Svelte checks report zero errors and zero warnings; the production build succeeds.
- Public-tree, brand-context, and packaged-VSIX audits pass. The local VSIX installs successfully into an isolated VS Code profile.
- Manual account-state, theme, accessibility, and screenshot QA remains for the user before any release decision.

## Outcome

Every Glow Community action should complete inside the VS Code extension. A signed-in user can join, create and edit a profile, share an affirmation, report a message, and block or unblock a member without being sent to the website.

This plan removes Community browser handoffs. Existing account authentication and secure billing checkout are separate platform flows and remain unchanged unless they are explicitly included in a later task.

## Release hold

- Do not commit these changes until the user approves the complete patch set.
- Do not push a branch or open a pull request yet.
- Do not change the package version yet.
- Do not tag, publish, deploy, or create a release yet.
- Keep all work local so additional fixes can join the same release candidate.

## Current gaps

| Capability         | Website                          | Extension now                             | Required extension behavior                                      |
| ------------------ | -------------------------------- | ----------------------------------------- | ---------------------------------------------------------------- |
| Join Community     | One-button native web onboarding | “Set up profile” opens the browser        | One-button native onboarding with inline conflict recovery       |
| Create profile     | Created as part of join          | Browser handoff                           | Created by the shared membership endpoint                        |
| Edit profile       | Native web form                  | Browser handoff from the profile surface  | Native editor matching the web fields and validation             |
| Share affirmation  | Native web composer              | Floating compose action opens the browser | Native source picker and share feedback                          |
| Report message     | Native web dialog                | Not implemented                           | Native reason/details dialog using server permissions            |
| Block member       | Native web confirmation          | Not implemented                           | Native block/unblock confirmation using server permissions       |
| Membership refresh | Server load refreshes the page   | Open `not_member` state can remain stale  | Refresh immediately after join and when the focused host returns |

## Existing server contracts to reuse

No new Supabase client mutation, database schema, RLS policy, service credential, or extension-specific backend contract is expected.

The extension continues to call the authenticated website API with its existing bearer session:

| Action                                          | Contract                                                                                                              |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Read membership                                 | `GET /api/v1/community/membership`                                                                                    |
| Join default Community space and create profile | `PUT /api/v1/community/membership`                                                                                    |
| Read the signed-in profile                      | Existing membership response followed by `GET /api/v1/community/profiles/:handle` when full profile fields are needed |
| Edit profile                                    | `PUT /api/v1/community/profile`                                                                                       |
| List shareable personal affirmations            | `GET /api/v1/community/affirmations/shareable`                                                                        |
| Share an affirmation                            | `POST /api/v1/community/affirmations/share`                                                                           |
| Report a message                                | `POST /api/v1/community/reports`                                                                                      |
| Block a member                                  | `PUT /api/v1/community/blocks/:userId`                                                                                |
| Unblock a member                                | `DELETE /api/v1/community/blocks/:userId`                                                                             |

The website API remains authoritative for authentication, membership, Premium eligibility, permissions, handle uniqueness, moderation, and returned profile state. The extension must not infer authorization from local UI state.

## Implementation plan

### 1. Extend the typed Community client

- Add types and parsers for join results, profile updates, shareable affirmations, share results, reports, and block results.
- Add `CommunityClient` methods for each existing endpoint above.
- Use the same bounded values and error codes as the website contract.
- Preserve one automatic access-token refresh on authentication failure through the existing request path.
- Map `handle_taken`, `invalid_profile`, `account_restricted`, `membership_restricted`, `premium_required`, `not_member`, `not_found`, rate limiting, offline, and service errors into actionable extension messages.
- Do not expose raw server errors, tokens, or user content in logs.

### 2. Replace `not_member` with native onboarding

- Expand the panel state from a bare `not_member` marker to an onboarding model containing the suggested handle, display name, avatar URL, pending state, and field/form feedback.
- Derive the initial handle with the same normalization used by the website: username first, then display name, then a stable `glow_<user-id-prefix>` fallback.
- Present the website-equivalent one-button “Join the community” entry state.
- Submit the join request inside the extension and guard against duplicate submissions.
- If the suggested handle is taken, reveal an inline handle field, preserve the entered display name, focus the field, and let the user retry without leaving Community.
- On success, replace onboarding with the ready Community state immediately and load channels, affirmations, and profile identity without reopening the tab.
- Preserve the onboarding state on a recoverable network failure and provide a native retry action.

### 3. Add native profile creation and editing

- Treat profile creation as part of the native join operation rather than a separate browser step.
- Add an Edit action to the signed-in member’s native profile view.
- Reuse the website fields: handle, display name, bio, and HTTPS avatar URL.
- Match website limits and normalization, with inline validation before the request and authoritative error handling after it.
- Keep the current profile visible until a successful response arrives; do not optimistically replace identity fields that the server has not accepted.
- Reconcile the updated handle everywhere in the current snapshot, menus, authorship labels, and account-scoped surface state.

### 4. Add native affirmation sharing

- Replace the floating compose browser handoff with a native Community composer.
- Load the server-provided shareable personal-affirmation list when the composer opens.
- Match the website selection model and empty state.
- Submit one selected source affirmation with a client nonce through the shared share endpoint.
- Enforce Premium only through the API response; the client may explain eligibility but must not grant it.
- Handle `shared`, `already_shared`, missing source, nonce conflict, posting restriction, and unavailable-channel responses.
- Insert or reconcile the shared item through an authoritative feed refresh, then close the composer and show native success feedback.

### 5. Add native report and block flows

- Expose Report and Block only when each message’s server-returned permissions allow it.
- Port the website’s report reasons, optional details field, limits, confirmation, pending state, success state, and retry behavior.
- Add block and unblock confirmation to member/message actions using the target user ID returned by the API model.
- After blocking, rehydrate the active feed and chat so server filtering removes affected content; do not hide content solely through a local filter.
- Keep report IDs and moderation details out of ordinary UI and logs.

### 6. Remove Community web handoffs

- Remove the `openCommunityOnWeb` webview message and `openOnWeb` controller method.
- Remove the `profile`, `compose`, and unused `chats` destinations from the extension Community contract.
- Replace every Community external-link label, tooltip, and accessibility name with its native action.
- Add a source-level test that fails if a Community UI action reintroduces `openCommunityOnWeb`, `COMMUNITY_URL`, or `vscode.env.openExternal`.
- Keep secure billing and account-auth flows outside this Community-specific guard.

### 7. Make membership refresh deterministic

- Reload membership immediately after a successful native join.
- While onboarding is visible, recheck membership when the VS Code host regains focus, with request deduplication and a short cooldown.
- Add a visible native Refresh action for recoverable or cross-device membership changes.
- Use the existing load sequence to discard stale responses when the panel closes, the user signs out, or a newer request wins.
- Clear onboarding state and caches when the signed-in user changes.

### 8. Match the website experience

- Port the website’s hierarchy, copy, spacing, typography, control sizes, disabled/pending states, and responsive behavior instead of creating an extension-only settings form.
- Verify the join screen, handle-conflict recovery, profile editor, affirmation composer, report dialog, and block confirmation in dark, light, editor-following, and high-contrast themes.
- Maintain keyboard operation, visible focus, Escape dismissal, dialog focus containment, descriptive errors, and screen-reader labels.
- Keep Community content responsive at the narrow editor widths where the chat channel grid is already supported.

## State-management rules

- Membership state is server-authoritative and must be refreshed after every membership mutation.
- Only one join, profile update, share, report, or block request of its kind may be pending at a time.
- A late response may not overwrite a newer user, panel, profile, channel, or dialog state.
- Closing a dialog cancels its presentation state but does not pretend an in-flight server request was cancelled.
- Failed mutations preserve user input and expose retry without duplicating successful requests.
- Signing out clears drafts containing profile or moderation content.
- Offline state disables mutations but keeps entered local form values until sign-out or successful completion.

## Test plan

### Client contract tests

- Correct HTTP method, endpoint, bearer authentication, headers, and payload for every new method.
- One refresh-and-retry path for expired access tokens.
- Strict parsing of success and error responses.
- Handle conflict, account restriction, membership restriction, Premium restriction, rate limit, malformed response, and service failure.

### Panel/state tests

- Signed-out, offline, not-member, joining, handle-conflict, joined, and retry states.
- A successful join transitions directly to `ready` without closing the tab.
- Duplicate clicks send one join request.
- Stale join/profile responses cannot overwrite a changed account.
- Host-focus refresh detects a membership created on another surface.
- Profile edits update the active identity only after server acceptance.
- Share success refreshes the feed once; retries reuse safe nonce behavior.
- Report and block actions obey server permissions and reconcile from the API.

### UI and accessibility tests

- Keyboard-only join, edit, compose, report, block, cancel, and retry.
- Focus placement after handle conflict and after dialog close.
- Narrow and wide Community panels.
- Dark, light, editor-following, and high-contrast screenshots.
- No Community action contains an external-link icon or browser-handoff copy.

### Regression tests

- Existing affirmation feed, profile viewing, reactions, library import, chats, Realtime, unread replies, read receipts, bulk deletion, and cached-channel continuity.
- Free users can join, browse, and read the bounded chat preview.
- Premium checks remain server-side for sharing and posting.
- Signed-out and expired-session states remain safe.
- Public-tree, VSIX-content, brand, dependency, and private TTS-provider/voice audits still pass.

## Acceptance criteria

- A newly signed-in non-member can join Community without leaving VS Code.
- The same open Community tab becomes ready immediately after joining.
- Handle conflicts and recoverable failures can be resolved inline.
- The user can edit their complete Community profile natively.
- A Premium user can select and share a personal affirmation natively.
- Allowed report, block, and unblock operations complete natively.
- No Community UI action opens `justglow.dev`.
- Website and extension use the same endpoints, validation boundaries, permission results, and visual interaction model.
- All planned tests pass from a clean checkout and an installable local VSIX passes manual smoke testing.

## Work ownership

### Codex

- Keep the canonical parity log synchronized in `sol-site` without creating a second copy here.
- Implement typed client methods, controller states, native UI, and error mapping.
- Add automated coverage and run the full extension verification suite.
- Build and install a local VSIX for user testing when the patch set is ready.
- Do not commit, push, tag, or publish until explicitly told.

### User

- Review the native onboarding, profile, compose, report, and block screenshots/interactions.
- Test with a new non-member account, an existing Free member, and an existing Premium member.
- Decide which additional fixes belong in the same release.
- Approve the final version number, commit, push, tag, and publication as separate steps.

## Delivery order

1. Update the ignored parity matrix from `web only`/`planned` to `in progress` before implementation.
2. Add client contracts and tests.
3. Ship native join and deterministic refresh.
4. Ship native profile editing.
5. Ship native affirmation sharing.
6. Ship native report/block flows.
7. Remove Community handoffs and add the regression guard.
8. Run automated tests, theme/accessibility review, package audit, and local VSIX installation.
9. Hand the local build to the user for testing.
10. Hold all repository and release actions until the user approves the complete batch.
