/* main.js
   - 3D driving game (procedural HD visuals, map, AI)
   - No external assets (textures/models) required.
   - Uses Three.js from CDN.
*/

/* ----------------------
   Basic three.js setup
   ---------------------- */
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fcfff);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth/window.innerHeight, 0.1, 10000);
camera.position.set(0, 8, -22);

/* lights */
const hemi = new THREE.HemisphereLight(0xffffff, 0x444455, 1.0);
hemi.position.set(0, 200, 0);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xffffff, 1.0);
sun.position.set(-50, 80, -60);
sun.castShadow = true;
sun.shadow.camera.left = -200; sun.shadow.camera.right = 200;
sun.shadow.camera.top = 200; sun.shadow.camera.bottom = -200;
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun);

/* Resize */
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth/window.innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

/* ----------------------
   Utilities: helper funcs
   ---------------------- */
function clamp(v, a,b){ return Math.max(a, Math.min(b, v)); }
function rand(min,max){ return Math.random()*(max-min)+min; }

/* ---- Generate procedural normal/roughness maps via canvas ---- */
function createNoiseCanvas(size = 512, scale = 8) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const image = ctx.createImageData(size, size);
  for(let y=0;y<size;y++){
    for(let x=0;x<size;x++){
      const i = (y*size+x)*4;
      // Perlin-style-ish simple value with sine-based cells
      const v = Math.floor(128 + 127*Math.sin((x/size)*Math.PI*scale + Math.random()*0.6) * Math.cos((y/size)*Math.PI*scale + Math.random()*0.6));
      image.data[i] = v; image.data[i+1]=v; image.data[i+2]=v; image.data[i+3]=255;
    }
  }
  ctx.putImageData(image,0,0);
  return cv;
}

/* create textures once */
const detailCanvas = createNoiseCanvas(512, 16);
const detailTexture = new THREE.CanvasTexture(detailCanvas);
detailTexture.wrapS = detailTexture.wrapT = THREE.RepeatWrapping;
detailTexture.repeat.set(8,8);

/* ----------------------
   Create HD materials (PBR-like)
   ---------------------- */
function makeGroundMaterial(hd = true){
  const mat = new THREE.MeshStandardMaterial({
    color: 0x324f30,
    roughness: hd ? 0.8 : 0.9,
    metalness: 0.02,
    envMapIntensity: 0.6,
  });
  if(hd){
    mat.normalMap = detailTexture;
    mat.normalScale = new THREE.Vector2(0.8,0.8);
  }
  return mat;
}
function makeBuildingMaterial(hd=true){
  const mat = new THREE.MeshStandardMaterial({
    color: 0xbdbdbd,
    roughness: hd ? 0.6 : 0.8,
    metalness: 0.1,
  });
  if(hd) { mat.roughnessMap = detailTexture; mat.roughnessMap.repeat.set(4,4); }
  return mat;
}
function makeRoadMaterial(hd=true){
  const mat = new THREE.MeshStandardMaterial({ color:0x222226, roughness: hd?0.6:0.8, metalness:0.03 });
  if(hd) { mat.normalMap = detailTexture; mat.normalScale = new THREE.Vector2(0.3,0.3); mat.normalMap.repeat.set(6,6); }
  return mat;
}
function makeCarMaterial(color=0xff3333, hd=true){
  const mat = new THREE.MeshStandardMaterial({ color, metalness: 0.6, roughness:hd?0.15:0.25 });
  return mat;
}

/* ----------------------
   Map generation (grid city)
   ---------------------- */
const MAP_SIZE = 1200;   // world size
const BLOCK = 120;       // block size
const ROAD_W = 12;       // road width

// Ground plane
const ground = new THREE.Mesh(new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE), makeGroundMaterial(true));
ground.rotation.x = -Math.PI/2;
ground.receiveShadow = true;
scene.add(ground);

