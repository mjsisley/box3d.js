// Dynamic Mover — a port of box3d's dynamic character mover sample
// (samples/dynamic_mover.cpp). Unlike the geometric Character example, the
// capsule is a real dynamic body with rotation locked, so contacts push it and it
// pushes everything else. Two joints do the work:
//
//  * a mover joint to a hidden static body drives the horizontal velocity up to a
//    force budget (large on walkable ground, small in the air, Quake pmove style);
//  * a pogo joint to whatever a downward ray hits holds the capsule at a spring
//    rest length above the ground, so it climbs steps without scraping the riser.
//
// When the center ray misses or lands on a steep face, an octagon "skirt" of rays
// around the capsule looks for a ledge to stand on. The probe rays are drawn.
//
// Controls: WASD move (camera-relative) · Space jump · Shift sprint · drag to orbit.

import type {
	Box3DModule,
	b3BodyId,
	b3JointId,
	b3ShapeId,
	b3Vec3,
} from 'box3d.js';
import Box3D from 'box3d.js/inline';
import * as THREE from 'three';
import { createWorldRenderer } from './box3d-three';
import { createHarness } from './harness';
import { quatFromAxisAngle } from './math';

const b3: Box3DModule = await Box3D();
const app = createHarness({ camera: [0, 6, 12], target: [0, 1, 0] });

const worldDef = b3.b3DefaultWorldDef();
worldDef.gravity = [0, -10, 0];
const world = b3.b3CreateWorld(worldDef);

// ---------------------------------------------------------------------------
// Course: floor, a wall, a staircase, a steep ramp, a ledge and pushable crates
// ---------------------------------------------------------------------------

function box(
	x: number,
	y: number,
	z: number,
	hx: number,
	hy: number,
	hz: number,
	dynamic = false,
	angleZ = 0,
): b3BodyId {
	const def = b3.b3DefaultBodyDef();
	def.position = [x, y, z];
	if (dynamic) def.type = b3.b3BodyType.b3_dynamicBody;
	if (angleZ !== 0) def.rotation = quatFromAxisAngle([0, 0, 1], angleZ);
	const body = b3.b3CreateBody(world, def);
	const sd = b3.b3DefaultShapeDef();
	if (dynamic) sd.density = 60;
	b3.b3CreateBoxShape(body, sd, hx, hy, hz);
	return body;
}

box(0, -0.5, 0, 20, 0.5, 20); // floor
box(-8, 1.5, 0, 0.5, 1.5, 8); // wall to slide along
for (let i = 0; i < 6; i++)
	box(4 + i * 0.6, 0.1 + i * 0.2, -4, 0.3, 0.1 + i * 0.2, 1.5); // stairs
box(4, 0.8, 4, 3, 0.2, 1.5, false, 0.9); // ramp too steep to walk
box(-4, 0.4, -6, 1.5, 0.4, 1.5); // a ledge the skirt can stand on
for (let i = 0; i < 4; i++) box(-2 + i * 1.2, 0.45, 5, 0.45, 0.45, 0.45, true); // crates

const renderer = createWorldRenderer(b3, world);
app.scene.add(renderer.object3d);

// ---------------------------------------------------------------------------
// The mover (DynamicMover::Create)
// ---------------------------------------------------------------------------

const mover = {
	jumpSpeed: 7,
	maxSpeed: 6,
	minSpeed: 0.1,
	stopSpeed: 3,
	accelerate: 20,
	airSteer: 0.25,
	friction: 8,
	gravityScale: 1.5,
	maxGroundForce: 6000,
	maxAirForce: 1500,
	pogoRestLength: 0.9,
	pogoHertz: 3,
	pogoDampingRatio: 0.8,
	pogoCompressionScale: 100,
	pogoTensionScale: 100,
	enableSkirtPogo: true,
	minGroundNormalY: 0.7,
	slideDuration: 0.2,
};
const SKIRT_COUNT = 8;
const capsule = {
	center1: [0, -0.5, 0] as b3Vec3,
	center2: [0, 0.5, 0] as b3Vec3,
	radius: 0.3,
};

