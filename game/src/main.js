import * as THREE from '../vendor/three.module.min.js';
import { createWorld, clamp, distance } from './world.js';

const canvas = document.getElementById('game');
const title = document.getElementById('title');
const missionEl = document.getElementById('mission');
const districtEl = document.getElementById('districtname');
const wantedEl = document.getElementById('wanted');
const speedEl = document.getElementById('speednum');
const promptEl = document.getElementById('prompt');
const toastEl = document.getElementById('toast');
const pauseEl = document.getElementById('pause');
const hud = document.getElementById('hud');
const pressureEl = document.getElementById('pressure');
const mapCanvas = document.getElementById('minimap');
const map = mapCanvas.getContext('2d');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#b9d0dc');
scene.fog = new THREE.FogExp2('#d2b29f', 0.0062);
const camera = new THREE.PerspectiveCamera(54, innerWidth / innerHeight, 0.1, 260);

const world = createWorld();
const state = world.state;
let playing = false, paused = false, yaw = 0.18, pitch = 0.24, empFlash = 0;
let audio, muted = false, inMission = false;
let lastMeaningfulSave = 0;
let chaseElapsed = 0;
let walkFx=0,walkFz=0,currentMoveSpeed=0;

function synth(type) {
  if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
  if (muted) return;
  const osc = audio.createOscillator(), gain = audio.createGain();
  osc.type = type === 'emp' ? 'sawtooth' : 'sine';
  osc.frequency.value = type === 'emp' ? 85 : type === 'enter' ? 180 : 230;
  gain.gain.setValueAtTime(type === 'emp' ? 0.12 : 0.05, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + (type === 'emp' ? 0.7 : 0.16));
  osc.connect(gain).connect(audio.destination); osc.start(); osc.stop(audio.currentTime + 0.72);
}

function toast(text) {
  toastEl.textContent = text; toastEl.classList.add('show');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => toastEl.classList.remove('show'), 2200);
}

function mat(color, rough = 0.82, metal = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
}

// Sky and sun
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(180, 32, 18),
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: { top: { value: new THREE.Color('#315c9a') }, bottom: { value: new THREE.Color('#ffad84') }, sun: { value: new THREE.Vector3(-0.65, 0.18, -0.55) } },
    vertexShader: 'varying vec3 vP;void main(){vP=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: 'varying vec3 vP;uniform vec3 top;uniform vec3 bottom;uniform vec3 sun;void main(){float h=smoothstep(-.25,.55,vP.y);vec3 c=mix(bottom,top,h);float s=pow(max(dot(normalize(vP),normalize(sun)),0.0),180.0);c=mix(c,vec3(1.0,.74,.42),s*.9);gl_FragColor=vec4(c,1.0);}'
  })
);
scene.add(sky);
scene.add(new THREE.HemisphereLight('#91bde9', '#ffb17d', 2));
const sun = new THREE.DirectionalLight('#fff1b5', 3.2);
sun.position.set(-45, 65, -50); sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024); sun.shadow.camera.left = -70; sun.shadow.camera.right = 70;
sun.shadow.camera.top = 70; sun.shadow.camera.bottom = -70; scene.add(sun);

