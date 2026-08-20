const canvas = document.querySelector("#game");
const gl = canvas.getContext("webgl");
const scoreEl = document.querySelector("#score");
const weaponPromptEl = document.querySelector("#weaponPrompt");
const weaponSlotsEl = document.querySelector("#weaponSlots");
const crosshairEl = document.querySelector("#crosshair");
const scopeOverlayEl = document.querySelector("#scopeOverlay");

if (!gl) {
  document.body.textContent = "WebGL is not supported. Please use a recent Chrome, Edge, Firefox, or Safari.";
  throw new Error("WebGL is not supported.");
}

const vertexShaderSource = `
  attribute vec3 aPosition;
  attribute vec3 aColor;

  uniform mat4 uViewProjection;

  varying vec3 vColor;

  void main() {
    vColor = aColor;
    gl_Position = uViewProjection * vec4(aPosition, 1.0);
  }
`;

const fragmentShaderSource = `
  precision mediump float;

  varying vec3 vColor;

  void main() {
    gl_FragColor = vec4(vColor, 1.0);
  }
`;

const program = createProgram(vertexShaderSource, fragmentShaderSource);
const positionLocation = gl.getAttribLocation(program, "aPosition");
const colorLocation = gl.getAttribLocation(program, "aColor");
const viewProjectionLocation = gl.getUniformLocation(program, "uViewProjection");
const vertexBuffer = gl.createBuffer();
gl.getExtension("OES_element_index_uint");

const pbrVertexSource = `
  attribute vec3 aPosition;
  attribute vec3 aNormal;
  attribute vec2 aUV;
  attribute vec4 aTangent;

  uniform mat4 uMVP;
  uniform mat4 uModel;

  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying vec3 vTangent;
  varying float vBitangentSign;
  varying vec2 vUV;

  void main() {
    vec4 world = uModel * vec4(aPosition, 1.0);
    vWorldPos = world.xyz;
    vNormal = mat3(uModel[0].xyz, uModel[1].xyz, uModel[2].xyz) * aNormal;
    vTangent = mat3(uModel[0].xyz, uModel[1].xyz, uModel[2].xyz) * aTangent.xyz;
    vBitangentSign = aTangent.w;
    vUV = aUV;
    gl_Position = uMVP * vec4(aPosition, 1.0);
  }
`;

const pbrFragmentSource = `
  precision mediump float;

  uniform sampler2D uBaseColor;
  uniform sampler2D uMetallicRoughness;
  uniform sampler2D uNormalMap;
  uniform vec3 uCameraPos;
  uniform vec3 uLightDir;
  uniform vec3 uLightColor;
  uniform float uShadow;
  uniform vec4 uBaseColorFactor;
  uniform float uMetallicFactor;
  uniform float uRoughnessFactor;
  uniform float uExposure;

  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying vec3 vTangent;
  varying float vBitangentSign;
  varying vec2 vUV;

  void main() {
    vec4 albedoSample = texture2D(uBaseColor, vUV) * uBaseColorFactor;
    vec3 albedo = albedoSample.rgb;
    vec3 mr = texture2D(uMetallicRoughness, vUV).rgb;
    float roughness = clamp(mr.g * uRoughnessFactor, 0.08, 1.0);
    float metallic = clamp(mr.b * uMetallicFactor, 0.0, 1.0);

    vec3 N = normalize(vNormal);
    vec3 T = normalize(vTangent - N * dot(N, vTangent));
    vec3 B = cross(N, T) * vBitangentSign;
    vec3 nSample = texture2D(uNormalMap, vUV).xyz * 2.0 - 1.0;
    N = normalize(mat3(T, B, N) * nSample);
    if (!gl_FrontFacing) N = -N;

    vec3 L = normalize(uLightDir);
    vec3 V = normalize(uCameraPos - vWorldPos);
    vec3 H = normalize(L + V);
    float sun = max(dot(N, L), 0.0);
    float NdotL = sun * uShadow;
    float sky = 0.2 + 0.16 * max(N.y, 0.0);
    float spec = pow(max(dot(N, H), 0.0), mix(12.0, 96.0, 1.0 - roughness));
    vec3 f0 = mix(vec3(0.04), albedo, metallic);
    vec3 diffuse = albedo * (1.0 - metallic) * (sky + 0.92 * NdotL);
    vec3 color = (diffuse + f0 * spec * NdotL) * uLightColor * uExposure;
    gl_FragColor = vec4(color, albedoSample.a);
  }
`;

const pbrProgram = createProgram(pbrVertexSource, pbrFragmentSource);
const pbr = {
  position: gl.getAttribLocation(pbrProgram, "aPosition"),
  normal: gl.getAttribLocation(pbrProgram, "aNormal"),
  uv: gl.getAttribLocation(pbrProgram, "aUV"),
  tangent: gl.getAttribLocation(pbrProgram, "aTangent"),
  mvp: gl.getUniformLocation(pbrProgram, "uMVP"),
  model: gl.getUniformLocation(pbrProgram, "uModel"),
  cameraPos: gl.getUniformLocation(pbrProgram, "uCameraPos"),
  lightDir: gl.getUniformLocation(pbrProgram, "uLightDir"),
  lightColor: gl.getUniformLocation(pbrProgram, "uLightColor"),
  shadow: gl.getUniformLocation(pbrProgram, "uShadow"),
  baseColorFactor: gl.getUniformLocation(pbrProgram, "uBaseColorFactor"),
  metallicFactor: gl.getUniformLocation(pbrProgram, "uMetallicFactor"),
  roughnessFactor: gl.getUniformLocation(pbrProgram, "uRoughnessFactor"),
  exposure: gl.getUniformLocation(pbrProgram, "uExposure"),
  baseColor: gl.getUniformLocation(pbrProgram, "uBaseColor"),
  metallicRoughness: gl.getUniformLocation(pbrProgram, "uMetallicRoughness"),
  normalMap: gl.getUniformLocation(pbrProgram, "uNormalMap"),
};

const weaponModels = { aug: null, akm: null, m4: null };
const handModels = { idle: null, grip: null, fist: null, gripLeft: null };
const bodyModels = { torso: null, leg: null, head: null, arm: null, forearm: null };
const sunLightDir = normalize([0.32, 0.88, 0.22]);
const CAMERA_MODES = ["first", "back", "front"];
let cameraModeIndex = 0;
let godView = false;
const godCamera = {
  position: [0, 6, -4],
  yaw: 0,
  pitch: -0.55,
};

const keys = new Set();
const player = {
  position: [0, 1.9, -8],
  yaw: 0,
  pitch: 0,
  speed: 8,
  sprintMultiplier: 1.8,
  verticalVelocity: 0,
  onGround: true,
  isMoving: false,
  isSprinting: false,
  handCycle: 0,
  handSway: 0,
  viewmodelPush: 0,
  viewmodelSidePush: 0,
};
const eyeHeight = 1.9;
const jumpVelocity = 7.5;
const gravity = 22;
const maxWeaponPickups = 8;
const weaponPromptRange = 5;
const maxCarriedWeapons = 2;

const WEAPON_DEFS = {
  aug: {
    kind: "aug",
    name: "AUG A3",
    type: "5.56mm Assault Rifle",
    layout: "Bullpup",
    fireRate: 0.086,
    recoil: 0.0064,
    recoilYaw: 0.0022,
    adsFov: 48,
    barrelZ: 1.05,
    bulletSpeed: 240,
    tracerLength: 2.4,
    tracerColor: [1, 0.84, 0.38],
    model: "models/weapons/aug.glb",
    viewScale: 1.08,
    viewOffset: [0.36, -0.32, 0.68],
    viewEuler: [0.05, 0.14, -0.1],
    viewGrip: [0.0, -0.07, 0.03],
    viewHandguard: [0.0, 0.04, 0.46],
    viewScope: [0.0, 0.16, 0.0],
    groundScale: 1,
  },
  akm: {
    kind: "akm",
    name: "AKM",
    type: "7.62mm Assault Rifle",
    layout: "Conventional layout",
    fireRate: 0.1,
    recoil: 0.011,
    recoilYaw: 0.0064,
    adsFov: 45,
    barrelZ: 0.74,
    bulletSpeed: 210,
    tracerLength: 2.8,
    tracerColor: [1, 0.68, 0.22],
    model: "models/weapons/akm.glb",
    viewScale: 1.1,
    viewOffset: [0.37, -0.33, 0.7],
    viewEuler: [0.045, 0.13, -0.09],
    viewGrip: [0.0, -0.07, 0.03],
    viewHandguard: [0.0, 0.035, 0.36],
    viewScope: [0.0, 0.095, 0.12],
    groundScale: 1,
  },
  m4: {
    kind: "m4",
    name: "M4A1",
    type: "5.56mm Carbine",
    layout: "Short-barrel carbine",
    fireRate: 0.072,
    recoil: 0.0072,
    recoilYaw: 0.0028,
    adsFov: 46,
    barrelZ: 0.58,
    bulletSpeed: 255,
    tracerLength: 2.1,
    tracerColor: [1, 0.9, 0.45],
    model: "models/weapons/m4.glb",
    viewScale: 1.12,
    viewOffset: [0.365, -0.32, 0.66],
    viewEuler: [0.05, 0.135, -0.1],
    viewGrip: [0.0, -0.065, 0.01],
    viewHandguard: [0.0, 0.04, 0.36],
    viewScope: [0.0, 0.085, 0.06],
    groundScale: 1.02,
  },
};

loadWeaponModels();
loadHandModels();
loadBodyModels();

let score = 0;
let target = randomTarget();
let lastTime = performance.now();
let nearbyWeapons = [];
let pickupAnimation = null;
let dropAnimation = null;
let inventory = [null, null];
let activeSlot = 0;
let isAiming = false;
let adsProgress = 0;
let adsZoom = 1;
let mouseButtons = { left: false, right: false };
let fireCooldown = 0;
let muzzleFlash = 0;
let bullets = [];
let impactSparks = [];
let bulletHoles = [];
let punchAnimation = null;
let nextPunchSide = 1;
let weaponSwitch = null;
let punchSounds = { whoosh: [], hit: [] };
let gunshotSounds = { m4: [], akm: [], aug: [] };
let footstepSounds = { walk: [], sprint: [] };
let unlockSound = null;
let audioReady = false;
let lastFootstepCycle = 0;
let wasOnGround = true;

const playerCollisionRadius = 0.4;
const playerCollisionHalfHeight = 1.0;

function createObstacles() {
  const mapHalf = 48;
  const wallHeight = 4.2;
  const wallThickness = 1.4;
  const wallColor = [0.46, 0.43, 0.38];
  const coverColor = [0.5, 0.47, 0.41];
  const span = mapHalf * 2 + wallThickness;

  return [
    { id: "wall-n", position: [0, wallHeight / 2, -mapHalf - wallThickness / 2], size: [span, wallHeight, wallThickness], color: wallColor },
    { id: "wall-s", position: [0, wallHeight / 2, mapHalf + wallThickness / 2], size: [span, wallHeight, wallThickness], color: wallColor },
    { id: "wall-e", position: [mapHalf + wallThickness / 2, wallHeight / 2, 0], size: [wallThickness, wallHeight, span - wallThickness * 2], color: wallColor },
    { id: "wall-w", position: [-mapHalf - wallThickness / 2, wallHeight / 2, 0], size: [wallThickness, wallHeight, span - wallThickness * 2], color: wallColor },
    { id: "cover-1", position: [-4.5, 1.35, 1.2], size: [9.2, 2.7, 0.5], color: coverColor },
    { id: "cover-2", position: [5.2, 1.5, -3.4], size: [0.5, 3, 8.4], color: coverColor },
    { id: "cover-3", position: [11, 1.25, 6.5], size: [7.5, 2.5, 0.5], color: coverColor },
    { id: "obs-1", position: [-6, 1.1, 6.5], size: [2.2, 2.2, 2.2], color: [0.24, 0.48, 0.31] },
    { id: "obs-2", position: [5, 1.4, 12], size: [2.6, 2.8, 2.6], color: [0.25, 0.35, 0.62] },
    { id: "obs-3", position: [10, 0.9, -3], size: [2.4, 1.8, 2], color: [0.52, 0.32, 0.24] },
    { id: "obs-4", position: [-9, 1.2, -6], size: [2, 2.4, 3.2], color: [0.45, 0.34, 0.62] },
  ];
}

const obstacles = createObstacles();
const weaponPickups = createWeaponPickups(maxWeaponPickups);

gl.enable(gl.DEPTH_TEST);
gl.clearColor(0.38, 0.62, 0.92, 1);

window.addEventListener("resize", resize);
window.addEventListener("keydown", (event) => {
  if (event.code === "Space" || event.code === "KeyF" || event.code === "KeyE" || event.code === "KeyC" || event.code === "KeyO" || event.code === "Digit1" || event.code === "Digit2") {
    event.preventDefault();
  }

  if (event.code === "KeyF" && !event.repeat) {
    handleFKey();
  }

  if (event.code === "KeyE" && !event.repeat) {
    handleEKey();
  }

  if (event.code === "KeyC" && !event.repeat) {
    if (godView) {
      godView = false;
      isAiming = false;
      adsProgress = 0;
    } else {
      cycleCameraMode();
    }
  }

  if (event.code === "KeyO" && !event.repeat) {
    if (godView) {
      godView = false;
    } else {
      enterGodView();
    }
    isAiming = false;
    adsProgress = 0;
  }

  if ((event.code === "Digit1" || event.code === "Numpad1") && !event.repeat) {
    switchToSlot(0);
  }

  if ((event.code === "Digit2" || event.code === "Numpad2") && !event.repeat) {
    switchToSlot(1);
  }

  if (event.code === "KeyQ" && !event.repeat) {
    switchToSlot(1 - activeSlot);
  }

  keys.add(event.code);
});
window.addEventListener("keyup", (event) => keys.delete(event.code));

canvas.addEventListener("mousedown", (event) => {
  unlockAudio();
  if (document.pointerLockElement !== canvas) return;

  if (event.button === 0) {
    mouseButtons.left = true;
    if (godView) return;
    if (getEquippedWeapon() && !pickupAnimation && !weaponSwitch && fireCooldown <= 0) {
      fireWeapon();
    } else if (!getEquippedWeapon() && !pickupAnimation && !weaponSwitch) {
      startPunch();
    }
  }

  if (event.button === 2) {
    event.preventDefault();
    mouseButtons.right = true;
    if (getEquippedWeapon() && !isViewmodelBlocked()) {
      isAiming = isFirstPerson();
    }
  }
});

canvas.addEventListener("mouseup", (event) => {
  if (event.button === 0) {
    mouseButtons.left = false;
  }

  if (event.button === 2) {
    mouseButtons.right = false;
    isAiming = false;
  }
});

canvas.addEventListener("contextmenu", (event) => event.preventDefault());

document.addEventListener("mousemove", (event) => {
  if (document.pointerLockElement !== canvas) return;

  const sensitivity = (0.0022 + (0.00115 / adsZoom - 0.0022) * getAdsBlend()) * (player.isSprinting && !isAiming ? 1.05 : 1);
  if (godView) {
    godCamera.yaw -= event.movementX * sensitivity;
    godCamera.pitch -= event.movementY * sensitivity;
    godCamera.pitch = clamp(godCamera.pitch, -1.45, 1.45);
    return;
  }
  player.yaw -= event.movementX * sensitivity;
  player.pitch -= event.movementY * sensitivity;
  player.pitch = clamp(player.pitch, -1.35, 1.35);
});

document.addEventListener("wheel", (event) => {
  if (document.pointerLockElement !== canvas) return;
  if (!isFirstPerson() || !isAiming || !getEquippedWeapon()) return;
  event.preventDefault();
  adsZoom = clamp(adsZoom - Math.sign(event.deltaY) * 0.14, 1, 2.6);
}, { passive: false });

document.addEventListener("pointerlockchange", () => {
  if (document.pointerLockElement === canvas) {
    unlockAudio();
  }
});

canvas.addEventListener("click", () => {
  unlockAudio();
  canvas.requestPointerLock();
});

initGunshotAudio();
resize();
updateWeaponHud();
requestAnimationFrame(loop);

function loop(now) {
  const deltaSeconds = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;

  update(deltaSeconds);
  render();

  requestAnimationFrame(loop);
}

function update(deltaSeconds) {
  if (godView) {
    updateGodCamera(deltaSeconds);
    player.isMoving = false;
    player.isSprinting = false;
  } else {
    const forward = [Math.sin(player.yaw), 0, Math.cos(player.yaw)];
    const right = [Math.cos(player.yaw), 0, -Math.sin(player.yaw)];
    const movement = [0, 0, 0];

    if (keys.has("KeyW")) addTo(movement, forward);
    if (keys.has("KeyS")) subtractFrom(movement, forward);
    if (keys.has("KeyA")) addTo(movement, right);
    if (keys.has("KeyD")) subtractFrom(movement, right);

    player.isMoving = length(movement) > 0;
    player.isSprinting = player.isMoving && (keys.has("ShiftLeft") || keys.has("ShiftRight"));

    if (player.isMoving) {
      const speed = player.isSprinting ? player.speed * player.sprintMultiplier : player.speed;

      normalize(movement);
      const deltaX = movement[0] * speed * deltaSeconds;
      const deltaZ = movement[2] * speed * deltaSeconds;
      const nextX = player.position[0] + deltaX;

      if (!movementBlocked(nextX, player.position[2], player.position[0], player.position[2])) {
        player.position[0] = nextX;
      }

      const nextZ = player.position[2] + deltaZ;
      if (!movementBlocked(player.position[0], nextZ, player.position[0], player.position[2])) {
        player.position[2] = nextZ;
      }
    }
  }

  if (!godView) {
    resolveViewmodelOverlap();
  }

  const targetHandSway = player.isMoving ? 1 : 0;
  player.handSway += (targetHandSway - player.handSway) * Math.min(deltaSeconds * 8, 1);
  player.handCycle += deltaSeconds * (player.isMoving ? (player.isSprinting ? 13 : 9) : 2.2);

  if (!godView && keys.has("Space") && player.onGround) {
    player.verticalVelocity = jumpVelocity;
    player.onGround = false;
  }

  player.verticalVelocity -= gravity * deltaSeconds;
  player.position[1] += player.verticalVelocity * deltaSeconds;

  if (player.position[1] <= eyeHeight) {
    player.position[1] = eyeHeight;
    player.verticalVelocity = 0;
    player.onGround = true;
  }

  const dx = player.position[0] - target[0];
  const dz = player.position[2] - target[2];
  if (Math.hypot(dx, dz) < 1.25) {
    score += 1;
    scoreEl.textContent = String(score);
    target = randomTarget();
  }

  updatePickupAnimation(deltaSeconds);
  updateDropAnimation(deltaSeconds);
  updateWeaponSwitch(deltaSeconds);
  updateCombat(deltaSeconds);
  updatePunch(deltaSeconds);
  updateViewmodelPush(deltaSeconds);
  updateAds(deltaSeconds);
  updateBullets(deltaSeconds);
  updateImpactSparks(deltaSeconds);
  updateBulletHoles(deltaSeconds);
  updateFootsteps(deltaSeconds);
  updateWeaponPrompt();
  updateWeaponHud();
  updateAimUi();
}

