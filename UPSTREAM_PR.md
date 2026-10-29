<!--
Prepared for Matthew Sisley to review. NOT submitted to isaac-mason/box3d.js.
This file is the branch's last commit. Before opening the PR, drop that commit
(the PR should not contain this file), then open mjsisley/box3d.js:feat/box3d-dynamic-mover
-> isaac-mason/box3d.js:main with the title and body below.
-->

# Title

Update box3d to 3362633 and bind the dynamic mover joints

# Body

This updates `vendor/box3d` from `8441b4a` (v0.1.0) to [`3362633`](https://github.com/erincatto/box3d/commit/336263320469e5e9febfe18697ab562488f7e97a), "Dynamic Mover (#202)", and binds the new mover and pogo joints that box3d's dynamic character mover sample is built on.

## What changed

**New bindings**

- Mover joint: `b3DefaultMoverJointDef`, `b3CreateMoverJoint`, `b3MoverJoint_SetLinearVelocity`, `b3MoverJoint_GetLinearVelocity(out, jointId)`, `b3MoverJoint_SetMaxVelocityForce`, `b3MoverJoint_GetMaxVelocityForce`.
- Pogo joint: `b3DefaultPogoJointDef`, `b3CreatePogoJoint`, and the `b3PogoJoint_*` setters and getters for rest length, spring hertz and damping ratio, max tension and compression force, normal (`b3PogoJoint_GetNormal(out, jointId)`), current length, current speed and impulse.
- `b3JointType.b3_moverJoint` / `b3_pogoJoint` and `b3Joint_IsAwake`.

Vec3 reads use `out_function`, as the header conventions ask. Both joints are marked experimental upstream.

**Def fields added since 8441b4a**

`b3WorldDef.restitutionIterations`, `enableRestitutionPropagation`, `isotropicInertiaTolerance`; `b3BodyDef.safetyFactor`; `b3ShapeDef.enableSpeculativeContact`. Embind value-initializes the C struct when it converts a JS object, so an unregistered field arrives as 0 rather than the `b3Default*Def` value. Registering them keeps, for example, `safetyFactor` at its 0.5 default instead of 0.

**Follow-on changes from the box3d update** (breaking, mirroring the C API):

- `b3Body_GetLocalCenterOfMass` / `b3Body_GetWorldCenterOfMass` → `b3Body_GetLocalCenter` / `b3Body_GetWorldCenter`
- `b3CreateCompoundShape` → `b3CreateBakedCompoundShape` (static bodies only in box3d)
- `b3CollideCapsuleAndTriangle` / `b3CollideHullAndTriangle` / `b3CollideSphereAndTriangle` → triangle-first `b3CollideTriangleAndCapsule(v1, v2, v3, capsule)` / `b3CollideTriangleAndHull(v1, v2, v3, triangleFlags, hull, enableSpeculative)` / `b3CollideTriangleAndSphere(v1, v2, v3, sphere)`. The manifold normal now points from the triangle to the shape.
- `b3RecPlayer_CreateFromRecording` / `b3RecPlayer_Destroy` keep their JS names and call the renamed `b3CreatePlayer` / `b3DestroyPlayer`.
- `b3Profile.applyRestitution` → `b3Profile.restitution`.
- box3d widened `b3GetByteCount()` and `b3Counters.byteCount` to `int64_t`, which embind returns as a BigInt (`b3GetByteCount() <= bytes + 4096` then throws). Both stay JS numbers (exact to 2^53).
- Removed `b3World_RebuildStaticTree` (removed from box3d) and `b3World_DumpShapeBounds`. The latter is still declared in `box3d.h` but its definition went away in box3d #53, so binding it fails to link.

The examples, docs and README use the new names.

**Example and docs**

- New `example-dynamic-mover`: a port of box3d's `samples/dynamic_mover.cpp` with the octagon skirt probes drawn, on a course with a wall, stairs, a ledge, a ramp too steep to walk and pushable crates. WASD, Space to jump, Shift to sprint.
- A "Mover and Pogo" snippet in the joints docs, and a changelog entry under Unreleased. I left the version alone.

`dist/` is rebuilt with emsdk 6.0.2, matching `REQUIRED_EMSDK`. `b3GetVersion()` reports 0.2.0.

## Testing

- `pnpm build` (emsdk 6.0.2) and `pnpm test`. The smoke test has a new case: a rotation-locked capsule driven by a mover joint while a pogo joint holds it at rest height. It passes for the separate-wasm and inline builds: x 3.98 after 2 s at 2 m/s, y 1.90 against an expected 1.9, pogo current length near 0.9.
- `pnpm docs:check`, `pnpm docs:build`, and the examples' `tsc --noEmit` and `vite build` pass.
- `pnpm check` (Biome) reports the same 13 errors on files this PR does not touch (formatting and import order in `box3d-three.ts`, `example-character.ts`, `example-friction.ts`, `example-hinge-motor.ts`, `example-manifold.ts`, `example-mesh.ts`, and `examples.json`'s indentation). The new and edited example files pass.
- Before this change I rebuilt `2617a0f` + box3d `8441b4a` with emsdk 6.0.2 and got the published 0.0.2 `dist/box3d.inline.mjs` byte for byte, so the toolchain is not a source of drift.
- The same bindings (on the v0.0.2 object API) run a 3D Library app's physics. Its port of the dynamic mover passes wall-slide, step-up, crate-push and jump tests on the shared world.

Not done: the multithreaded build has no mover-specific test. The `example-dynamic-mover` screenshot for the examples index is not generated.
