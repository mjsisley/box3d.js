// Smoke test: base API + a real "falling box" simulation, run against both
// build variants (separate-wasm and inlined single-file).

import assert from 'node:assert/strict';

function fallingBox( b3 )
{
	// world with downward gravity
	const worldDef = b3.b3DefaultWorldDef();
	worldDef.gravity = [ 0, -10, 0 ];
	const world = b3.b3CreateWorld( worldDef );
	assert.ok( b3.b3World_IsValid( world ), 'world is valid' );

	// static ground: a wide, thin box centered at the origin
	const groundBodyDef = b3.b3DefaultBodyDef();
	groundBodyDef.type = b3.b3BodyType.b3_staticBody;
	groundBodyDef.position = [ 0, 0, 0 ];
	const ground = b3.b3CreateBody( world, groundBodyDef );
	b3.b3CreateBoxShape( ground, b3.b3DefaultShapeDef(), 25, 0.5, 25 );

	// dynamic body: a sphere dropped from y = 10
	const bodyDef = b3.b3DefaultBodyDef();
	bodyDef.type = b3.b3BodyType.b3_dynamicBody;
	bodyDef.position = [ 0, 10, 0 ];
	const body = b3.b3CreateBody( world, bodyDef );
	const shapeDef = b3.b3DefaultShapeDef();
	b3.b3CreateSphereShape( body, shapeDef, { center: [ 0, 0, 0 ], radius: 0.5 } );

	// out-param reader: fill a caller-owned [x,y,z], read component 1 (y)
	const pos = [ 0, 0, 0 ];
	const startY = b3.b3Body_GetPosition( pos, body )[ 1 ];

	// simulate ~2.5 s at 60 Hz
	for ( let i = 0; i < 150; i++ )
	{
		b3.b3World_Step( world, 1 / 60, 4 );
	}

	const endY = b3.b3Body_GetPosition( pos, body )[ 1 ];

	// multi-out reader: a transform reads as two out params (position + rotation),
	// and returns them as a [position, rotation] tuple.
	const tp = [ 0, 0, 0 ], tq = [ 0, 0, 0, 1 ];
	const [ tPos, tRot ] = b3.b3Body_GetTransform( tp, tq, body );
	assert.ok( tPos === tp && tRot === tq, 'GetTransform fills the caller arrays and returns them' );
	assert.ok( Math.abs( tPos[ 1 ] - endY ) < 1e-6, 'transform position matches GetPosition' );
	assert.ok( Math.abs( Math.hypot( tRot[ 0 ], tRot[ 1 ], tRot[ 2 ], tRot[ 3 ] ) - 1 ) < 1e-3, 'transform rotation is a unit quaternion' );

	b3.b3DestroyWorld( world );
	return { startY, endY };
}