function render() {
  const vertices = [];

  addGround(vertices);
  addObstacleShadows(vertices);
  addWeaponShadows(vertices);
  if (!isFirstPerson()) {
    addPlayerShadow(vertices);
  }

  for (const obstacle of obstacles) {
    addBox(vertices, obstacle.position, obstacle.size, obstacle.color);
  }

  for (const hole of bulletHoles) {
    addBulletHoleMesh(vertices, hole);
  }

  for (const weapon of weaponPickups) {
    addGroundWeapon(vertices, weapon);
  }

  addBox(vertices, [target[0], 0.55, target[2]], [1.1, 1.1, 1.1], [1, 0.82, 0.18]);

  for (const bullet of bullets) {
    addBulletTracer(vertices, bullet);
  }

  for (const spark of impactSparks) {
    addImpactSparkMesh(vertices, spark);
  }

  const aspect = canvas.width / canvas.height;
  const equipped = getEquippedWeapon();
  const firstPerson = isFirstPerson();
  const adsT = firstPerson ? getAdsBlend() : 0;
  const hipFov = firstPerson ? 70 : 58;
  const aimedFov = equipped
    ? clamp(WEAPON_DEFS[equipped.kind].adsFov / adsZoom, 18, WEAPON_DEFS[equipped.kind].adsFov)
    : hipFov;
  const fovDegrees = hipFov + (aimedFov - hipFov) * adsT;
  const projection = perspective((fovDegrees * Math.PI) / 180, aspect, firstPerson ? 0.1 : 0.18, 220);
  const lookDirection = getLookDirection();
  const pickupProgress = getPickupProgress();
  const crouchAmount = Math.sin(pickupProgress * Math.PI) * 0.42;
  const eyePosition = [player.position[0], player.position[1] - crouchAmount, player.position[2]];
  const camera = getRenderCamera(eyePosition, lookDirection);
  const cameraPosition = camera.position;
  addSun(vertices, cameraPosition);
  const view = lookAt(cameraPosition, camera.target, [0, 1, 0]);

  if (!bodyModels.torso) {
    addPickupBody(vertices, lookDirection, eyePosition, pickupProgress);
  }

  const hideWeaponView = firstPerson && getScopeOverlayBlend() > 0.92 && equipped && !pickupAnimation && !dropAnimation;
  if (!firstPerson) {
    addThirdPersonPalms(vertices, eyePosition);
  }
  if (!hideWeaponView) {
    if (firstPerson && !handModels.idle) {
      addFirstPersonHands(vertices, lookDirection, eyePosition);
    }
    addHeldWeapon(vertices, lookDirection, eyePosition, getPickupProgress(), getActiveViewWeapon());
  }

  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);

  const stride = 6 * Float32Array.BYTES_PER_ELEMENT;
  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(colorLocation);
  gl.vertexAttribPointer(colorLocation, 3, gl.FLOAT, false, stride, 3 * Float32Array.BYTES_PER_ELEMENT);

  gl.uniformMatrix4fv(viewProjectionLocation, false, multiply(projection, view));
  gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 6);

  const viewProjection = multiply(projection, view);
  drawGltfBody(viewProjection, eyePosition, cameraPosition, lookDirection, !firstPerson);
  drawGltfWeapons(viewProjection, cameraPosition, lookDirection, pickupProgress, equipped, hideWeaponView, eyePosition);
  drawGltfHands(viewProjection, cameraPosition, lookDirection, hideWeaponView, eyePosition);
}

function resize() {
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(window.innerWidth * pixelRatio);
  canvas.height = Math.floor(window.innerHeight * pixelRatio);
  gl.viewport(0, 0, canvas.width, canvas.height);
}

function addGround(vertices) {
  const size = 100;
  const color = sunLitColor([0.55, 0.34, 0.16], [0, 1, 0]);
  pushVertex(vertices, -size, 0, -size, color);
  pushVertex(vertices, size, 0, -size, color);
  pushVertex(vertices, size, 0, size, color);
  pushVertex(vertices, -size, 0, -size, color);
  pushVertex(vertices, size, 0, size, color);
  pushVertex(vertices, -size, 0, size, color);
}

function addSun(vertices, cameraPosition) {
  const dist = 160;
  const center = [
    cameraPosition[0] + sunLightDir[0] * dist,
    cameraPosition[1] + sunLightDir[1] * dist,
    cameraPosition[2] + sunLightDir[2] * dist,
  ];
  const forward = sunLightDir;
  let right = cross([0, 1, 0], forward);
  if (Math.hypot(right[0], right[1], right[2]) < 0.1) {
    right = cross([1, 0, 0], forward);
  }
  right = normalize(right);
  const up = normalize(cross(forward, right));
  const layers = [
    { radius: 10, color: [1.0, 0.55, 0.18] },
    { radius: 6.2, color: [1.0, 0.78, 0.32] },
    { radius: 3.6, color: [1.0, 0.93, 0.55] },
    { radius: 1.8, color: [1.0, 0.99, 0.9] },
  ];
  const segments = 28;
  for (const layer of layers) {
    const ring = [];
    for (let i = 0; i < segments; i += 1) {
      const ang = (i / segments) * Math.PI * 2;
      const ca = Math.cos(ang) * layer.radius;
      const sa = Math.sin(ang) * layer.radius;
      ring.push([
        center[0] + right[0] * ca + up[0] * sa,
        center[1] + right[1] * ca + up[1] * sa,
        center[2] + right[2] * ca + up[2] * sa,
      ]);
    }
    for (let i = 0; i < segments; i += 1) {
      pushVertex(vertices, ...center, layer.color);
      pushVertex(vertices, ...ring[i], layer.color);
      pushVertex(vertices, ...ring[(i + 1) % segments], layer.color);
    }
  }
}

function sunLitColor(color, normal) {
  const ndotl = Math.max(dot(normal, sunLightDir), 0);
  const wrap = 0.2 + 0.8 * ndotl;
  return [
    Math.min(color[0] * wrap * 1.12, 1),
    Math.min(color[1] * wrap * 1.04, 1),
    Math.min(color[2] * wrap * 0.92, 1),
  ];
}

function projectPointToGround(point) {
  const ly = Math.max(sunLightDir[1], 0.08);
  const t = Math.max(point[1], 0.01) / ly;
  return [point[0] - sunLightDir[0] * t, 0.03, point[2] - sunLightDir[2] * t];
}