// Ground, sea and avenue
const ground = new THREE.Mesh(new THREE.PlaneGeometry(220, 260), mat('#9bc9a8'));
ground.rotation.x = -Math.PI / 2; ground.position.z = 0; ground.receiveShadow = true; scene.add(ground);
const sea = new THREE.Mesh(new THREE.PlaneGeometry(220, 90), new THREE.MeshPhysicalMaterial({
  color:'#4d91aa', roughness:.18, metalness:.12, transparent:true, opacity:.9
}));
sea.rotation.x=-Math.PI/2; sea.position.set(0, -.08, -133); sea.receiveShadow=true; scene.add(sea);
for(let i=0;i<16;i++){
  const rail=new THREE.Mesh(new THREE.BoxGeometry(220,.025,.28),mat(i%2?'#ffc3a1':'#84ced0'));
  rail.position.set(0,.015,-93+i*3);scene.add(rail);
}
const road = new THREE.Mesh(new THREE.PlaneGeometry(26, 176), mat('#4a5062'));
road.rotation.x=-Math.PI/2; road.position.set(0,.02,0); road.receiveShadow=true; scene.add(road);
for(let z=-82;z<84;z+=9){
  const dash=new THREE.Mesh(new THREE.BoxGeometry(.12,.025,3.8),mat('#f6ddb1'));
  dash.position.set(0,.07,z);scene.add(dash);
}
for(const x of [-13,13]){
  const walk=new THREE.Mesh(new THREE.BoxGeometry(7,.12,176),mat('#d9bda8'));
  walk.position.set(x,.08,0);walk.receiveShadow=true;scene.add(walk);
}

// Buildings and landmarks
const buildingColors=['#d9ebd7','#f1d1b8','#96bbc7','#f4b9a8','#b9d5cf','#e8d6a6'];
function building(x,z,w,d,h,color,decor=true){
  const group=new THREE.Group();
  const base=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat(color,.68,.04));
  base.position.y=h/2;base.castShadow=base.receiveShadow=true;group.add(base);
  const trim=new THREE.Mesh(new THREE.BoxGeometry(w+.25,.18,d+.25),mat('#f9de9c',.5));
  trim.position.y=h-.25;group.add(trim);
  if(decor) for(let yy=2.2;yy<h-1;yy+=3.1){
    for(let xx=-w/2+1.2;xx<w/2-.8;xx+=2.1){
      const win=new THREE.Mesh(new THREE.PlaneGeometry(1.05,1.35),mat('#4a7f95',.25,.25));
      win.position.set(xx,yy,d/2+.012);group.add(win);
    }
  }
  group.position.set(x,0,z);scene.add(group);
  return group;
}
for(let i=0;i<5;i++){
  building(-38+i*0,-68+i*9,10,12,8+(i%3)*4,buildingColors[i%buildingColors.length]);
  building(38-i*0,-68+i*10,10,12,10+(i%2)*5,buildingColors[(i+2)%buildingColors.length]);
}
for(const z of [-38,-8,22,52]){
  building(-20,z,11,13,10+(z%3)*2,buildingColors[(z+38)%buildingColors.length|0]);
  building(20,z,11,13,12+(z%2)*3,buildingColors[(z/10+2)|0]);
}
// Coral tower and lighthouse landmark
building(-2,-76,20,14,28,'#eaa18e');
const dome=new THREE.Mesh(new THREE.SphereGeometry(5.2,20,12,0,Math.PI*2,0,Math.PI/2),mat('#ffd69a'));
dome.position.set(-2,28,-76);scene.add(dome);
const beacon=new THREE.Mesh(new THREE.CylinderGeometry(.35,.35,8,12),mat('#ffe09a'));
beacon.position.set(-2,32,-76);scene.add(beacon);

// Distant island skyline and harbor cranes
for(let i=0;i<9;i++){
  const h=3+i%4*3;
  const tower=new THREE.Mesh(new THREE.BoxGeometry(4,h,5),mat(buildingColors[i%buildingColors.length]));
  tower.position.set(-74+i*18,h/2,-98-i%2*4);tower.receiveShadow=true;scene.add(tower);
}
for(const x of [-58,58]){
  const mast=new THREE.Mesh(new THREE.CylinderGeometry(.12,.16,18,6),mat('#ffe3aa'));
  mast.position.set(x,9,-105);scene.add(mast);
  const arm=new THREE.Mesh(new THREE.BoxGeometry(10,.18,.18),mat('#ffe3aa'));
  arm.position.set(x,17,-105);scene.add(arm);
}
for(let i=0;i<5;i++){
  const wake=new THREE.Mesh(new THREE.BoxGeometry(.12,.02,18),mat('#b9e8e6',.1,.2));
  wake.position.set(-49+i*24,.02,-116+(i%2)*6);scene.add(wake);
}

