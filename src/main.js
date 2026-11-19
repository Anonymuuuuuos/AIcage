import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import * as CANNON from 'cannon-es';

const canvas = document.querySelector('#scene');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x090b10);
scene.fog = new THREE.FogExp2(0x090b10, 0.018);

const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.05, 100);
camera.position.set(5.8, 4.2, 7.2);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.05, 0);
controls.enableDamping = true;
controls.minDistance = 3;
controls.maxDistance = 18;

scene.add(new THREE.HemisphereLight(0xc9dcff, 0x151923, 1.5));
const sun = new THREE.DirectionalLight(0xfff1d6, 3.2);
sun.position.set(4, 8, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = sun.shadow.camera.bottom = -7;
sun.shadow.camera.right = sun.shadow.camera.top = 7;
scene.add(sun);

const world = new CANNON.World({
  gravity: new CANNON.Vec3(0, -9.81, 0)
});
world.broadphase = new CANNON.SAPBroadphase(world);
world.allowSleep = true;
world.defaultContactMaterial.friction = 0.65;
world.defaultContactMaterial.restitution = 0.05;

const floorMat = new THREE.MeshStandardMaterial({ color: 0x11151b, roughness: 0.72, metalness: 0.12 });
const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), floorMat);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
world.addBody(new CANNON.Body({
  mass: 0,
  shape: new CANNON.Plane()
}));

const grid = new THREE.GridHelper(8, 16, 0x344052, 0x202631);
grid.position.y = 0.003;
scene.add(grid);

function addWall(size, position) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(size.x, size.y, size.z),
    new THREE.MeshPhysicalMaterial({
      color: 0x7788a0, roughness: 0.25, metalness: 0.15,
      transparent: true, opacity: 0.12, depthWrite: false
    })
  );
  mesh.position.copy(position);
  mesh.receiveShadow = true;
  scene.add(mesh);
  const body = new CANNON.Body({ mass: 0 });
  body.addShape(new CANNON.Box(new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2)));
  body.position.set(position.x, position.y, position.z);
  world.addBody(body);
}

addWall({x: 8, y: 3, z: 0.12}, new THREE.Vector3(0, 1.5, -4));
addWall({x: 8, y: 3, z: 0.12}, new THREE.Vector3(0, 1.5, 4));
addWall({x: 0.12, y: 3, z: 8}, new THREE.Vector3(-4, 1.5, 0));

// Door opening occupies the north wall with a hinge on the left edge.
const doorGroup = new THREE.Group();
const doorMesh = new THREE.Mesh(
  new THREE.BoxGeometry(2.8, 2.4, 0.12),
  new THREE.MeshStandardMaterial({ color: 0x6f7f91, roughness: 0.38, metalness: 0.55 })
);
doorMesh.position.set(-1.4, 1.2, 0);
doorMesh.castShadow = true;
doorMesh.receiveShadow = true;
doorGroup.add(doorMesh);
doorGroup.position.set(2.6, 0, -3.94);
scene.add(doorGroup);

const doorBody = new CANNON.Body({ mass: 12, linearDamping: 0.5, angularDamping: 0.8 });
doorBody.addShape(new CANNON.Box(new CANNON.Vec3(1.4, 1.2, 0.06)), new CANNON.Vec3(-1.4, 1.2, 0));
doorBody.position.set(1.2, 1.2, -3.94);
world.addBody(doorBody);

const anchorBody = new CANNON.Body({ mass: 0 });
anchorBody.position.set(2.6, 1.2, -3.94);
world.addBody(anchorBody);
world.addConstraint(new CANNON.HingeConstraint(anchorBody, doorBody, {
  pivotA: new CANNON.Vec3(0, 0, 0),
  pivotB: new CANNON.Vec3(1.4, 0, 0),
  axisA: new CANNON.Vec3(0, 1, 0),
  axisB: new CANNON.Vec3(0, 1, 0),
  maxForce: 1e6
}));

let doorOpen = false;
function toggleDoor() {
  doorOpen = !doorOpen;
  doorBody.wakeUp();
  doorBody.applyImpulse(
    new CANNON.Vec3(0, 0, doorOpen ? 35 : -35),
    doorBody.position
  );
  document.querySelector('#doorBtn').firstChild.textContent = doorOpen ? 'Close door ' : 'Open door ';
}

const robot = new THREE.Group();
robot.position.set(0, 0.79, 0);
scene.add(robot);

const humanoidPhysics = new CANNON.Body({
  mass: 35,
  position: new CANNON.Vec3(0, 1.1, 0),
  linearDamping: 0.35,
  angularDamping: 0.75,
  shape: new CANNON.Box(new CANNON.Vec3(0.28, 0.75, 0.22))
});
world.addBody(humanoidPhysics);

const xmlLoader = new THREE.FileLoader();
let actuatorControls = [];

function xmlVector(text) {
  return (text || '0 0 0').trim().split(/\s+/).map(Number);
}
function xmlQuat(text) {
  const q = xmlVector(text);
  return q.length === 4 ? q : [1, 0, 0, 0];
}