function convexHullXZ(points) {
  const unique = [];
  for (const point of points) {
    if (!unique.some((other) => Math.hypot(other[0] - point[0], other[2] - point[2]) < 0.002)) {
      unique.push(point);
    }
  }
  unique.sort((a, b) => a[0] - b[0] || a[2] - b[2]);
  if (unique.length <= 2) return unique;

  const cross2 = (origin, a, b) => (a[0] - origin[0]) * (b[2] - origin[2]) - (a[2] - origin[2]) * (b[0] - origin[0]);
  const lower = [];
  for (const point of unique) {
    while (lower.length >= 2 && cross2(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper = [];
  for (let index = unique.length - 1; index >= 0; index -= 1) {
    const point = unique[index];
    while (upper.length >= 2 && cross2(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function addObstacleShadows(vertices) {
  const color = [0.13, 0.07, 0.04];
  for (const obstacle of obstacles) {
    addProjectedBoxShadow(vertices, obstacle.position, obstacle.size, color);
  }
}

function addProjectedBoxShadow(vertices, center, size, color) {
  const [cx, cy, cz] = center;
  const [sx, sy, sz] = size.map((value) => value / 2);
  const corners = [];
  for (const x of [cx - sx, cx + sx]) {
    for (const y of [Math.max(cy - sy, 0.02), Math.max(cy + sy, 0.04)]) {
      for (const z of [cz - sz, cz + sz]) {
        corners.push(projectPointToGround([x, y, z]));
      }
    }
  }
  const hull = convexHullXZ(corners);
  if (hull.length < 3) return;
  addPolygonFace(vertices, hull, color);
}

function addWeaponShadows(vertices) {
  const color = [0.15, 0.08, 0.04];
  for (const weapon of weaponPickups) {
    const def = WEAPON_DEFS[weapon.kind];
    const length = (def.barrelZ + 0.32) * (def.groundScale || 1);
    addProjectedBoxShadow(vertices, [weapon.position[0], 0.12, weapon.position[2]], [length, 0.14, 0.2], color);
  }
  if (isFirstPerson()) return;
  const held = getActiveViewWeapon();
  if (!held) return;
  const origin = getEyePosition();
  const look = getLookDirection();
  const basis = makeViewBasis(look, origin);
  const hold = getViewWeaponHold(held.kind);
  const grip = toWorldPoint(basis, hold.position[0], hold.position[1], hold.position[2]);
  addProjectedBoxShadow(
    vertices,
    [grip[0], Math.max(0.2, grip[1]), grip[2]],
    [WEAPON_DEFS[held.kind].barrelZ * 0.7 + 0.2, 0.16, 0.18],
    color,
  );
}

function addPlayerShadow(vertices) {
  const origin = getEyePosition();
  addProjectedBoxShadow(vertices, [origin[0], 0.95, origin[2]], [0.7, 1.9, 0.55], [0.12, 0.06, 0.03]);
}

function rayHitsAabb(origin, dir, center, half, minT, maxT) {
  return rayAabbT(origin, dir, center, half, minT, maxT) != null;
}

function rayAabbT(origin, dir, center, half, minT, maxT) {
  let tmin = minT;
  let tmax = maxT;
  for (let axis = 0; axis < 3; axis += 1) {
    const delta = dir[axis];
    const inv = Math.abs(delta) < 1e-8 ? 1e8 : 1 / delta;
    const t0 = (center[axis] - half[axis] - origin[axis]) * inv;
    const t1 = (center[axis] + half[axis] - origin[axis]) * inv;
    tmin = Math.max(tmin, Math.min(t0, t1));
    tmax = Math.min(tmax, Math.max(t0, t1));
    if (tmax < tmin) return null;
  }
  return tmax >= tmin ? tmin : null;
}

function sunShadowFactor(origin) {
  const start = [
    origin[0] + sunLightDir[0] * 0.12,
    origin[1] + sunLightDir[1] * 0.12,
    origin[2] + sunLightDir[2] * 0.12,
  ];
  for (const obstacle of obstacles) {
    const half = obstacle.size.map((value) => value / 2);
    if (rayHitsAabb(start, sunLightDir, obstacle.position, half, 0, 80)) {
      return 0.22;
    }
  }
  return 1;
}

function isFirstPerson() {
  return !godView && CAMERA_MODES[cameraModeIndex] === "first";
}

function cycleCameraMode() {
  godView = false;
  cameraModeIndex = (cameraModeIndex + 1) % CAMERA_MODES.length;
  isAiming = false;
  adsProgress = 0;
}

function getGodLook() {
  return [
    Math.sin(godCamera.yaw) * Math.cos(godCamera.pitch),
    Math.sin(godCamera.pitch),
    Math.cos(godCamera.yaw) * Math.cos(godCamera.pitch),
  ];
}

function enterGodView() {
  const eye = getEyePosition();
  const look = getLookDirection();
  const cam = getRenderCamera(eye, look);
  const dx = cam.target[0] - cam.position[0];
  const dy = cam.target[1] - cam.position[1];
  const dz = cam.target[2] - cam.position[2];
  const horiz = Math.hypot(dx, dz) || 1;
  godCamera.position = [
    cam.position[0],
    Math.max(2.4, cam.position[1] + (isFirstPerson() ? 2.8 : 1.1)),
    cam.position[2],
  ];
  godCamera.yaw = Math.atan2(dx, dz);
  godCamera.pitch = clamp(Math.atan2(dy, horiz) - (isFirstPerson() ? 0.42 : 0.12), -1.45, 1.45);
  godView = true;
}

function updateGodCamera(deltaSeconds) {
  const look = getGodLook();
  const right = [Math.cos(godCamera.yaw), 0, -Math.sin(godCamera.yaw)];
  const movement = [0, 0, 0];
  if (keys.has("KeyW")) addTo(movement, look);
  if (keys.has("KeyS")) subtractFrom(movement, look);
  if (keys.has("KeyA")) addTo(movement, right);
  if (keys.has("KeyD")) subtractFrom(movement, right);
  if (keys.has("Space")) movement[1] += 1;
  if (keys.has("ControlLeft") || keys.has("ControlRight")) movement[1] -= 1;
  if (length(movement) <= 0) return;
  normalize(movement);
  const speed = keys.has("ShiftLeft") || keys.has("ShiftRight") ? 32 : 16;
  godCamera.position[0] += movement[0] * speed * deltaSeconds;
  godCamera.position[1] = clamp(godCamera.position[1] + movement[1] * speed * deltaSeconds, 0.45, 80);
  godCamera.position[2] += movement[2] * speed * deltaSeconds;
}

function getEyePosition() {
  const crouchAmount = Math.sin(getPickupProgress() * Math.PI) * 0.42;
  return [player.position[0], player.position[1] - crouchAmount, player.position[2]];
}

function fitCamera(from, desired) {
  const delta = [desired[0] - from[0], desired[1] - from[1], desired[2] - from[2]];
  const dist = Math.hypot(delta[0], delta[1], delta[2]) || 0.001;
  const dir = [delta[0] / dist, delta[1] / dist, delta[2] / dist];
  let hitT = dist;
  for (const obstacle of obstacles) {
    const half = obstacle.size.map((value) => value / 2);
    const t = rayAabbT(from, dir, obstacle.position, half, 0.2, hitT);
    if (t != null) hitT = Math.min(hitT, t);
  }
  const pulled = Math.max(0.55, hitT - 0.22);
  return [from[0] + dir[0] * pulled, from[1] + dir[1] * pulled, from[2] + dir[2] * pulled];
}

function getRenderCamera(eyePosition, lookDirection) {
  if (godView) {
    const look = getGodLook();
    return {
      position: godCamera.position,
      target: [
        godCamera.position[0] + look[0],
        godCamera.position[1] + look[1],
        godCamera.position[2] + look[2],
      ],
    };
  }

  const chest = [eyePosition[0], eyePosition[1] - 0.42, eyePosition[2]];
  const mode = CAMERA_MODES[cameraModeIndex];
  if (mode === "first") {
    return {
      position: eyePosition,
      target: [
        eyePosition[0] + lookDirection[0],
        eyePosition[1] + lookDirection[1],
        eyePosition[2] + lookDirection[2],
      ],
    };
  }

  const forward = [Math.sin(player.yaw), 0, Math.cos(player.yaw)];
  if (mode === "front") {
    const dist = 3.05;
    const desired = [
      chest[0] + forward[0] * dist,
      Math.max(0.6, chest[1] + 0.45 + player.pitch * 0.55),
      chest[2] + forward[2] * dist,
    ];
    return { position: fitCamera(chest, desired), target: chest };
  }

  const dist = 3.35;
  const desired = [
    chest[0] - lookDirection[0] * dist,
    Math.max(0.55, chest[1] - lookDirection[1] * dist + 0.72),
    chest[2] - lookDirection[2] * dist,
  ];
  const target = [
    chest[0] + lookDirection[0] * 1.4,
    chest[1] + lookDirection[1] * 1.4 + 0.08,
    chest[2] + lookDirection[2] * 1.4,
  ];
  return { position: fitCamera(chest, desired), target };
}

const BODY_HIP_Y = -0.96;
const BODY_HIP_X = 0.125;
const BODY_SHOULDER = [0.26, -0.32, 0.1];
const ARM_UPPER_LENGTH = 0.3;
const ARM_FORE_LENGTH = 0.28;
const ARM_UPPER_MESH = 0.28;
const ARM_FORE_MESH = 0.26;

function loadBodyModels() {
  return Promise.all(
    ["torso", "leg", "head", "arm", "forearm"].map(async (part) => {
      try {
        bodyModels[part] = await Gltf.load(`models/player/${part}.glb?v=95`, gl);
      } catch (error) {
        console.warn(`Could not load body ${part}`, error);
      }
    }),
  );
}

function getBodyWalk() {
  const move = player.handSway;
  const sprint = player.isSprinting ? 1 : 0;
  const swing = Math.sin(player.handCycle) * (0.42 + sprint * 0.22) * move;
  const bob = Math.abs(Math.sin(player.handCycle)) * (0.02 + sprint * 0.014) * move;
  const breath = (1 - move) * Math.sin(player.handCycle * 0.8) * 0.008;
  const jump = player.onGround ? 0 : clamp(-player.verticalVelocity * 0.01, -0.05, 0.07);
  const pickup = pickupAnimation ? Math.sin(getPickupProgress() * Math.PI) : 0;
  const lean = (player.isSprinting && player.isMoving ? 0.1 : 0.04) + pickup * 0.28;
  return { swing, bob, breath, jump, pickup, lean };
}

function applyEulerPoint(x, y, z, pitch, yaw, roll) {
  const matrix = eulerMatrix(pitch, yaw, roll);
  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z,
    matrix[1] * x + matrix[5] * y + matrix[9] * z,
    matrix[2] * x + matrix[6] * y + matrix[10] * z,
  ];
}

function bodyWorldMatrix(origin, localX, localY, localZ, pitch, yaw, roll, sx, sy, sz) {
  const offset = applyEulerPoint(localX, localY, localZ, pitch, yaw, roll);
  return multiply(
    translationMatrix(origin[0] + offset[0], origin[1] + offset[1], origin[2] + offset[2]),
    multiply(eulerMatrix(pitch, yaw, roll), scaleMatrix3(sx, sy, sz)),
  );
}

function aimMatrix(from, to, sx, restLength, radius = 1) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const len = Math.hypot(dx, dy, dz) || 0.001;
  const forward = [dx / len, dy / len, dz / len];
  const helper = Math.abs(forward[1]) > 0.94 ? [1, 0, 0] : [0, 1, 0];
  const right = cross(helper, forward);
  const rightLen = Math.hypot(right[0], right[1], right[2]) || 1;
  right[0] /= rightLen;
  right[1] /= rightLen;
  right[2] /= rightLen;
  const up = cross(forward, right);
  const stretch = Math.max(0.4, len / restLength);
  const rx = sx * radius;
  return new Float32Array([
    right[0] * rx,
    right[1] * rx,
    right[2] * rx,
    0,
    up[0] * radius,
    up[1] * radius,
    up[2] * radius,
    0,
    forward[0] * stretch,
    forward[1] * stretch,
    forward[2] * stretch,
    0,
    from[0],
    from[1],
    from[2],
    1,
  ]);
}

function solveTwoBone(shoulder, wrist, pole, upperLen, foreLen) {
  const dx = wrist[0] - shoulder[0];
  const dy = wrist[1] - shoulder[1];
  const dz = wrist[2] - shoulder[2];
  const dist = Math.hypot(dx, dy, dz) || 0.001;
  const dir = [dx / dist, dy / dist, dz / dist];
  const maxReach = upperLen + foreLen;
  const stretch = dist > maxReach - 0.004 ? dist / maxReach : 1;
  const u = upperLen * stretch;
  const f = foreLen * stretch;
  const d = Math.min(dist, u + f - 0.004);
  const minD = Math.abs(u - f) + 0.01;
  const reach = Math.max(minD, d);
  const along = clamp((u * u + reach * reach - f * f) / (2 * u * reach), -1, 1) * u;
  const height = Math.sqrt(Math.max(0, u * u - along * along));
  let poleDir = [pole[0] - shoulder[0], pole[1] - shoulder[1], pole[2] - shoulder[2]];
  const poleAlong = poleDir[0] * dir[0] + poleDir[1] * dir[1] + poleDir[2] * dir[2];
  poleDir = [poleDir[0] - dir[0] * poleAlong, poleDir[1] - dir[1] * poleAlong, poleDir[2] - dir[2] * poleAlong];
  let poleLen = Math.hypot(poleDir[0], poleDir[1], poleDir[2]);
  if (poleLen < 0.001) {
    const helper = Math.abs(dir[1]) > 0.94 ? [1, 0, 0] : [0, 1, 0];
    poleDir = cross(dir, helper);
    poleLen = Math.hypot(poleDir[0], poleDir[1], poleDir[2]) || 1;
  }
  poleDir = [poleDir[0] / poleLen, poleDir[1] / poleLen, poleDir[2] / poleLen];
  return [
    shoulder[0] + dir[0] * along + poleDir[0] * height,
    shoulder[1] + dir[1] * along + poleDir[1] * height,
    shoulder[2] + dir[2] * along + poleDir[2] * height,
  ];
}

function getViewHandScale(kind) {
  if (!isFirstPerson()) return kind === "hold" ? 1.08 : 1.02;
  return kind === "hold" ? 1.85 : 1.9;
}

function getHandWristLocal(pose) {
  if (pose.hand === "fist") return [0, -0.02, -0.05];
  if (pose.hand === "grip") return [0, 0.0, -0.05];
  return [0, -0.02, -0.06];
}

function getArmAimEuler(side, palm) {
  const shoulder = [-side * BODY_SHOULDER[0], BODY_SHOULDER[1], BODY_SHOULDER[2]];
  const euler = viewLookEuler(shoulder, palm);
  euler[2] = side * 0.4;
  return euler;
}

function keepWeaponClearOfBody(hold) {
  if (isFirstPerson()) return hold;
  const probes = [
    [0, 0.02, -0.4],
    [0, -0.1, -0.12],
    [0, 0.06, -0.22],
    [0, 0, 0],
  ];
  let pushZ = Math.max(0, 0.82 - hold.position[2]);
  for (const local of probes) {
    const point = transformViewPoint(hold.position, hold.euler, hold.scale, local);
    if (point[2] < 0.34) pushZ = Math.max(pushZ, 0.34 - point[2]);
    if (point[1] > -0.08 && point[2] < 0.42) pushZ = Math.max(pushZ, 0.42 - point[2]);
  }
  return {
    position: [hold.position[0], hold.position[1], hold.position[2] + pushZ],
    euler: hold.euler,
    scale: hold.scale,
  };
}

function getThirdPersonArmPose(side, eyePosition) {
  const { lean, breath, jump } = getBodyWalk();
  const bodyYaw = player.yaw;
  const origin = [eyePosition[0], eyePosition[1] + breath + jump, eyePosition[2]];
  const viewLook = getViewmodelLook();
  const basis = makeViewBasis(viewLook, eyePosition);
  const viewRight = getViewRight();
  const pose = getHandViewPose(side);
  const palm = toWorldPoint(basis, pose.position[0], pose.position[1], pose.position[2]);
  const shoulderOffset = applyEulerPoint(-side * BODY_SHOULDER[0], BODY_SHOULDER[1], BODY_SHOULDER[2], lean, bodyYaw, 0);
  const shoulder = [origin[0] + shoulderOffset[0], origin[1] + shoulderOffset[1], origin[2] + shoulderOffset[2]];
  const wristView = transformViewPoint(pose.position, pose.euler, pose.scale, getHandWristLocal(pose));
  const wrist = toWorldPoint(basis, wristView[0], wristView[1], wristView[2]);
  const towardShoulder = [
    shoulder[0] - palm[0],
    shoulder[1] - palm[1],
    shoulder[2] - palm[2],
  ];
  const towardLen = Math.hypot(towardShoulder[0], towardShoulder[1], towardShoulder[2]) || 1;
  const stub = 0.05 * pose.scale;
  const join = [
    palm[0] + towardShoulder[0] / towardLen * stub,
    palm[1] + towardShoulder[1] / towardLen * stub,
    palm[2] + towardShoulder[2] / towardLen * stub,
  ];
  const mixedJoin = mix3(wrist, join, 0.7);
  const pole = [
    shoulder[0] + viewRight[0] * side * 0.26 - viewLook[0] * 0.05,
    shoulder[1] - 0.48,
    shoulder[2] + viewRight[2] * side * 0.26 - viewLook[2] * 0.05,
  ];
  const elbow = solveTwoBone(shoulder, mixedJoin, pole, ARM_UPPER_LENGTH, ARM_FORE_LENGTH);
  return { shoulder, elbow, wrist: mixedJoin, palm, side };
}

function addThirdPersonPalms(vertices, eyePosition) {
  const skin = sunLitColor([0.9, 0.64, 0.5], [0, 1, 0]);
  const palmTone = sunLitColor([0.84, 0.56, 0.44], [0, 0, 1]);
  for (const side of [-1, 1]) {
    const arm = getThirdPersonArmPose(side, eyePosition);
    let forward = [
      arm.palm[0] - arm.wrist[0],
      arm.palm[1] - arm.wrist[1],
      arm.palm[2] - arm.wrist[2],
    ];
    if (Math.hypot(forward[0], forward[1], forward[2]) < 0.018) {
      forward = [
        arm.wrist[0] - arm.elbow[0],
        arm.wrist[1] - arm.elbow[1],
        arm.wrist[2] - arm.elbow[2],
      ];
    }
    forward = normalize(forward);
    const helper = Math.abs(forward[1]) > 0.92 ? [1, 0, 0] : [0, 1, 0];
    let right = cross(helper, forward);
    const rightLen = Math.hypot(right[0], right[1], right[2]) || 1;
    right = [right[0] / rightLen, right[1] / rightLen, right[2] / rightLen];
    const up = normalize(cross(forward, right));
    const basis = { origin: arm.wrist, forward, right, up };
    addBeveledViewBox(vertices, basis, [0, 0, 0.012], [0.068, 0.052, 0.036], skin);
    addBeveledViewBox(vertices, basis, [side * 0.006, 0.006, 0.058], [0.09, 0.028, 0.1], palmTone);
  }
}

function drawGltfBody(viewProjection, eyePosition, cameraPosition, lookDirection, thirdPerson) {
  if (!bodyModels.torso || !bodyModels.leg) return;

  const { swing, bob, breath, jump, lean } = getBodyWalk();
  const shadow = sunShadowFactor(eyePosition);
  const bodyYaw = player.yaw;
  const origin = [eyePosition[0], eyePosition[1] + breath + jump, eyePosition[2]];

  gl.disable(gl.CULL_FACE);
  drawGltfModel(
    bodyModels.torso,
    viewProjection,
    bodyWorldMatrix(origin, 0, 0, 0.05, lean, bodyYaw, 0, 1, 1, 1),
    cameraPosition,
    sunLightDir,
    1.45,
    shadow,
  );

  if (thirdPerson && bodyModels.head) {
    drawGltfModel(
      bodyModels.head,
      viewProjection,
      bodyWorldMatrix(origin, 0, -0.02, 0.02, lean * 0.2 + clamp(player.pitch, -0.95, 0.75), bodyYaw, 0, 1, 1, 1),
      cameraPosition,
      sunLightDir,
      1.45,
      shadow,
    );
  }

  if (thirdPerson && bodyModels.arm) {
    for (const side of [-1, 1]) {
      const arm = getThirdPersonArmPose(side, eyePosition);
      const mirror = side < 0 ? -1 : 1;
      if (side < 0) gl.frontFace(gl.CW);
      drawGltfModel(
        bodyModels.arm,
        viewProjection,
        aimMatrix(arm.shoulder, arm.elbow, mirror, ARM_UPPER_MESH, 0.94),
        cameraPosition,
        sunLightDir,
        1.45,
        shadow,
      );
      if (bodyModels.forearm) {
        drawGltfModel(
          bodyModels.forearm,
          viewProjection,
          aimMatrix(arm.elbow, arm.wrist, mirror, ARM_FORE_MESH, 0.88),
          cameraPosition,
          sunLightDir,
          1.45,
          shadow,
        );
      }
      gl.frontFace(gl.CCW);
    }
  }

  for (const side of [-1, 1]) {
    const planted = Math.sin(player.handCycle + (side > 0 ? 0 : Math.PI)) > 0 ? 1 : 0.2;
    const lift = bob * planted;
    const hip = applyEulerPoint(side * BODY_HIP_X, BODY_HIP_Y + lift * 0.05, 0.08, lean, bodyYaw, 0);
    if (side < 0) gl.frontFace(gl.CW);
    drawGltfModel(
      bodyModels.leg,
      viewProjection,
      multiply(
        translationMatrix(origin[0] + hip[0], origin[1] + hip[1], origin[2] + hip[2]),
        multiply(eulerMatrix(lean + side * swing, bodyYaw, side * 0.03), scaleMatrix3(side, 1, 1)),
      ),
      cameraPosition,
    sunLightDir,
    1.45,
    shadow,
    );
    gl.frontFace(gl.CCW);
  }
}

function loadHandModels() {
  return Promise.all(
    ["idle", "grip", "fist"].map(async (pose) => {
      try {
        handModels[pose] = await Gltf.load(`models/hands/hand_${pose}.glb?v=107`, gl);
      } catch (error) {
        console.warn(`Could not load hand ${pose}`, error);
      }
    }).concat([
      (async () => {
        try {
          handModels.gripLeft = await Gltf.load("models/hands/hand_grip_left.glb?v=107", gl);
        } catch (error) {
          console.warn("Could not load hand grip_left", error);
        }
      })(),
    ]),
  );
}

function loadWeaponModels() {
  return Promise.all(
    Object.keys(WEAPON_DEFS).map(async (kind) => {
      try {
        weaponModels[kind] = await Gltf.load(WEAPON_DEFS[kind].model, gl);
      } catch (error) {
        console.warn(`Could not load ${WEAPON_DEFS[kind].model}`, error);
      }
    }),
  );
}

function getActiveViewWeapon() {
  return dropAnimation?.weapon || pickupAnimation?.weapon || getEquippedWeapon();
}

function getHoldBlend() {
  if (pickupAnimation) {
    return easeInOut(clamp((pickupAnimation.elapsed / pickupAnimation.duration - 0.08) / 0.82, 0, 1));
  }
  if (dropAnimation) {
    return 1 - easeInOut(clamp(dropAnimation.elapsed / dropAnimation.duration, 0, 1));
  }
  return getEquippedWeapon() ? 1 : 0;
}

function getHeldWeaponTransform(kind, holdProgress, bob, sway, ads) {
  const hip = getHipHeldTransform(kind, holdProgress, bob, sway);
  const shift = getAdsShift(kind, holdProgress, bob, sway);
  const position = [hip.position[0] + shift[0], hip.position[1] + shift[1], hip.position[2] + shift[2]];
  const hold = { position, euler: hip.euler, scale: hip.scale };
  if (isFirstPerson()) return hold;
  const t = holdProgress;
  return keepWeaponClearOfBody({
    position: mix3(position, [0.04, -0.26, 0.58], t),
    euler: mix3(hip.euler, [0, 0, 0], t),
    scale: hip.scale,
  });
}

function getWeaponContact(kind, holdProgress, bob, sway, ads, side) {
  const def = WEAPON_DEFS[kind];
  const hold = getHeldWeaponTransform(kind, holdProgress, bob, sway, ads);
  const local = side > 0
    ? isFirstPerson()
      ? [
          (def.viewGrip?.[0] || 0) + 0.07,
          (def.viewGrip?.[1] || -0.07) - 0.08,
          def.viewGrip?.[2] || 0.02,
        ]
      : [
          (def.viewGrip?.[0] || 0) + 0.012,
          (def.viewGrip?.[1] || -0.07) - 0.002,
          (def.viewGrip?.[2] || 0.02) + 0.004,
        ]
    : [
        (def.viewHandguard?.[0] || 0) - 0.02,
        (def.viewHandguard?.[1] || 0.04) - 0.05,
        def.viewHandguard?.[2] || 0.38,
      ];
  const grip = transformViewPoint(hold.position, hold.euler, hold.scale, local);
  if (!isFirstPerson()) {
    const handEuler = getArmAimEuler(side, grip);
    const wrap = transformViewPoint([0, 0, 0], handEuler, getViewHandScale("hold"), [0, 0.002, 0.012]);
    return [grip[0] - wrap[0], grip[1] - wrap[1], grip[2] - wrap[2]];
  }
  return grip;
}

function getHipHeldTransform(kind, holdProgress, bob, sway) {
  const def = WEAPON_DEFS[kind];
  const rest = def.viewOffset || [0.28, -0.27, 0.55];
  const restEuler = def.viewEuler || [0.05, 0.14, -0.1];
  const grab = [rest[0] * 0.35, rest[1] - 0.62, rest[2] + 0.32];
  const grabEuler = [0.62, -0.16, -0.28];
  const t = holdProgress;
  const position = offsetForAds(
    grab[0] + (rest[0] - grab[0]) * t + sway,
    grab[1] + (rest[1] - grab[1]) * t + bob,
    grab[2] + (rest[2] - grab[2]) * t,
    0,
  );
  return {
    position,
    euler: [
      grabEuler[0] + (restEuler[0] - grabEuler[0]) * t,
      grabEuler[1] + (restEuler[1] - grabEuler[1]) * t,
      grabEuler[2] + (restEuler[2] - grabEuler[2]) * t,
    ],
    scale: def.viewScale || 0.72,
  };
}

function getAdsShift(kind, holdProgress, bob, sway) {
  const adsT = getAdsBlend() * holdProgress;
  if (adsT <= 0.001) return [0, 0, 0];
  const hip = getHipHeldTransform(kind, holdProgress, bob, sway);
  const scopeLocal = WEAPON_DEFS[kind].viewScope || [0, 0.1, 0.06];
  const scope = transformViewPoint(hip.position, hip.euler, hip.scale, scopeLocal);
  const target = [0, 0, 0.5];
  return [
    (target[0] - scope[0]) * adsT,
    (target[1] - scope[1]) * adsT,
    (target[2] - scope[2]) * adsT,
  ];
}

function basisToWorldMatrix(basis) {
  return new Float32Array([
    basis.right[0],
    basis.right[1],
    basis.right[2],
    0,
    basis.up[0],
    basis.up[1],
    basis.up[2],
    0,
    basis.forward[0],
    basis.forward[1],
    basis.forward[2],
    0,
    basis.origin[0],
    basis.origin[1],
    basis.origin[2],
    1,
  ]);
}

function translationMatrix(x, y, z) {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
}

function scaleMatrix(scale) {
  return scaleMatrix3(scale, scale, scale);
}

function scaleMatrix3(sx, sy, sz) {
  return new Float32Array([sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, 0, 0, 0, 1]);
}

function eulerMatrix(pitch, yaw, roll) {
  const cx = Math.cos(pitch);
  const sx = Math.sin(pitch);
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cz = Math.cos(roll);
  const sz = Math.sin(roll);
  const rx = new Float32Array([1, 0, 0, 0, 0, cx, sx, 0, 0, -sx, cx, 0, 0, 0, 0, 1]);
  const ry = new Float32Array([cy, 0, -sy, 0, 0, 1, 0, 0, sy, 0, cy, 0, 0, 0, 0, 1]);
  const rz = new Float32Array([cz, sz, 0, 0, -sz, cz, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  return multiply(ry, multiply(rx, rz));
}

function makeViewModelMatrix(basis, position, euler, scale) {
  return makeViewModelMatrix3(basis, position, euler, scale, scale, scale);
}

function makeViewModelMatrix3(basis, position, euler, sx, sy, sz) {
  const local = multiply(
    translationMatrix(position[0], position[1], position[2]),
    multiply(eulerMatrix(euler[0], euler[1], euler[2]), scaleMatrix3(sx, sy, sz)),
  );
  return multiply(basisToWorldMatrix(basis), local);
}

function transformViewPoint(position, euler, scale, local) {
  const matrix = multiply(
    translationMatrix(position[0], position[1], position[2]),
    multiply(eulerMatrix(euler[0], euler[1], euler[2]), scaleMatrix(scale)),
  );
  return [
    matrix[0] * local[0] + matrix[4] * local[1] + matrix[8] * local[2] + matrix[12],
    matrix[1] * local[0] + matrix[5] * local[1] + matrix[9] * local[2] + matrix[13],
    matrix[2] * local[0] + matrix[6] * local[1] + matrix[10] * local[2] + matrix[14],
  ];
}

function groundWeaponMatrix(weapon) {
  const yaw = weapon.heading >= 0 ? Math.PI / 2 : -Math.PI / 2;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const scale = WEAPON_DEFS[weapon.kind].groundScale || 1;
  return new Float32Array([
    cy * scale,
    0,
    -sy * scale,
    0,
    0,
    scale,
    0,
    0,
    sy * scale,
    0,
    cy * scale,
    0,
    weapon.position[0],
    0.14,
    weapon.position[2],
    1,
  ]);
}

function drawGltfModel(model, viewProjection, world, cameraPosition, lightDir, exposure, shadow = 1) {
  gl.useProgram(pbrProgram);
  gl.uniform3fv(pbr.cameraPos, cameraPosition);
  gl.uniform3fv(pbr.lightDir, lightDir);
  gl.uniform3fv(pbr.lightColor, [1.38, 1.24, 0.98]);
  gl.uniform1f(pbr.shadow, shadow);
  gl.uniform1f(pbr.exposure, exposure);
  gl.uniform1i(pbr.baseColor, 0);
  gl.uniform1i(pbr.metallicRoughness, 1);
  gl.uniform1i(pbr.normalMap, 2);

  gl.enableVertexAttribArray(pbr.position);
  gl.enableVertexAttribArray(pbr.normal);
  gl.enableVertexAttribArray(pbr.uv);
  gl.enableVertexAttribArray(pbr.tangent);

  for (const primitive of model.primitives) {
    const combined = Gltf.multiply4(world, primitive.world);
    gl.uniformMatrix4fv(pbr.mvp, false, multiply(viewProjection, combined));
    gl.uniformMatrix4fv(pbr.model, false, combined);
    gl.uniform4fv(pbr.baseColorFactor, primitive.baseColorFactor);
    gl.uniform1f(pbr.metallicFactor, primitive.metallicFactor);
    gl.uniform1f(pbr.roughnessFactor, primitive.roughnessFactor);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, primitive.baseMap);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, primitive.mrMap);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, primitive.normalMap);

    gl.bindBuffer(gl.ARRAY_BUFFER, primitive.vbo);
    const stride = primitive.stride;
    gl.vertexAttribPointer(pbr.position, 3, gl.FLOAT, false, stride, 0);
    gl.vertexAttribPointer(pbr.normal, 3, gl.FLOAT, false, stride, 12);
    gl.vertexAttribPointer(pbr.uv, 2, gl.FLOAT, false, stride, 24);
    gl.vertexAttribPointer(pbr.tangent, 4, gl.FLOAT, false, stride, 32);

    if (primitive.ibo) {
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, primitive.ibo);
      gl.drawElements(gl.TRIANGLES, primitive.count, primitive.indexType, 0);
    } else {
      gl.drawArrays(gl.TRIANGLES, 0, primitive.count);
    }
  }
}

function drawGltfWeapons(viewProjection, cameraPosition, lookDirection, pickupProgress, equipped, hideWeaponView, eyePosition) {
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);

  for (const weapon of weaponPickups) {
    const model = weaponModels[weapon.kind];
    if (!model) continue;
    drawGltfModel(
      model,
      viewProjection,
      groundWeaponMatrix(weapon),
      cameraPosition,
      sunLightDir,
      1.05,
      sunShadowFactor([weapon.position[0], 0.4, weapon.position[2]]),
    );
  }

  const activeWeapon = getActiveViewWeapon();
  if (!hideWeaponView && activeWeapon && weaponModels[activeWeapon.kind]) {
    const basis = makeViewBasis(getViewmodelLook(), eyePosition);
    const hold = getViewWeaponHold(activeWeapon.kind);
    drawGltfModel(
      weaponModels[activeWeapon.kind],
      viewProjection,
      makeViewModelMatrix(basis, hold.position, hold.euler, hold.scale),
      cameraPosition,
      sunLightDir,
      1.22,
      sunShadowFactor(eyePosition),
    );
  }

  gl.disable(gl.CULL_FACE);
}

function keepViewOutsideBody(point) {
  if (isFirstPerson()) return point;
  let x = point[0];
  let y = point[1];
  let z = point[2];
  const holding = getHoldBlend() > 0.35 && getActiveViewWeapon() && !punchAnimation;
  const inChest = y < -0.08 && y > -0.9 && Math.abs(x) < 0.28 && z < 0.3;
  if (inChest) {
    z = holding ? 0.72 : 0.32;
    if (!holding && Math.abs(x) < 0.24) x = Math.sign(x || 1) * 0.24;
  }
  return [x, y, Math.max(z, holding ? 0.7 : 0.22)];
}

function getViewWeaponHold(kind) {
  if (isViewmodelBlocked() && !punchAnimation) {
    return getBlockedWeaponHold(kind);
  }
  const holdProgress = getHoldBlend();
  const { bob, sway, ads } = getHeldSway(holdProgress);
  const hold = getHeldWeaponTransform(kind, holdProgress, bob, sway, ads);
  const position = keepViewOutsideBody(hold.position);
  return { position, euler: hold.euler, scale: hold.scale };
}

function getBlockedWeaponHold(kind) {
  const def = WEAPON_DEFS[kind];
  const pose = getHangPose(1);
  return {
    position: keepViewOutsideBody([pose.position[0] - 0.04, pose.position[1] + 0.02, pose.position[2] + 0.04]),
    euler: [1.12, 0.08, 0.42],
    scale: def.viewScale || 1,
  };
}

function getHangPose(side) {
  return {
    position: [side * 0.22, -0.78, 0.15],
    euler: [1.22, side * 0.05, side * 0.16],
    scale: 1.9,
    hand: "idle",
  };
}

function isViewmodelBlocked() {
  return player.viewmodelPush > 0.34 || Math.abs(player.viewmodelSidePush) > 0.48;
}

function viewLookEuler(from, to) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const horiz = Math.hypot(dx, dz) || 0.0001;
  return [Math.atan2(dy, horiz), Math.atan2(dx, dz), 0];
}

function getHandViewPose(side) {
  const phase = player.handCycle + (side > 0 ? Math.PI : 0);
  const moveAmount = player.handSway;
  const sprintAmount = player.isSprinting ? 1 : 0;
  const idleBreath = (1 - moveAmount) * Math.sin(player.handCycle * 0.8) * 0.008;
  const walkBob = Math.abs(Math.sin(phase)) * (0.014 + sprintAmount * 0.01) * moveAmount;
  const lateralSway = Math.cos(phase) * (0.01 + sprintAmount * 0.008) * moveAmount;
  const forwardSway = Math.sin(phase) * (0.012 + sprintAmount * 0.01) * moveAmount;
  const jumpLag = player.onGround ? 0 : clamp(-player.verticalVelocity * 0.008, -0.04, 0.04);
  const pickupReach = pickupAnimation
    ? Math.sin(getPickupProgress() * Math.PI)
    : dropAnimation
      ? Math.sin(getHoldBlend() * Math.PI) * 0.35
      : 0;
  const holdBlend = getHoldBlend();
  const { bob, sway: gunSway, ads } = getHeldSway(holdBlend);
  const viewWeapon = getActiveViewWeapon();
  const dip = getSwitchDip();
  const push = player.viewmodelPush;
  const sidePush = player.viewmodelSidePush;

  const idlePos = [
    side * 0.3 + side * lateralSway + dip * side * 0.04 - sidePush * 0.35,
    -0.26 + idleBreath - walkBob + jumpLag - pickupReach * 0.1 - dip * 0.35 - push * 0.06,
    0.58 + forwardSway + pickupReach * 0.12 - dip * 0.14 - push * 0.24 - Math.abs(sidePush) * 0.24,
  ];
  const idleEuler = [0.05, side * 0.03, 0];

  if (punchAnimation) {
    const joints = getPunchJoints(side, side === punchAnimation.side);
    const euler = viewLookEuler(joints.wrist, joints.hand);
    euler[2] = side * 0.18;
    return {
      position: keepViewOutsideBody(mix3(joints.wrist, joints.hand, isFirstPerson() ? 0.55 : 0.35)),
      euler,
      scale: getViewHandScale("idle"),
      hand: "fist",
    };
  }

  if (isViewmodelBlocked()) {
    const hang = getHangPose(side);
    return {
      position: keepViewOutsideBody(hang.position),
      euler: hang.euler,
      scale: getViewHandScale("idle"),
      hand: "idle",
    };
  }

  if (viewWeapon && holdBlend > 0.02) {
    const target = getWeaponContact(viewWeapon.kind, holdBlend, bob, gunSway, ads, side);
    const holdEuler = isFirstPerson()
      ? (side < 0 ? [0.18, 0.14, -0.55] : [0.18, -0.08, 0.55])
      : getArmAimEuler(side, target);
    const gripping = holdBlend > 0.35;
    return {
      position: keepViewOutsideBody(mix3(idlePos, target, holdBlend)),
      euler: mix3(idleEuler, holdEuler, holdBlend),
      scale: getViewHandScale("hold"),
      hand: gripping ? "grip" : "idle",
    };
  }

  return {
    position: keepViewOutsideBody(idlePos),
    euler: idleEuler,
    scale: getViewHandScale("idle"),
    hand: "idle",
  };
}

function drawGltfHands(viewProjection, cameraPosition, lookDirection, hideWeaponView, eyePosition) {
  if (!isFirstPerson() || hideWeaponView || !handModels.idle) return;

  const basis = makeViewBasis(getViewmodelLook(), eyePosition);
  const holdBlend = getHoldBlend();
  const sides = punchAnimation || holdBlend < 0.4 || isViewmodelBlocked() ? [-1, 1] : [-1];

  gl.disable(gl.CULL_FACE);

  for (const side of sides) {
    const pose = getHandViewPose(side);
    const model = pose.hand === "grip" && side < 0
      ? (handModels.gripLeft || handModels.grip)
      : (handModels[pose.hand] || handModels.idle);
    const sx = (side < 0 ? -1 : 1) * pose.scale;
    if (side < 0) gl.frontFace(gl.CW);
    drawGltfModel(
      model,
      viewProjection,
      makeViewModelMatrix3(basis, pose.position, pose.euler, sx, pose.scale, pose.scale),
      cameraPosition,
      sunLightDir,
      1.42,
      sunShadowFactor(eyePosition),
    );
    gl.frontFace(gl.CCW);
  }
}

function createWeaponPickups(limit) {
  const spawnPoints = [
    { position: [-12, 0, 10], kind: "aug" },
    { position: [12, 0, 12], kind: "akm" },
    { position: [-18, 0, -8], kind: "m4" },
    { position: [18, 0, -12], kind: "akm" },
    { position: [0, 0, 18], kind: "aug" },
    { position: [9, 0, -22], kind: "m4" },
    { position: [-24, 0, 18], kind: "akm" },
    { position: [24, 0, 2], kind: "aug" },
  ];

  return spawnPoints.slice(0, limit).map((spawn, index) => {
    const def = WEAPON_DEFS[spawn.kind];
    return {
      id: `${spawn.kind}-${index + 1}`,
      kind: spawn.kind,
      name: def.name,
      type: def.type,
      layout: def.layout,
      position: spawn.position,
      heading: index % 2 === 0 ? 1 : -1,
    };
  });
}

function getEquippedWeapon() {
  return inventory[activeSlot];
}

function getInventoryCount() {
  return inventory.filter(Boolean).length;
}

function dropActiveWeapon(options = {}) {
  const weapon = getEquippedWeapon();
  if (!weapon || pickupAnimation || dropAnimation) return false;

  isAiming = false;
  adsZoom = 1;
  const forward = [Math.sin(player.yaw), 0, Math.cos(player.yaw)];
  dropAnimation = {
    weapon,
    elapsed: 0,
    duration: 0.46,
    keepSlot: Boolean(options.keepSlot),
    thenPickup: options.thenPickup || null,
    landPosition: [
      player.position[0] + forward[0] * 1.4,
      0,
      player.position[2] + forward[2] * 1.4,
    ],
    heading: forward[0] >= 0 ? 1 : -1,
  };
  return true;
}

function finishDropAnimation() {
  const drop = dropAnimation;
  if (!drop) return;

  weaponPickups.push({
    ...drop.weapon,
    id: `${drop.weapon.kind}-${Date.now()}`,
    position: drop.landPosition,
    heading: drop.heading,
  });

  inventory[activeSlot] = null;
  dropAnimation = null;

  if (drop.thenPickup) {
    pickupAnimation = {
      weapon: drop.thenPickup,
      elapsed: 0,
      duration: 1.05,
      replaceOnly: true,
    };
  }
}

function updateDropAnimation(deltaSeconds) {
  if (!dropAnimation) return;

  dropAnimation.elapsed += deltaSeconds;
  if (dropAnimation.elapsed >= dropAnimation.duration) {
    finishDropAnimation();
  }
}

function handleFKey() {
  if (pickupAnimation || dropAnimation) return;

  if (nearbyWeapons.length > 0) {
    tryStartWeaponPickup();
  }
}

function handleEKey() {
  if (pickupAnimation || dropAnimation || weaponSwitch) return;
  dropActiveWeapon();
}

function getLookDirection() {
  return [
    Math.sin(player.yaw) * Math.cos(player.pitch),
    Math.sin(player.pitch),
    Math.cos(player.yaw) * Math.cos(player.pitch),
  ];
}

function getViewmodelLook() {
  return getLookDirection();
}

function updateCombat(deltaSeconds) {
  if (isAiming && !getEquippedWeapon()) {
    isAiming = false;
  }

  fireCooldown = Math.max(0, fireCooldown - deltaSeconds);
  muzzleFlash = Math.max(0, muzzleFlash - deltaSeconds);

  if (pickupAnimation || dropAnimation || punchAnimation || weaponSwitch || godView || !getEquippedWeapon()) return;

  if (mouseButtons.left && fireCooldown <= 0) {
    fireWeapon();
  }
}

function initGunshotAudio() {
  const sampleRate = 22050;
  gunshotSounds = {
    m4: createSoundPlayers(createGunshotWav(sampleRate, {
      duration: 0.13,
      decay: 24,
      snapDecay: 72,
      freq: 250,
      freqDrop: 14,
      noise: 1.08,
      body: 0.38,
      bassFreq: 150,
      bassDecay: 30,
      bass: 0.18,
      ringFreq: 1900,
      ring: 0.16,
      click: 0.32,
      clickTime: 0.007,
    }), 8, 1),
    akm: createSoundPlayers(createGunshotWav(sampleRate, {
      duration: 0.34,
      decay: 8.5,
      snapDecay: 28,
      freq: 78,
      freqDrop: 5.5,
      noise: 0.62,
      body: 0.92,
      bassFreq: 48,
      bassDecay: 10,
      bass: 0.78,
      ringFreq: 380,
      ring: 0.06,
      click: 0.12,
      clickTime: 0.014,
    }), 6, 1),
    aug: createSoundPlayers(createGunshotWav(sampleRate, {
      duration: 0.17,
      decay: 17,
      snapDecay: 48,
      freq: 155,
      freqDrop: 9,
      noise: 0.7,
      body: 0.48,
      bassFreq: 105,
      bassDecay: 20,
      bass: 0.26,
      ringFreq: 860,
      ring: 0.22,
      click: 0.48,
      clickTime: 0.006,
    }), 8, 1),
  };
  footstepSounds = {
    walk: [
      ...createSoundPlayers(createGrassStepWav(sampleRate, { duration: 0.38, rustle: 0.52, ticks: 0.1, gain: 0.7, lp: 0.2, hp: 0.08 }), 1, 0.3),
      ...createSoundPlayers(createGrassStepWav(sampleRate, { duration: 0.42, rustle: 0.44, ticks: 0.18, gain: 0.64, lp: 0.16, hp: 0.1 }), 1, 0.28),
      ...createSoundPlayers(createGrassStepWav(sampleRate, { duration: 0.33, rustle: 0.6, ticks: 0.08, gain: 0.68, lp: 0.24, hp: 0.06 }), 1, 0.32),
      ...createSoundPlayers(createGrassStepWav(sampleRate, { duration: 0.36, rustle: 0.5, ticks: 0.22, gain: 0.66, lp: 0.19, hp: 0.09 }), 1, 0.29),
      ...createSoundPlayers(createGrassStepWav(sampleRate, { duration: 0.4, rustle: 0.38, ticks: 0.14, gain: 0.62, lp: 0.14, hp: 0.11 }), 1, 0.27),
    ],
    sprint: [
      ...createSoundPlayers(createGrassStepWav(sampleRate, { duration: 0.28, rustle: 0.7, ticks: 0.18, gain: 0.84, lp: 0.26, hp: 0.05 }), 1, 0.44),
      ...createSoundPlayers(createGrassStepWav(sampleRate, { duration: 0.24, rustle: 0.58, ticks: 0.28, gain: 0.8, lp: 0.22, hp: 0.08 }), 1, 0.42),
      ...createSoundPlayers(createGrassStepWav(sampleRate, { duration: 0.3, rustle: 0.64, ticks: 0.12, gain: 0.78, lp: 0.3, hp: 0.04 }), 1, 0.4),
    ],
  };
  punchSounds = {
    whoosh: createSoundPlayers(createPunchWav(sampleRate, { duration: 0.18, whoosh: 0.7, thud: 0.08, freq: 220 }), 4, 0.45),
    hit: createSoundPlayers(createPunchWav(sampleRate, { duration: 0.16, whoosh: 0.25, thud: 0.85, freq: 90 }), 4, 0.7),
  };
  audioReady = true;
  unlockSound = new Audio(gunshotSounds.m4[0].src);
  unlockSound.volume = 0.001;
  unlockSound.preload = "auto";
}

function createSoundPlayers(url, count, volume) {
  return Array.from({ length: count }, () => {
    const audio = new Audio(url);
    audio.preload = "auto";
    audio.volume = volume;
    return audio;
  });
}

function createGrassStepWav(sampleRate, options) {
  const count = Math.floor(sampleRate * options.duration);
  const samples = new Float32Array(count);
  let low = 0;
  let band = 0;

  for (let index = 0; index < count; index += 1) {
    const time = index / sampleRate;
    const attack = Math.min(1, time / 0.02);
    const body = Math.exp(-time * 6.2);
    const tail = Math.exp(-time * 2.4);
    const env = attack * (body * 0.62 + tail * 0.38);
    const white = Math.random() * 2 - 1;
    low += options.lp * (white - low);
    band += options.hp * (low - band);
    const rustle = (low - band) * options.rustle;
    const tick = Math.random() > 0.975 ? (Math.random() * 2 - 1) * options.ticks * env : 0;
    samples[index] = clamp((rustle + tick) * env * options.gain, -1, 1);
  }

  return encodeWavDataUri(samples, sampleRate);
}

function createPunchWav(sampleRate, options) {
  const count = Math.floor(sampleRate * options.duration);
  const samples = new Float32Array(count);
  let phase = 0;

  for (let index = 0; index < count; index += 1) {
    const time = index / sampleRate;
    const whooshEnv = Math.exp(-time * 16) * (1 - Math.exp(-time * 70));
    const thudEnv = Math.exp(-time * 22);
    phase += (Math.PI * 2 * options.freq * Math.exp(-time * 8)) / sampleRate;
    const air = (Math.random() * 2 - 1) * options.whoosh * whooshEnv;
    const thud = Math.sin(phase) * options.thud * thudEnv;
    samples[index] = clamp(air + thud, -1, 1);
  }

  return encodeWavDataUri(samples, sampleRate);
}

function createGunshotWav(sampleRate, options) {
  const count = Math.floor(sampleRate * options.duration);
  const samples = new Float32Array(count);
  let bodyPhase = 0;
  let bassPhase = 0;
  let ringPhase = 0;

  for (let index = 0; index < count; index += 1) {
    const time = index / sampleRate;
    const snap = Math.exp(-time * options.snapDecay);
    const bodyEnv = Math.exp(-time * options.decay);
    const bassEnv = Math.exp(-time * options.bassDecay);
    const noise = Math.random() * 2 - 1;

    bodyPhase += (Math.PI * 2 * options.freq * Math.exp(-time * options.freqDrop)) / sampleRate;
    bassPhase += (Math.PI * 2 * options.bassFreq * Math.exp(-time * 6)) / sampleRate;
    ringPhase += (Math.PI * 2 * options.ringFreq) / sampleRate;

    const crack = noise * options.noise * snap;
    const body = Math.sin(bodyPhase) * options.body * bodyEnv;
    const bass = Math.sin(bassPhase) * options.bass * bassEnv;
    const ring = Math.sin(ringPhase) * options.ring * Math.exp(-time * 28);
    const click = time < options.clickTime ? (index % 2 === 0 ? 1 : -1) * options.click : 0;

    samples[index] = clamp(crack + body + bass + ring + click, -1, 1);
  }

  return encodeWavDataUri(samples, sampleRate);
}

function encodeWavDataUri(samples, sampleRate) {
  const dataSize = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeWavString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeWavString(view, 8, "WAVE");
  writeWavString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeWavString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let index = 0; index < samples.length; index += 1) {
    view.setInt16(offset, Math.round(samples[index] * 32767), true);
    offset += 2;
  }

  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }

  return `data:audio/wav;base64,${btoa(binary)}`;
}