const groundId = b3.b3CreateBody(world, b3.b3DefaultBodyDef());
const moverDef = b3.b3DefaultBodyDef();
moverDef.type = b3.b3BodyType.b3_dynamicBody;
moverDef.position = [0, 1.4, 0];
moverDef.gravityScale = mover.gravityScale;
moverDef.motionLocks.angularX = true;
moverDef.motionLocks.angularY = true;
moverDef.motionLocks.angularZ = true;
moverDef.enableSleep = false;
const moverId = b3.b3CreateBody(world, moverDef);
const capsuleDef = b3.b3DefaultShapeDef();
capsuleDef.density = 200;
// The mover joint and the pogo joint handle all the movement; surface friction would fight them.
capsuleDef.baseMaterial.friction = 0;
capsuleDef.baseMaterial.restitution = 0;
b3.b3CreateCapsuleShape(moverId, capsuleDef, capsule);

const velocity: b3Vec3 = [0, 0, 0];

function createMoverJoint(baseId: b3BodyId): b3JointId {
	const def = b3.b3DefaultMoverJointDef();
	def.linearVelocity = [velocity[0], velocity[1], velocity[2]];
	def.maxForce = mover.maxGroundForce;
	def.base.bodyIdA = baseId;
	def.base.bodyIdB = moverId;
	def.base.collideConnected = true;
	return b3.b3CreateMoverJoint(world, def);
}
let moverJointId = createMoverJoint(groundId);

// ---------------------------------------------------------------------------
// Ground probes (CastCallback)
// ---------------------------------------------------------------------------

type CastResult = {
	hit: boolean;
	point: b3Vec3;
	normal: b3Vec3;
	bodyId: b3BodyId | null;
	fraction: number;
};
const newResult = (): CastResult => ({
	hit: false,
	point: [0, 0, 0],
	normal: [0, 1, 0],
	bodyId: null,
	fraction: 1,
});
const queryFilter = b3.b3DefaultQueryFilter();
const sameBody = (a: b3BodyId | null, b: b3BodyId | null) =>
	!!a &&
	!!b &&
	a.index1 === b.index1 &&
	a.world0 === b.world0 &&
	a.generation === b.generation;

function castRay(
	origin: b3Vec3,
	translation: b3Vec3,
	result: CastResult,
): void {
	result.hit = false;
	result.fraction = 1;
	b3.b3World_CastRay(
		world,
		origin,
		translation,
		queryFilter,
		(shapeId: b3ShapeId, point: b3Vec3, normal: b3Vec3, fraction: number) => {
			const bodyId = b3.b3Shape_GetBody(shapeId);
			// The probes start inside or on the capsule. Sensors can't hold up the mover.
			if (sameBody(bodyId, moverId) || b3.b3Shape_IsSensor(shapeId)) return -1;
			result.hit = true;
			result.point = [point[0], point[1], point[2]];
			result.normal = [normal[0], normal[1], normal[2]];
			result.bodyId = bodyId;
			result.fraction = fraction;
			return fraction;
		},
	);
}

// ---------------------------------------------------------------------------
// DynamicMover::Update — Quake ground/air movement + pogo
// ---------------------------------------------------------------------------

let castResult = newResult();
let surfaceBodyId: b3BodyId | null = null;
let pogoJointId: b3JointId | null = null;
let pogoImpulse = 0;
let pogoVelocity = 0;
let timeSliding = 0;
let onGround = false;
let walkable = false;
let jumping = false;
let jumpTicks = 0;

const probes: Array<{
	origin: b3Vec3;
	translation: b3Vec3;
	fraction: number;
	hit: boolean;
}> = [];
const _pos: b3Vec3 = [0, 0, 0];
const _vel: b3Vec3 = [0, 0, 0];
const _gravity: b3Vec3 = [0, 0, 0];
const _local: b3Vec3 = [0, 0, 0];

