import Box3D from 'box3d.js/inline';
import type { Box3DModule, b3BodyId, b3Quat } from 'box3d.js';

const b3: Box3DModule = await Box3D();
const worldDef = b3.b3DefaultWorldDef();
worldDef.gravity = [0, -10, 0];
const world = b3.b3CreateWorld(worldDef);

const IDENTITY_QUAT: b3Quat = [0, 0, 0, 1];

function makeBox(x: number, y: number, z: number, isStatic = false): b3BodyId {
    const def = b3.b3DefaultBodyDef();
    def.type = isStatic ? b3.b3BodyType.b3_staticBody : b3.b3BodyType.b3_dynamicBody;
    def.position = [x, y, z];
    const body = b3.b3CreateBody(world, def);
    b3.b3CreateBoxShape(body, b3.b3DefaultShapeDef(), 0.5, 0.5, 0.5);
    return body;
}

const anchor = makeBox(0, 5, 0, true);
const pendulum = makeBox(0, 3, 0);

/* SNIPPET_START: revolute */
// Revolute joint: rotates around the joint frame's local Z-axis.
// To hinge around world Y, rotate the frame +90 deg about X (local Z -> world Y).
// All joint bodies and frames live on `def.base`. A local frame is a b3Transform:
// { position: b3Vec3, quaternion: b3Quat }.
const revoluteDef = b3.b3DefaultRevoluteJointDef();
revoluteDef.base.bodyIdA = anchor;
revoluteDef.base.bodyIdB = pendulum;
revoluteDef.base.localFrameA = { position: [0, -1, 0], quaternion: IDENTITY_QUAT };
revoluteDef.base.localFrameB = { position: [0,  1, 0], quaternion: IDENTITY_QUAT };
b3.b3CreateRevoluteJoint(world, revoluteDef);
/* SNIPPET_END: revolute */

/* SNIPPET_START: revolute-motor */
// Motorized revolute joint: the motor drives the hinge at a target angular speed
const motorDef = b3.b3DefaultRevoluteJointDef();
motorDef.base.bodyIdA = anchor;
motorDef.base.bodyIdB = pendulum;
motorDef.base.localFrameA = { position: [0, -1, 0], quaternion: IDENTITY_QUAT };
motorDef.base.localFrameB = { position: [0,  1, 0], quaternion: IDENTITY_QUAT };
motorDef.enableMotor = true;
motorDef.motorSpeed = 2.0;          // rad/s
motorDef.maxMotorTorque = 10000;    // must be large enough to overcome inertia
const motorJoint = b3.b3CreateRevoluteJoint(world, motorDef);

// Adjust speed at runtime
b3.b3RevoluteJoint_SetMotorSpeed(motorJoint, 4.0);
/* SNIPPET_END: revolute-motor */

/* SNIPPET_START: weld */
// Weld joint: locks two bodies together rigidly (no relative motion)
const weldDef = b3.b3DefaultWeldJointDef();
weldDef.base.bodyIdA = anchor;
weldDef.base.bodyIdB = pendulum;
weldDef.base.localFrameA = { position: [0, -1, 0], quaternion: IDENTITY_QUAT };
weldDef.base.localFrameB = { position: [0,  1, 0], quaternion: IDENTITY_QUAT };
b3.b3CreateWeldJoint(world, weldDef);
/* SNIPPET_END: weld */

/* SNIPPET_START: distance */
// Distance joint: maintains a target distance between two local anchor points
const distanceDef = b3.b3DefaultDistanceJointDef();
distanceDef.base.bodyIdA = anchor;
distanceDef.base.bodyIdB = pendulum;
distanceDef.base.localFrameA = { position: [0, -1, 0], quaternion: IDENTITY_QUAT };
distanceDef.base.localFrameB = { position: [0,  1, 0], quaternion: IDENTITY_QUAT };
distanceDef.length = 2.0; // desired distance in metres
b3.b3CreateDistanceJoint(world, distanceDef);
/* SNIPPET_END: distance */

/* SNIPPET_START: spherical */
// Spherical (ball-and-socket) joint: allows free rotation in all directions.
// Optionally constrain the cone angle to limit how far B can swing from A's Z-axis.
const sphericalDef = b3.b3DefaultSphericalJointDef();
sphericalDef.base.bodyIdA = anchor;
sphericalDef.base.bodyIdB = pendulum;
sphericalDef.base.localFrameA = { position: [0, -1, 0], quaternion: IDENTITY_QUAT };
sphericalDef.base.localFrameB = { position: [0,  1, 0], quaternion: IDENTITY_QUAT };
b3.b3CreateSphericalJoint(world, sphericalDef);
/* SNIPPET_END: spherical */

