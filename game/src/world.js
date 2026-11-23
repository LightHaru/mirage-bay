export const SAVE_KEY = 'mirage-bay-save-v1';

export function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function createWorld() {
  const player = { x: 3, z: 14, heading: 0, health: 100 };
  const coupe = { x: 3, z: 10, heading: 0, color: '#ff4f78', type: 'coupe' };
  const vehicles = [
    coupe,
    { x: -20, z: -18, heading: Math.PI, color: '#71ddd8', type: 'sedan', speed: 7 },
    { x: 19, z: 38, heading: -Math.PI / 2, color: '#f6ca70', type: 'sedan', speed: 6 },
  ];
  const police = [];
  const pedestrians = [];
  for (let i = 0; i < 14; i += 1) {
    pedestrians.push({
      x: i % 2 ? -13 - (i % 4) : 13 + (i % 5),
      z: -48 + i * 7,
      heading: i % 2 ? Math.PI : 0,
      speed: 0.8 + (i % 3) * 0.24,
      hue: i % 3,
    });
  }
  const state = {
    player, vehicles, police, pedestrians, inVehicle: null, stage: 0,
    wanted: 0, wantedHeat: 0, emp: 100, elapsed: 0,
    missionText: 'Meet Sol at Palm Row',
    district: 'Palisade Avenue',
  };

  function reset() {
    player.x = 3; player.z = 14; player.heading = 0;
    coupe.x = 3; coupe.z = 10; coupe.heading = 0;
    police.length = 0;
    Object.assign(state, { inVehicle: null, stage: 0, wanted: 0, wantedHeat: 0, emp: 100,
      missionText: 'Meet Sol at Palm Row', district: 'Palisade Avenue' });
  }

  function save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        px: player.x, pz: player.z, stage: state.stage, wanted: state.wanted,
      }));
    } catch (_) {}
  }

  let lastSave = 0;
  function saveThrottled(now = Date.now()) {
    if (now - lastSave < 1500) return;
    lastSave = now;
    save();
  }

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (!saved) return false;
      player.x = clamp(saved.px || 0, -46, 46);
      player.z = clamp(saved.pz || 18, -78, 78);
      state.stage = clamp(saved.stage || 0, 0, 5);
      state.wanted = clamp(saved.wanted || 0, 0, 5);
      updateMission();
      return true;
    } catch (_) { return false; }
  }

  function updateMission() {
    const missions = [
      'Meet Sol at Palm Row',
      'Find the coral coupe',
      'Take the coupe to Harborlight',
      'Lose the patrol — stay moving',
      'Fire EMP to clear the road',
      'Return to Sol at Palm Row',
    ];
    state.missionText = missions[state.stage];
  }

  function advance() {
    state.stage = Math.min(5, state.stage + 1);
    state.wanted = 0;
    state.wantedHeat = 0;
    updateMission();
    save();
  }

  function collision(x, z) {
    if (x < -48 || x > 48 || z < -88 || z > 88) return true;
    for (const bx of [-38, -20, 20, 38]) {
      for (const bz of [-68, -38, -8, 22, 52]) {
        if (Math.abs(x - bx) < 6 && Math.abs(z - bz) < 7) return true;
      }
    }
    return false;
  }

  return { state, reset, save, saveThrottled, load, advance, updateMission, collision };
}