// Road layer: create long boxes for roads across grid
const roads = new THREE.Group();
const roadMat = makeRoadMaterial(true);
for(let x = -MAP_SIZE/2; x <= MAP_SIZE/2; x += BLOCK){
  const geom = new THREE.BoxGeometry(ROAD_W, 0.1, MAP_SIZE);
  const mesh = new THREE.Mesh(geom, roadMat);
  mesh.position.set(x, 0.05, 0);
  mesh.receiveShadow = true;
  roads.add(mesh);
}
for(let z = -MAP_SIZE/2; z <= MAP_SIZE/2; z += BLOCK){
  const geom = new THREE.BoxGeometry(MAP_SIZE, 0.1, ROAD_W);
  const mesh = new THREE.Mesh(geom, roadMat);
  mesh.position.set(0, 0.05, z);
  mesh.receiveShadow = true;
  roads.add(mesh);
}
scene.add(roads);

// Sidewalks and blocks: create building blocks inside each block
const blocks = new THREE.Group();
const bMat = makeBuildingMaterial(true);
for(let bx = -MAP_SIZE/2; bx < MAP_SIZE/2; bx += BLOCK){
  for(let bz = -MAP_SIZE/2; bz < MAP_SIZE/2; bz += BLOCK){
    // skip central cross for variety
    const pad = 14;
    const blockW = BLOCK - ROAD_W - pad;
    const blockD = BLOCK - ROAD_W - pad;
    const cx = bx + BLOCK/2;
    const cz = bz + BLOCK/2;

    // randomize building count per block
    const count = Math.floor(rand(2,6));
    for(let i=0;i<count;i++){
      const bw = rand(blockW*0.18, blockW*0.45);
      const bd = rand(blockD*0.18, blockD*0.45);
      const bh = rand(18, rand(36, 160) );
      const ox = cx + rand(-blockW/2 + bw/2, blockW/2 - bw/2);
      const oz = cz + rand(-blockD/2 + bd/2, blockD/2 - bd/2);
      const bGeo = new THREE.BoxGeometry(bw, bh, bd);
      const building = new THREE.Mesh(bGeo, bMat);
      building.position.set(ox, bh/2, oz);
      building.castShadow = building.receiveShadow = true;
      blocks.add(building);
    }

    // small trees/props at block corners
    if(Math.random() < 0.7){
      const tree = createTree();
      tree.position.set(cx - blockW/2 + 6, 0, cz - blockD/2 + 6);
      blocks.add(tree);
    }
    if(Math.random() < 0.7){
      const tree = createTree();
      tree.position.set(cx + blockW/2 - 6, 0, cz + blockD/2 - 6);
      blocks.add(tree);
    }
  }
}
scene.add(blocks);

/* create a stylized tree */
function createTree(){
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.6,0.9,4,6), new THREE.MeshStandardMaterial({color:0x6b4f3f}));
  trunk.position.y = 2;
  g.add(trunk);
  const leaves = new THREE.Mesh(new THREE.SphereGeometry(2.6, 8, 8), new THREE.MeshStandardMaterial({color: 0x2b7a2b}));
  leaves.position.y = 5;
  g.add(leaves);
  return g;
}

/* ----------------------
   Player car (procedural)
   ---------------------- */
class PlayerCar {
  constructor(){
    this.group = new THREE.Group();
    // chassis
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.4,0.6,1.1), makeCarMaterial(0xff3333,true));
    body.position.y = 0.6;
    body.castShadow = true;
    this.group.add(body);
    // cabin
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.2,0.4,0.8), new THREE.MeshStandardMaterial({color:0xff7777}));
    cabin.position.set(0, 0.95, -0.05);
    this.group.add(cabin);
    // wheels
    const wgeo = new THREE.BoxGeometry(0.4,0.4,0.16);
    const wmat = new THREE.MeshStandardMaterial({color:0x111111});
    const positions = [[1.0,0.22,0.5], [-1.0,0.22,0.5], [1.0,0.22,-0.5], [-1.0,0.22,-0.5]];
    positions.forEach(p => {
      const w = new THREE.Mesh(wgeo, wmat);
      w.position.set(p[0], p[1], p[2]); w.castShadow=true;
      this.group.add(w);
    });

    this.group.position.set(0,0,0);
    this.speed = 0;
    this.maxSpeed = 48; // units/sec
    this.acc = 48;
    this.brake = 80;
    this.friction = 12;
    this.turn = 0.045;
    this.forward = 0;
    this.steer = 0;
  }
  update(dt){
    // speed
    if(this.forward < -0.02) this.speed += this.acc * dt * (-this.forward);
    else if(this.forward > 0.02) this.speed -= this.brake * dt * this.forward;
    else {
      if(this.speed > 0.02) this.speed -= this.friction * dt;
      else if(this.speed < -0.02) this.speed += this.friction * dt;
      else this.speed = 0;
    }
    this.speed = clamp(this.speed, -this.maxSpeed*0.4, this.maxSpeed);
    // rotation influenced by speed
    let steerEffect = this.turn * this.steer * (0.6 + 0.4 * (1 - Math.abs(this.speed)/this.maxSpeed));
    this.group.rotation.y += steerEffect * (this.speed / Math.max(1, this.maxSpeed)) * dt * 60;
    // move
    const forwardVec = new THREE.Vector3(0,0,-1).applyQuaternion(this.group.quaternion).multiplyScalar(this.speed * dt);
    this.group.position.add(forwardVec);
  }
}