// Palm rows
function palm(x,z){
  const g=new THREE.Group();
  const trunk=new THREE.Mesh(new THREE.CylinderGeometry(.18,.32,5.8,8),mat('#a66e45'));
  trunk.position.y=2.9;trunk.castShadow=true;g.add(trunk);
  for(let i=0;i<7;i++){
    const leaf=new THREE.Mesh(new THREE.ConeGeometry(.65,3.8,5),mat('#2fa08c',.7));
    leaf.position.set(Math.sin(i)*2,6,Math.cos(i)*2);leaf.rotation.z=Math.PI/2.8;leaf.rotation.y=i;g.add(leaf);
  }
  g.position.set(x,0,z);scene.add(g);
}
for(const z of [-60,-48,-36,-24,-12,28,40,52,64]){
  palm(-10,z); palm(10,z+2);
}

// Coupe
function vehicleMesh(v, police=false){
  const g=new THREE.Group();
  const body=new THREE.Mesh(new THREE.BoxGeometry(police?2.1:2.35,.55,police?4.7:4.3),mat(police?'#dfe9ee':v.color,.38,.42));
  body.position.y=.65;body.castShadow=true;g.add(body);
  const cabin=new THREE.Mesh(new THREE.BoxGeometry(police?1.75:1.9,.58,2.05),mat(police?'#dfe9ee':'#7fc7ce',.22,.15));
  cabin.position.set(0,1.08,-.15);cabin.castShadow=true;g.add(cabin);
  for(const x of [-1.05,1.05])for(const z of [-1.35,1.35]){
    const wheel=new THREE.Mesh(new THREE.CylinderGeometry(.42,.42,.32,12),mat('#18202a',.9));
    wheel.rotation.z=Math.PI/2;wheel.position.set(x,.43,z);wheel.castShadow=true;g.add(wheel);
  }
  if(police){
    for(const x of [-.55,.55]){
      const light=new THREE.Mesh(new THREE.BoxGeometry(.7,.12,.18),mat(x<0?'#58aaff':'#ff4c73',.2,.3));
      light.position.set(x,1.38,.55);g.add(light);
    }
    for(const x of [-1.19,1.19]){
      const stripe=new THREE.Mesh(new THREE.BoxGeometry(.08,.58,4.5),mat('#edf6ff',.45,.2));
      stripe.position.set(x,.66,-.1);g.add(stripe);
    }
  }
  g.userData.vehicle=v;scene.add(g);return g;
}
const coupeMesh=vehicleMesh(state.vehicles[0]);
const trafficMeshes=state.vehicles.slice(1).map(v=>vehicleMesh(v));

// Pedestrians
const pedestrianMeshes=state.pedestrians.map(p=>{
  const g=new THREE.Group();
  const body=new THREE.Mesh(new THREE.CapsuleGeometry(.28,.75,4,8),mat(['#f2a4a4','#87b7b8','#f3cf86'][p.hue]));
  body.position.y=.75;body.castShadow=true;g.add(body);
  const head=new THREE.Mesh(new THREE.SphereGeometry(.24,10,8),mat('#d79a72'));head.position.y=1.58;g.add(head);
  g.position.set(p.x,0,p.z);scene.add(g);return g;
});

// Visible player avatar
const avatar=new THREE.Group();
const avatarBody=new THREE.Mesh(new THREE.CapsuleGeometry(.34,.82,5,8),mat('#f4ba58'));
avatarBody.position.y=.86;avatarBody.castShadow=true;avatar.add(avatarBody);
const avatarHead=new THREE.Mesh(new THREE.SphereGeometry(.28,12,8),mat('#d79a72'));
avatarHead.position.y=1.72;avatar.add(avatarHead);
const avatarLegA=new THREE.Mesh(new THREE.CapsuleGeometry(.11,.55,4,6),mat('#35556f'));
avatarLegA.position.set(-.16,.28,0);avatar.add(avatarLegA);
const avatarLegB=avatarLegA.clone();avatarLegB.position.x=.16;avatar.add(avatarLegB);
scene.add(avatar);