function writeWavString(view, offset, text) {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}

function unlockAudio() {
  if (!audioReady) {
    initGunshotAudio();
  }

  if (!unlockSound) return;

  unlockSound.volume = 0.001;
  const playPromise = unlockSound.play();
  if (playPromise && playPromise.then) {
    playPromise.then(() => {
      unlockSound.pause();
      unlockSound.currentTime = 0;
    }).catch(() => {});
  }
}

function playPooledSound(pool, volume) {
  if (!pool || pool.length === 0) return;

  const audio = pool.find((item) => item.paused) || pool[0];
  audio.volume = volume;
  audio.currentTime = 0;
  const playPromise = audio.play();
  if (playPromise && playPromise.catch) {
    playPromise.catch(() => {});
  }
}

function playGunshot(kind) {
  if (!audioReady) {
    initGunshotAudio();
  }

  playPooledSound(gunshotSounds[kind] || gunshotSounds.m4, 1);
}

function playFootstep(sprinting) {
  if (!audioReady) {
    initGunshotAudio();
  }

  const pool = sprinting ? footstepSounds.sprint : footstepSounds.walk;
  if (!pool || pool.length === 0) return;

  const audio = pool[Math.floor(Math.random() * pool.length)];
  audio.pause();
  audio.currentTime = 0;
  const baseVolume = sprinting ? 0.22 : 0.14;
  audio.volume = Math.min(0.28, baseVolume * (0.78 + Math.random() * 0.44));
  audio.playbackRate = 0.97 + Math.random() * 0.06;
  const playPromise = audio.play();
  if (playPromise && playPromise.catch) {
    playPromise.catch(() => {});
  }
}

function playPunchSound(kind) {
  if (!audioReady) {
    initGunshotAudio();
  }

  playPooledSound(punchSounds[kind] || punchSounds.whoosh, kind === "hit" ? 0.72 : 0.48);
}

function startPunch() {
  if (punchAnimation || pickupAnimation || dropAnimation || weaponSwitch || getEquippedWeapon()) return;

  punchAnimation = {
    elapsed: 0,
    duration: 0.42,
    side: nextPunchSide,
    hit: false,
  };
  nextPunchSide *= -1;
  player.pitch -= 0.006;
  player.pitch = clamp(player.pitch, -1.35, 1.35);
  playPunchSound("whoosh");
}

function getPunchProgress() {
  if (!punchAnimation) return 0;
  return clamp(punchAnimation.elapsed / punchAnimation.duration, 0, 1);
}

function updatePunch(deltaSeconds) {
  if (!punchAnimation) {
    if (!godView && mouseButtons.left && !getEquippedWeapon() && !pickupAnimation && !dropAnimation && !weaponSwitch) {
      startPunch();
    }
    return;
  }

  punchAnimation.elapsed += deltaSeconds;
  const progress = getPunchProgress();

  if (!punchAnimation.hit && progress >= 0.24 && progress <= 0.48) {
    punchAnimation.hit = true;
    resolvePunchHit();
  }

  if (punchAnimation.elapsed >= punchAnimation.duration) {
    punchAnimation = null;
  }
}

function resolvePunchHit() {
  const direction = normalize(getLookDirection());
  const origin = player.position;
  const reach = 2.05;
  const end = [
    origin[0] + direction[0] * reach,
    origin[1] + direction[1] * reach,
    origin[2] + direction[2] * reach,
  ];

  let closestHit = null;
  const targetHit = segmentHitBox(origin, end, [target[0], 0.55, target[2]], [0.55, 0.55, 0.55]);
  if (targetHit) {
    closestHit = { ...targetHit, kind: "target" };
  }

  for (const obstacle of obstacles) {
    const half = obstacle.size.map((value) => value / 2);
    const hit = segmentHitBox(origin, end, obstacle.position, half);
    if (!hit) continue;
    if (!closestHit || hit.t < closestHit.t) {
      closestHit = { ...hit, kind: "wall" };
    }
  }

  if (!closestHit) return;

  playPunchSound("hit");
  spawnImpactSpark(closestHit.point, closestHit.kind === "target");

  if (closestHit.kind === "target") {
    score += 1;
    scoreEl.textContent = String(score);
    target = randomTarget();
  }
}