function update(
	timeStep: number,
	forward: b3Vec3,
	right: b3Vec3,
	throttleX: number,
	throttleY: number,
	speedScale: number,
): void {
	// Reach further while grounded so the spring can find the ground over a step.
	const rayLength = onGround ? 2 * mover.pogoRestLength : mover.pogoRestLength;
	const translation: b3Vec3 = [0, -rayLength, 0];
	b3.b3Body_GetPosition(_pos, moverId);
	const origin: b3Vec3 = [
		_pos[0] + capsule.center1[0],
		_pos[1] + capsule.center1[1],
		_pos[2] + capsule.center1[2],
	];
	castResult = newResult();
	castRay(origin, translation, castResult);
	probes.length = 0;
	probes.push({
		origin,
		translation,
		fraction: castResult.fraction,
		hit: castResult.hit,
	});

	const pogoOffset: b3Vec3 = [0, 0, 0];
	const centerWalkable =
		castResult.hit && castResult.normal[1] >= mover.minGroundNormalY;
	if (!centerWalkable && mover.enableSkirtPogo) {
		// The skirt turns with the direction of travel so ties go to the leading probe.
		b3.b3Body_GetLinearVelocity(_vel, moverId);
		let hx = _vel[0];
		let hz = _vel[2];
		const len = Math.hypot(hx, hz);
		if (len < 1e-6) {
			hx = 1;
			hz = 0;
		} else {
			hx /= len;
			hz /= len;
		}
		let bestDisplacement = Number.POSITIVE_INFINITY;
		for (let i = 0; i < SKIRT_COUNT; i++) {
			const a = (2 * Math.PI * i) / SKIRT_COUNT;
			const ox = capsule.radius * (Math.cos(a) * hx - Math.sin(a) * hz);
			const oz = capsule.radius * (Math.cos(a) * hz + Math.sin(a) * hx);
			const skirtOrigin: b3Vec3 = [origin[0] + ox, origin[1], origin[2] + oz];
			const result = newResult();
			castRay(skirtOrigin, translation, result);
			probes.push({
				origin: skirtOrigin,
				translation,
				fraction: result.fraction,
				hit: result.hit,
			});
			// Use the walkable result that causes the least movement.
			if (result.hit && result.normal[1] >= mover.minGroundNormalY) {
				const displacement = Math.abs(
					result.fraction * rayLength - mover.pogoRestLength,
				);
				if (displacement < bestDisplacement) {
					bestDisplacement = displacement;
					castResult = result;
					pogoOffset[0] = ox;
					pogoOffset[2] = oz;
				}
			}
		}
	}

	if (jumping) {
		jumpTicks += 1;
		const n = castResult.normal;
		if (
			jumpTicks > 2 &&
			castResult.hit &&
			velocity[0] * n[0] + velocity[1] * n[1] + velocity[2] * n[2] <= 0
		)
			jumping = false;
	}

	if (castResult.hit) {
		walkable = castResult.normal[1] >= mover.minGroundNormalY;
		onGround = !jumping;
		if (onGround) {
			timeSliding = walkable
				? Math.max(timeSliding - timeStep, 0)
				: Math.min(timeSliding + timeStep, mover.slideDuration);
		}
	} else {
		onGround = false;
		walkable = false;
		timeSliding = Math.max(timeSliding - timeStep, 0);
	}

	if (!b3.b3Joint_IsValid(moverJointId))
		moverJointId = createMoverJoint(groundId);

	b3.b3Body_GetLinearVelocity(velocity, moverId);

	// Friction acts in the horizontal plane. The pogo owns the vertical motion.
	if (onGround) {
		const speed = Math.hypot(velocity[0], velocity[2]);
		if (speed < mover.minSpeed) {
			velocity[0] = 0;
			velocity[2] = 0;
		} else {
			const control = speed < mover.stopSpeed ? mover.stopSpeed : speed;
			const ratio =
				Math.max(0, speed - control * mover.friction * timeStep) / speed;
			velocity[0] *= ratio;
			velocity[2] *= ratio;
		}
	}

	let maxForce = mover.maxAirForce;
	if (onGround) {
		const scale = Math.min(
			Math.max(1 - timeSliding / mover.slideDuration, 0),
			1,
		);
		maxForce = scale * mover.maxGroundForce;
	}
	b3.b3MoverJoint_SetMaxVelocityForce(moverJointId, maxForce);

	// Accelerate toward the desired velocity.
	const maxSpeed = speedScale * mover.maxSpeed;
	const dx = maxSpeed * (throttleX * forward[0] + throttleY * right[0]);
	const dz = maxSpeed * (throttleX * forward[2] + throttleY * right[2]);
	let desiredSpeed = Math.hypot(dx, dz);
	const dirX = desiredSpeed > 1e-6 ? dx / desiredSpeed : 0;
	const dirZ = desiredSpeed > 1e-6 ? dz / desiredSpeed : 0;
	desiredSpeed = Math.min(desiredSpeed, maxSpeed);
	const addSpeed = desiredSpeed - (velocity[0] * dirX + velocity[2] * dirZ);
	if (addSpeed > 0) {
		const steer = walkable ? 1 : mover.airSteer;
		const accelSpeed = Math.min(
			steer * mover.accelerate * maxSpeed * timeStep,
			addSpeed,
		);
		velocity[0] += accelSpeed * dirX;
		velocity[2] += accelSpeed * dirZ;
	}

	if (castResult.hit && castResult.bodyId) {
		b3.b3World_GetGravity(_gravity, world);
		const weight =
			mover.gravityScale *
			Math.hypot(_gravity[0], _gravity[1], _gravity[2]) *
			b3.b3Body_GetMass(moverId);
		const tension = jumping ? 0 : mover.pogoTensionScale * weight;
		b3.b3Body_GetLocalPoint(_local, castResult.bodyId, castResult.point);
		const frameA = {
			position: [_local[0], _local[1], _local[2]] as b3Vec3,
			quaternion: [0, 0, 0, 1] as [number, number, number, number],
		};
		const frameB = {
			position: [
				capsule.center1[0] + pogoOffset[0],
				capsule.center1[1],
				capsule.center1[2] + pogoOffset[2],
			] as b3Vec3,
			quaternion: [0, 0, 0, 1] as [number, number, number, number],
		};
		const pogoValid = pogoJointId !== null && b3.b3Joint_IsValid(pogoJointId);
		if (!sameBody(castResult.bodyId, surfaceBodyId) || !pogoValid) {
			if (pogoValid && pogoJointId) {
				pogoImpulse = b3.b3PogoJoint_GetImpulse(pogoJointId);
				pogoVelocity = b3.b3PogoJoint_GetCurrentSpeed(pogoJointId);
				b3.b3DestroyJoint(pogoJointId, false);
			}
			surfaceBodyId = castResult.bodyId;
			const def = b3.b3DefaultPogoJointDef();
			def.base.localFrameA = frameA;
			def.base.localFrameB = frameB;
			def.base.bodyIdA = surfaceBodyId;
			def.base.bodyIdB = moverId;
			def.base.collideConnected = true;
			def.normal = castResult.normal;
			def.restLength = mover.pogoRestLength;
			def.hertz = mover.pogoHertz;
			def.dampingRatio = mover.pogoDampingRatio;
			def.maxCompressionForce = mover.pogoCompressionScale * weight;
			def.maxTensionForce = tension;
			// Warm start from the joint that was just destroyed.
			def.impulse = pogoImpulse;
			def.velocity = pogoVelocity;
			pogoJointId = b3.b3CreatePogoJoint(world, def);
		} else if (pogoJointId) {
			// Preserve the joint, improving performance.
			b3.b3Joint_SetLocalFrameA(pogoJointId, frameA);
			b3.b3Joint_SetLocalFrameB(pogoJointId, frameB);
			b3.b3PogoJoint_SetNormal(pogoJointId, castResult.normal);
			b3.b3PogoJoint_SetMaxTensionForce(pogoJointId, tension);
			b3.b3PogoJoint_SetMaxCompressionForce(
				pogoJointId,
				mover.pogoCompressionScale * weight,
			);
			b3.b3PogoJoint_SetSpringHertz(pogoJointId, mover.pogoHertz);
			b3.b3PogoJoint_SetSpringDampingRatio(pogoJointId, mover.pogoDampingRatio);
		}
	} else {
		if (pogoJointId !== null && b3.b3Joint_IsValid(pogoJointId))
			b3.b3DestroyJoint(pogoJointId, false);
		pogoJointId = null;
		surfaceBodyId = null;
		pogoImpulse = 0;
		pogoVelocity = 0;
	}

	b3.b3MoverJoint_SetLinearVelocity(moverJointId, velocity);
}

