/* global THREE */
(function () {
  'use strict';

  const DASH_SPACING = 5;
  const DASH_ROWS = 30;
  const DASH_ROWS_ECO = 14;
  const WHEEL_NAME = /^wheel-(front|back)-(left|right)$/;
  const DOOR_NAME = /^door-(left|right)$/;
  const DOOR_OPEN_RAD = 1.22;
  const AXES = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };

  // The concept car was modeled in Blender for this app: it faces +x and its axles run along z.
  // The Car Kit models by Kenney (CC0, www.kenney.nl) face +z with their axles along x.
  const KENNEY = { yaw: Math.PI / 2, spinAxis: 'x', spinSign: 1 };
  const CAR_TYPES = {
    // "Free Concept Car 011" from Sketchfab (CC0), doors repaired and given scissor hinges in Blender
    concept011: { label: 'Concept 011', file: 'concept-011.glb', length: 4.9, yaw: Math.PI / 2, spinAxis: 'x', spinSign: 1, paint: true, paintMaterial: 'body' },
    concept: { label: 'Concept', file: 'concept-car.glb', length: 4.95, yaw: 0, spinAxis: 'z', spinSign: -1, paint: true },
    small: { label: 'Kleinwagen', file: 'hatchback-sports.glb', length: 4.0, ...KENNEY },
    sedan: { label: 'Limousine', file: 'sedan.glb', length: 4.9, ...KENNEY },
    sport: { label: 'Sportlimousine', file: 'sedan-sports.glb', length: 4.7, ...KENNEY },
    suv: { label: 'SUV', file: 'suv.glb', length: 4.6, ...KENNEY },
    suvLarge: { label: 'SUV groß', file: 'suv-luxury.glb', length: 5.0, ...KENNEY },
    van: { label: 'Van', file: 'van.glb', length: 5.1, ...KENNEY },
  };
  window.CAR_TYPES = CAR_TYPES;

  // linear colours, matching the Blender material values
  const PAINT_COLORS = {
    silver: { label: 'Silber', color: 0xc7ccd6 },
    white: { label: 'Perlweiß', color: 0xf0f0ee },
    black: { label: 'Schwarz', color: 0x0e0f11 },
    blue: { label: 'Tiefblau', color: 0x0d2a7a },
    red: { label: 'Rot', color: 0x8c0a12 },
  };
  window.PAINT_COLORS = PAINT_COLORS;

  function toStandard(physical) {
    const standard = new THREE.MeshStandardMaterial();
    THREE.MeshStandardMaterial.prototype.copy.call(standard, physical);
    standard.type = 'MeshStandardMaterial';
    standard.defines = { STANDARD: '' };
    return standard;
  }

  /**
   * Soft dark ellipse under the car, cheaper than real shadow maps on the T-Box GPU.
   */
  function createGroundShadow() {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(0,0,0,0.75)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.02;
    return mesh;
  }

  // eco trades sharpness for GPU time: no MSAA (fixed at creation), a smaller render buffer that the
  // browser scales up, and only the nearby dashes
  window.createCarScene = function (canvas, options) {
    const eco = Boolean(options && options.eco);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: !eco, alpha: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(eco ? 0.65 : 1);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x1d1e23, 20, 60);

    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x303038, 1.0));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(-4, 8, 5);
    scene.add(sun);

    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400),
      new THREE.MeshStandardMaterial({ color: 0x1d1e23, roughness: 1 }),
    );
    road.rotation.x = -Math.PI / 2;
    scene.add(road);

    const lineMat = new THREE.MeshBasicMaterial({ color: 0x8e8f97 });
    const dashGeo = new THREE.BoxGeometry(2, 0.01, 0.1);
    const dashes = [];
    for (let i = 0; i < (eco ? DASH_ROWS_ECO : DASH_ROWS); i++) {
      [-1.9, 1.9].forEach((z) => {
        const dash = new THREE.Mesh(dashGeo, lineMat);
        dash.position.set(0, 0.01, z);
        dash.userData.baseX = -20 + i * DASH_SPACING;
        scene.add(dash);
        dashes.push(dash);
      });
    }
    [-5.7, 5.7].forEach((z) => {
      const edge = new THREE.Mesh(new THREE.BoxGeometry(400, 0.01, 0.1), lineMat);
      edge.position.set(0, 0.01, z);
      scene.add(edge);
    });

    const shadow = createGroundShadow();
    scene.add(shadow);

    // Studio HDRI (Poly Haven, CC0) for reflections. It is not set as scene.environment, because
    // sampling it costs a lot per pixel on the T-Box GPU: only reflective materials get it, the
    // road, tyres, plastics and interior are lit by the lights alone.
    let envMap = null;
    const pmrem = new THREE.PMREMGenerator(renderer);
    new THREE.RGBELoader().load('env/studio.hdr', (hdr) => {
      envMap = pmrem.fromEquirectangular(hdr).texture;
      hdr.dispose();
      pmrem.dispose();
      if (car) {
        applyEnvMap(car.group);
      }
      dirty = true;
    });

    function isReflective(material) {
      return material.metalness >= 0.3 || material.transparent || /paint|body|glass|chrome|rim|light|spoke/i.test(material.name);
    }

    function applyEnvMap(root) {
      root.traverse((node) => {
        if (node.isMesh && isReflective(node.material) && node.material.envMap !== envMap) {
          node.material.envMap = envMap;
          node.material.needsUpdate = true;
        }
      });
    }

    const loader = new THREE.GLTFLoader();
    loader.setMeshoptDecoder(window.MeshoptDecoder);
    const sources = {};
    let car = null;
    let loadToken = 0;

    function loadSource(file) {
      if (!sources[file]) {
        sources[file] = new Promise((resolve, reject) => {
          loader.load(`models/${file}`, (gltf) => resolve(gltf.scene), undefined, reject);
        });
      }
      return sources[file];
    }

    /**
     * Swaps the displayed car. The Kenney models face +z, the scene drives along +x.
     */
    function setType(key) {
      const type = CAR_TYPES[key] || CAR_TYPES.sedan;
      const token = ++loadToken;
      return loadSource(type.file).then((source) => {
        if (token !== loadToken) {
          return;
        }
        const model = source.clone(true);
        const raw = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
        model.scale.setScalar(type.length / Math.max(raw.x, raw.z));
        model.rotation.y = type.yaw;

        // Clearcoat and specular turn materials into MeshPhysicalMaterial, whose shader is too
        // expensive for the T-Box GPU on a detailed model, so everything renders as standard PBR.
        // The paint gets its own material so recolouring never touches the cached model.
        const paint = [];
        model.traverse((node) => {
          if (!node.isMesh) {
            return;
          }
          if (node.material.isMeshPhysicalMaterial) {
            node.material = toStandard(node.material);
          } else if (node.material.name === (type.paintMaterial || 'paint')) {
            node.material = node.material.clone();
          }
          if (node.material.name === (type.paintMaterial || 'paint')) {
            paint.push(node.material);
          }
        });

        applyEnvMap(model);

        const group = new THREE.Group();
        group.add(model);
        group.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        model.position.set(-center.x, -box.min.y, -center.z);

        // spin and swing are applied on top of each node's own rest rotation
        const wheels = [];
        const doors = [];
        model.traverse((node) => {
          if (WHEEL_NAME.test(node.name)) {
            node.userData.rest = node.quaternion.clone();
            wheels.push(node);
          } else if (DOOR_NAME.test(node.name)) {
            node.userData.rest = node.quaternion.clone();
            doors.push(node);
          }
        });
        let radius = 0.35;
        if (wheels.length) {
          group.updateMatrixWorld(true);
          radius = new THREE.Box3().setFromObject(wheels[0]).getSize(new THREE.Vector3()).y / 2;
        }

        const size = box.getSize(new THREE.Vector3());
        shadow.scale.set(size.x * 1.25, size.z * 1.6, 1);

        if (car) {
          scene.remove(car.group);
        }
        car = { group, wheels, doors, radius, type, paint, angle: 0, door: 0 };
        setPaint(paintKey);
        scene.add(group);
        dirty = true;
      });
    }

    let paintKey = 'silver';

    function setPaint(key) {
      paintKey = PAINT_COLORS[key] ? key : 'silver';
      if (car) {
        car.paint.forEach((material) => material.color.setHex(PAINT_COLORS[paintKey].color));
      }
      dirty = true;
    }

    const parkedPos = new THREE.Vector3();
    const drivePos = new THREE.Vector3(-11.5, 5.2, 0);
    const parkedTarget = new THREE.Vector3(0, 1.5, 0);
    const driveTarget = new THREE.Vector3(6, 0.2, 0);
    const camTarget = new THREE.Vector3();

    const spin = new THREE.Quaternion();
    let roadOffset = 0;
    let orbitAngle = 0.6;
    let driveBlend = 0;
    // the scene is static unless something moves, so frames are only drawn when this is set
    let dirty = true;

    function resize() {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const ratio = renderer.getPixelRatio();
      if (canvas.width !== Math.floor(w * ratio) || canvas.height !== Math.floor(h * ratio)) {
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        dirty = true;
      }
    }

    // handle for live profiling through chrome://inspect
    window.__car3d = { renderer, scene, camera, getCar: () => car };

    return {
      setType,
      setPaint,
      hasDoors() {
        return Boolean(car && car.doors.length);
      },
      render(dt, state) {
        resize();
        const doorTarget = state.doorsOpen ? 1 : 0;
        const settled = Math.abs((state.speed > 2 && !state.orbit ? 1 : 0) - driveBlend) < 0.002;
        const animating = state.speed > 0.1 || state.orbit || !settled || (car && car.door !== doorTarget);
        if (!dirty && !animating) {
          return;
        }
        dirty = false;
        const distance = (state.speed / 3.6) * dt;
        const moving = state.speed > 2 && !state.orbit;

        roadOffset = (roadOffset + distance) % DASH_SPACING;
        dashes.forEach((dash) => {
          dash.position.x = dash.userData.baseX - roadOffset;
        });

        if (car) {
          car.angle += distance / car.radius;
          spin.setFromAxisAngle(AXES[car.type.spinAxis], car.angle * car.type.spinSign);
          car.wheels.forEach((wheel) => wheel.quaternion.copy(wheel.userData.rest).multiply(spin));

          const target = state.doorsOpen ? 1 : 0;
          if (car.door !== target) {
            // eased swing, roughly 1.5 s from closed to open
            car.door += Math.sign(target - car.door) * Math.min(Math.abs(target - car.door), dt / 1.5);
            const eased = car.door * car.door * (3 - 2 * car.door);
            spin.setFromAxisAngle(AXES.x, eased * DOOR_OPEN_RAD);
            car.doors.forEach((door) => door.quaternion.copy(door.userData.rest).multiply(spin));
          }
        }

        driveBlend += ((moving ? 1 : 0) - driveBlend) * Math.min(1, dt * 1.5);
        if (state.orbit) {
          orbitAngle += dt * 0.25 * (1 - driveBlend);
        }
        parkedPos.set(Math.cos(orbitAngle) * 10.5, 4.2, Math.sin(orbitAngle) * 10.5);
        camera.position.lerpVectors(parkedPos, drivePos, driveBlend);
        camTarget.lerpVectors(parkedTarget, driveTarget, driveBlend);
        camera.lookAt(camTarget);

        renderer.render(scene, camera);
      },
    };
  };
})();