/* ----------------------
   AI car class
   ---------------------- */
class AICar {
  constructor(color=0x22aacc){
    this.group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.2,0.6,1.05), makeCarMaterial(color,true));
    body.position.y = 0.6; body.castShadow=true;
    this.group.add(body);
    // wheels simple
    const wgeo = new THREE.BoxGeometry(0.32,0.32,0.14);
    const wmat = new THREE.MeshStandardMaterial({color:0x111111});
    [[0.95,0.22,0.48],[-0.95,0.22,0.48],[0.95,0.22,-0.48],[-0.95,0.22,-0.48]].forEach(p=>{
      const w = new THREE.Mesh(wgeo, wmat); w.position.set(p[0],p[1],p[2]); w.castShadow=true; this.group.add(w);
    });
    this.speed = rand(12, 30);
    this.maxSpeed = this.speed;
    this.path = [];
    this.targetIndex = 0;
    this.avoidRadius = 8;
  }
  setPath(p){ this.path = p; this.targetIndex = 0; }
  update(dt, others){
    if(this.path.length===0) return;
    const target = this.path[this.targetIndex];
    const toTarget = new THREE.Vector3(target.x,0,target.z).sub(this.group.position);
    const dist = toTarget.length();
    const desiredDir = Math.atan2(toTarget.x, -toTarget.z); // world yaw to target
    // current yaw
    const yaw = this.group.rotation.y;
    let ang = desiredDir - yaw;
    ang = Math.atan2(Math.sin(ang), Math.cos(ang));
    const steer = clamp(ang*3, -1, 1); // simple steering
    // speed adjustments and avoidance
    let localSpeed = this.maxSpeed;
    // avoid others (player and ai)
    for(const o of others){
      if(o === this) continue;
      const d = o.group.position.distanceTo(this.group.position);
      if(d < this.avoidRadius){
        localSpeed = Math.min(localSpeed, this.maxSpeed * 0.4);
        // steer away
        const away = new THREE.Vector3().subVectors(this.group.position, o.group.position).normalize();
        const awayYaw = Math.atan2(away.x, -away.z);
        let aAng = awayYaw - yaw; aAng = Math.atan2(Math.sin(aAng), Math.cos(aAng));
        ang += aAng * 0.6;
      }
    }
    // rotate
    this.group.rotation.y += ang * 0.06 * dt * 60;
    // move forward
    const forwardVec = new THREE.Vector3(0,0,-1).applyQuaternion(this.group.quaternion).multiplyScalar(localSpeed * dt);
    this.group.position.add(forwardVec);
    if(dist < 6){
      this.targetIndex = (this.targetIndex + 1) % this.path.length;
    }
  }
}

/* ----------------------
   Spawn player and AI, build waypoint network
   ---------------------- */
const player = new PlayerCar();
player.group.position.set(0,0,0);
scene.add(player.group);