// World markers
function ring(color){
  const r=new THREE.Mesh(new THREE.RingGeometry(1.7,2.1,32),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.75,side:THREE.DoubleSide}));
  r.rotation.x=-Math.PI/2;r.position.y=.16;scene.add(r);return r;
}
const solRing=ring('#ffd36a'); solRing.position.set(-3,0.16,8);
const harborRing=ring('#62e7ed'); harborRing.position.set(0,.16,-68); harborRing.visible=false;

const policeMeshes=[];
const keys={};
addEventListener('keydown',e=>{
  keys[e.code]=true;
  if(e.code==='KeyE') interact();
  if(e.code==='KeyQ') emp();
  if(e.code==='Escape'&&playing)togglePause();
  if(e.code==='KeyM') muted=!muted;
});
addEventListener('keyup',e=>{keys[e.code]=false});
canvas.addEventListener('click',()=>{if(playing&&!paused)canvas.requestPointerLock?.()});
addEventListener('mousemove',e=>{
  if(document.pointerLockElement===canvas&&playing&&!paused){
    yaw-=e.movementX*.0024; pitch=clamp(pitch-e.movementY*.0018,.12,.65);
  }
});

function interact(){
  if(!playing||paused)return;
  if(state.inVehicle){ state.inVehicle=null; state.player.x+=3; synth('enter'); world.save(); toast('Street mode'); return; }
  for(const v of state.vehicles){
    if(distance(state.player,v)<3.2){ state.inVehicle=v; state.player.x=v.x; state.player.z=v.z; synth('enter'); toast(v===state.vehicles[0]?'Coral coupe ready':'Vehicle ready'); return; }
  }
  // Sol interaction advances the opening / return stages
  if(distance(state.player,{x:-3,z:8})<4){
    if(state.stage===0){state.stage=1;world.updateMission();toast('Sol: “The coupe is by Palm Row.”');world.save();}
    else if(state.stage===5){toast('Mission complete — Palm Row is yours');world.advance();world.save();}
  }
}

function emp(){
  if(!playing||paused||state.emp<100)return;
  state.emp=0;empFlash=.7;synth('emp');
  toast('EMP PULSE');
  for(const p of policeMeshes){p.userData.stun=5;}
  if(state.stage===4){state.stage=5;world.updateMission();world.save();toast('Patrols stunned — return to Palm Row');}
}

function togglePause(){
  paused=!paused;pauseEl.classList.toggle('show',paused);
  if(paused&&document.pointerLockElement)document.exitPointerLock();
}
document.getElementById('resume').onclick=togglePause;
document.getElementById('mute').onclick=()=>{muted=!muted;document.getElementById('mute').textContent=muted?'×':'♪'};

function startGame(continueSave=false){
  if(continueSave&&!world.load()){toast('No saved run');return;}
  else if(!continueSave){world.reset();}
  playing=true;title.classList.add('hidden');pauseEl.classList.remove('show');paused=false;
  document.body.classList.add('playing');
  synth('enter');
  canvas.requestPointerLock?.();
}
document.getElementById('start').onclick=()=>startGame(false);
document.getElementById('continue').onclick=()=>startGame(true);

function spawnPolice(count){
  while(policeMeshes.length<count){
    const v={x:state.player.x+(Math.random()<.5?-18:18),z:state.player.z+(Math.random()<.5?-18:18),heading:0};
    const m=vehicleMesh(v,true);m.userData.stun=0;policeMeshes.push(m);state.police.push(v);
  }
}