// Converts MuJoCo Z-up local coordinates and quaternions to Three Y-up.
function threePosition(pos) {
  return new THREE.Vector3(pos[0], pos[2], -pos[1]);
}
function threeQuat(q) {
  const qZup = new THREE.Quaternion(q[1], q[2], q[3], q[0]);
  const zToY = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  return zToY.multiply(qZup);
}

const loader = new STLLoader();
const materials = {
  black: new THREE.MeshStandardMaterial({ color: 0x20242b, roughness: 0.42, metalness: 0.3 }),
  metal: new THREE.MeshStandardMaterial({ color: 0x9aa1a8, roughness: 0.38, metalness: 0.7 })
};

async function loadMesh(name) {
  if (!name) return null;
  return new Promise((resolve, reject) => {
    loader.load(`/assets/${name}`, geometry => {
      geometry.computeVertexNormals();
      resolve(geometry);
    }, undefined, reject);
  });
}

async function buildRobotFromXml(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  const meshes = new Map(
    [...doc.querySelectorAll('mesh')].map(mesh => [mesh.getAttribute('name') || mesh.getAttribute('file'), mesh.getAttribute('file')])
  );
  const cache = new Map();

  async function buildBody(body, parent) {
    const group = new THREE.Group();
    group.name = body.getAttribute('name');
    group.position.copy(threePosition(xmlVector(body.getAttribute('pos'))));
    if (body.hasAttribute('quat')) group.quaternion.copy(threeQuat(xmlQuat(body.getAttribute('quat'))));
    parent.add(group);

    const geometries = [...body.children].filter(child => child.tagName === 'geom');
    for (const geom of geometries) {
      if (geom.getAttribute('class') === 'collision') continue;
      const meshName = geom.getAttribute('mesh');
      if (!meshName) continue;
      const file = meshes.get(meshName) || `${meshName}.STL`;
      let geometry = cache.get(file);
      if (!geometry) {
        geometry = await loadMesh(file);
        if (geometry) cache.set(file, geometry);
      }
      if (!geometry) continue;
      const materialName = geom.getAttribute('material');
      const mesh = new THREE.Mesh(geometry, materials[materialName] || materials.metal);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (geom.hasAttribute('pos')) mesh.position.copy(threePosition(xmlVector(geom.getAttribute('pos'))));
      if (geom.hasAttribute('quat')) mesh.quaternion.copy(threeQuat(xmlQuat(geom.getAttribute('quat'))));
      group.add(mesh);
    }

    for (const child of body.children) {
      if (child.tagName === 'body') await buildBody(child, group);
    }
  }

  const worldBody = doc.querySelector('worldbody');
  const rootBody = worldBody.querySelector(':scope > body');
  if (rootBody) await buildBody(rootBody, robot);

  const actuators = [...doc.querySelectorAll('actuator position')].map(el => ({
    name: el.getAttribute('name'),
    joint: el.getAttribute('joint'),
    force: el.getAttribute('forcerange')
  }));
  buildActuatorUI(actuators);
  document.querySelector('#dofCount').textContent = actuators.length;
  document.querySelector('#statusText').textContent = 'MODEL LOADED';
  setTimeout(() => document.querySelector('#statusText').textContent = 'RUNNING', 1200);
}

function buildActuatorUI(actuators) {
  const list = document.querySelector('#actuatorList');
  list.replaceChildren();
  actuatorControls = actuators.map((actuator, index) => {
    const row = document.createElement('div');
    row.className = 'actuator';
    const label = document.createElement('label');
    label.textContent = actuator.name.replaceAll('_', ' ');
    const input = document.createElement('input');
    input.type = 'range';
    input.min = '-1';
    input.max = '1';
    input.step = '0.01';
    input.value = '0';
    const output = document.createElement('output');
    output.textContent = '0.00';
    input.addEventListener('input', () => { output.textContent = Number(input.value).toFixed(2); });
    row.append(label, input, output);
    list.append(row);
    return { ...actuator, input, index };
  });
}

xmlLoader.load('/assets/g1_with_hands.xml', text => buildRobotFromXml(text));

let paused = false;
let speed = 1;
let reverse = false;
let policyRunning = false;
let simTime = 0;
let reward = 0;
const snapshots = [];
const clock = new THREE.Clock();
const keys = {};

function resetRobot() {
  humanoidPhysics.position.set(0, 1.1, 0);
  humanoidPhysics.velocity.setZero();
  humanoidPhysics.angularVelocity.setZero();
  humanoidPhysics.quaternion.set(0, 0, 0, 1);
  robot.position.set(0, 0, 0);
  robot.rotation.set(0, 0, 0);
  simTime = 0;
  snapshots.length = 0;
}

function saveSnapshot() {
  snapshots.push({
    position: humanoidPhysics.position.clone(),
    quaternion: humanoidPhysics.quaternion.clone(),
    velocity: humanoidPhysics.velocity.clone(),
    angular: humanoidPhysics.angularVelocity.clone(),
    time: simTime
  });
  if (snapshots.length > 3600) snapshots.shift();
}

