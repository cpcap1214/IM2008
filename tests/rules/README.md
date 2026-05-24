# Firestore rules — manual emulator checks

The Vitest suite under `src/lib/__tests__/` covers application code, NOT the
Firestore security rules in [`../../firestore.rules`](../../firestore.rules).
There is no automated rules test in CI yet.

If you change `firestore.rules`, please run them through the Firestore
emulator manually before merging.

## Smoke checklist

Spin up the emulator and verify the four canonical scenarios:

```bash
firebase emulators:start --only firestore
```

| Actor (custom claim `role`) | Action | Expected |
|---|---|---|
| `boss` | `create Orders/<id>` with blank or manual `customerId` | ✅ allowed |
| `boss` | `update Orders/<id>` (any field) | ✅ allowed |
| `customer` (own UID == `customerId`) | `create Orders/<id>` | ✅ allowed |
| `customer` (own UID != `customerId`) | `create Orders/<id>` | ❌ denied |
| `customer` | `update Orders/<id>` (any field) | ❌ denied — only boss can flip status / set delivery |
| any unauthenticated request | any read or write | ❌ denied |

## Why no automated test

Firestore rules tests need `@firebase/rules-unit-testing` plus a Java runtime
to run the local emulator. That toolchain is too heavy for this project's
current CI matrix. Once the Firebase Auth integration PR lands and rules are
actively deployed, we should add a separate `npm run test:rules` script and
a dedicated CI job.