function update(dt){
  state.elapsed+=dt;empFlash=Math.max(0,empFlash-dt);state.emp=Math.min(100,state.emp+dt*12);
  const p=state.player;
  const drive=state.inVehicle;
  let moveSpeed=0, fx=0, fz=0;
  currentMoveSpeed=0;
  if(drive){
    const throttle=(keys.KeyW?1:0)-(keys.KeyS?1:0);
    const steer=(keys.KeyD?1:0)-(keys.KeyA?1:0);
    moveSpeed=throttle*(keys.ShiftLeft?31:22);
    currentMoveSpeed=moveSpeed;
    drive.heading+=steer*dt*(throttle?1.55:0.25);
    if(throttle){
      const nx=drive.x+Math.sin(drive.heading)*moveSpeed*dt,nz=drive.z-Math.cos(drive.heading)*moveSpeed*dt;
      if(!world.collision(nx,nz)){drive.x=nx;drive.z=nz}else{moveSpeed=0}}
    p.x=drive.x;p.z=drive.z;p.heading=drive.heading;
  }else{
    if(keys.KeyW){fx-=Math.sin(yaw);fz-=Math.cos(yaw)}
    if(keys.KeyS){fx+=Math.sin(yaw);fz+=Math.cos(yaw)}
    if(keys.KeyA){fx-=Math.cos(yaw);fz+=Math.sin(yaw)}
    if(keys.KeyD){fx+=Math.cos(yaw);fz-=Math.sin(yaw)}
    const len=Math.hypot(fx,fz)||1;const speed=(keys.ShiftLeft?9:5)*dt;
    const nx=p.x+fx/len*speed,nz=p.z+fz/len*speed;
    if(!world.collision(nx,nz)){p.x=nx;p.z=nz}
    if(Math.hypot(fx,fz)>0)p.heading=Math.atan2(fx,fz);
    walkFx=fx;walkFz=fz;
  }
  state.district=p.z<-45?'Harborlight District':p.z>45?'Cobalt Heights':p.x<0?'Solstice Gardens':'Palisade Avenue';
  districtEl.textContent=state.district;

  for(let i=0;i<state.pedestrians.length;i++){
    const ped=state.pedestrians[i];ped.z+=ped.speed*Math.sin(ped.heading)*dt;
    if(ped.z<-82||ped.z>78)ped.heading*=-1;
    pedestrianMeshes[i].position.set(ped.x,0,ped.z);
  }
  for(const v of state.vehicles.slice(1)){
    v.z+=v.speed*dt;if(v.z>82)v.z=-82;
  }
  trafficMeshes.forEach((m,i)=>{
    const v=state.vehicles[i+1];m.position.set(v.x,0,v.z);m.rotation.y=v.heading;
  });
  coupeMesh.position.set(state.vehicles[0].x,0,state.vehicles[0].z);coupeMesh.rotation.y=state.vehicles[0].heading;

  // Mission gates
  if(state.stage===0&&distance(p,{x:-3,z:8})<3.5)promptEl.textContent='E  Talk to Sol';
  else if(state.stage===1&&distance(p,state.vehicles[0])<3.2)promptEl.textContent='E  Enter coral coupe';
  else if(state.stage===2&&distance(p,{x:0,z:-68})<7)promptEl.textContent='Check in at Harborlight';
  else if(drive)promptEl.textContent='E  Exit · Q  EMP';
  else promptEl.textContent='E  Enter nearby vehicle';

  if(state.stage===1&&state.inVehicle===state.vehicles[0]){state.stage=2;world.updateMission();world.save();toast('Route: Harborlight');}
  if(state.stage===2&&distance(p,{x:0,z:-68})<12){state.stage=3;state.wanted=2;chaseElapsed=0;world.updateMission();world.save();toast('Patrol sweep — keep moving');}
  if(state.stage===3&&state.inVehicle){chaseElapsed+=dt;if(chaseElapsed>8){state.stage=4;world.updateMission();world.save();toast('EMP charged — clear the convoy');}}
  solRing.visible=state.stage===0||state.stage===5;
  harborRing.visible=state.stage===2;

  if(state.wanted>0){
    spawnPolice(1+state.wanted);
    for(let i=0;i<policeMeshes.length;i++){
      const m=policeMeshes[i], v=state.police[i];if(!v)continue;
      if(m.userData.stun>0){m.userData.stun-=dt;m.position.y=Math.sin(state.elapsed*20)*.08}
      else{
        const dx=p.x-v.x,dz=p.z-v.z,len=Math.hypot(dx,dz)||1;
        const ang=Math.atan2(dx,dz);v.heading=ang;
        const nx=v.x+(dx/len)*6*dt,nz=v.z+(dz/len)*6*dt;
        v.x=nx;v.z=nz;m.position.set(v.x,.03,v.z);m.rotation.y=ang;
      }
    }
  }

  missionEl.textContent=state.missionText;
  wantedEl.textContent=state.wanted?'★ '.repeat(state.wanted)+'☆ '.repeat(5-state.wanted):'☆ ☆ ☆ ☆ ☆';
  speedEl.textContent=drive?String(Math.round(Math.abs(moveSpeed)*3.2)):Math.round(Math.min(6,(Math.hypot(fx,fz)*9))).toString();
  if(state.stage!==world.lastStage){world.lastStage=state.stage;world.save();}
  pressureEl.textContent=state.wanted>0?'POLICE PRESSURE · STAY MOVING':'';
}