function updateFootsteps(deltaSeconds) {
  const landed = player.onGround && !wasOnGround;
  wasOnGround = player.onGround;

  if (landed && !punchAnimation) {
    playFootstep(true);
    lastFootstepCycle = player.handCycle;
    return;
  }

  if (!player.isMoving || !player.onGround || pickupAnimation || dropAnimation || punchAnimation) {
    lastFootstepCycle = player.handCycle;
    return;
  }

  // Hands dip twice per 2π of handCycle; plant a foot on each dip.
  const prevDip = Math.cos(lastFootstepCycle);
  const nextDip = Math.cos(player.handCycle);
  lastFootstepCycle = player.handCycle;
  if (prevDip === nextDip || prevDip * nextDip > 0) return;
  if (player.handSway < 0.35) return;

  playFootstep(player.isSprinting);
}

function getCrosshairRay() {
  const look = getLookDirection();
  const eye = getEyePosition();
  // Front / side cameras look at the body, so screen-center would hit the player.
  if (godView || CAMERA_MODES[cameraModeIndex] === "front") {
    return { origin: eye, dir: look };
  }
  const camera = getRenderCamera(eye, look);
  const dx = camera.target[0] - camera.position[0];
  const dy = camera.target[1] - camera.position[1];
  const dz = camera.target[2] - camera.position[2];
  const len = Math.hypot(dx, dy, dz) || 1;
  return {
    origin: camera.position,
    dir: [dx / len, dy / len, dz / len],
  };
}

function raycastShot(origin, dir, maxRange) {
  const end = [
    origin[0] + dir[0] * maxRange,
    origin[1] + dir[1] * maxRange,
    origin[2] + dir[2] * maxRange,
  ];
  let closestHit = null;
  const targetHit = segmentHitBox(origin, end, [target[0], 0.55, target[2]], [0.55, 0.55, 0.55]);
  if (targetHit) {
    closestHit = { ...targetHit, kind: "target" };
  }

  for (const obstacle of obstacles) {
    const half = obstacle.size.map((value) => value / 2);
    const hit = segmentHitBox(origin, end, obstacle.position, half);
    if (!hit) continue;
    if (!closestHit || hit.t < closestHit.t) {
      closestHit = { ...hit, kind: "wall" };
    }
  }

  const groundHit = segmentHitGround(origin, end);
  if (groundHit && (!closestHit || groundHit.t < closestHit.t)) {
    closestHit = { ...groundHit, kind: "ground" };
  }
  return closestHit;
}

function applyShotHit(hit, incomingDir) {
  if (hit.kind === "target") {
    score += isAiming ? 2 : 1;
    scoreEl.textContent = String(score);
    target = randomTarget();
    spawnImpactSpark(hit.point, true);
    return;
  }
  spawnImpactSpark(hit.point, false);
  spawnBulletHole(hit.point, hit.normal, incomingDir);
}

function getMuzzleWorldPosition() {
  const weapon = getActiveViewWeapon();
  if (!weapon) return null;
  const eye = getEyePosition();
  const basis = makeViewBasis(getViewmodelLook(), eye);
  const hold = getViewWeaponHold(weapon.kind);
  const local = transformViewPoint(
    hold.position,
    hold.euler,
    hold.scale,
    [0, 0.035, WEAPON_DEFS[weapon.kind].barrelZ],
  );
  return toWorldPoint(basis, local[0], local[1], local[2]);
}

function spawnBullet(weaponKind) {
  const def = WEAPON_DEFS[weaponKind];
  const ray = getCrosshairRay();
  const aimStart = isFirstPerson() ? 0.12 : 0.35;
  const aimOrigin = [
    ray.origin[0] + ray.dir[0] * aimStart,
    ray.origin[1] + ray.dir[1] * aimStart,
    ray.origin[2] + ray.dir[2] * aimStart,
  ];
  const hit = raycastShot(aimOrigin, ray.dir, 130);
  if (hit) applyShotHit(hit, ray.dir);
  const aimPoint = hit
    ? hit.point
    : [
        ray.origin[0] + ray.dir[0] * 130,
        ray.origin[1] + ray.dir[1] * 130,
        ray.origin[2] + ray.dir[2] * 130,
      ];

  let origin = aimOrigin;
  let direction = ray.dir;
  const muzzle = isFirstPerson() ? null : getMuzzleWorldPosition();
  if (muzzle) {
    origin = muzzle;
    const dx = aimPoint[0] - muzzle[0];
    const dy = aimPoint[1] - muzzle[1];
    const dz = aimPoint[2] - muzzle[2];
    const len = Math.hypot(dx, dy, dz) || 1;
    direction = [dx / len, dy / len, dz / len];
  }
  const maxRange = Math.max(
    0.08,
    Math.hypot(aimPoint[0] - origin[0], aimPoint[1] - origin[1], aimPoint[2] - origin[2]),
  );

  bullets.push({
    position: origin,
    direction,
    speed: def.bulletSpeed,
    traveled: 0,
    maxRange,
    kind: weaponKind,
    tracerLength: def.tracerLength,
    tracerColor: def.tracerColor,
  });

  if (bullets.length > 48) {
    bullets.splice(0, bullets.length - 48);
  }
}

function updateBullets(deltaSeconds) {
  for (let index = bullets.length - 1; index >= 0; index -= 1) {
    const bullet = bullets[index];
    const step = bullet.speed * deltaSeconds;
    bullet.position[0] += bullet.direction[0] * step;
    bullet.position[1] += bullet.direction[1] * step;
    bullet.position[2] += bullet.direction[2] * step;
    bullet.traveled += step;
    if (bullet.traveled >= bullet.maxRange) {
      bullets.splice(index, 1);
    }
  }
}

function getPlayerCollisionBox(x, z) {
  const centerY = Math.max(playerCollisionHalfHeight, player.position[1] - eyeHeight + playerCollisionHalfHeight);
  return {
    center: [x, centerY, z],
    half: [playerCollisionRadius, playerCollisionHalfHeight, playerCollisionRadius],
  };
}

function aabbOverlap(boxA, boxB) {
  return (
    Math.abs(boxA.center[0] - boxB.center[0]) < boxA.half[0] + boxB.half[0] &&
    Math.abs(boxA.center[1] - boxB.center[1]) < boxA.half[1] + boxB.half[1] &&
    Math.abs(boxA.center[2] - boxB.center[2]) < boxA.half[2] + boxB.half[2]
  );
}

function playerCollidesAt(x, z) {
  const playerBox = getPlayerCollisionBox(x, z);

  for (const obstacle of obstacles) {
    const half = obstacle.size.map((value) => value / 2);
    if (aabbOverlap(playerBox, { center: obstacle.position, half })) {
      return true;
    }
  }

  return false;
}

function viewmodelCollidesAt(x, z) {
  return viewmodelOverlapAmount(x, z) > 0.001;
}

function viewmodelOverlapAmount(x, z) {
  let maxOverlap = 0;

  for (const probe of getViewmodelProbes(x, z)) {
    for (const obstacle of obstacles) {
      const overlap = aabbHorizontalOverlap(probe, obstacle);
      if (overlap > maxOverlap) maxOverlap = overlap;
    }
  }

  return maxOverlap;
}

function aabbHorizontalOverlap(probe, obstacle) {
  const half = obstacle.size.map((value) => value / 2);
  const overlapX = half[0] + probe.half[0] - Math.abs(probe.center[0] - obstacle.position[0]);
  const overlapY = half[1] + probe.half[1] - Math.abs(probe.center[1] - obstacle.position[1]);
  const overlapZ = half[2] + probe.half[2] - Math.abs(probe.center[2] - obstacle.position[2]);
  if (overlapX <= 0 || overlapY <= 0 || overlapZ <= 0) return 0;
  return Math.min(overlapX, overlapZ);
}

function getViewmodelProbes(x, z) {
  const forwardX = Math.sin(player.yaw);
  const forwardZ = Math.cos(player.yaw);
  const viewRight = getViewRight();
  const rightX = viewRight[0];
  const rightZ = viewRight[2];
  const y = player.position[1] - 0.22;
  const armed = Boolean(getEquippedWeapon());
  const ads = getAdsBlend() > 0.45 && armed;

  if (ads) {
    return [
      {
        center: [x + forwardX * 0.38, y, z + forwardZ * 0.38],
        half: [0.14, 0.18, 0.14],
      },
    ];
  }

  const rightReach = armed ? 0.36 : 0.4;
  const leftReach = armed ? 0.32 : 0.4;
  const forwardReach = armed ? 0.68 : punchAnimation ? 0.42 : 0.58;

  const probes = [
    {
      center: [x + forwardX * forwardReach + rightX * (armed ? 0.12 : 0.16), y, z + forwardZ * forwardReach + rightZ * (armed ? 0.12 : 0.16)],
      half: [0.1, 0.14, 0.1],
    },
    {
      center: [x + forwardX * forwardReach * 0.52 + rightX * (armed ? 0.14 : 0.16), y, z + forwardZ * forwardReach * 0.52 + rightZ * (armed ? 0.14 : 0.16)],
      half: [0.09, 0.13, 0.1],
    },
    {
      center: [x + forwardX * (armed ? 0.42 : 0.34) - rightX * leftReach * 0.35, y, z + forwardZ * (armed ? 0.42 : 0.34) - rightZ * leftReach * 0.35],
      half: [0.1, 0.13, 0.1],
    },
    {
      center: [x + rightX * rightReach, y, z + rightZ * rightReach],
      half: [0.12, 0.18, 0.12],
    },
    {
      center: [x - rightX * leftReach, y, z - rightZ * leftReach],
      half: [0.12, 0.18, 0.12],
    },
    {
      center: [x + forwardX * 0.18 + rightX * rightReach, y, z + forwardZ * 0.18 + rightZ * rightReach],
      half: [0.11, 0.16, 0.11],
    },
    {
      center: [x + forwardX * 0.18 - rightX * leftReach, y, z + forwardZ * 0.18 - rightZ * leftReach],
      half: [0.11, 0.16, 0.11],
    },
  ];

  if (punchAnimation) {
    const look = getLookDirection();
    const toWorld = (point) => [
      x + rightX * point[0] + look[0] * point[2],
      y + point[1] * 0.35,
      z + rightZ * point[0] + look[2] * point[2],
    ];
    const striking = getPunchJoints(punchAnimation.side, true);
    const guard = getPunchJoints(-punchAnimation.side, false);
    probes.push(
      { center: toWorld(striking.hand), half: [0.22, 0.22, 0.22] },
      { center: toWorld(striking.wrist), half: [0.16, 0.18, 0.16] },
      { center: toWorld(striking.elbow), half: [0.16, 0.16, 0.16] },
      { center: toWorld(guard.hand), half: [0.18, 0.18, 0.18] },
    );
  }

  return probes;
}

function movementBlocked(nextX, nextZ, currentX, currentZ) {
  if (playerCollidesAt(nextX, nextZ)) return true;
  const nextOverlap = viewmodelOverlapAmount(nextX, nextZ);
  if (nextOverlap <= 0.001) return false;
  const currentOverlap = viewmodelOverlapAmount(currentX, currentZ);
  return nextOverlap > currentOverlap + 0.0005;
}

function getViewmodelMTV(x, z) {
  let best = null;
  let bestLen = Infinity;

  for (const probe of getViewmodelProbes(x, z)) {
    for (const obstacle of obstacles) {
      const half = obstacle.size.map((value) => value / 2);
      const dx = probe.center[0] - obstacle.position[0];
      const dz = probe.center[2] - obstacle.position[2];
      const overlapX = half[0] + probe.half[0] - Math.abs(dx);
      const overlapY = half[1] + probe.half[1] - Math.abs(probe.center[1] - obstacle.position[1]);
      const overlapZ = half[2] + probe.half[2] - Math.abs(dz);
      if (overlapX <= 0 || overlapY <= 0 || overlapZ <= 0) continue;

      const mtv = overlapX < overlapZ
        ? [Math.sign(dx || 1) * overlapX, 0, 0]
        : [0, 0, Math.sign(dz || 1) * overlapZ];
      const len = Math.hypot(mtv[0], mtv[2]);
      if (len > 0 && len < bestLen) {
        bestLen = len;
        best = mtv;
      }
    }
  }

  return best;
}

function resolveViewmodelOverlap() {
  for (let iter = 0; iter < 6; iter += 1) {
    const mtv = getViewmodelMTV(player.position[0], player.position[2]);
    if (!mtv) return;

    const nextX = player.position[0] + mtv[0];
    const nextZ = player.position[2] + mtv[2];
    if (playerCollidesAt(nextX, nextZ)) return;

    player.position[0] = nextX;
    player.position[2] = nextZ;
  }
}

function rayHitDistance(origin, direction, maxDistance) {
  const end = [
    origin[0] + direction[0] * maxDistance,
    origin[1] + direction[1] * maxDistance,
    origin[2] + direction[2] * maxDistance,
  ];
  let closest = maxDistance;

  for (const obstacle of obstacles) {
    const hit = segmentHitBox(origin, end, obstacle.position, obstacle.size.map((value) => value / 2));
    if (hit) {
      closest = Math.min(closest, hit.t * maxDistance);
    }
  }

  return closest;
}

function sampleClearance(direction, maxDistance) {
  const origin = player.position;
  const forward = [Math.sin(player.yaw), 0, Math.cos(player.yaw)];
  const right = [Math.cos(player.yaw), 0, -Math.sin(player.yaw)];
  const points = [
    origin,
    [origin[0], origin[1] - 0.28, origin[2]],
    [origin[0] + forward[0] * 0.4, origin[1] - 0.12, origin[2] + forward[2] * 0.4],
    [origin[0] + forward[0] * 0.85, origin[1] - 0.1, origin[2] + forward[2] * 0.85],
    [origin[0] + right[0] * 0.12, origin[1] - 0.14, origin[2] + right[2] * 0.12],
    [origin[0] - right[0] * 0.12, origin[1] - 0.14, origin[2] - right[2] * 0.12],
  ];

  let closest = maxDistance;
  for (const point of points) {
    closest = Math.min(closest, rayHitDistance(point, direction, maxDistance));
  }
  return closest;
}

function updateViewmodelPush(deltaSeconds) {
  const forward = normalize(getLookDirection());
  const right = getViewRight();
  const left = [-right[0], 0, -right[2]];
  const armed = Boolean(getEquippedWeapon());

  const forwardDist = sampleClearance(forward, 1.05);
  const rightDist = sampleClearance(right, 0.7);
  const leftDist = sampleClearance(left, 0.7);

  const forwardNeed = punchAnimation ? 0.95 : armed ? 0.72 : 0.58;
  const sideNeed = armed ? 0.38 : 0.44;
  const forwardPush = clamp((forwardNeed - forwardDist) / 0.48, 0, 1);
  const rightPush = clamp((sideNeed - rightDist) / 0.82, 0, 1);
  const leftPush = clamp((sideNeed - leftDist) / 0.82, 0, 1);
  const target = Math.max(forwardPush, rightPush, leftPush);
  const sideTarget = rightPush - leftPush;

  const follow = Math.min(deltaSeconds * 18, 1);
  player.viewmodelPush += (target - player.viewmodelPush) * follow;
  player.viewmodelSidePush += (sideTarget - player.viewmodelSidePush) * follow;
}

function segmentHitBox(start, end, center, halfSize) {
  const dir = [end[0] - start[0], end[1] - start[1], end[2] - start[2]];
  const min = [
    center[0] - halfSize[0],
    center[1] - halfSize[1],
    center[2] - halfSize[2],
  ];
  const max = [
    center[0] + halfSize[0],
    center[1] + halfSize[1],
    center[2] + halfSize[2],
  ];

  let tMin = 0;
  let tMax = 1;
  let hitAxis = -1;
  let hitSign = 0;

  for (let axis = 0; axis < 3; axis += 1) {
    if (Math.abs(dir[axis]) < 0.00001) {
      if (start[axis] < min[axis] || start[axis] > max[axis]) {
        return null;
      }
      continue;
    }

    const inv = 1 / dir[axis];
    let tEnter = (min[axis] - start[axis]) * inv;
    let tLeave = (max[axis] - start[axis]) * inv;
    let enterSign = -1;

    if (tEnter > tLeave) {
      const swap = tEnter;
      tEnter = tLeave;
      tLeave = swap;
      enterSign = 1;
    }

    if (tEnter > tMin) {
      tMin = tEnter;
      hitAxis = axis;
      hitSign = enterSign;
    }

    tMax = Math.min(tMax, tLeave);
    if (tMin > tMax) {
      return null;
    }
  }

  if (hitAxis === -1) {
    if (pointInBox(start, center, halfSize)) {
      const exit = inferInsideHit(start, dir, min, max);
      if (!exit) return null;
      return { point: start, normal: exit.normal, t: 0 };
    }
    return null;
  }

  if (tMin < 0 || tMin > 1) {
    return null;
  }

  const normal = [0, 0, 0];
  normal[hitAxis] = hitSign;
  const point = [
    start[0] + dir[0] * tMin,
    start[1] + dir[1] * tMin,
    start[2] + dir[2] * tMin,
  ];

  return { point, normal, t: tMin };
}

function inferInsideHit(start, dir, min, max) {
  let bestAxis = 0;
  let bestDist = Infinity;
  let bestSign = 1;

  for (let axis = 0; axis < 3; axis += 1) {
    const toMax = max[axis] - start[axis];
    const toMin = start[axis] - min[axis];
    if (toMax < bestDist) {
      bestDist = toMax;
      bestAxis = axis;
      bestSign = 1;
    }
    if (toMin < bestDist) {
      bestDist = toMin;
      bestAxis = axis;
      bestSign = -1;
    }
  }

  const normal = [0, 0, 0];
  normal[bestAxis] = bestSign;
  return { normal };
}

function segmentHitGround(start, end) {
  const groundY = 0.02;
  const dy = end[1] - start[1];

  if (end[1] > groundY && start[1] > groundY) {
    return null;
  }

  if (Math.abs(dy) < 0.00001) {
    return null;
  }

  const t = (groundY - start[1]) / dy;
  if (t < 0 || t > 1) {
    return null;
  }

  return {
    point: [
      start[0] + (end[0] - start[0]) * t,
      groundY,
      start[2] + (end[2] - start[2]) * t,
    ],
    normal: [0, 1, 0],
    t,
  };
}

function spawnBulletHole(point, normal, incomingDir) {
  const absX = Math.abs(normal[0]);
  const absY = Math.abs(normal[1]);
  const absZ = Math.abs(normal[2]);
  const axis = absX >= absY && absX >= absZ ? 0 : absY >= absZ ? 1 : 2;
  const dirLen = incomingDir ? Math.hypot(incomingDir[0], incomingDir[1], incomingDir[2]) : 0;
  const dir = dirLen > 0.001
    ? [incomingDir[0] / dirLen, incomingDir[1] / dirLen, incomingDir[2] / dirLen]
    : [-normal[0], -normal[1], -normal[2]];
  const pull = 0.012;

  bulletHoles.push({
    position: [
      point[0] - dir[0] * pull,
      point[1] - dir[1] * pull,
      point[2] - dir[2] * pull,
    ],
    normal: [normal[0], normal[1], normal[2]],
    axis,
    size: 0.07,
    rotation: 0,
    life: 12,
    maxLife: 12,
  });

  if (bulletHoles.length > 400) {
    bulletHoles.splice(0, bulletHoles.length - 400);
  }
}

function updateBulletHoles(deltaSeconds) {
  for (let index = bulletHoles.length - 1; index >= 0; index -= 1) {
    bulletHoles[index].life -= deltaSeconds;
    if (bulletHoles[index].life <= 0) {
      bulletHoles.splice(index, 1);
    }
  }
}