// Drop a box onto the ground, let it settle, then read the resulting contact via
// the packed buffer + facade readers (createContact/getContactAt/getManifoldAt).
function contactRead( b3 )
{
	const worldDef = b3.b3DefaultWorldDef();
	worldDef.gravity = [ 0, -10, 0 ];
	const world = b3.b3CreateWorld( worldDef );

	const groundDef = b3.b3DefaultBodyDef();
	groundDef.type = b3.b3BodyType.b3_staticBody;
	const ground = b3.b3CreateBody( world, groundDef );
	b3.b3CreateBoxShape( ground, b3.b3DefaultShapeDef(), 25, 0.5, 25 );

	const boxDef = b3.b3DefaultBodyDef();
	boxDef.type = b3.b3BodyType.b3_dynamicBody;
	boxDef.position = [ 0, 5, 0 ];
	const box = b3.b3CreateBody( world, boxDef );
	const boxShape = b3.b3CreateBoxShape( box, b3.b3DefaultShapeDef(), 0.5, 0.5, 0.5 );

	// events buffer: one step while the box is falling reliably produces a body
	// move event — read it back through the reusable, wasm-backed events buffer.
	const eb = b3.createEventsBuffer();
	const move = b3.createBodyMoveEvent();
	b3.b3World_Step( world, 1 / 60, 4 );
	b3.getEvents( eb, world );
	const moveCount = b3.getNumBodyMoveEvents( eb );
	assert.ok( moveCount >= 1, `body move events reported while falling (got ${moveCount})` );
	b3.getBodyMoveEventAt( move, eb, 0 );
	assert.ok( Number.isFinite( move.position[ 1 ] ), 'body move event decodes a finite position' );
	const q = move.rotation;
	assert.ok( Math.abs( Math.hypot( q[ 0 ], q[ 1 ], q[ 2 ], q[ 3 ] ) - 1 ) < 1e-3, 'move event rotation is a unit quaternion' );

	for ( let i = 0; i < 150; i++ ) b3.b3World_Step( world, 1 / 60, 4 );

	// reusable contacts buffer: fill it, read it, then refill after another step to
	// exercise reuse + the growth-safe view refresh.
	const cb = b3.createContactsBuffer();
	const contact = b3.createContact();
	const manifold = b3.createManifold();

	function summarize()
	{
		b3.getShapeContactData( cb, boxShape );
		const n = b3.getNumContacts( cb );
		let totalPoints = 0;
		let worstNormalErr = 0;
		for ( let i = 0; i < n; i++ )
		{
			b3.getContactAt( contact, cb, i );
			// the queried shape is one side of the contact (box3d picks the A/B order)
			assert.ok(
				contact.shapeIdA.index1 === boxShape.index1 || contact.shapeIdB.index1 === boxShape.index1,
				'queried shape id round-trips as one side of the contact',
			);
			for ( let m = 0; m < contact.manifoldCount; m++ )
			{
				b3.getManifoldAt( manifold, contact, m );
				const nrm = manifold.normal;
				worstNormalErr = Math.max( worstNormalErr, Math.abs( Math.hypot( nrm[ 0 ], nrm[ 1 ], nrm[ 2 ] ) - 1 ) );
				totalPoints += manifold.pointCount;
			}
		}
		return { n, totalPoints, worstNormalErr };
	}

	const first = summarize();
	b3.b3World_Step( world, 1 / 60, 4 );
	const second = summarize(); // still valid after a refill following a step

	assert.ok( first.n >= 1, `resting box reports a contact (got ${first.n})` );
	assert.ok( first.totalPoints >= 1, `contact has at least one manifold point (got ${first.totalPoints})` );
	assert.ok( first.worstNormalErr < 1e-3, `manifold normal is unit-length (err ${first.worstNormalErr.toExponential( 1 )})` );
	assert.ok( second.n >= 1, 'reusable buffer still valid after a refill following a step' );

	b3.destroyContactsBuffer( cb );
	b3.destroyEventsBuffer( eb );
	b3.b3DestroyWorld( world );
	return { n: first.n, totalPoints: first.totalPoints, worstNormalErr: first.worstNormalErr };
}

