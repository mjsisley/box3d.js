# Changelog

## Unreleased

- Update box3d to [`3362633`](https://github.com/erincatto/box3d/commit/336263320469e5e9febfe18697ab562488f7e97a) ("Dynamic Mover (#202)"). `b3GetVersion()` now reports 0.2.0.
- Added the experimental dynamic character mover joints: `b3DefaultMoverJointDef` / `b3CreateMoverJoint` / `b3MoverJoint_*` and `b3DefaultPogoJointDef` / `b3CreatePogoJoint` / `b3PogoJoint_*`, plus `b3_moverJoint` / `b3_pogoJoint` in `b3JointType` and `b3Joint_IsAwake`.
- New def fields are bound so defs round-trip with their engine defaults: `b3WorldDef.restitutionIterations` / `enableRestitutionPropagation` / `isotropicInertiaTolerance`, `b3BodyDef.safetyFactor`, `b3ShapeDef.enableSpeculativeContact`.
- New example: Dynamic Mover, a port of box3d's `samples/dynamic_mover.cpp`.
- **Breaking** (follows the box3d C API renames):
  - `b3Body_GetLocalCenterOfMass` / `b3Body_GetWorldCenterOfMass` → `b3Body_GetLocalCenter` / `b3Body_GetWorldCenter`
  - `b3CreateCompoundShape` → `b3CreateBakedCompoundShape` (static bodies only)
  - `b3CollideCapsuleAndTriangle` / `b3CollideHullAndTriangle` / `b3CollideSphereAndTriangle` → triangle-first `b3CollideTriangleAndCapsule(v1, v2, v3, capsule)` / `b3CollideTriangleAndHull(v1, v2, v3, triangleFlags, hull, enableSpeculative)` / `b3CollideTriangleAndSphere(v1, v2, v3, sphere)`; the manifold normal now points from the triangle to the shape
  - `b3Profile.applyRestitution` → `b3Profile.restitution`
  - Removed `b3World_RebuildStaticTree` (gone from box3d) and `b3World_DumpShapeBounds` (still declared in `box3d.h` but no longer implemented, so it fails to link)

## v0.1.1

- Documentation updates to reflect the new API surface and usage patterns, included in the npm package README.md

## v0.1.0

Rework of embind API surface so that box3d.js interops with gl-matrix-style libraries and reads values without allocating JavaScript objects.

- **Breaking:** math types are now plain arrays, matching gl-matrix/mathcat — `b3Vec3` is `[x, y, z]`, `b3Quat` is `[x, y, z, w]`, `b3AABB` is `[minX, minY, minZ, maxX, maxY, maxZ]`. Pass and receive them straight from your existing math library, no wrapper objects or conversion.
- **Breaking:** value reads are out-param-first and zero-allocation. Getters fill a caller-supplied array and return it, e.g. `b3Body_GetPosition(out, bodyId)`; the allocating form that returned a fresh object is gone. Reuse a scratch array per frame to keep the hot path free of GC pressure.
- Removed the pure math-op bindings (`b3Cross`, `b3MakeQuatFromAxisAngle`, `b3AABB_Union`, …). Do vector/quaternion math in JS with gl-matrix/mathcat rather than crossing the wasm boundary for each operation.
- The emitted modules are now validated and post-processed into clean ESM: Emscripten's `require()` calls are rewritten to `await import`, Node builtins are given the `node:` scheme, and the single-file (`*.inline.mjs`) builds have their dead Node file-reader code stripped. The outputs now bundle with no bundler config.

## v0.0.2

- Added `repository`, `homepage`, `bugs`, and `author` fields to `package.json`

## v0.0.1

- Initial release