function jump(): void {
	if (!onGround || !walkable) return;
	b3.b3Body_GetLinearVelocity(_vel, moverId);
	const dv = Math.max(0, mover.jumpSpeed - _vel[1]);
	b3.b3Body_ApplyLinearImpulseToCenter(
		moverId,
		[0, b3.b3Body_GetMass(moverId) * dv, 0],
		true,
	);
	// Release the ground so the pogo does not pull the mover back down.
	onGround = false;
	walkable = false;
	jumping = true;
	jumpTicks = 0;
}

// ---------------------------------------------------------------------------
// Probe drawing, input and the loop
// ---------------------------------------------------------------------------

const probeGeometry = new THREE.BufferGeometry();
const probePositions = new Float32Array((SKIRT_COUNT + 1) * 2 * 3);
probeGeometry.setAttribute(
	'position',
	new THREE.BufferAttribute(probePositions, 3),
);
const probeLines = new THREE.LineSegments(
	probeGeometry,
	new THREE.LineBasicMaterial({ color: 0xffcc33 }),
);
app.scene.add(probeLines);

function drawProbes(): void {
	probePositions.fill(0);
	probes.forEach((p, i) => {
		const o = i * 6;
		probePositions.set(p.origin, o);
		probePositions[o + 3] = p.origin[0] + p.fraction * p.translation[0];
		probePositions[o + 4] = p.origin[1] + p.fraction * p.translation[1];
		probePositions[o + 5] = p.origin[2] + p.fraction * p.translation[2];
	});
	probeGeometry.attributes.position.needsUpdate = true;
	probeGeometry.setDrawRange(0, probes.length * 2);
}