function playSnapshot() {
  if (!snapshots.length) return;
  const snap = reverse ? snapshots.pop() : snapshots.shift();
  humanoidPhysics.position.copy(snap.position);
  humanoidPhysics.quaternion.copy(snap.quaternion);
  humanoidPhysics.velocity.copy(snap.velocity);
  humanoidPhysics.angularVelocity.copy(snap.angular);
  simTime = snap.time;
}

document.querySelector('#pauseBtn').addEventListener('click', () => {
  paused = !paused;
  document.querySelector('#pauseBtn').textContent = paused ? '▶' : 'Ⅱ';
  document.querySelector('#statusDot').style.background = paused ? '#e6bd65' : '#65e0a3';
  document.querySelector('#statusText').textContent = paused ? 'PAUSED' : 'RUNNING';
});
document.querySelector('#stepBtn').addEventListener('click', () => {
  world.step(1 / 60);
  simTime += 1 / 60;
});
document.querySelector('#speedSelect').addEventListener('change', event => {
  speed = Number(event.target.value);
});
document.querySelector('#resetBtn').addEventListener('click', resetRobot);
document.querySelector('#doorBtn').addEventListener('click', toggleDoor);
document.querySelector('#reverseBtn').addEventListener('click', () => {
  reverse = !reverse;
  document.querySelector('#reverseBtn').classList.toggle('primary', reverse);
  document.querySelector('#statusText').textContent = reverse ? 'REVERSING' : 'RUNNING';
});
document.querySelector('#rewindBtn').addEventListener('click', () => {
  for (let i = 0; i < 120 && snapshots.length; i++) {
    const snap = snapshots.pop();
    humanoidPhysics.position.copy(snap.position);
    humanoidPhysics.quaternion.copy(snap.quaternion);
    humanoidPhysics.velocity.copy(snap.velocity);
    humanoidPhysics.angularVelocity.copy(snap.angular);
  }
});
document.querySelector('#fastBtn').addEventListener('click', () => {
  speed = speed >= 4 ? 0.25 : speed * 2;
  document.querySelector('#speedSelect').value = String(speed);
});
document.querySelector('#policyBtn').addEventListener('click', event => {
  policyRunning = !policyRunning;
  event.currentTarget.textContent = policyRunning ? 'Stop policy' : 'Start random policy';
  event.currentTarget.classList.toggle('accent', !policyRunning);
});

window.addEventListener('keydown', event => {
  keys[event.key.toLowerCase()] = true;
  if (event.key.toLowerCase() === 'e') toggleDoor();
});
window.addEventListener('keyup', event => { keys[event.key.toLowerCase()] = false; });

function applyPolicy(dt) {
  if (!policyRunning) return;
  for (const control of actuatorControls) {
    if (Math.random() < dt * 1.2) {
      control.input.value = (Math.random() * 2 - 1).toFixed(2);
      control.input.dispatchEvent(new Event('input'));
    }
  }
}

function applyMovement(dt) {
  const forward = keys.w ? 1 : keys.s ? -1 : 0;
  const side = keys.d ? 1 : keys.a ? -1 : 0;
  const turn = keys.r ? 1 : keys.q ? -1 : 0;
  if (forward || side) {
    const force = new CANNON.Vec3(side * 85, 0, forward * -85);
    humanoidPhysics.applyForce(force, humanoidPhysics.position);
  }
  if (turn) humanoidPhysics.angularVelocity.y = turn * 2.2;
  if (keys[' '] ) humanoidPhysics.applyImpulse(new CANNON.Vec3(0, 140, 0), humanoidPhysics.position);
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  controls.update();

  if (!paused) {
    if (reverse) {
      playSnapshot();
    } else {
      applyPolicy(dt);
      applyMovement(dt);
      const substeps = Math.max(1, Math.ceil(speed));
      for (let i = 0; i < substeps; i++) world.step(1 / 60);
      simTime += dt * speed;
      if (snapshots.length === 0 || Math.floor(simTime * 60) !== Math.floor((snapshots.at(-1)?.time || -1) * 60)) {
        saveSnapshot();
      }
    }
  }

  robot.position.set(humanoidPhysics.position.x, humanoidPhysics.position.y - 0.31, humanoidPhysics.position.z);
  robot.quaternion.set(
    humanoidPhysics.quaternion.x,
    humanoidPhysics.quaternion.y,
    humanoidPhysics.quaternion.z,
    humanoidPhysics.quaternion.w
  );

  doorGroup.position.set(doorBody.position.x + 1.4, doorBody.position.y - 1.2, doorBody.position.z);
  doorGroup.quaternion.set(
    doorBody.quaternion.x,
    doorBody.quaternion.y,
    doorBody.quaternion.z,
    doorBody.quaternion.w
  );

  reward = (1 - Math.max(0, Math.abs(humanoidPhysics.position.y - 1.1) * 0.15) + Math.max(0, humanoidPhysics.velocity.length() * 0.01));
  document.querySelector('#rewardValue').textContent = reward.toFixed(3);
  document.querySelector('#timeValue').textContent = `${simTime.toFixed(2)} s`;

  renderer.render(scene, camera);
}

animate();

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