const aiCars = [];
// spawn AI cars on random road intersections and give them loop paths
const waypoints = [];
for(let x=-MAP_SIZE/2+BLOCK/2; x<=MAP_SIZE/2-BLOCK/2; x+=BLOCK){
  for(let z=-MAP_SIZE/2+BLOCK/2; z<=MAP_SIZE/2-BLOCK/2; z+=BLOCK){
    waypoints.push({x, z});
  }
}
// helper to create a smooth route around a few random waypoints
function makeRoute(centerX, centerZ){
  const route = [];
  const len = Math.floor(rand(6,12));
  let cx = centerX, cz = centerZ;
  for(let i=0;i<len;i++){
    cx += rand(-BLOCK, BLOCK); cz += rand(-BLOCK, BLOCK);
    // snap to nearest road coordinate
    cx = clamp(cx, -MAP_SIZE/2+10, MAP_SIZE/2-10);
    cz = clamp(cz, -MAP_SIZE/2+10, MAP_SIZE/2-10);
    route.push({x: cx, z: cz});
  }
  return route;
}
// spawn some AI
for(let i=0;i<12;i++){
  const ai = new AICar( [0x22aacc,0xffcc33,0x44cc66,0xff6666][i%4] );
  const sx = rand(-MAP_SIZE/2+20, MAP_SIZE/2-20);
  const sz = rand(-MAP_SIZE/2+20, MAP_SIZE/2-20);
  ai.group.position.set(sx, 0, sz);
  ai.setPath(makeRoute(sx, sz));
  scene.add(ai.group);
  aiCars.push(ai);
}

/* ----------------------
   Simple collision check (AABB)
   ---------------------- */
function collideWithBuildings(obj){
  const bb = new THREE.Box3().setFromObject(obj);
  // check boundaries (world)
  if(obj.position.x < -MAP_SIZE/2+4 || obj.position.x > MAP_SIZE/2-4 || obj.position.z < -MAP_SIZE/2+4 || obj.position.z > MAP_SIZE/2-4) return true;
  // check buildings
  for(const b of blocks.children){
    const bbb = new THREE.Box3().setFromObject(b);
    if(bbb.intersectsBox(bb)) return true;
  }
  return false;
}

/* ----------------------
   Camera control (third-person) + pinch zoom
   ---------------------- */
let cameraDistance = 24;
let cameraHeight = 8;
let lastPinch = null;
window.addEventListener('touchstart', (e) => { if(e.touches.length===2) lastPinch = distance(e.touches[0], e.touches[1]); }, {passive:true});
window.addEventListener('touchmove', (e) => {
  if(e.touches.length===2){
    const d = distance(e.touches[0], e.touches[1]);
    if(lastPinch) {
      cameraDistance = clamp(cameraDistance - (d-lastPinch)*0.02, 10, 60);
      cameraHeight = clamp(cameraHeight - (d-lastPinch)*0.01, 4, 20);
    }
    lastPinch = d;
  }
}, {passive:true});
window.addEventListener('touchend', (e) => { if(e.touches.length<2) lastPinch=null; });

function distance(a,b){ const dx=a.clientX-b.clientX, dy=a.clientY-b.clientY; return Math.sqrt(dx*dx+dy*dy); }

/* ----------------------
   Controls: virtual joystick + keyboard fallback
   ---------------------- */
const joystick = document.getElementById('joystick');
const stick = document.getElementById('stick');
let joyActive=false, joyId=null, originX=0, originY=0;
let joystickVal = {x:0,y:0};

function setStick(dx,dy){
  const max = Math.max(48, joystick.clientWidth/3);
  const dist = Math.sqrt(dx*dx + dy*dy);
  if(dist > max){ dx = dx/dist*max; dy = dy/dist*max; }
  stick.style.transform = `translate(${dx}px, ${dy}px)`;
  joystickVal.x = dx/max; joystickVal.y = dy/max;
}
function resetStick(){
  stick.style.transform = `translate(0px,0px)`; joystickVal.x=0; joystickVal.y=0;
}

