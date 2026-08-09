import test from 'node:test';
import assert from 'node:assert/strict';

import router from '../merchant.route.js';

/**
 * The team endpoints live under literal paths on a router that also declares
 * '/:id'. Express matches in declaration order, so if '/:id' were registered
 * first, GET /my-store/members would be handled by getMerchantById with
 * id="my-store" — a 400 that looks like a client bug. These tests pin the
 * ordering rather than trusting a comment to survive the next edit.
 */

const layers = router.stack.filter((l) => l.route);

const indexOf = (path, method) =>
  layers.findIndex((l) => l.route.path === path && l.route.methods[method]);

const routeAt = (path, method) => layers[indexOf(path, method)]?.route;

test('every team route is registered', () => {
  const expected = [
    ['/my-memberships', 'get'],
    ['/members/accept', 'post'],
    ['/my-store/members', 'get'],
    ['/my-store/members', 'post'],
    ['/my-store/members/:memberId', 'patch'],
    ['/my-store/members/:memberId', 'delete'],
    ['/my-store/transfer-ownership', 'post'],
  ];

  for (const [path, method] of expected) {
    assert.ok(indexOf(path, method) >= 0, `${method.toUpperCase()} ${path} is not registered`);
  }
});

test("literal team paths are declared before the '/:id' catch-all", () => {
  const catchAll = indexOf('/:id', 'get');
  assert.ok(catchAll >= 0, "the '/:id' route should exist");

  for (const path of [
    '/my-memberships',
    '/my-store/members',
    '/my-store/transfer-ownership',
  ]) {
    const method = path === '/my-store/transfer-ownership' ? 'post' : 'get';
    assert.ok(
      indexOf(path, method) < catchAll,
      `${path} must be declared before '/:id' or it will never match`
    );
  }
});

test('accepting an invitation is not gated on already being a member', () => {
  // The accepting user has no membership yet, so isApprovedMerchant here would
  // make every invitation impossible to accept.
  const handlers = routeAt('/members/accept', 'post').stack.map((s) => s.handle.name);
  assert.ok(handlers.includes('isAuthenticated'));
  assert.ok(
    !handlers.includes('isApprovedMerchant'),
    'accept must not require an existing membership'
  );
});

test('listing your memberships is authenticated-only, so invites are discoverable in-app', () => {
  const handlers = routeAt('/my-memberships', 'get').stack.map((s) => s.handle.name);
  assert.ok(handlers.includes('isAuthenticated'));
  assert.ok(!handlers.includes('isApprovedMerchant'));
});

test('reading the team needs membership; changing it needs a permission gate too', () => {
  const read = routeAt('/my-store/members', 'get').stack.map((s) => s.handle.name);
  assert.ok(read.includes('isApprovedMerchant'));

  for (const [path, method] of [
    ['/my-store/members', 'post'],
    ['/my-store/members/:memberId', 'patch'],
    ['/my-store/members/:memberId', 'delete'],
    ['/my-store/transfer-ownership', 'post'],
  ]) {
    const handlers = routeAt(path, method).stack.map((s) => s.handle.name);
    assert.ok(
      handlers.includes('isApprovedMerchant'),
      `${method.toUpperCase()} ${path} must resolve a store`
    );
    // requireMerchantPermission returns an anonymous arrow assigned to nothing,
    // so it is identified by arity rather than by name.
    assert.ok(
      routeAt(path, method).stack.some((s) => s.handle.length === 3 && !s.handle.name),
      `${method.toUpperCase()} ${path} must carry a permission gate`
    );
  }
});

/* -------------------------------------------------------------------------- */
/* admin team routes                                                          */
/* -------------------------------------------------------------------------- */

test('admin team routes are registered and are admin-gated', () => {
  for (const [path, method] of [
    ['/:id/members', 'get'],
    ['/:id/members', 'post'],
    ['/:id/members/:memberId', 'patch'],
    ['/:id/members/:memberId', 'delete'],
  ]) {
    const route = routeAt(path, method);
    assert.ok(route, `${method.toUpperCase()} ${path} is not registered`);
    const handlers = route.stack.map((s) => s.handle.name);
    assert.ok(handlers.includes('isAdmin'), `${path} must be admin-gated`);
    assert.ok(
      handlers.includes('loadStoreForAdmin'),
      `${path} must load the store it is acting on`,
    );
    assert.ok(
      !handlers.includes('isApprovedMerchant'),
      `${path} must not require the admin to be a merchant`,
    );
  }
});

test("'/my-store/members' is declared before '/:id/members'", () => {
  // Both patterns match the path /my-store/members. If the parameterised one
  // won, a merchant reading their own team would be routed to the admin handler
  // with id="my-store" and get a 400 from the ObjectId validator.
  assert.ok(
    indexOf('/my-store/members', 'get') < indexOf('/:id/members', 'get'),
    "'/my-store/members' must be declared first or merchants hit the admin route",
  );
  assert.ok(
    indexOf('/my-store/members', 'post') < indexOf('/:id/members', 'post'),
  );
});

test('ownership transfer is not exposed to admins', () => {
  // Transfer changes who owns the business. It stays with the owner, so there
  // is deliberately no /:id/transfer-ownership counterpart.
  assert.equal(indexOf('/:id/transfer-ownership', 'post'), -1);
});

test('deleting a member validates the id before the controller sees it', () => {
  // validateObjectId only queues the check — without handleValidationErrors a
  // malformed id reaches Mongoose and surfaces as a 500 CastError.
  const handlers = routeAt('/my-store/members/:memberId', 'delete').stack.map((s) => s.handle.name);
  assert.ok(handlers.includes('handleValidationErrors'));
});
