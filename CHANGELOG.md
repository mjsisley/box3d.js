# Changelog

## Unreleased — The Library object-API build (not published)

This branch keeps the v0.0.2 object-shaped API (`{ x, y, z }` vectors, returning
getters) that The Library's worlds call, and carries the same box3d update as the
upstreamable `feat/box3d-dynamic-mover` branch, which targets the v0.1 array API.

- Update box3d to [`3362633`](https://github.com/erincatto/box3d/commit/336263320469e5e9febfe18697ab562488f7e97a) ("Dynamic Mover (#202)"). `b3GetVersion()` now reports 0.2.0.
- Added the mover and pogo joints (`b3CreateMoverJoint` / `b3MoverJoint_*`, `b3CreatePogoJoint` / `b3PogoJoint_*`, their defs and joint types) and `b3Joint_IsAwake`.
- New def fields are bound so defs keep their engine defaults: `b3WorldDef.restitutionIterations` / `enableRestitutionPropagation` / `isotropicInertiaTolerance`, `b3BodyDef.safetyFactor`, `b3ShapeDef.enableSpeculativeContact`.
- Added `b3Body_GetLocalCenter` / `b3Body_GetWorldCenter` and `b3CreateBakedCompoundShape`; the old names (`b3Body_GetLocalCenterOfMass`, `b3Body_GetWorldCenterOfMass`, `b3CreateCompoundShape`) stay as aliases. `b3Profile.applyRestitution` reads the renamed `restitution` timer.
- Triangle collision follows box3d's triangle-first functions: `b3CollideTriangleAndCapsule` / `b3CollideTriangleAndHull` / `b3CollideTriangleAndSphere` replace the shape-first names; the normal points from the triangle to the shape.
- Removed `b3World_RebuildStaticTree` (gone from box3d) and `b3World_DumpShapeBounds` (declared but no longer implemented).
- `b3GetByteCount()` and `b3Counters.byteCount` stay JS numbers; box3d widened them to `int64_t`, which embind would return as a BigInt.

## v0.0.2

- Added `repository`, `homepage`, `bugs`, and `author` fields to `package.json`

## v0.0.1

- Initial release