// Exercise the sensor-touch, and CollideMover plane-result readers — the
// browser-facing buffer paths the examples use but the contact scene doesn't hit.
function eventsAndPlanes( b3 )
{
	const world = b3.b3CreateWorld( b3.b3DefaultWorldDef() );

	// sensor box at the origin with a dynamic visitor overlapping it
	const sensorBody = b3.b3CreateBody( world, b3.b3DefaultBodyDef() );
	const sensorShapeDef = b3.b3DefaultShapeDef();
	sensorShapeDef.isSensor = true;
	sensorShapeDef.enableSensorEvents = true;
	b3.b3CreateBoxShape( sensorBody, sensorShapeDef, 2, 2, 2 );

	const visitorDef = b3.b3DefaultBodyDef();
	visitorDef.type = b3.b3BodyType.b3_dynamicBody;
	visitorDef.position = [ 0, 0, 0 ];
	const visitorBody = b3.b3CreateBody( world, visitorDef );
	const visitorShapeDef = b3.b3DefaultShapeDef();
	visitorShapeDef.enableSensorEvents = true;
	const visitorShape = b3.b3CreateBoxShape( visitorBody, visitorShapeDef, 0.5, 0.5, 0.5 );

	const eb = b3.createEventsBuffer();
	const touch = b3.createSensorTouchEvent();
	let sawSensor = false;
	for ( let i = 0; i < 10 && !sawSensor; i++ )
	{
		b3.b3World_Step( world, 1 / 60, 4 );
		b3.getEvents( eb, world );
		for ( let k = 0, n = b3.getNumSensorBeginEvents( eb ); k < n; k++ )
		{
			b3.getSensorBeginEventAt( touch, eb, k );
			if ( touch.visitorShapeId.index1 === visitorShape.index1 ) sawSensor = true;
		}
	}
	b3.destroyEventsBuffer( eb );
	assert.ok( sawSensor, 'sensor begin-touch event decoded via the events buffer' );

	// CollideMover: a mover capsule overlapping a static sphere yields collision
	// planes (placed clear of the sensor bodies above).
	const obstacleDef = b3.b3DefaultBodyDef();
	obstacleDef.position = [ 10, 1, 0 ];
	const obstacle = b3.b3CreateBody( world, obstacleDef );
	b3.b3CreateSphereShape( obstacle, b3.b3DefaultShapeDef(), { center: [ 0, 0, 0 ], radius: 0.6 } );
	b3.b3World_Step( world, 1 / 60, 4 ); // put the new shape into the broadphase
	const capsule = { center1: [ 0, -0.5, 0 ], center2: [ 0, 0.5, 0 ], radius: 0.35 };
	const planeResult = b3.createPlaneResult();
	let planeCount = 0;
	let worstNormalErr = 0;
	b3.b3World_CollideMover( world, [ 10, 1, 0 ], capsule, b3.b3DefaultQueryFilter(), ( _s, buf ) =>
	{
		for ( let i = 0, n = b3.getNumPlaneResults( buf ); i < n; i++ )
		{
			b3.getPlaneResultAt( planeResult, buf, i );
			const nrm = planeResult.plane.normal;
			worstNormalErr = Math.max( worstNormalErr, Math.abs( Math.hypot( nrm[ 0 ], nrm[ 1 ], nrm[ 2 ] ) - 1 ) );
			planeCount++;
		}
		return true;
	} );
	assert.ok( planeCount >= 1, `CollideMover reported plane results via the buffer (got ${planeCount})` );
	assert.ok( worstNormalErr < 1e-3, 'plane-result normal is unit-length' );

	b3.b3DestroyWorld( world );
	return { sawSensor, planeCount };
}

// Dynamic mover joints: a rotation-locked capsule held up by a pogo joint to the
// ground and driven sideways by a mover joint to a hidden static base body.
function moverJoints( b3 )
{
	const worldDef = b3.b3DefaultWorldDef();
	worldDef.gravity = [ 0, -10, 0 ];
	const world = b3.b3CreateWorld( worldDef );

	const ground = b3.b3CreateBody( world, b3.b3DefaultBodyDef() );
	b3.b3CreateBoxShape( ground, b3.b3DefaultShapeDef(), 25, 0.5, 25 );
	const base = b3.b3CreateBody( world, b3.b3DefaultBodyDef() );

	const moverDef = b3.b3DefaultBodyDef();
	moverDef.type = b3.b3BodyType.b3_dynamicBody;
	moverDef.position = [ 0, 2, 0 ];
	moverDef.motionLocks.angularX = true;
	moverDef.motionLocks.angularY = true;
	moverDef.motionLocks.angularZ = true;
	const mover = b3.b3CreateBody( world, moverDef );
	const capsuleDef = b3.b3DefaultShapeDef();
	capsuleDef.density = 200;
	capsuleDef.baseMaterial.friction = 0;
	b3.b3CreateCapsuleShape( mover, capsuleDef, { center1: [ 0, -0.5, 0 ], center2: [ 0, 0.5, 0 ], radius: 0.3 } );

	const jointDef = b3.b3DefaultMoverJointDef();
	jointDef.base.bodyIdA = base;
	jointDef.base.bodyIdB = mover;
	jointDef.base.collideConnected = true;
	jointDef.maxForce = 6000;
	const moverJoint = b3.b3CreateMoverJoint( world, jointDef );
	assert.equal( b3.b3Joint_GetType( moverJoint ), b3.b3JointType.b3_moverJoint, 'mover joint type' );
	b3.b3MoverJoint_SetLinearVelocity( moverJoint, [ 2, 0, 0 ] );
	const velocity = b3.b3MoverJoint_GetLinearVelocity( [ 0, 0, 0 ], moverJoint );
	assert.deepEqual( velocity, [ 2, 0, 0 ], 'mover joint velocity reads back through the out-param' );

	// Pogo from the ground top (y = 0.5) to the capsule lower sphere center, resting 0.9 long,
	// so the capsule center settles at 0.5 + 0.9 + 0.5 = 1.9.
	const weight = 10 * b3.b3Body_GetMass( mover );
	const pogoDef = b3.b3DefaultPogoJointDef();
	pogoDef.base.bodyIdA = ground;
	pogoDef.base.bodyIdB = mover;
	pogoDef.base.collideConnected = true;
	pogoDef.base.localFrameA.position = [ 0, 0.5, 0 ];
	pogoDef.base.localFrameB.position = [ 0, -0.5, 0 ];
	pogoDef.restLength = 0.9;
	pogoDef.hertz = 3;
	pogoDef.dampingRatio = 0.8;
	pogoDef.maxCompressionForce = 100 * weight;
	pogoDef.maxTensionForce = 100 * weight;
	const pogo = b3.b3CreatePogoJoint( world, pogoDef );
	assert.equal( b3.b3Joint_GetType( pogo ), b3.b3JointType.b3_pogoJoint, 'pogo joint type' );
	assert.deepEqual( b3.b3PogoJoint_GetNormal( [ 0, 0, 0 ], pogo ), [ 0, 1, 0 ], 'pogo normal defaults to +y' );

	const pos = [ 0, 0, 0 ];
	for ( let i = 0; i < 120; i++ )
	{
		// keep the pogo anchored under the capsule as it slides
		b3.b3Body_GetPosition( pos, mover );
		b3.b3Joint_SetLocalFrameA( pogo, { position: [ pos[ 0 ], 0.5, pos[ 2 ] ], quaternion: [ 0, 0, 0, 1 ] } );
		b3.b3World_Step( world, 1 / 60, 4 );
	}
	b3.b3Body_GetPosition( pos, mover );
	const length = b3.b3PogoJoint_GetCurrentLength( pogo );
	b3.b3DestroyWorld( world );
	return { x: pos[ 0 ], y: pos[ 1 ], length };
}