joystick.addEventListener('touchstart', (e) => {
  const t = e.changedTouches[0]; joyActive=true; joyId=t.identifier; originX=t.pageX; originY=t.pageY; setStick(0,0);
}, {passive:false});
joystick.addEventListener('touchmove', (e) => {
  for(const t of e.changedTouches) if(t.identifier===joyId){ setStick(t.pageX-originX, t.pageY-originY); e.preventDefault(); }
}, {passive:false});
joystick.addEventListener('touchend', (e) => {
  for(const t of e.changedTouches) if(t.identifier===joyId){ joyActive=false; joyId=null; resetStick(); e.preventDefault(); }
}, {passive:false});

// desktop fallback
const keys = {left:false, right:false, up:false, down:false};
window.addEventListener('keydown', (e)=> {
  if(e.key==='a'||e.key==='A'||e.key==='ArrowLeft') keys.left=true;
  if(e.key==='d'||e.key==='D'||e.key==='ArrowRight') keys.right=true;
  if(e.key==='w'||e.key==='W'||e.key==='ArrowUp') keys.up=true;
  if(e.key==='s'||e.key==='S'||e.key==='ArrowDown') keys.down=true;
});
window.addEventListener('keyup', (e)=> {
  if(e.key==='a'||e.key==='A'||e.key==='ArrowLeft') keys.left=false;
  if(e.key==='d'||e.key==='D'||e.key==='ArrowRight') keys.right=false;
  if(e.key==='w'||e.key==='W'||e.key==='ArrowUp') keys.up=false;
  if(e.key==='s'||e.key==='S'||e.key==='ArrowDown') keys.down=false;
});

/* HUD and quality toggle */
const speedEl = document.getElementById('speed');
const hdToggle = document.getElementById('hdToggle');
hdToggle.addEventListener('change', ()=> setQuality(hdToggle.checked) );
function setQuality(hd){
  // adjust renderer & material detail
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, hd?2:1.0));
  // toggle normal maps
  [ground, ...blocks.children].forEach(m=>{
    if(m.material){
      if(hd && detailTexture) {
        if(!m.material.normalMap) m.material.normalMap = detailTexture;
      } else {
        if(m.material.normalMap) m.material.normalMap = null;
      }
      m.material.needsUpdate = true;
    }
  });
}
setQuality(true);

/* ----------------------
   Main loop
   ---------------------- */
let last = performance.now();
function tick(now){
  const dt = Math.min((now - last)/1000, 0.05); last = now;

  // compute controls: joystickVal.x -> steer, joystickVal.y -> throttle (negative=forward)
  let steer = 0, throttle = 0;
  if(Math.abs(joystickVal.x) > 0.02 || Math.abs(joystickVal.y) > 0.02){
    steer = joystickVal.x;
    throttle = joystickVal.y;
  } else {
    steer = (keys.right?1:0) - (keys.left?1:0);
    throttle = (keys.down?1:0) - (keys.up?1:0);
  }

  // apply to player
  player.steer = clamp(steer, -1, 1);
  player.forward = clamp(throttle, -1, 1);
  player.update(dt);

  // collision with buildings or bounds: simple rollback
  if(collideWithBuildings(player.group)){
    // rollback small step and damp speed
    const back = new THREE.Vector3(0,0,1).applyQuaternion(player.group.quaternion).multiplyScalar(0.2);
    player.group.position.add(back);
    player.speed *= -0.25;
  }

  // update AI
  for(const ai of aiCars) ai.update(dt, [player, ...aiCars]);

  // camera follow (smooth)
  const backDir = new THREE.Vector3(0,0,1).applyQuaternion(player.group.quaternion);
  const desired = new THREE.Vector3().copy(player.group.position).add(backDir.multiplyScalar(cameraDistance)).add(new THREE.Vector3(0,cameraHeight,0));
  camera.position.lerp(desired, 0.09);
  camera.lookAt(player.group.position.x, player.group.position.y + 1.4, player.group.position.z);

  // update HUD
  speedEl.innerText = `Speed: ${Math.round(player.speed)}`;

  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

/* ----------------------
   Done — performance notes
   ---------------------- */
/* Tips:
   - For best mobile performance run via local HTTP server (python -m http.server)
   - Use HD toggle to reduce pixel ratio and normal maps if the device is slow.
   - I kept everything procedural—no external models/textures—so it's fully offline-ready.
*/