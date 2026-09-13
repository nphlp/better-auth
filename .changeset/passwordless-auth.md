---
"better-auth": minor
"@better-auth/passkey": minor
"@better-auth/core": minor
---

Add explicit passwordless magic-link signup profiles, opt-in magic-link two-factor challenges,
completed-login method cookies, and a passkey option requiring local user verification on both
the browser and server sides. Existing default signup and passkey policies remain unchanged.

Share serialized credential creation between native password reset, server-only setPassword and
custom initial-password endpoints on transactional adapters, preserving account hooks. Reject
lastLoginMethod before twoFactor during initialization so a pending login cannot update its cookie.
