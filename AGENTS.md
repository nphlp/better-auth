# Better Auth Development Guide

This is the Better Auth repository - a comprehensive authentication framework for TypeScript, designed to be runtime and framework-agnostic.

## Project Structure

- `packages/better-auth` - Main authentication library
- `packages/core` - Shared core types and utilities
- `packages/cli` - CLI tool
- `packages/*` - Database adapters, plugins, integrations
- `docs/` - Documentation site (Next.js + Fumadocs), content in `docs/content/docs/`
- `test/` - Shared test workspace
- `e2e/` - End-to-end tests (smoke, adapter, integration)
- `demo/` - Example apps

## Commands

- ALWAYS use `pnpm` (never npm, yarn, or bun)
- NEVER run `pnpm test` (runs all packages). Use `vitest path/to/test -t <pattern>`
- Type check: `pnpm typecheck`
- After changing a dependency version in `package.json` or `pnpm-workspace.yaml`, run `pnpm install --lockfile-only` from the affected workspace root to avoid unrelated lockfile updates. Verify with `pnpm install --frozen-lockfile`. Nested `demo/*` workspaces have separate lockfiles.
- Formatting/linting runs automatically on commit (Lefthook + Biome). No need to run manually.

## Writing Code

- Must work across Node.js, Bun, Deno, and Cloudflare Workers. Avoid runtime-specific APIs.
- Biome (tabs for code, 2 spaces for JSON)
- NEVER use `any`. NEVER use classes.
- Use `Uint8Array` instead of `Buffer` (except in tests)
- Import zod as `import * as z from "zod"`
- Use `import type` for type-only imports
- Use `node:` protocol for Node.js built-ins (e.g. `node:crypto`)
- JSDoc comments for public APIs
- The Better Auth CLI package was renamed from `@better-auth/cli` to `auth`. Use `npx auth@latest` in docs and user-facing messages, while preserving historical references in changelogs and explanations of the rename.
- Plugins should be as independent as possible. When working on a plugin, prefer modifying the plugin over changing core.

### URL Composition

- When appending query parameters to callback or redirect URLs, use `appendQueryParams` from `@better-auth/core/utils/url`. Keep origin and trust validation separate.
- Magic-link callback query values are already decoded by the HTTP query parser. Validate and
  redirect using that same value without another `decodeURIComponent`, preserving encoded query
  delimiters and fragments. Cover ordinary, new-user and error redirects through `auth.handler`.
- Change-email verification failures preserve the callback query and fragment, placing the error
  parameter in the query string before the fragment. Cover relative and absolute callbacks.

```ts
const params = new URLSearchParams({ error });
const redirectURL = appendQueryParams(errorURL, params);

throw ctx.redirect(redirectURL);
```

### Placeholder Emails

`User.email` is currently required and unique, which is a limitation of the current architecture.

When a flow must synthesize an email, use `createPlaceholderEmail` with a stable identifier and namespace. Keep placeholder emails unverified, and preserve flows that delegate generation to user code.

## Issue Triage and Architecture

- A reproducible error is not automatically a bug. First prove the behavior violates Better Auth's documented contract, TypeScript contract, or established runtime semantics.
- Before changing public API behavior, check existing docs, generated/inferred types, endpoint metadata, release history, and git history for the relevant code path. Treat long-standing metadata such as `requireHeaders`, `requireRequest`, endpoint method, schema, and middleware as part of the API contract.
- For regression claims, compare the exact reported versions or tags. If the behavior existed before the claimed version, classify it as expected behavior, documentation gap, or integration misuse unless another contract proves otherwise.
- Distinguish invalid usage from valid empty state. Example: a server session check without request headers is invalid usage; a server session check with headers but no session cookie is a valid request that returns `null`.
- Do not weaken TypeScript guidance to make runtime behavior more permissive unless that is the explicit architectural decision. Optional input types can hide integration bugs from users and agents.
- Prefer docs or clearer error messages over API-contract changes when the current behavior is intentional but confusing.
- When reviewing or patching external issue PRs, validate both the issue and the proposed fix against the surrounding contract before improving the PR. If the PR changes a long-standing contract, call that out before pushing changes.

## Testing

- Most tests use Vitest; some under `e2e/` use Playwright
- Use `getTestInstance()` from `better-auth/test`. It returns `{ client, auth, sessionSetter, ... }`
- Pass client plugins via `clientOptions.plugins`
- NEVER create separate clients with `createAuthClient()` in tests
- Default test DB is SQLite in-memory; use `testWith` for other databases
- Adapter tests need Docker: `docker compose up -d`
- Regression tests: use `@see` for relevant issues or authoritative sources. Do not reference the current pull request or its review comments:
  ```typescript
  /**
   * @see https://github.com/better-auth/better-auth/issues/{issue_number}
   */
  it("should handle the previously broken behavior", async () => {
    // ...
  });
  ```
- Put a shared `@see` above a focused `describe()` when multiple regression tests share the same reference. For a standalone regression test, put it above `it()`.

## Important Development Notes

- Bug fixes and new features MUST include tests
  - For bug fixes: after confirming the reproducible behavior violates the intended contract, write a failing test first, then implement the fix