function addBulletHoleMesh(vertices, hole) {
  const fade = hole.life < 2.5 ? clamp(hole.life / 2.5, 0, 1) : 1;
  if (fade <= 0.04) return;

  const pos = hole.position;
  const radius = hole.size * (0.55 + fade * 0.45);
  const depth = 0.016 * fade;
  const scorchSize = [radius * 2.2, radius * 2.2, radius * 2.2];
  scorchSize[hole.axis] = 0.01 * fade;
  const craterSize = [radius, radius, radius];
  craterSize[hole.axis] = Math.max(depth, 0.008);
  const coreSize = [radius * 0.38, radius * 0.38, radius * 0.38];
  coreSize[hole.axis] = Math.max(depth * 1.1, 0.009);

  addBox(vertices, pos, scorchSize, [0.18 * fade, 0.16 * fade, 0.13 * fade]);
  addBox(vertices, pos, craterSize, [0.05 * fade, 0.05 * fade, 0.055 * fade]);
  addBox(vertices, pos, coreSize, [0.015 * fade, 0.015 * fade, 0.018 * fade]);
}

function segmentIntersectsBox(start, end, center, halfSize) {
  return segmentHitBox(start, end, center, halfSize) !== null;
}

function pointInBox(point, center, halfSize) {
  return (
    Math.abs(point[0] - center[0]) <= halfSize[0] &&
    Math.abs(point[1] - center[1]) <= halfSize[1] &&
    Math.abs(point[2] - center[2]) <= halfSize[2]
  );
}

function spawnImpactSpark(position, isTarget) {
  impactSparks.push({
    position: [position[0], position[1], position[2]],
    life: isTarget ? 0.18 : 0.12,
    maxLife: isTarget ? 0.18 : 0.12,
    isTarget,
  });

  if (impactSparks.length > 24) {
    impactSparks.splice(0, impactSparks.length - 24);
  }
}

function updateImpactSparks(deltaSeconds) {
  for (let index = impactSparks.length - 1; index >= 0; index -= 1) {
    impactSparks[index].life -= deltaSeconds;
    if (impactSparks[index].life <= 0) {
      impactSparks.splice(index, 1);
    }
  }
}

function addBulletTracer(vertices, bullet) {
  const tip = bullet.position;
  const tail = [
    tip[0] - bullet.direction[0] * bullet.tracerLength,
    tip[1] - bullet.direction[1] * bullet.tracerLength,
    tip[2] - bullet.direction[2] * bullet.tracerLength,
  ];
  const segments = 7;

  for (let index = 0; index <= segments; index += 1) {
    const t = index / segments;
    const point = [
      tail[0] + (tip[0] - tail[0]) * t,
      tail[1] + (tip[1] - tail[1]) * t,
      tail[2] + (tip[2] - tail[2]) * t,
    ];
    const glow = 0.35 + t * 0.65;
    const size = 0.028 + t * 0.04;
    const color = bullet.tracerColor.map((value) => value * glow);
    addBox(vertices, point, [size * 0.55, size * 0.55, size * 1.35], color);
  }

  addBox(vertices, tip, [0.05, 0.05, 0.08], [1, 0.98, 0.82]);
}

function addImpactSparkMesh(vertices, spark) {
  const fade = spark.life / spark.maxLife;
  const size = 0.08 + (1 - fade) * 0.12;
  const color = spark.isTarget
    ? [1, 0.86, 0.22].map((value) => value * fade)
    : [0.72, 0.72, 0.72].map((value) => value * fade);

  addBox(vertices, spark.position, [size, size, size], color);
  addBox(
    vertices,
    [spark.position[0], spark.position[1] + size * 0.35, spark.position[2]],
    [size * 0.45, size * 0.18, size * 0.45],
    color.map((value) => value * 0.75),
  );
}

function fireWeapon() {
  const weapon = getEquippedWeapon();
  if (!weapon) return;

  const def = WEAPON_DEFS[weapon.kind];
  fireCooldown = def.fireRate;
  muzzleFlash = 0.05;

  playGunshot(weapon.kind);
  spawnBullet(weapon.kind);

  const recoilScale = isAiming ? 0.52 : 1;
  player.pitch += def.recoil * recoilScale;
  player.yaw += (Math.random() - 0.5) * def.recoilYaw * recoilScale;
  player.pitch = clamp(player.pitch, -1.35, 1.35);
}

function updateAimUi() {
  const overlay = isFirstPerson() ? getScopeOverlayBlend() : 0;
  crosshairEl?.classList.toggle("hidden", CAMERA_MODES[cameraModeIndex] === "front" || godView);
  crosshairEl?.classList.toggle("ads-mode", overlay > 0.35);
  if (scopeOverlayEl) {
    scopeOverlayEl.classList.toggle("active", overlay > 0.02);
    scopeOverlayEl.style.opacity = String(overlay);
  }
}

function updateAds(deltaSeconds) {
  if (isViewmodelBlocked()) {
    isAiming = false;
  }
  const want = isFirstPerson() && isAiming && getEquippedWeapon() && !isViewmodelBlocked() && !weaponSwitch && !dropAnimation && !pickupAnimation;
  const target = want ? 1 : 0;
  const duration = target > adsProgress ? 0.28 : 0.18;
  const step = deltaSeconds / duration;
  if (adsProgress < target) {
    adsProgress = Math.min(target, adsProgress + step);
  } else {
    adsProgress = Math.max(target, adsProgress - step);
  }
  if (!getEquippedWeapon()) adsProgress = 0;
}

function getAdsBlend() {
  return easeInOut(clamp(adsProgress, 0, 1));
}

function getScopeOverlayBlend() {
  return easeInOut(clamp((adsProgress - 0.72) / 0.28, 0, 1));
}

function getViewmodelSwing() {
  const walkAmount = player.handSway * (pickupAnimation || dropAnimation ? 0.15 : 1);
  const sprintAmount = player.isSprinting ? 1 : 0;
  const aimDamp = getAdsBlend() > 0.2 && getEquippedWeapon() && !dropAnimation ? 0.3 : 1;
  const amplitude = (0.018 + sprintAmount * 0.012) * walkAmount * aimDamp;
  const cycle = player.handCycle;
  return {
    x: Math.cos(cycle) * amplitude,
    y: Math.sin(cycle) * amplitude,
    amplitude,
    walkAmount,
    sprintAmount,
    aimDamp,
  };
}

function getHeldSway(holdProgress) {
  const swing = getViewmodelSwing();
  const ads = getAdsBlend();
  return { bob: swing.y, sway: swing.x, ads, holdProgress };
}

function offsetForAds(baseX, baseY, baseZ, ads) {
  const dip = getSwitchDip();
  const push = player.viewmodelPush;
  const sidePush = player.viewmodelSidePush;
  const xScale = 1 - push * 0.42 - Math.abs(sidePush) * 0.35;
  return [
    baseX * xScale - sidePush * 0.58 + dip * 0.16,
    baseY - dip * 0.82 - push * 0.2,
    baseZ - dip * 0.38 - push * 0.48 - Math.abs(sidePush) * 0.42,
  ];
}

function addMuzzleFlash(vertices, basis, baseX, baseY, baseZ, barrelZ) {
  if (muzzleFlash <= 0) return;

  const flash = [1, 0.92, 0.55];
  addViewBox(vertices, basis, [baseX, baseY + 0.01, baseZ + barrelZ], [0.08, 0.08, 0.12], flash);
}

function addWeaponToInventory(weapon) {
  inventory[activeSlot] = weapon;
}

function switchToSlot(slot) {
  if (pickupAnimation || dropAnimation || punchAnimation) return;
  if (slot !== 0 && slot !== 1) return;
  if (weaponSwitch) return;
  if (slot === activeSlot) return;

  isAiming = false;
  weaponSwitch = {
    elapsed: 0,
    duration: 0.36,
    fromSlot: activeSlot,
    toSlot: slot,
    swapped: false,
  };
}

function updateWeaponSwitch(deltaSeconds) {
  if (!weaponSwitch) return;

  weaponSwitch.elapsed += deltaSeconds;
  const progress = weaponSwitch.elapsed / weaponSwitch.duration;

  if (!weaponSwitch.swapped && progress >= 0.5) {
    activeSlot = weaponSwitch.toSlot;
    weaponSwitch.swapped = true;
  }

  if (weaponSwitch.elapsed >= weaponSwitch.duration) {
    activeSlot = weaponSwitch.toSlot;
    weaponSwitch = null;
  }
}

function getSwitchDip() {
  if (!weaponSwitch) return 0;
  return Math.sin(clamp(weaponSwitch.elapsed / weaponSwitch.duration, 0, 1) * Math.PI);
}

function weaponIconSvg(kind) {
  if (kind === "akm") {
    return `
      <svg viewBox="0 0 48 24" aria-hidden="true">
        <path d="M4 13h5l1.2-2.2h8.3l1.2 1.4h8.8l1.8-1.2h5.2v1.4h-4.1l-1.1 1.1h-7.8v2.1h-2.4v-2.1H12l-1.4 2.8H7.6L6 15.2H4z"/>
        <path d="M8.8 15.2h2.9l.8-1.6H8.8z"/>
        <path d="M15.2 10.8h11.2v1.5H15.2z"/>
        <path d="M13.8 15.2l1.1-2.3c1.2-.2 2.1.8 1.8 2.1l-.4 1.6h-2.5z"/>
        <path d="M21.2 15.2v2.4h2.8v-2.4z"/>
      </svg>
    `;
  }

  if (kind === "m4") {
    return `
      <svg viewBox="0 0 48 24" aria-hidden="true">
        <path d="M7 13.2h4.6l1-1.8h10.4l1.4 1.2h6.8l1.6-1h4.2v1.2h-3.2l-1 1h-6.2v1.8h-2v-1.8h-6.8l-1.2 2.4H9.4L8 15.4H7z"/>
        <path d="M10.8 15.4h2.4l.7-1.4h-2.4z"/>
        <path d="M16.8 11.4h8.8v1.2H16.8z"/>
        <path d="M18.2 15.4v2h2.4v-2z"/>
        <path d="M24.6 11.4h6.2v1.2h-6.2z"/>
      </svg>
    `;
  }

  return `
    <svg viewBox="0 0 48 24" aria-hidden="true">
      <path d="M9 13.4h4.8l1.2-2h11.6l1.4 1.1h7.4l1.8-1.1h4.6v1.3h-3.6l-1.1 1h-7.1v1.9h-2.1v-1.9h-7.4l-1.3 2.6h-3.4l-1.4-2.6H9z"/>
      <path d="M12.8 15.4h2.7l.8-1.6h-2.7z"/>
      <path d="M18.4 9.8h8.4v2.2h-8.4z"/>
      <path d="M19.2 9.8l.8-1.6h5.2l.8 1.6z"/>
      <path d="M20.4 15.4v2.1h2.6v-2.1z"/>
    </svg>
  `;
}

function weaponShortName(kind) {
  if (kind === "akm") return "AKM";
  if (kind === "m4") return "M4A1";
  return "AUG";
}

function updateWeaponHud() {
  weaponSlotsEl.innerHTML = inventory
    .map((weapon, index) => {
      const active = index === activeSlot && weapon;
      const classes = ["weapon-slot", active ? "active" : "", weapon ? "" : "empty"].filter(Boolean).join(" ");
      const wrapClass = active ? "weapon-slot-wrap active" : "weapon-slot-wrap";
      const label = index === 0 ? "1" : "2";
      return `
        <div class="${wrapClass}">
          <div class="${classes}" title="${weapon ? weapon.name : "Empty slot"}">
            ${weapon ? weaponIconSvg(weapon.kind) : ""}
          </div>
          <div class="weapon-slot__name">${weapon ? weaponShortName(weapon.kind) : "—"}</div>
          <div class="weapon-slot__key">${label}</div>
        </div>
      `;
    })
    .join("");
}

function updateWeaponPrompt() {
  nearbyWeapons = weaponPickups
    .map((weapon) => {
      const dx = player.position[0] - weapon.position[0];
      const dz = player.position[2] - weapon.position[2];
      return { ...weapon, distance: Math.hypot(dx, dz) };
    })
    .filter((weapon) => weapon.distance <= weaponPromptRange)
    .sort((a, b) => a.distance - b.distance);

  if (dropAnimation) {
    weaponPromptEl.classList.remove("hidden");
    weaponPromptEl.innerHTML = `
      <div class="weapon-prompt__title">Dropping</div>
      <div class="weapon-row">
        <div class="weapon-row__key">E</div>
        <div>
          <div class="weapon-row__name">${dropAnimation.weapon.name}</div>
          <div class="weapon-row__meta">Lowering weapon</div>
        </div>
        <div class="weapon-row__distance">${Math.round((1 - getHoldBlend()) * 100)}%</div>
      </div>
    `;
    return;
  }

  if (pickupAnimation) {
    weaponPromptEl.classList.remove("hidden");
    weaponPromptEl.innerHTML = `
      <div class="weapon-prompt__title">Picking up</div>
      <div class="weapon-row">
        <div class="weapon-row__key">F</div>
        <div>
          <div class="weapon-row__name">${pickupAnimation.weapon.name}</div>
          <div class="weapon-row__meta">Crouching to pick up · ${pickupAnimation.replaceOnly ? "Replacing held weapon" : "Equipping current slot"}</div>
        </div>
        <div class="weapon-row__distance">${Math.round(getPickupProgress() * 100)}%</div>
      </div>
    `;
    return;
  }

  if (nearbyWeapons.length === 0) {
    weaponPromptEl.classList.add("hidden");
    weaponPromptEl.innerHTML = "";
    return;
  }

  weaponPromptEl.classList.remove("hidden");
  weaponPromptEl.innerHTML = `
    <div class="weapon-prompt__title">Nearby loot</div>
    ${nearbyWeapons
      .map(
        (weapon, index) => `
          <div class="weapon-row">
            <div class="weapon-row__key">${index === 0 ? "F" : "·"}</div>
            <div>
              <div class="weapon-row__name">${weapon.name}</div>
          <div class="weapon-row__meta">${weapon.type} · ${weapon.layout}</div>
            </div>
            <div class="weapon-row__distance">${weapon.distance.toFixed(1)}m</div>
          </div>
        `,
      )
      .join("")}
  `;
}

function tryStartWeaponPickup() {
  if (pickupAnimation || dropAnimation || nearbyWeapons.length === 0) return;

  const weapon = nearbyWeapons[0];
  const pickupIndex = weaponPickups.findIndex((item) => item.id === weapon.id);
  if (pickupIndex === -1) return;

  const replacing = Boolean(getEquippedWeapon());
  weaponPickups.splice(pickupIndex, 1);

  if (replacing) {
    if (!dropActiveWeapon({ keepSlot: true, thenPickup: weapon })) {
      weaponPickups.push(weapon);
    }
    return;
  }

  pickupAnimation = {
    weapon,
    elapsed: 0,
    duration: 1.05,
    replaceOnly: false,
  };
}

function updatePickupAnimation(deltaSeconds) {
  if (!pickupAnimation) return;

  pickupAnimation.elapsed += deltaSeconds;
  if (pickupAnimation.elapsed >= pickupAnimation.duration) {
    addWeaponToInventory(pickupAnimation.weapon);
    pickupAnimation = null;
  }
}

function getPickupProgress() {
  if (!pickupAnimation) return 0;
  return clamp(pickupAnimation.elapsed / pickupAnimation.duration, 0, 1);
}

function addGroundWeapon(vertices, weapon) {
  if (weaponModels[weapon.kind]) return;

  if (weapon.kind === "akm") {
    addAkmWeaponGround(vertices, weapon);
    return;
  }

  if (weapon.kind === "m4") {
    addM4WeaponGround(vertices, weapon);
    return;
  }

  addAugWeaponGround(vertices, weapon);
}

function addAugWeaponGround(vertices, weapon) {
  const [x, , z] = weapon.position;
  const y = 0.26;
  const direction = weapon.heading;
  const dark = [0.05, 0.06, 0.055];
  const receiver = [0.18, 0.22, 0.16];
  const tan = [0.45, 0.39, 0.24];
  const metal = [0.1, 0.11, 0.1];
  const accent = [0.75, 0.62, 0.26];
  const sx = (offset) => x + offset * direction;

  addBox(vertices, [sx(0), y + 0.18, z], [0.78, 0.18, 0.16], receiver);
  addBox(vertices, [sx(-0.36), y + 0.13, z], [0.28, 0.2, 0.18], tan);
  addBox(vertices, [sx(0.5), y + 0.18, z], [0.34, 0.11, 0.11], metal);
  addBox(vertices, [sx(0.79), y + 0.18, z], [0.42, 0.055, 0.055], metal);
  addBox(vertices, [sx(1.04), y + 0.18, z], [0.12, 0.075, 0.075], dark);
  addBox(vertices, [sx(0.02), y + 0.34, z], [0.5, 0.06, 0.12], dark);
  addBox(vertices, [sx(0.02), y + 0.42, z], [0.34, 0.08, 0.1], metal);
  addBox(vertices, [sx(0.12), y + 0.02, z], [0.18, 0.28, 0.11], tan);
  addBox(vertices, [sx(0.34), y + 0.02, z], [0.08, 0.24, 0.08], dark);
  addBox(vertices, [sx(-0.1), y + 0.03, z], [0.24, 0.035, 0.08], accent);
}

function addAkmWeaponGround(vertices, weapon) {
  const [x, , z] = weapon.position;
  const y = 0.26;
  const direction = weapon.heading;
  const wood = [0.42, 0.28, 0.16];
  const receiver = [0.16, 0.2, 0.14];
  const metal = [0.1, 0.11, 0.1];
  const dark = [0.05, 0.06, 0.055];
  const sx = (offset) => x + offset * direction;

  addBox(vertices, [sx(-0.42), y + 0.16, z], [0.34, 0.16, 0.14], wood);
  addBox(vertices, [sx(-0.08), y + 0.18, z], [0.42, 0.16, 0.15], receiver);
  addBox(vertices, [sx(0.34), y + 0.18, z], [0.36, 0.1, 0.1], metal);
  addBox(vertices, [sx(0.62), y + 0.18, z], [0.4, 0.05, 0.05], metal);
  addBox(vertices, [sx(0.86), y + 0.18, z], [0.1, 0.07, 0.07], dark);
  addBox(vertices, [sx(0.02), y + 0.02, z], [0.12, 0.22, 0.1], wood);
  addBox(vertices, [sx(0.08), y - 0.02, z + 0.04 * direction], [0.1, 0.18, 0.08], metal);
}

function addM4WeaponGround(vertices, weapon) {
  const [x, , z] = weapon.position;
  const y = 0.26;
  const direction = weapon.heading;
  const polymer = [0.18, 0.22, 0.16];
  const metal = [0.1, 0.11, 0.1];
  const dark = [0.05, 0.06, 0.055];
  const sx = (offset) => x + offset * direction;

  addBox(vertices, [sx(-0.28), y + 0.15, z], [0.24, 0.14, 0.12], polymer);
  addBox(vertices, [sx(-0.02), y + 0.17, z], [0.34, 0.14, 0.13], polymer);
  addBox(vertices, [sx(0.28), y + 0.17, z], [0.28, 0.09, 0.09], metal);
  addBox(vertices, [sx(0.5), y + 0.17, z], [0.3, 0.045, 0.045], metal);
  addBox(vertices, [sx(0.68), y + 0.17, z], [0.08, 0.06, 0.06], dark);
  addBox(vertices, [sx(0.1), y + 0.02, z], [0.1, 0.2, 0.09], polymer);
  addBox(vertices, [sx(0.02), y + 0.28, z], [0.22, 0.05, 0.08], dark);
}

function addPickupBody(vertices, lookDirection, cameraPosition, progress) {
  if (progress <= 0) return;

  const basis = makeViewBasis(lookDirection, cameraPosition);
  const amount = Math.sin(progress * Math.PI);
  const fabric = [0.04, 0.055, 0.05];
  const boot = [0.025, 0.03, 0.028];
  const pad = [0.11, 0.13, 0.11];

  addBeveledViewBox(vertices, basis, [-0.42, -1.15 + amount * 0.1, 0.75], [0.22, 0.14, 0.42], fabric);
  addBeveledViewBox(vertices, basis, [0.42, -1.15 + amount * 0.1, 0.75], [0.22, 0.14, 0.42], fabric);
  addBeveledViewBox(vertices, basis, [-0.43, -1.04 + amount * 0.08, 0.98], [0.18, 0.045, 0.16], pad);
  addBeveledViewBox(vertices, basis, [0.43, -1.04 + amount * 0.08, 0.98], [0.18, 0.045, 0.16], pad);
  addBeveledViewBox(vertices, basis, [-0.36, -1.28 + amount * 0.07, 1.18], [0.24, 0.12, 0.2], boot);
  addBeveledViewBox(vertices, basis, [0.36, -1.28 + amount * 0.07, 1.18], [0.24, 0.12, 0.2], boot);
}

