/**
 * Security Rule Contract & Dirty Dozen Payload Spec (see security_spec.md)
 * Verifies that every adversarial payload violates at least one invariant
 * enforced in firestore.rules and mirrored by client payload sanitization.
 */

export interface SimulatedAuth {
  uid: string;
  emailVerified: boolean;
}

export const ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

export const DIRTY_DOZEN_CASES: Array<{
  name: string;
  expected: 'PERMISSION_DENIED';
  auth: SimulatedAuth | null;
  targetUserId: string;
  docId: string;
  payload: Record<string, unknown>;
}> = [
  {
    name: '1. Unauthenticated read/write',
    expected: 'PERMISSION_DENIED',
    auth: null,
    targetUserId: 'u1',
    docId: 'movie_550',
    payload: {},
  },
  {
    name: '2. Unverified email spoof',
    expected: 'PERMISSION_DENIED',
    auth: { uid: 'u1', emailVerified: false },
    targetUserId: 'u1',
    docId: 'u1',
    payload: { uid: 'u1', email: 'fake@example.com' },
  },
  {
    name: '3. Cross-user profile read',
    expected: 'PERMISSION_DENIED',
    auth: { uid: 'u2', emailVerified: true },
    targetUserId: 'u1',
    docId: 'u1',
    payload: {},
  },
  {
    name: '4. User enumeration LIST /users',
    expected: 'PERMISSION_DENIED',
    auth: { uid: 'u1', emailVerified: true },
    targetUserId: '*',
    docId: '*',
    payload: {},
  },
  {
    name: '5. Cross-user watchlist write',
    expected: 'PERMISSION_DENIED',
    auth: { uid: 'u2', emailVerified: true },
    targetUserId: 'u1',
    docId: 'movie_550',
    payload: { ownerId: 'u2', tmdbId: 550 },
  },
  {
    name: '6. Owner UID spoofing',
    expected: 'PERMISSION_DENIED',
    auth: { uid: 'u1', emailVerified: true },
    targetUserId: 'u1',
    docId: 'movie_550',
    payload: { ownerId: 'u2', tmdbId: 550 },
  },
  {
    name: '7. Shadow field injection (isAdmin)',
    expected: 'PERMISSION_DENIED',
    auth: { uid: 'u1', emailVerified: true },
    targetUserId: 'u1',
    docId: 'movie_550',
    payload: { ownerId: 'u1', tmdbId: 550, isAdmin: true },
  },
  {
    name: '8. Invalid ID poisoning',
    expected: 'PERMISSION_DENIED',
    auth: { uid: 'u1', emailVerified: true },
    targetUserId: 'u1',
    docId: 'bad$id.poison',
    payload: { ownerId: 'u1', tmdbId: 550 },
  },
  {
    name: '9. Oversized string DoW attack',
    expected: 'PERMISSION_DENIED',
    auth: { uid: 'u1', emailVerified: true },
    targetUserId: 'u1',
    docId: 'movie_550',
    payload: { ownerId: 'u1', tmdbId: 550, title: 'x'.repeat(5000) },
  },
  {
    name: '10. Forged client timestamp',
    expected: 'PERMISSION_DENIED',
    auth: { uid: 'u1', emailVerified: true },
    targetUserId: 'u1',
    docId: 'movie_550',
    payload: { ownerId: 'u1', tmdbId: 550, createdAt: 1000 },
  },
  {
    name: '11. Immutable field mutation (tmdbId)',
    expected: 'PERMISSION_DENIED',
    auth: { uid: 'u1', emailVerified: true },
    targetUserId: 'u1',
    docId: 'movie_550',
    payload: { ownerId: 'u1', tmdbId: 999 },
  },
  {
    name: '12. Unbounded array / invalid element',
    expected: 'PERMISSION_DENIED',
    auth: { uid: 'u1', emailVerified: true },
    targetUserId: 'u1',
    docId: 'movie_550',
    payload: { ownerId: 'u1', tmdbId: 550, genreIds: Array.from({ length: 20 }, (_, i) => i) },
  },
];