- Update docs (`docs/content/docs/`) when changing public API
- Ensure `pnpm typecheck` passes before finishing
- DO NOT COMMIT unless the user explicitly asks
- Conventional Commits: `feat(scope):`, `fix(scope):`, `docs:`, `chore:`. Use `!` for breaking changes (e.g. `feat(auth)!:`)
- Downstream maintenance uses the branch policy below

## No-account password reset invitations

`sendResetPasswordNoAccount` receives the submitted email and optional `redirectTo`, after origin
validation. Consumers can retain their registration return target without re-reading a consumed
request body. Keep the HTTP response identical for existing and unknown accounts, including when
notification delivery fails.

## Opt-in passwordless extensions

Magic-link signup profiles are validated before token storage using declared user field permissions.
Only token consumption creates the verified account. Defaults retain automatic signup compatibility,
while `disableSignUp` always wins and `requireExplicitSignUp` requires a profile for unknown users.

The two-factor plugin optionally handles magic-link verification using its existing pending-session,
signed-cookie, expiration and attempt-budget machinery. The application supplies a trusted UI
redirect, not an authenticated session. The signed challenge identifier retains the primary method;
old `2fa-` identifiers stay consumable. Successful verification exposes transient request metadata
for the last-login-method cookie resolver. No schema field or client-provided identity is added.

Passkey `requireUserVerification` applies to option generation and cryptographic verification in both
ceremonies. Test the verifier boundary and actual browser assertions; requesting UV in browser
options alone does not enforce the server policy. Keep every new option disabled by default.

Trusted-device records are rotating single-use credentials. Sign-in and two-factor disabling consume
them through `internalAdapter.consumeVerificationValue`, which claims one concurrent winner and accepts
the legacy plain identifier during a global hash rollout. Never restore a separate find-then-delete
pair or a hash-only deletion for this path. Their server-side value binds the user to the current
private `twoFactorVersion`. Factor activation and deactivation advance that generation, so disabling
and later re-enabling or replacing a factor invalidates trust granted under the previous enrollment
across all browsers. Pre-generation user-id-only trust values fail closed and are consumed on their
next use. Regenerating backup codes does not rotate this generation.

`lastLoginMethod` must follow `twoFactor` in the plugin array. Initialization rejects reversed
ordering because its cookie hook must see the completed two-factor decision. This completion
guarantee applies to the cookie; the optional database field retains its existing provisioning
and session-creation hook semantics.

`internalAdapter.setCredentialPassword` is shared by initial password creation and native reset.
With a transactional adapter it first updates the user's `updatedAt` to obtain the database write
lock, then reads and mutates the credential through the native account hooks. This metadata write
is internal synchronization, not a user-profile edit, so it bypasses user edit hooks. Credential
hook vetoes fail the operation and roll back. A missing user fails closed. The application may
require transaction support; legacy nontransactional consumers retain their previous behavior
without a cross-process concurrency guarantee. Test the actual PostgreSQL race at the consumer
boundary in addition to SQLite hook/rollback tests. No schema column is added.

## Downstream fork maintenance

This fork is maintained on `fork/nextjs-deploy`, starting from the complete
`merge/nextjs-deploy` aggregate. Its current upstream base is stable v1.7.14.
Upstream PRs #8915, #8916 and #9561 are closed by the owner's decision. Their
links remain historical references, not work queues or a publication requirement.
Keep delivered source revisions recoverable before rewriting maintenance history.

Preserve lifecycle callbacks, atomic email changes, passwordless onboarding,
serialized credential writes, hashed verification lookup, trusted-device factor
generations, completed login methods and passkey freshness/verification policy.
The reset helper keeps upstream atomic token consumption and session revocation
in the same transaction as the fork's serialized credential write. The explicit
magic-link signup profile remains validated within a purpose-specific record.

Upstream purpose-prefixed Magic Link and OAuth/SAML state records are mandatory.
Previously issued links and pending sign-ins must be restarted on upgrade.
Do not add an unprefixed fallback to make old links redeemable. Existing account
and user data do not require a migration for this token namespace change.

Use the native pnpm lockfile and build all ten packages declared by the product
builder before validating compiled exports. The Zod catalogue requires ^4.6.7.
Keep the full source audit visible, including documentation and test workspaces.
A dependency check of the delivered packages has its own explicit coverage and
must not be presented as a clean audit of the entire upstream monorepo.

PostgreSQL auth tests use BETTER_AUTH_TEST_POSTGRES_URL pointing to an isolated
test server. The db and OAuth-proxy cases are disabled when it is absent rather
than probing a development server. Legacy migration-provider files that probe
fixed PostgreSQL/MySQL endpoints require a separate isolated setup and are not
part of the source unit selection used for this upgrade.

Normal product installation consumes the committed prebuilt aggregate, not this
source checkout. Publish a verified source revision before adopting its gitlink,
BUILD_INFO.json, package artifacts and consumer lockfiles together. Keep Expo's
separate native application in standby and preserve the complete server package
set, including the Expo server integration. Database changes and deployment keep
their separate owner approvals.