function addHeldWeapon(vertices, lookDirection, cameraPosition, pickupProgress, weapon) {
  if (!weapon && !pickupAnimation && !dropAnimation) return;

  const activeWeapon = getActiveViewWeapon();
  if (!activeWeapon) return;

  if (weaponModels[activeWeapon.kind]) {
    const basis = makeViewBasis(getViewmodelLook(), cameraPosition);
    const holdProgress = getHoldBlend();
    const hold = getViewWeaponHold(activeWeapon.kind);
    if (muzzleFlash > 0 && holdProgress > 0.7) {
      const muzzle = transformViewPoint(hold.position, hold.euler, hold.scale, [0, 0.035, WEAPON_DEFS[activeWeapon.kind].barrelZ]);
      addViewBox(vertices, basis, muzzle, [0.07, 0.07, 0.1], [1, 0.92, 0.55]);
    }
    return;
  }

  if (activeWeapon.kind === "akm") {
    addHeldAkmWeapon(vertices, lookDirection, cameraPosition, pickupProgress);
    return;
  }

  if (activeWeapon.kind === "m4") {
    addHeldM4Weapon(vertices, lookDirection, cameraPosition, pickupProgress);
    return;
  }

  addHeldAugWeapon(vertices, lookDirection, cameraPosition, pickupProgress);
}

function addHeldAugWeapon(vertices, lookDirection, cameraPosition, pickupProgress) {
  if (!getEquippedWeapon() && !pickupAnimation) return;

  const basis = makeViewBasis(lookDirection, cameraPosition);
  const holdProgress = pickupAnimation ? easeInOut(Math.max(0, pickupProgress - 0.35) / 0.65) : 1;
  const { bob, sway, ads } = getHeldSway(holdProgress);
  const [baseX, baseY, baseZ] = offsetForAds(0.22 + sway, -0.86 + holdProgress * 0.4 + bob, 1.28 - holdProgress * 0.4, ads);
  const dark = [0.06, 0.07, 0.064];
  const receiver = [0.24, 0.31, 0.22];
  const polymer = [0.34, 0.37, 0.26];
  const metal = [0.14, 0.15, 0.14];
  const sight = [0.04, 0.045, 0.04];

  addViewBox(vertices, basis, [baseX, baseY, baseZ], [0.34, 0.2, 0.9], receiver);
  addViewBox(vertices, basis, [baseX + 0.06, baseY - 0.04, baseZ - 0.36], [0.32, 0.24, 0.32], polymer);
  addViewBox(vertices, basis, [baseX, baseY + 0.01, baseZ + 0.5], [0.13, 0.1, 0.36], metal);
  addViewBox(vertices, basis, [baseX, baseY + 0.01, baseZ + 0.82], [0.06, 0.05, 0.5], metal);
  addViewBox(vertices, basis, [baseX, baseY + 0.01, baseZ + 1.05], [0.065, 0.06, 0.12], dark);
  addViewBox(vertices, basis, [baseX, baseY + 0.17, baseZ + 0.02], [0.16, 0.05, 0.5], sight);
  addViewBox(vertices, basis, [baseX, baseY + 0.26, baseZ + 0.08], [0.13, 0.075, 0.32], sight);
  addViewBox(vertices, basis, [baseX + 0.1, baseY - 0.22, baseZ - 0.05], [0.12, 0.28, 0.16], polymer);
  addViewBox(vertices, basis, [baseX + 0.11, baseY - 0.24, baseZ + 0.15], [0.085, 0.22, 0.08], dark);
  addBeveledViewBox(vertices, basis, [baseX - 0.24, baseY - 0.12, baseZ + 0.34], [0.2, 0.09, 0.28], polymer);
  addMuzzleFlash(vertices, basis, baseX, baseY, baseZ, WEAPON_DEFS.aug.barrelZ);
}

function addHeldAkmWeapon(vertices, lookDirection, cameraPosition, pickupProgress) {
  const basis = makeViewBasis(lookDirection, cameraPosition);
  const holdProgress = pickupAnimation ? easeInOut(Math.max(0, pickupProgress - 0.35) / 0.65) : 1;
  const { bob, sway, ads } = getHeldSway(holdProgress);
  const [baseX, baseY, baseZ] = offsetForAds(0.2 + sway, -0.88 + holdProgress * 0.38 + bob, 1.26 - holdProgress * 0.38, ads);
  const wood = [0.42, 0.28, 0.16];
  const receiver = [0.2, 0.24, 0.18];
  const metal = [0.14, 0.15, 0.14];
  const dark = [0.06, 0.07, 0.064];

  addViewBox(vertices, basis, [baseX - 0.18, baseY, baseZ - 0.28], [0.18, 0.16, 0.34], wood);
  addViewBox(vertices, basis, [baseX, baseY, baseZ], [0.34, 0.18, 0.72], receiver);
  addViewBox(vertices, basis, [baseX, baseY + 0.01, baseZ + 0.46], [0.12, 0.1, 0.34], metal);
  addViewBox(vertices, basis, [baseX, baseY + 0.01, baseZ + 0.74], [0.06, 0.05, 0.46], metal);
  addViewBox(vertices, basis, [baseX + 0.1, baseY - 0.22, baseZ - 0.04], [0.12, 0.28, 0.16], wood);
  addViewBox(vertices, basis, [baseX + 0.12, baseY - 0.24, baseZ + 0.12], [0.085, 0.22, 0.08], dark);
  addBeveledViewBox(vertices, basis, [baseX - 0.22, baseY - 0.12, baseZ + 0.3], [0.18, 0.09, 0.24], wood);
  addMuzzleFlash(vertices, basis, baseX, baseY, baseZ, WEAPON_DEFS.akm.barrelZ);
}

function addHeldM4Weapon(vertices, lookDirection, cameraPosition, pickupProgress) {
  const basis = makeViewBasis(lookDirection, cameraPosition);
  const holdProgress = pickupAnimation ? easeInOut(Math.max(0, pickupProgress - 0.35) / 0.65) : 1;
  const { bob, sway, ads } = getHeldSway(holdProgress);
  const [baseX, baseY, baseZ] = offsetForAds(0.21 + sway, -0.86 + holdProgress * 0.38 + bob, 1.26 - holdProgress * 0.38, ads);
  const polymer = [0.24, 0.28, 0.2];
  const metal = [0.14, 0.15, 0.14];
  const dark = [0.06, 0.07, 0.064];

  addViewBox(vertices, basis, [baseX - 0.08, baseY, baseZ - 0.18], [0.16, 0.14, 0.22], polymer);
  addViewBox(vertices, basis, [baseX, baseY, baseZ], [0.3, 0.17, 0.62], polymer);
  addViewBox(vertices, basis, [baseX, baseY + 0.01, baseZ + 0.38], [0.11, 0.09, 0.28], metal);
  addViewBox(vertices, basis, [baseX, baseY + 0.01, baseZ + 0.58], [0.05, 0.045, 0.32], metal);
  addViewBox(vertices, basis, [baseX, baseY + 0.15, baseZ + 0.02], [0.14, 0.045, 0.34], dark);
  addViewBox(vertices, basis, [baseX + 0.1, baseY - 0.22, baseZ - 0.03], [0.11, 0.26, 0.15], polymer);
  addBeveledViewBox(vertices, basis, [baseX - 0.2, baseY - 0.12, baseZ + 0.28], [0.18, 0.09, 0.22], polymer);
  addMuzzleFlash(vertices, basis, baseX, baseY, baseZ, WEAPON_DEFS.m4.barrelZ);
}

function addBox(vertices, position, size, color) {
  const [cx, cy, cz] = position;
  const [sx, sy, sz] = size.map((value) => value / 2);
  const x0 = cx - sx;
  const x1 = cx + sx;
  const y0 = cy - sy;
  const y1 = cy + sy;
  const z0 = cz - sz;
  const z1 = cz + sz;

  const darker = sunLitColor(color, [0, 0, -1]);
  const lighter = sunLitColor(color, [0, 1, 0]);
  const front = sunLitColor(color, [0, 0, 1]);
  const right = sunLitColor(color, [1, 0, 0]);
  const left = sunLitColor(color, [-1, 0, 0]);
  const bottom = sunLitColor(color, [0, -1, 0]);

  addQuad(vertices, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], front);
  addQuad(vertices, [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], darker);
  addQuad(vertices, [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], lighter);
  addQuad(vertices, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], bottom);
  addQuad(vertices, [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], right);
  addQuad(vertices, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], left);
}

function addFirstPersonHands(vertices, lookDirection, cameraPosition) {
  const skin = [0.9, 0.62, 0.52];
  const palm = [0.13, 0.15, 0.12];
  const glovePad = [0.05, 0.06, 0.055];
  const nail = [1, 0.86, 0.8];
  const basis = makeViewBasis(lookDirection, cameraPosition);

  if (punchAnimation) {
    addPunchHands(vertices, basis, skin, palm, glovePad, nail);
    return;
  }

  const holdBlend = getHoldBlend();
  addHand(vertices, basis, -1, skin, palm, glovePad, nail);
  if (holdBlend < 0.4) {
    addHand(vertices, basis, 1, skin, palm, glovePad, nail);
  }
}

function addIdleArms(vertices, basis, skin, palm, glovePad, nail) {
  const move = player.handSway;
  const sprint = player.isSprinting ? 1 : 0;
  const bob = Math.sin(player.handCycle) * (0.028 + sprint * 0.02) * move;
  const sway = Math.cos(player.handCycle * 0.8) * (0.024 + sprint * 0.014) * move;

  for (const side of [-1, 1]) {
    const x = side * sway;
    addConnectedArm(
      vertices,
      basis,
      {
        shoulder: [side * 0.58 + x, -1.42 + bob, 0.06],
        elbow: [side * 0.78 + x, -1.08 + bob, 0.52],
        wrist: [side * 0.62 + x, -0.74 + bob, 1.02],
        hand: [side * 0.54 + x, -0.64 + bob, 1.2],
      },
      side,
      skin,
      palm,
      glovePad,
      nail,
    );
  }
}

function addPunchHands(vertices, basis, skin, palm, glovePad, nail) {
  const side = punchAnimation.side;
  addConnectedArm(vertices, basis, getPunchJoints(side, true), side, skin, palm, glovePad, nail, "fist");
  addConnectedArm(vertices, basis, getPunchJoints(-side, false), -side, skin, palm, glovePad, nail, "fist");
}

function getPunchReachLimit() {
  const forward = normalize(getLookDirection());
  return Math.max(0.48, sampleClearance(forward, 1.85) - 0.2);
}

function getPunchJoints(side, isStriking) {
  const t = getPunchProgress();
  const wind = t < 0.2 ? easeInOut(t / 0.2) : 1;
  const strike = t < 0.2 ? 0 : t < 0.4 ? easeOutPunch((t - 0.2) / 0.2) : 1;
  const retract = t < 0.4 ? 0 : easeInOut((t - 0.4) / 0.6);
  const punchT = isStriking ? -0.18 * wind + 1.22 * strike * (1 - retract) + 0.08 * retract : 0;
  const push = player.viewmodelPush * 0.7;
  const sidePush = player.viewmodelSidePush;
  const xScale = 1 - push * 0.28 - Math.abs(sidePush) * 0.5;
  const maxZ = getPunchReachLimit();
  const clampZ = (value) => Math.min(value, maxZ);

  if (!isFirstPerson()) {
    if (!isStriking) {
      return {
        shoulder: [side * 0.26, -0.32, 0.1],
        elbow: [side * 0.34, -0.44, 0.2],
        wrist: [side * 0.2, -0.36, 0.34],
        hand: [side * 0.16, -0.3, 0.44],
      };
    }
    return {
      shoulder: [side * 0.26, -0.32, 0.1],
      elbow: [side * (0.3 - punchT * 0.06), -0.4 + punchT * 0.06, 0.18 + punchT * 0.1],
      wrist: [side * (0.16 - punchT * 0.08), -0.3 + punchT * 0.05, clampZ(0.4 + punchT * 0.28)],
      hand: [side * (0.1 - punchT * 0.08), -0.24 + punchT * 0.06, clampZ(0.5 + punchT * 0.34)],
    };
  }

  if (!isStriking) {
    return {
      shoulder: [side * 0.5, -1.38, 0.05],
      elbow: [side * 0.58, -1.02, 0.34],
      wrist: [side * 0.3, -0.64, clampZ(0.56)],
      hand: [side * 0.24, -0.5, clampZ(0.68)],
    };
  }

  return {
    shoulder: [side * 0.56 * xScale - sidePush * 0.18, -1.4, 0.04],
    elbow: [side * (0.86 - punchT * 0.12) * xScale - sidePush * 0.22, -1.14 + punchT * 0.14, clampZ(0.22 + punchT * 0.16 - push * 0.14)],
    wrist: [side * (0.36 - punchT * 0.22) * xScale - sidePush * 0.28, -0.78 + punchT * 0.36, clampZ(0.54 + punchT * 0.48 - push * 0.28)],
    hand: [side * (0.28 - punchT * 0.24) * xScale - sidePush * 0.3, -0.62 + punchT * 0.4, clampZ(0.66 + punchT * 0.58 - push * 0.34)],
  };
}

function addRectangularFist(vertices, basis, wrist, hand, side, skin, palm, glovePad) {
  const worldHand = viewToWorld(basis, hand);
  const worldWrist = viewToWorld(basis, wrist);
  const dx = worldHand[0] - worldWrist[0];
  const dy = worldHand[1] - worldWrist[1];
  const dz = worldHand[2] - worldWrist[2];
  const span = Math.hypot(dx, dy, dz) || 1;
  const forward = [dx / span, dy / span, dz / span];
  const upDot = basis.up[0] * forward[0] + basis.up[1] * forward[1] + basis.up[2] * forward[2];
  let up = [
    basis.up[0] - forward[0] * upDot,
    basis.up[1] - forward[1] * upDot,
    basis.up[2] - forward[2] * upDot,
  ];
  if (Math.hypot(up[0], up[1], up[2]) < 0.2) {
    up = [basis.right[0], basis.right[1], basis.right[2]];
  }
  const upLen = Math.hypot(up[0], up[1], up[2]) || 1;
  up = [up[0] / upLen, up[1] / upLen, up[2] / upLen];
  let right = [
    up[1] * forward[2] - up[2] * forward[1],
    up[2] * forward[0] - up[0] * forward[2],
    up[0] * forward[1] - up[1] * forward[0],
  ];
  const rightLen = Math.hypot(right[0], right[1], right[2]) || 1;
  right = [right[0] / rightLen, right[1] / rightLen, right[2] / rightLen];
  up = [
    forward[1] * right[2] - forward[2] * right[1],
    forward[2] * right[0] - forward[0] * right[2],
    forward[0] * right[1] - forward[1] * right[0],
  ];
  const fistBasis = { origin: worldHand, forward, right, up };

  addBeveledViewBox(vertices, fistBasis, [0, 0.01, 0.02], [0.18, 0.13, 0.22], palm);
  addBeveledViewBox(vertices, fistBasis, [0, 0.045, 0.08], [0.17, 0.06, 0.12], glovePad);
  addBeveledViewBox(vertices, fistBasis, [0, -0.02, 0.07], [0.16, 0.06, 0.1], palm);
  addBeveledViewBox(vertices, fistBasis, [-side * 0.08, 0.0, -0.01], [0.07, 0.08, 0.13], palm);
  addBeveledViewBox(vertices, fistBasis, [-side * 0.06, -0.015, 0.04], [0.05, 0.045, 0.07], skin);
  addBeveledViewBox(vertices, fistBasis, [0, 0.0, -0.08], [0.16, 0.13, 0.14], palm);
}

function easeOutPunch(value) {
  const t = clamp(value, 0, 1);
  return 1 - (1 - t) * (1 - t);
}

function addWeaponGripPose(vertices, basis, skin, palm, glovePad, nail) {
  const walkAmount = player.handSway;
  const bob = Math.sin(player.handCycle) * 0.016 * walkAmount;
  const sway = Math.cos(player.handCycle * 0.8) * 0.014 * walkAmount;

  addConnectedArm(
    vertices,
    basis,
    {
      shoulder: [-0.68 + sway, -1.44 + bob, 0.04],
      elbow: [-0.52 + sway, -1.08 + bob, 0.58],
      wrist: [-0.22 + sway, -0.76 + bob, 1.14],
      hand: [-0.12 + sway, -0.68 + bob, 1.32],
    },
    -1,
    skin,
    palm,
    glovePad,
    nail,
  );

  addConnectedArm(
    vertices,
    basis,
    {
      shoulder: [0.74 + sway, -1.46 + bob, 0.02],
      elbow: [0.58 + sway, -1.12 + bob, 0.46],
      wrist: [0.4 + sway, -0.84 + bob, 0.86],
      hand: [0.34 + sway, -0.74 + bob, 1.04],
    },
    1,
    skin,
    palm,
    glovePad,
    nail,
  );
}

function addConnectedArm(vertices, basis, joints, side, skin, palm, glovePad, nail, handStyle = "grip") {
  const sleeve = [0.16, 0.2, 0.13];
  addArticulatedArm(vertices, basis, joints.shoulder, joints.elbow, joints.wrist, sleeve, joints.hand, palm, handStyle !== "fist");
  if (handStyle === "fist") {
    addRectangularFist(vertices, basis, joints.wrist, joints.hand, side, skin, palm, glovePad);
    return;
  }
  addGripHand(vertices, basis, joints.hand, side, skin, palm, glovePad, nail);
}