async function check( label, importPath )
{
	const { default: Box3D } = await import( importPath );
	const b3 = await Box3D();

	const v = b3.b3GetVersion();
	const { startY, endY } = fallingBox( b3 );

	assert.ok( endY < startY - 5, `body fell (start=${startY.toFixed( 2 )} end=${endY.toFixed( 2 )})` );
	assert.ok( endY > 0.5, `body rests above the ground, not through it (end=${endY.toFixed( 2 )})` );

	const { n, totalPoints, worstNormalErr } = contactRead( b3 );
	assert.ok( n >= 1, `resting box reports a contact (got ${n})` );
	assert.ok( totalPoints >= 1, `contact has at least one manifold point (got ${totalPoints})` );
	assert.ok( worstNormalErr < 1e-3, `manifold normal is unit-length (err ${worstNormalErr.toExponential( 1 )})` );

	const { planeCount } = eventsAndPlanes( b3 );

	const mover = moverJoints( b3 );
	assert.ok( mover.x > 3, `mover joint drove the capsule along x (x=${mover.x.toFixed( 2 )})` );
	assert.ok( Math.abs( mover.y - 1.9 ) < 0.1, `pogo joint held the capsule at its rest height (y=${mover.y.toFixed( 2 )})` );
	assert.ok( Math.abs( mover.length - 0.9 ) < 0.1, `pogo current length is near its rest length (${mover.length.toFixed( 2 )})` );

	console.log( `  ${label}: box3d v${v.major}.${v.minor}.${v.revision} — ` +
		`sphere fell ${startY.toFixed( 2 )} -> ${endY.toFixed( 2 )} and settled; ` +
		`read ${n} contact(s)/${totalPoints} point(s), a sensor touch, and ${planeCount} mover plane(s) from the buffers; ` +
		`mover + pogo joints carried a capsule to x=${mover.x.toFixed( 2 )} at y=${mover.y.toFixed( 2 )}` );
}

console.log( 'box3d.js smoke test' );
await check( 'separate-wasm', '../dist/box3d.mjs' );
await check( 'inline       ', '../dist/box3d.inline.mjs' );
console.log( 'OK' );