function drawMap(){
  const w=172,h=172;map.clearRect(0,0,w,h);map.fillStyle='#1e3f60';map.fillRect(0,0,w,h);
  map.strokeStyle='rgba(226,223,176,.8)';map.lineWidth=11;map.beginPath();map.moveTo(86,-10);map.lineTo(86,182);map.stroke();
  map.strokeStyle='rgba(96,196,192,.55)';map.lineWidth=3;
  for(let z=-5;z<h;z+=32){map.beginPath();map.moveTo(8,z);map.lineTo(164,z);map.stroke()}
  map.save();map.translate(86,86);
  map.rotate(-yaw);
  const px=clamp(state.player.x,-48,48)/48*58,pz=clamp(state.player.z,-88,88)/88*58;
  map.fillStyle='#ffcf68';map.beginPath();map.moveTo(0,-7);map.lineTo(5,6);map.lineTo(-5,6);map.closePath();map.fill();
  map.restore();
  map.fillStyle='#ff718e';for(const v of state.police){map.beginPath();map.arc(86+(v.x-state.player.x)*.8,86+(v.z-state.player.z)*.8,3,0,7);map.fill()}
  map.strokeStyle='#62e7ed';map.lineWidth=2;map.beginPath();map.arc(86,86,38,0,7);map.stroke();
}

addEventListener('resize',()=>{
  renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();
});

const clock=new THREE.Clock();
function animate(){
  requestAnimationFrame(animate);
  const dt=Math.min(clock.getDelta(),.05);
  if(playing&&!paused)update(dt);
  const target=state.inVehicle||state.player;
  const dist=state.inVehicle?9:6.8;
  const lookYaw=state.inVehicle?target.heading:yaw;
  const desired=new THREE.Vector3(
    target.x-Math.sin(lookYaw)*dist,
    3.2+pitch*3,
    target.z+Math.cos(lookYaw)*dist
  );
  camera.position.lerp(desired,1-Math.pow(.001,dt));
  camera.lookAt(target.x,1.15,target.z);
  avatar.position.set(state.player.x,0,state.player.z);
  avatar.rotation.y=state.player.heading;
  avatar.visible=!state.inVehicle;
  const walk=Math.hypot(walkFx,walkFz)>0||Math.abs(currentMoveSpeed)>0;
  avatarLegA.position.z=Math.sin(state.elapsed*8)*.18*(walk?.7:0);
  avatarLegB.position.z=-avatarLegA.position.z;
  sky.position.copy(camera.position);
  sea.rotation.z+=dt*.01;
  if(empFlash>0){
    renderer.toneMappingExposure=1.05+empFlash*2;
  }else renderer.toneMappingExposure=1.05;
  drawMap();renderer.render(scene,camera);
}
animate();