function mix3(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function addTacticalGlove(vertices, basis, palm, side, curl, scale = 1, includeThumb = true) {
  const s = scale;
  const skin = [0.9, 0.64, 0.5];
  const glove = [0.24, 0.22, 0.18];
  const p = (x, y, z) => [palm[0] + x * s, palm[1] + y * s, palm[2] + z * s];

  addBeveledViewBox(vertices, basis, p(0, 0.01, 0.04), [0.2 * s, 0.07 * s, 0.24 * s], skin);
  addBeveledViewBox(vertices, basis, p(0, 0.038, 0.02), [0.17 * s, 0.024 * s, 0.14 * s], glove);
  addBeveledViewBox(vertices, basis, p(0, -0.006, -0.06), [0.16 * s, 0.06 * s, 0.14 * s], glove);
  addBeveledViewBox(vertices, basis, p(0, -0.012, -0.12), [0.14 * s, 0.07 * s, 0.08 * s], glove);

  const fingers = [
    { x: -side * 0.062, length: 0.18, width: 0.04 },
    { x: -side * 0.02, length: 0.2, width: 0.044 },
    { x: side * 0.022, length: 0.186, width: 0.042 },
    { x: side * 0.062, length: 0.15, width: 0.036 },
  ];
  for (const finger of fingers) {
    addBoxFinger(vertices, basis, p(finger.x, 0.014, 0.13), finger.length * s, finger.width * s, curl, skin, glove);
  }

  if (includeThumb) {
    addBoxFinger(vertices, basis, p(-side * 0.09, 0.006, 0.02), 0.13 * s, 0.044 * s, curl * 0.65, skin, glove);
  }
}

function addBoxFinger(vertices, basis, origin, length, width, curl, skin, glove) {
  const seg = length / 3;
  for (let index = 0; index < 3; index += 1) {
    const bend = curl * index * 0.042;
    addBeveledViewBox(
      vertices,
      basis,
      [origin[0], origin[1] - bend, origin[2] + (index + 0.5) * seg - bend * 0.15],
      [width * (1 - index * 0.12), width * 1.15, seg * 0.95],
      index === 0 ? glove : skin,
    );
  }
}

function addArticulatedArm(vertices, basis, shoulder, elbow, wrist, sleeve, hand = null, handColor = null, capHand = true) {
  const palmColor = handColor || sleeve;
  addViewBeam(vertices, basis, shoulder, elbow, 0.13, 0.11, sleeve);
  addViewBeam(vertices, basis, elbow, wrist, 0.11, 0.09, sleeve);
  addBeveledViewBox(vertices, basis, shoulder, [0.16, 0.16, 0.16], sleeve);
  addBeveledViewBox(vertices, basis, elbow, [0.14, 0.14, 0.14], sleeve);

  if (hand) {
    addViewBeam(vertices, basis, mix3(elbow, wrist, 0.65), hand, 0.09, 0.1, palmColor);
    addBeveledViewBox(vertices, basis, mix3(wrist, hand, 0.55), [0.16, 0.12, 0.14], palmColor);
  }
}

function addViewBeam(vertices, basis, from, to, thickStart, thickEnd, color) {
  const start = viewToWorld(basis, from);
  const end = viewToWorld(basis, to);
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const dz = end[2] - start[2];
  const span = Math.hypot(dx, dy, dz) || 0.001;
  const forward = [dx / span, dy / span, dz / span];
  let right = cross([0, 1, 0], forward);
  if (Math.hypot(right[0], right[1], right[2]) < 0.001) {
    right = cross([1, 0, 0], forward);
  }
  right = normalize(right);
  const up = normalize(cross(forward, right));
  const darker = color.map((value) => value * 0.72);
  const lighter = color.map((value) => Math.min(value * 1.16, 1));
  const corners = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  const ringAt = (origin, radius) =>
    corners.map(([u, v]) => [
      origin[0] + (right[0] * u + up[0] * v) * radius,
      origin[1] + (right[1] * u + up[1] * v) * radius,
      origin[2] + (right[2] * u + up[2] * v) * radius,
    ]);
  const startRing = ringAt(start, thickStart);
  const endRing = ringAt(end, thickEnd);
  addPolygonFace(vertices, [...startRing].reverse(), darker);
  addPolygonFace(vertices, endRing, lighter);
  for (let index = 0; index < 4; index += 1) {
    const next = (index + 1) % 4;
    addQuad(vertices, startRing[index], startRing[next], endRing[next], endRing[index], index % 2 === 0 ? color : darker);
  }
}

function viewToWorld(basis, point) {
  return [
    basis.origin[0] + basis.right[0] * point[0] + basis.up[0] * point[1] + basis.forward[0] * point[2],
    basis.origin[1] + basis.right[1] * point[0] + basis.up[1] * point[1] + basis.forward[1] * point[2],
    basis.origin[2] + basis.right[2] * point[0] + basis.up[2] * point[1] + basis.forward[2] * point[2],
  ];
}

function addBentArm(vertices, basis, elbow, wrist, hand, palm, glovePad) {
  addBeveledViewBox(vertices, basis, elbow, [0.24, 0.14, 0.38], palm);
  addBeveledViewBox(vertices, basis, wrist, [0.2, 0.12, 0.34], palm);
  addBeveledViewBox(vertices, basis, hand, [0.15, 0.1, 0.18], glovePad);
}

function addGripHand(vertices, basis, center, side, skin, palm, glovePad, nail) {
  addHybridHandPart(vertices, basis, center, [0.22, 0.13, 0.2], [0.26, 0.15, 0.23], palm, palm, 8, 14);
  addBeveledViewBox(vertices, basis, [center[0], center[1] + 0.08, center[2] + 0.02], [0.2, 0.028, 0.12], glovePad);

  for (let index = 0; index < 4; index += 1) {
    const x = center[0] + side * (0.04 + index * 0.035);
    const y = center[1] - 0.03 - index * 0.004;
    const z = center[2] + 0.1 - index * 0.02;
    addBeveledViewBox(vertices, basis, [x, y, z], [0.045, 0.052, 0.14], palm);
    addBeveledViewBox(vertices, basis, [x, y - 0.04, z + 0.07], [0.035, 0.03, 0.04], skin);
  }

  if (side > 0) {
    addBeveledViewBox(vertices, basis, [center[0] - side * 0.12, center[1] + 0.005, center[2] + 0.02], [0.055, 0.06, 0.15], palm);
    addBeveledViewBox(vertices, basis, [center[0] - side * 0.15, center[1] - 0.03, center[2] + 0.09], [0.035, 0.03, 0.04], nail);
  }
}

function addHand(vertices, basis, side, skin, palm, glovePad, nail) {
  const phase = player.handCycle + (side > 0 ? Math.PI : 0);
  const moveAmount = player.handSway;
  const sprintAmount = player.isSprinting ? 1 : 0;
  const idleBreath = (1 - moveAmount) * Math.sin(player.handCycle * 0.8) * 0.014;
  const walkBob = Math.abs(Math.sin(phase)) * (0.035 + sprintAmount * 0.028) * moveAmount;
  const lateralSway = Math.cos(phase) * (0.025 + sprintAmount * 0.018) * moveAmount;
  const forwardSway = Math.sin(phase) * (0.035 + sprintAmount * 0.03) * moveAmount;
  const jumpLag = player.onGround ? 0 : clamp(-player.verticalVelocity * 0.01, -0.08, 0.08);
  const idleSway = {
    x: side * lateralSway,
    y: idleBreath - walkBob + jumpLag,
    z: forwardSway,
  };
  const pickupReach = pickupAnimation ? Math.sin(getPickupProgress() * Math.PI) : dropAnimation ? Math.sin(getHoldBlend() * Math.PI) * 0.35 : 0;
  const holdBlend = getHoldBlend();
  const { bob, sway: gunSway, ads } = getHeldSway(holdBlend);
  const viewWeapon = getActiveViewWeapon();
  const adsShift = viewWeapon ? getAdsShift(viewWeapon.kind, holdBlend, bob, gunSway) : [0, 0, 0];
  const dip = getSwitchDip();
  const push = player.viewmodelPush;
  const sidePush = player.viewmodelSidePush;
  const xScale = 1 - push * 0.22 - Math.abs(sidePush) * 0.62;
  const idlePlace = (center) => [
    center[0] * xScale + idleSway.x + dip * side * 0.08 - sidePush * 0.52,
    center[1] + idleSway.y - pickupReach * 0.18 - dip * 0.55 - push * 0.1,
    center[2] + idleSway.z + pickupReach * 0.22 - dip * 0.22 - push * 0.38 - Math.abs(sidePush) * 0.38,
  ];
  const holdPlace = (center) => {
    const posed = offsetForAds(center[0] + gunSway, center[1] + bob, center[2], ads * holdBlend);
    return [posed[0] + adsShift[0], posed[1] + adsShift[1], posed[2] + adsShift[2]];
  };
  const place = (center) => mix3(idlePlace(center), holdPlace(center), holdBlend);

  const idlePalm = [side * 0.4, -0.41, 0.6];
  const riflePalm = side > 0 ? [0.28, -0.34, 0.54] : [0.02, -0.3, 0.78];
  const palmLocal = mix3(idlePalm, riflePalm, holdBlend);
  let palmShift = [0, 0, 0];
  if (viewWeapon && holdBlend > 0.02) {
    const targetPalm = getWeaponContact(viewWeapon.kind, holdBlend, bob, gunSway, ads, side);
    const placedPalm = place(palmLocal);
    palmShift = [
      (targetPalm[0] - placedPalm[0]) * holdBlend,
      (targetPalm[1] - placedPalm[1]) * holdBlend,
      (targetPalm[2] - placedPalm[2]) * holdBlend,
    ];
  }
  const worldPalm = [
    place(palmLocal)[0] + palmShift[0],
    place(palmLocal)[1] + palmShift[1],
    place(palmLocal)[2] + palmShift[2],
  ];

  addTacticalGlove(vertices, basis, worldPalm, side, 0.16 + holdBlend * 0.9, 0.7, !(side < 0 && holdBlend > 0.35));
}

function addFinger(vertices, basis, place, side, finger, flex, skin, palm, glovePad, nail) {
  const segmentLength = finger.length / 3;

  addHybridHandPart(
    vertices,
    basis,
    place([side * finger.x, finger.y, finger.z - 0.015]),
    [finger.width * 1.42, 0.032, 0.07],
    [finger.width * 1.55, 0.039, 0.078],
    palm,
    palm,
    6,
    12,
  );

  for (let segment = 0; segment < 3; segment += 1) {
    const progress = segment + 0.5;
    const bend = segment === 0 ? 0 : flex * (progress - 0.65);
    const center = [
      side * finger.x,
      finger.y - bend * 0.055,
      finger.z + segmentLength * progress - bend * 0.045 - (segment === 0 ? 0.012 : 0),
    ];
    const width = finger.width * (1 - segment * 0.12);
    addHybridHandPart(
      vertices,
      basis,
      place(center),
      [width, 0.04, segmentLength * (segment === 0 ? 1.15 : 0.92)],
      [width * 1.18, 0.046, segmentLength * (segment === 0 ? 1.25 : 1.02)],
      palm,
      segment === 2 ? skin : palm,
      8,
      14,
    );
  }

  addBeveledViewBox(
    vertices,
    basis,
    place([side * finger.x, finger.y + 0.044 - flex * 0.035, finger.z + finger.length * 0.38 - flex * 0.03]),
    [finger.width * 0.95, 0.022, 0.055],
    glovePad,
  );

  addBeveledViewBox(
    vertices,
    basis,
    place([
      side * finger.x,
      finger.y + 0.006 - flex * 0.16,
      finger.z + finger.length * 0.96 - flex * 0.13,
    ]),
    [finger.width * 0.68, 0.032, 0.04],
    nail,
  );
}

function addThumb(vertices, basis, place, side, flex, skin, palm, glovePad, nail, scale = 1) {
  const base = [side * 1.23, -0.82, 1.2];
  const thumbSegments = [
    [base[0], base[1] - flex * 0.02, base[2] + 0.06],
    [side * 1.29, base[1] + 0.015 - flex * 0.06, base[2] + 0.16 - flex * 0.04],
  ];

  addHybridHandPart(vertices, basis, place(thumbSegments[0]), [0.075 * scale, 0.08 * scale, 0.14 * scale], [0.09 * scale, 0.09 * scale, 0.16 * scale], palm, palm, 8, 14);
  addHybridHandPart(vertices, basis, place(thumbSegments[1]), [0.06 * scale, 0.065 * scale, 0.12 * scale], [0.075 * scale, 0.075 * scale, 0.14 * scale], palm, skin, 8, 14);
  addBeveledViewBox(vertices, basis, place([side * 1.27, base[1] + 0.04 - flex * 0.05, base[2] + 0.1]), [0.055 * scale, 0.02 * scale, 0.06 * scale], glovePad);
  addBeveledViewBox(
    vertices,
    basis,
    place([side * 1.32, base[1] + 0.032 - flex * 0.09, base[2] + 0.23 - flex * 0.06]),
    [0.047 * scale, 0.034 * scale, 0.04 * scale],
    nail,
  );
}

function addBentLeftForearm(vertices, basis, place, palm, glovePad) {
  addBeveledViewBox(vertices, basis, place([-0.72, -0.98, 0.9]), [0.18, 0.12, 0.34], palm);
  addBeveledViewBox(vertices, basis, place([-0.58, -0.9, 1.05]), [0.16, 0.11, 0.32], palm);
  addBeveledViewBox(vertices, basis, place([-0.46, -0.83, 1.18]), [0.12, 0.095, 0.18], glovePad);
}

function getViewRight() {
  return [-Math.cos(player.yaw), 0, Math.sin(player.yaw)];
}

function makeViewBasis(lookDirection, origin) {
  const forward = normalize([...lookDirection]);
  const right = getViewRight();
  const up = normalize(cross(right, forward));

  return { origin, forward, right, up };
}

function mixBasis(a, b, t) {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const forward = normalize(mix3(a.forward, b.forward, t));
  const upHint = mix3(a.up, b.up, t);
  const rightHint = mix3(a.right, b.right, t);
  let right = cross(forward, upHint);
  if (Math.hypot(right[0], right[1], right[2]) < 0.001) {
    right = rightHint;
  }
  right = normalize(right);
  if (right[0] * rightHint[0] + right[1] * rightHint[1] + right[2] * rightHint[2] < 0) {
    right = [-right[0], -right[1], -right[2]];
  }
  const up = normalize(cross(right, forward));
  return { origin: a.origin, forward, right, up };
}

function makeHandBasis(basis, side, swayTwist, inwardScale = 1) {
  const inward = -side * (0.26 * inwardScale + swayTwist);
  const forward = normalize([
    basis.forward[0] + basis.right[0] * inward - basis.up[0] * 0.12,
    basis.forward[1] + basis.right[1] * inward - basis.up[1] * 0.12,
    basis.forward[2] + basis.right[2] * inward - basis.up[2] * 0.12,
  ]);
  let right = cross(forward, basis.up);
  if (Math.hypot(right[0], right[1], right[2]) < 0.001) {
    right = [...basis.right];
  }
  right = normalize(right);
  if (right[0] * basis.right[0] + right[1] * basis.right[1] + right[2] * basis.right[2] < 0) {
    right = [-right[0], -right[1], -right[2]];
  }
  const up = normalize(cross(right, forward));

  return { origin: basis.origin, forward, right, up };
}

function addViewBox(vertices, basis, center, size, color) {
  const [cx, cy, cz] = center;
  const [sx, sy, sz] = size.map((value) => value / 2);
  const x0 = cx - sx;
  const x1 = cx + sx;
  const y0 = cy - sy;
  const y1 = cy + sy;
  const z0 = cz - sz;
  const z1 = cz + sz;

  const darker = color.map((value) => value * 0.72);
  const lighter = color.map((value) => Math.min(value * 1.18, 1));
  const point = (x, y, z) => toWorldPoint(basis, x, y, z);

  addQuad(vertices, point(x0, y0, z1), point(x1, y0, z1), point(x1, y1, z1), point(x0, y1, z1), color);
  addQuad(vertices, point(x1, y0, z0), point(x0, y0, z0), point(x0, y1, z0), point(x1, y1, z0), darker);
  addQuad(vertices, point(x0, y1, z1), point(x1, y1, z1), point(x1, y1, z0), point(x0, y1, z0), lighter);
  addQuad(vertices, point(x0, y0, z0), point(x1, y0, z0), point(x1, y0, z1), point(x0, y0, z1), darker);
  addQuad(vertices, point(x1, y0, z1), point(x1, y0, z0), point(x1, y1, z0), point(x1, y1, z1), color);
  addQuad(vertices, point(x0, y0, z0), point(x0, y0, z1), point(x0, y1, z1), point(x0, y1, z0), darker);
}

function addBeveledViewBox(vertices, basis, center, size, color) {
  const [cx, cy, cz] = center;
  const [hx, hy, hz] = size.map((value) => value / 2);
  const bevel = Math.min(hx, hy) * 0.42;

  if (bevel <= 0.002) {
    addViewBox(vertices, basis, center, size, color);
    return;
  }

  const profile = [
    [-hx + bevel, -hy],
    [hx - bevel, -hy],
    [hx, -hy + bevel],
    [hx, hy - bevel],
    [hx - bevel, hy],
    [-hx + bevel, hy],
    [-hx, hy - bevel],
    [-hx, -hy + bevel],
  ];
  const point = (x, y, z) => toWorldPoint(basis, cx + x, cy + y, cz + z);
  const front = profile.map(([x, y]) => point(x, y, hz));
  const back = profile.map(([x, y]) => point(x, y, -hz));
  const darker = color.map((value) => value * 0.72);
  const lighter = color.map((value) => Math.min(value * 1.16, 1));

  addPolygonFace(vertices, front, color);
  addPolygonFace(vertices, [...back].reverse(), darker);

  for (let index = 0; index < profile.length; index += 1) {
    const next = (index + 1) % profile.length;
    const shade = index >= 3 && index <= 5 ? lighter : index === 0 || index === 7 ? darker : color;
    addQuad(vertices, front[index], front[next], back[next], back[index], shade);
  }
}

function addHybridHandPart(
  vertices,
  basis,
  center,
  blockSize,
  smoothSize,
  blockColor,
  smoothColor,
  rings = 8,
  segments = 14,
) {
  addBeveledViewBox(vertices, basis, center, blockSize, blockColor);
}

function addPolygonFace(vertices, points, color) {
  for (let index = 1; index < points.length - 1; index += 1) {
    pushVertex(vertices, ...points[0], color);
    pushVertex(vertices, ...points[index], color);
    pushVertex(vertices, ...points[index + 1], color);
  }
}

function toWorldPoint(basis, x, y, z) {
  return [
    basis.origin[0] + basis.right[0] * x + basis.up[0] * y + basis.forward[0] * z,
    basis.origin[1] + basis.right[1] * x + basis.up[1] * y + basis.forward[1] * z,
    basis.origin[2] + basis.right[2] * x + basis.up[2] * y + basis.forward[2] * z,
  ];
}

function addQuad(vertices, a, b, c, d, color) {
  pushVertex(vertices, ...a, color);
  pushVertex(vertices, ...b, color);
  pushVertex(vertices, ...c, color);
  pushVertex(vertices, ...a, color);
  pushVertex(vertices, ...c, color);
  pushVertex(vertices, ...d, color);
}

function pushVertex(vertices, x, y, z, color) {
  vertices.push(x, y, z, color[0], color[1], color[2]);
}

function randomTarget() {
  return [(Math.random() - 0.5) * 70, 0, (Math.random() - 0.5) * 70];
}

function createProgram(vertexSource, fragmentSource) {
  const vertexShader = createShader(gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = createShader(gl.FRAGMENT_SHADER, fragmentSource);
  const shaderProgram = gl.createProgram();

  gl.attachShader(shaderProgram, vertexShader);
  gl.attachShader(shaderProgram, fragmentShader);
  gl.linkProgram(shaderProgram);

  if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(shaderProgram));
  }

  return shaderProgram;
}

function createShader(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader));
  }

  return shader;
}

function perspective(fieldOfView, aspect, near, far) {
  const f = 1 / Math.tan(fieldOfView / 2);
  const rangeInv = 1 / (near - far);

  return new Float32Array([
    f / aspect,
    0,
    0,
    0,
    0,
    f,
    0,
    0,
    0,
    0,
    (near + far) * rangeInv,
    -1,
    0,
    0,
    near * far * rangeInv * 2,
    0,
  ]);
}

function lookAt(eye, targetPoint, up) {
  const zAxis = normalize([
    eye[0] - targetPoint[0],
    eye[1] - targetPoint[1],
    eye[2] - targetPoint[2],
  ]);
  const xAxis = normalize(cross(up, zAxis));
  const yAxis = cross(zAxis, xAxis);

  return new Float32Array([
    xAxis[0],
    yAxis[0],
    zAxis[0],
    0,
    xAxis[1],
    yAxis[1],
    zAxis[1],
    0,
    xAxis[2],
    yAxis[2],
    zAxis[2],
    0,
    -dot(xAxis, eye),
    -dot(yAxis, eye),
    -dot(zAxis, eye),
    1,
  ]);
}

function multiply(a, b) {
  const result = new Float32Array(16);

  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      result[column * 4 + row] =
        a[0 * 4 + row] * b[column * 4 + 0] +
        a[1 * 4 + row] * b[column * 4 + 1] +
        a[2 * 4 + row] * b[column * 4 + 2] +
        a[3 * 4 + row] * b[column * 4 + 3];
    }
  }

  return result;
}

function addTo(a, b) {
  a[0] += b[0];
  a[1] += b[1];
  a[2] += b[2];
}

function subtractFrom(a, b) {
  a[0] -= b[0];
  a[1] -= b[1];
  a[2] -= b[2];
}

function length(vector) {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

function normalize(vector) {
  const vectorLength = length(vector) || 1;
  vector[0] /= vectorLength;
  vector[1] /= vectorLength;
  vector[2] /= vectorLength;
  return vector;
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function easeInOut(value) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}