/* SNIPPET_START: prismatic */
// Prismatic joint: slides along the joint frame's local X-axis
const prismaticDef = b3.b3DefaultPrismaticJointDef();
prismaticDef.base.bodyIdA = anchor;
prismaticDef.base.bodyIdB = pendulum;
prismaticDef.base.localFrameA = { position: [0, 0, 0], quaternion: IDENTITY_QUAT };
prismaticDef.base.localFrameB = { position: [0, 0, 0], quaternion: IDENTITY_QUAT };
prismaticDef.enableLimit = true;
prismaticDef.lowerTranslation = -2.0;
prismaticDef.upperTranslation =  2.0;
b3.b3CreatePrismaticJoint(world, prismaticDef);
/* SNIPPET_END: prismatic */

/* SNIPPET_START: wheel */
// Wheel joint: revolute + suspension spring; models a vehicle wheel
const wheelDef = b3.b3DefaultWheelJointDef();
wheelDef.base.bodyIdA = anchor;
wheelDef.base.bodyIdB = pendulum;
wheelDef.base.localFrameA = { position: [0, -1, 0], quaternion: IDENTITY_QUAT };
wheelDef.base.localFrameB = { position: [0,  0, 0], quaternion: IDENTITY_QUAT };
wheelDef.enableSuspensionSpring = true;
wheelDef.suspensionHertz = 4.0;         // spring frequency (Hz)
wheelDef.suspensionDampingRatio = 0.7;  // 0 = undamped, 1 = critically damped
b3.b3CreateWheelJoint(world, wheelDef);
/* SNIPPET_END: wheel */

/* SNIPPET_START: mover */
// Mover + pogo joints (experimental upstream): the building blocks of box3d's
// dynamic character mover sample. The character is a rotation-locked dynamic
// capsule. A mover joint to a static base body drives its horizontal velocity up
// to a force budget; a pogo joint to whatever a downward ray hits holds it at a
// spring rest length above the ground, so it can step up without scraping.
const baseBody = b3.b3CreateBody(world, b3.b3DefaultBodyDef());

const characterDef = b3.b3DefaultBodyDef();
characterDef.type = b3.b3BodyType.b3_dynamicBody;
characterDef.position = [0, 1.4, 4]; // ground top 0 + rest 0.9 + half-height 0.5
characterDef.motionLocks.angularX = true;
characterDef.motionLocks.angularY = true;
characterDef.motionLocks.angularZ = true;
const character = b3.b3CreateBody(world, characterDef);
const capsuleDef = b3.b3DefaultShapeDef();
capsuleDef.baseMaterial.friction = 0; // the joints own the motion
b3.b3CreateCapsuleShape(character, capsuleDef, { center1: [0, -0.5, 0], center2: [0, 0.5, 0], radius: 0.3 });

const moverDef = b3.b3DefaultMoverJointDef();
moverDef.base.bodyIdA = baseBody;
moverDef.base.bodyIdB = character;
moverDef.base.collideConnected = true;
moverDef.maxForce = 6000;
const moverJoint = b3.b3CreateMoverJoint(world, moverDef);
b3.b3MoverJoint_SetLinearVelocity(moverJoint, [2, 0, 0]); // update every step from input

const ground = makeBox(0, -0.5, 4, true); // the body a downward ray hit under the character
const pogoDef = b3.b3DefaultPogoJointDef();
pogoDef.base.bodyIdA = ground;
pogoDef.base.bodyIdB = character;
pogoDef.base.collideConnected = true;
pogoDef.base.localFrameA = { position: [0, 0.5, 0], quaternion: IDENTITY_QUAT }; // ray hit, in ground's frame
pogoDef.base.localFrameB = { position: [0, -0.5, 0], quaternion: IDENTITY_QUAT }; // lower capsule center
pogoDef.normal = [0, 1, 0]; // ground normal from the ray hit
pogoDef.restLength = 0.9;
pogoDef.hertz = 3;
pogoDef.dampingRatio = 0.8;
pogoDef.maxCompressionForce = 1e5;
pogoDef.maxTensionForce = 1e5;
const pogoJoint = b3.b3CreatePogoJoint(world, pogoDef);
// Each step: move the pogo frames to the new ray hit, or recreate it when the ground body changes.
b3.b3PogoJoint_SetNormal(pogoJoint, [0, 1, 0]);
/* SNIPPET_END: mover */

b3.b3DestroyWorld(world);