const folder = app.gui.addFolder('Mover');
folder.add(mover, 'maxSpeed', 1, 12);
folder.add(mover, 'jumpSpeed', 1, 15);
folder.add(mover, 'pogoRestLength', 0.3, 1.5);
folder.add(mover, 'pogoHertz', 0.5, 10);
folder.add(mover, 'pogoDampingRatio', 0, 2);
folder.add(mover, 'enableSkirtPogo');

const keys = new Set<string>();
window.addEventListener('keydown', (e) => {
	keys.add(e.key.toLowerCase());
	if (e.key === ' ') jump();
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

const camDir = new THREE.Vector3();
const previous = new THREE.Vector3();

app.onFrame(() => {
	app.camera.getWorldDirection(camDir);
	camDir.y = 0;
	camDir.normalize();
	const forward: b3Vec3 = [camDir.x, 0, camDir.z];
	const right: b3Vec3 = [-camDir.z, 0, camDir.x];
	let tx = 0;
	let ty = 0;
	if (keys.has('w')) tx += 1;
	if (keys.has('s')) tx -= 1;
	if (keys.has('d')) ty += 1;
	if (keys.has('a')) ty -= 1;

	b3.b3Body_GetPosition(_pos, moverId);
	previous.set(_pos[0], _pos[1], _pos[2]);
	app.step(() => {
		update(1 / 60, forward, right, tx, ty, keys.has('shift') ? 1.5 : 1);
		b3.b3World_Step(world, 1 / 60, 4);
	});
	renderer.update();
	drawProbes();

	// Follow the mover, keeping the user's orbit offset.
	b3.b3Body_GetPosition(_pos, moverId);
	app.camera.position.x += _pos[0] - previous.x;
	app.camera.position.y += _pos[1] - previous.y;
	app.camera.position.z += _pos[2] - previous.z;
	app.controls.target.set(_pos[0], _pos[1], _pos[2]);
});
app.start();
