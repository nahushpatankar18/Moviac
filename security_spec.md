# Moviac Firestore Security Specification (Phase 0 TDD)

## 1. Data Invariants
1. **Identity Isolation**: A user can only read, create, update, or delete their own `/users/{userId}` document, `/users/{userId}/watchlist/{itemKey}` items, and `/users/{userId}/preferences/main` document, and must have `request.auth.token.email_verified == true`.
2. **No Enumeration**: Blanket `list` on `/users` is strictly denied. Listing `/users/{userId}/watchlist` requires both path ownership (`userId == request.auth.uid`) and `resource.data.ownerId == request.auth.uid`.
3. **Parent Integrity**: Subcollection reads/writes on `watchlist` and `preferences` verify the parent `/users/{userId}` document exists.
4. **Immutable Ownership & Identity**: `uid`, `ownerId`, `tmdbId`, `mediaType`, and `createdAt` cannot change after creation.
5. **Strict Schema & Bounds**: Unknown shadow fields are rejected via `keys().hasAll(...)` + `keys().hasOnly(...)` on create and `affectedKeys().hasOnly(...)` on update; all strings, lists, maps, and numeric ranges are strictly bounded.
6. **Temporal Integrity**: `createdAt` and `updatedAt` must equal `request.time` on create, and `updatedAt` must equal `request.time` on update.

## 2. The "Dirty Dozen" Attack Payloads (All Must Yield PERMISSION_DENIED)
1. **Unauthenticated read/write**: Unauthenticated client requests `GET /users/u1/watchlist/movie_550`.
2. **Unverified email spoof**: Authenticated user with `email_verified: false` attempts `CREATE /users/u1`.
3. **Cross-user profile read**: Authenticated user `u2` requests `GET /users/u1`.
4. **User enumeration**: Authenticated user `u1` runs `LIST /users`.
5. **Cross-user watchlist write**: User `u2` attempts `CREATE /users/u1/watchlist/movie_550` with `ownerId: "u2"`.
6. **Owner UID spoofing**: User `u1` attempts `CREATE /users/u1/watchlist/movie_550` with `ownerId: "u2"`.
7. **Shadow field injection**: User `u1` creates a watchlist item including an extra field `isAdmin: true`.
8. **Invalid ID poisoning**: User `u1` writes to `/users/u1/watchlist/bad$id/with.chars` or a 200-char ID.
9. **Oversized string / DoW attack**: User `u1` sets `title` to a 5,000-character string or `tmdbApiKey` to a 2,000-character string.
10. **Forged client timestamp**: User `u1` writes `createdAt` or `updatedAt` set to a past/future timestamp instead of `request.time`.
11. **Immutable field mutation**: User `u1` updates `tmdbId`, `mediaType`, or `createdAt` on an existing `WatchlistItem`.
12. **Unbounded array / invalid element**: User `u1` sets `genreIds` to 20 items or `["not-an-int"]`, or `recentSearches` to 15 items.
