
/* eslint-disable */
// @ts-nocheck
// Auditorium 3D scene — lifted verbatim from the design export (How It Works
// Cinematic). Only the DCLogic lifecycle + scroll wiring are adapted; all the
// three.js geometry / textures / camera tick are unchanged. Uses window.THREE
// (set by the React wrapper before instantiation).
export class AuditoriumScene {
  constructor(canvas, scrubEl, onProgress){
    this._canvas = canvas; this._scrubEl = scrubEl; this._onProgress = onProgress;
    this._pTarget = 0; this._pEased = 0;
  }

  onScrollHandler(el) {
    const rect = this._scrubEl && this._scrubEl.getBoundingClientRect();
    let p = 0;
    if (rect) {
      const vh = el.clientHeight;
      const total = rect.height - vh;
      p = Math.max(0, Math.min(1, -rect.top / total));
    }
    this._pTarget = p;
    if (this._onProgress) this._onProgress(p);
  }

  start() {
    this._pTarget = 0;
    // Wait for canvas ref + THREE
    const tryInit = () => {
      if (!this._canvas || !window.THREE) { requestAnimationFrame(tryInit); return; }
      this.initScene();
    };
    tryInit();
  }

  dispose() {
    this._alive = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    if (this._renderer) { this._renderer.dispose(); this._renderer.forceContextLoss && this._renderer.forceContextLoss(); }
  }

  initScene() {
    const THREE = window.THREE;
    const canvas = this._canvas;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const renderer = new THREE.WebGLRenderer({ canvas, antialias:true, alpha:false });
    renderer.setPixelRatio(dpr);
    renderer.setSize(rect.width, rect.height, false);
    renderer.setClearColor(new THREE.Color('#050405'), 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    this._renderer = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x1a1010, 0.014); // warmer + thinner — room reads as a church, not space
    this._scene = scene;
    this._fog = scene.fog;

    const camera = new THREE.PerspectiveCamera(48, rect.width/rect.height, 0.1, 200);
    this._camera = camera;

    // resize
    this._onResize = () => {
      const r = canvas.getBoundingClientRect();
      renderer.setSize(r.width, r.height, false);
      camera.aspect = r.width / r.height;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', this._onResize);

    // ==== LIGHTS — brighter, warmer, saturated brass/amber pops ====
    const ambient = new THREE.AmbientLight(0x4a3222, 1.90);
    scene.add(ambient); this._ambient = ambient;
    const hemi = new THREE.HemisphereLight(0xffe4bc, 0x2a1a12, 1.15);
    scene.add(hemi); this._hemi = hemi;
    const houseLight = new THREE.DirectionalLight(0xffedd0, 1.05);
    houseLight.position.set(0, 14, -4); scene.add(houseLight); this._houseLight = houseLight;
    const stageKey = new THREE.SpotLight(0xffb861, 4.20, 48, Math.PI/6, 0.5, 1.2);
    stageKey.position.set(0, 12, -12);
    stageKey.target.position.set(0, 2, -18);
    scene.add(stageKey); scene.add(stageKey.target); this._stageKey = stageKey;
    const boothFill = new THREE.PointLight(0xffe4bc, 1.80, 22, 2);
    boothFill.position.set(0, 5.8, 7.2); scene.add(boothFill); this._boothFill = boothFill;
    const boothKey = new THREE.DirectionalLight(0xfff2dc, 1.90);
    boothKey.position.set(3, 6, 8); scene.add(boothKey); this._boothKey = boothKey;
    const boothFillL = new THREE.DirectionalLight(0xffe4bc, 1.10);
    boothFillL.position.set(-3, 5, 7); scene.add(boothFillL);

    // pendants (flickering candlelight)
    this._pendants = [];
    for (let i = 0; i < 4; i++) {
      const p = new THREE.PointLight(0xffb861, 1.5, 12, 2);
      p.position.set((i%2?1:-1)*3.2, 6.5, -6 - i*3.5);
      scene.add(p);
      const g = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffb861 }));
      g.position.copy(p.position);
      scene.add(g);
      this._pendants.push({ light: p, mesh: g, base: 1.5, seed: Math.random()*10 });
    }

    // rim light on operator from monitor
    const rim = new THREE.PointLight(0xff7a2c, 0, 6, 2);
    rim.position.set(0, 2.6, 5.5);
    scene.add(rim);
    this._rim = rim;

    // ==== SANCTUARY GEOMETRY ====
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x2a1a12, roughness: 0.85, metalness: 0.05 });
    const darkWoodMat = new THREE.MeshStandardMaterial({ color: 0x1a0f0a, roughness: 0.9 });
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x0a0705, roughness: 0.95 });
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x120a0a, roughness: 1 });
    // Track materials so the MATCH-inverse can recolour the actual sanctuary
    this._recolor = [];
    const recolorable = (mat, lightHex) => { mat.userData.darkHex = mat.color.getHex(); mat.userData.lightHex = lightHex; this._recolor.push(mat); return mat; };
    recolorable(floorMat, 0xd8c8b0);
    recolorable(wallMat,  0xe6d8c0);

    // floor
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 60), floorMat);
    floor.rotation.x = -Math.PI/2;
    floor.position.z = -12;
    scene.add(floor);

    // walls (dark)
    const wallL = new THREE.Mesh(new THREE.PlaneGeometry(60, 20), wallMat);
    wallL.rotation.y = Math.PI/2; wallL.position.set(-14, 8, -12); scene.add(wallL);
    const wallR = wallL.clone(); wallR.rotation.y = -Math.PI/2; wallR.position.x = 14; scene.add(wallR);
    const wallBack = new THREE.Mesh(new THREE.PlaneGeometry(28, 20), wallMat);
    wallBack.position.set(0, 8, -28); scene.add(wallBack);

    // ==== WHITE CURTAIN backdrop across the whole back wall ====
    const curtainCvs = document.createElement('canvas'); curtainCvs.width = 1024; curtainCvs.height = 720;
    const cg = curtainCvs.getContext('2d');
    // base off-white gradient
    const cbg = cg.createLinearGradient(0, 0, 0, 720);
    cbg.addColorStop(0, '#f4ebd8'); cbg.addColorStop(1, '#d8ccb4');
    cg.fillStyle = cbg; cg.fillRect(0, 0, 1024, 720);
    // vertical folds
    for (let i = 0; i < 26; i++) {
      const x = i * (1024 / 26);
      const grad = cg.createLinearGradient(x, 0, x + 1024/26, 0);
      grad.addColorStop(0.0, 'rgba(60,40,25,0.20)');
      grad.addColorStop(0.5, 'rgba(255,240,220,0.15)');
      grad.addColorStop(1.0, 'rgba(60,40,25,0.20)');
      cg.fillStyle = grad; cg.fillRect(x, 0, 1024/26, 720);
    }
    // top valance ripple
    cg.fillStyle = 'rgba(60,40,25,0.25)';
    for (let i = 0; i < 40; i++) {
      const x = i * (1024/40); cg.beginPath(); cg.moveTo(x, 0); cg.lineTo(x + 12, 24); cg.lineTo(x + 24, 0); cg.closePath(); cg.fill();
    }
    const curtainTex = new THREE.CanvasTexture(curtainCvs); curtainTex.colorSpace = THREE.SRGBColorSpace;
    const curtain = new THREE.Mesh(new THREE.PlaneGeometry(26, 18), new THREE.MeshStandardMaterial({ map: curtainTex, roughness: 0.9 }));
    curtain.position.set(0, 8, -27.85); scene.add(curtain);
    // Curtain rod
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 26.4, 20), new THREE.MeshStandardMaterial({ color: 0xC6912F, roughness: 0.3, metalness: 0.85 }));
    rod.rotation.z = Math.PI / 2; rod.position.set(0, 17.1, -27.75); scene.add(rod);

    // ==== WALL SIGN — engraved caption plate on the LEFT wall, under the windows ====
    const wsCvs = document.createElement('canvas'); wsCvs.width = 1024; wsCvs.height = 400;
    const ws = wsCvs.getContext('2d');
    ws.clearRect(0, 0, 1024, 400);
    // engraved brass plaque background
    const wsBg = ws.createLinearGradient(0, 0, 0, 400);
    wsBg.addColorStop(0, 'rgba(198,145,47,0.28)'); wsBg.addColorStop(1, 'rgba(70,44,18,0.20)');
    ws.fillStyle = wsBg; ws.fillRect(0, 0, 1024, 400);
    // hairline border
    ws.strokeStyle = 'rgba(255,184,97,0.55)'; ws.lineWidth = 3;
    ws.strokeRect(14, 14, 996, 372);
    this._wallSignCanvas = wsCvs; this._wallSignCtx = ws;
    const wsTex = new THREE.CanvasTexture(wsCvs); wsTex.colorSpace = THREE.SRGBColorSpace;
    this._wallSignTex = wsTex;
    const wallSignL = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 2.1), new THREE.MeshBasicMaterial({ map: wsTex, transparent: true }));
    wallSignL.position.set(-13.65, 4.0, -14);
    wallSignL.rotation.y = Math.PI / 2;
    scene.add(wallSignL);
    this._wallSignL = wallSignL;

    // stage platform
    const stage = new THREE.Mesh(new THREE.BoxGeometry(18, 0.6, 6), woodMat);
    stage.position.set(0, 0.3, -22); scene.add(stage);

    // ==== PULPIT — proper preacher's lectern, centered on stage ====
    const pulpitGrp = new THREE.Group();
    pulpitGrp.position.set(0, 0, -20.2); // centered, on the stage
    scene.add(pulpitGrp);
    // Pedestal column
    const pedestal = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.85, 0.85), woodMat);
    pedestal.position.set(0, 1.55, 0); pulpitGrp.add(pedestal);
    // Wider base foot
    const pedBase = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.12, 1.1), darkWoodMat);
    pedBase.position.set(0, 0.66, 0); pulpitGrp.add(pedBase);
    // Angled book-rest top (tilts back toward preacher)
    const bookRest = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.08, 0.95), woodMat);
    bookRest.position.set(0, 2.55, 0.08); bookRest.rotation.x = -0.35; pulpitGrp.add(bookRest);
    // Lip on the front to keep the Bible in place
    const lip = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.05, 0.05), darkWoodMat);
    lip.position.set(0, 2.42, -0.36); pulpitGrp.add(lip);
    // Open Bible on the rest (two pages, ivory)
    const bibleMat = new THREE.MeshStandardMaterial({ color: 0xf4ebd8, roughness: 0.85 });
    const bibleL = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.75), bibleMat);
    const bibleR = bibleL.clone();
    bibleL.position.set(-0.26, 2.63, 0.10); bibleL.rotation.x = -0.35; pulpitGrp.add(bibleL);
    bibleR.position.set( 0.26, 2.63, 0.10); bibleR.rotation.x = -0.35; pulpitGrp.add(bibleR);
    // Cross carved into the front (thin oxblood)
    const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.55, 0.02), new THREE.MeshStandardMaterial({ color: 0x8F2C10, roughness: 0.7 }));
    crossV.position.set(0, 1.55, -0.43); pulpitGrp.add(crossV);
    const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.08, 0.02), crossV.material);
    crossH.position.set(0, 1.72, -0.43); pulpitGrp.add(crossH);

    // ==== MICROPHONE — real lectern mic on a gooseneck boom ====
    // Base attached to top of pulpit, gooseneck arm swings up and forward,
    // capsule (head) at preacher mouth-height, tilted toward the pulpit position.
    const micStandMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.35, metalness: 0.85 });
    const micBase = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.08, 20), micStandMat);
    micBase.position.set(0, 2.52, -0.22); pulpitGrp.add(micBase);
    // Lower straight shaft
    const micShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.55, 12), micStandMat);
    micShaft.position.set(0, 2.83, -0.22); pulpitGrp.add(micShaft);
    // Gooseneck (curved arm) — approximate with a torus arc segment
    const gooseGeom = new THREE.TorusGeometry(0.22, 0.02, 8, 16, Math.PI * 0.55);
    const goose = new THREE.Mesh(gooseGeom, micStandMat);
    goose.position.set(0, 3.10, -0.22); goose.rotation.z = -Math.PI * 0.5; goose.rotation.y = 0;
    pulpitGrp.add(goose);
    // Angled top arm to capsule
    const micArm = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.28, 12), micStandMat);
    micArm.position.set(0.18, 3.15, -0.08); micArm.rotation.z = -0.9;
    pulpitGrp.add(micArm);
    // Mic capsule (foam windscreen + capsule)
    const micCapsule = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.05, 0.16, 20), micStandMat);
    micCapsule.position.set(0.38, 3.14, 0.02); micCapsule.rotation.z = Math.PI * 0.35;
    pulpitGrp.add(micCapsule);
    // Foam windscreen
    const foam = new THREE.Mesh(new THREE.SphereGeometry(0.075, 18, 14), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.95 }));
    foam.position.set(0.42, 3.18, 0.08); pulpitGrp.add(foam);

    // Mic position (world) for the waveform line + pulse ring
    this._micPos = new THREE.Vector3(0.42, 3.18, -20.12);
    // Mic pulse ring removed — the orange ring was reading as a box.
    this._micRing = null;

    // ==== In-scene labels — small billboarded captions that explain each step ====
    const makeLabel = (text, opts = {}) => {
      const w = opts.w || 512, h = opts.h || 128;
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d');
      g.clearRect(0,0,w,h);
      // brass hairline underline
      if (opts.brassBar) { g.fillStyle = '#C6912F'; g.fillRect(0, h-4, w * (opts.barPct || 0.4), 2); }
      // optional live dot
      if (opts.dot) {
        g.fillStyle = opts.dot;
        g.beginPath(); g.arc(24, h/2, 8, 0, Math.PI*2); g.fill();
      }
      g.font = (opts.weight || '600') + ' ' + (opts.size || 36) + 'px "JetBrains Mono", monospace';
      g.fillStyle = opts.color || '#F4EFE6';
      g.textAlign = 'left'; g.textBaseline = 'middle';
      g.fillText(text, opts.dot ? 44 : 12, h/2 - (opts.brassBar ? 4 : 0));
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(opts.planeW || 3.2, opts.planeH || 0.8), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
      m.material.opacity = 0;
      return m;
    };

    // In-scene floating labels retired — moved into the LEFT-hand HUD instead.
    this._lblListen = this._lblChain = this._lblConnected = this._lblDevice = this._lblMatching = this._lblShow = null;

    // Sonar rings removed — the orange rings were reading as a "box" around the pulpit.
    this._sonarRings = [];

    // ==== PEWS — spread wide across the sanctuary, filled with congregation ====
    const pewMat = new THREE.MeshStandardMaterial({ color: 0x4a2f1e, roughness: 0.85 });
    const pewCushionMat = new THREE.MeshStandardMaterial({ color: 0x7a1e44, roughness: 0.9 });
    recolorable(pewMat,        0xc9a888);
    recolorable(pewCushionMat, 0xd4a2b0);
    const congSkin = new THREE.MeshStandardMaterial({ color: 0x8a5a3a, roughness: 0.85, emissive: 0x1a0a06, emissiveIntensity: 0.2 });
    const congHair = new THREE.MeshStandardMaterial({ color: 0x241610, roughness: 0.95 });
    const congClothesA = new THREE.MeshStandardMaterial({ color: 0x2a2028, roughness: 0.9 });
    const congClothesB = new THREE.MeshStandardMaterial({ color: 0x3a2820, roughness: 0.9 });
    const congClothesC = new THREE.MeshStandardMaterial({ color: 0x5a3020, roughness: 0.9 });
    const congClothesD = new THREE.MeshStandardMaterial({ color: 0x1a2a3a, roughness: 0.9 });
    recolorable(congClothesA, 0xdccbb8);
    recolorable(congClothesB, 0xe4c9a4);
    recolorable(congClothesC, 0xf0d8b8);
    recolorable(congClothesD, 0xc8d4dc);
    const congVariants = [congClothesA, congClothesB, congClothesC, congClothesD];
    for (let side = 0; side < 2; side++) {
      const sx = side === 0 ? -1 : 1;
      for (let row = 0; row < 8; row++) {
        const z = -6 - row * 2.2;
        const pewX = sx * 6.4; // spread out wider than the old 4.2
        // seat
        const seat = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.16, 0.9), pewMat);
        seat.position.set(pewX, 0.85 + row*0.02, z); scene.add(seat);
        // cushion
        const cushion = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.06, 0.8), pewCushionMat);
        cushion.position.set(pewX, 0.96 + row*0.02, z); scene.add(cushion);
        // backrest — lowered so worshippers' upper bodies are visible above it
        const back = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.55, 0.14), pewMat);
        back.position.set(pewX, 1.24 + row*0.02, z + 0.45); scene.add(back);
        // end panels
        const endInner = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.55, 1.15), pewMat);
        endInner.position.set(pewX - sx*2.7, 1.28 + row*0.02, z + 0.05); scene.add(endInner);
        const endOuter = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.55, 1.15), pewMat);
        endOuter.position.set(pewX + sx*2.7, 1.28 + row*0.02, z + 0.05); scene.add(endOuter);

        // 4 congregation figures per pew — proper visible upper bodies, facing the stage
        for (let s = 0; s < 4; s++) {
          const px = pewX + (s - 1.5) * 1.35 + Math.sin(row*3 + s + side*7) * 0.06;
          const jitter = row * 7 + s * 11 + side * 3;
          const clothes = congVariants[jitter % congVariants.length];
          const baseY = 1.05 + row*0.02;
          // torso — visible above backrest (top ~ y 2.05)
          const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.55, 6, 10), clothes);
          torso.position.set(px, baseY + 0.75, z + 0.02);
          torso.rotation.x = -0.05;
          scene.add(torso);
          // shoulders (wider than torso — clearly a body)
          const shL = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 10), clothes);
          shL.position.set(px - 0.34, baseY + 1.10, z + 0.02); shL.scale.set(1, 0.85, 1); scene.add(shL);
          const shR = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 10), clothes);
          shR.position.set(px + 0.34, baseY + 1.10, z + 0.02); shR.scale.set(1, 0.85, 1); scene.add(shR);
          // neck
          const nk = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.14, 10), congSkin);
          nk.position.set(px, baseY + 1.28, z); scene.add(nk);
          // head
          const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), congSkin);
          head.position.set(px, baseY + 1.45, z - 0.02);
          head.scale.set(1, 1.12, 1);
          scene.add(head);
          // hair cap (varies)
          if (jitter % 5 !== 0) {
            const hair = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 12, 0, Math.PI*2, 0, Math.PI*(0.55 + (jitter%3)*0.08)), congHair);
            hair.position.set(px, baseY + 1.47, z - 0.02);
            scene.add(hair);
          }
        }
      }
    }

    // ==== CHURCH DRESSING — cross, windows, signage ====
    // Large wooden cross on the back wall behind the stage
    const crossMat = new THREE.MeshStandardMaterial({ color: 0x5a3820, roughness: 0.8 });
    const bigCrossV = new THREE.Mesh(new THREE.BoxGeometry(0.55, 4.5, 0.25), crossMat);
    bigCrossV.position.set(0, 10.5, -27.7); scene.add(bigCrossV);
    const bigCrossH = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.55, 0.25), crossMat);
    bigCrossH.position.set(0, 11.6, -27.7); scene.add(bigCrossH);
    // Subtle warm glow behind the cross so it silhouettes softly
    const crossGlow = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 6.5), new THREE.MeshBasicMaterial({ color: 0xffb861, transparent: true, opacity: 0.10 }));
    crossGlow.position.set(0, 11.0, -27.85); scene.add(crossGlow);

    // Stained-glass arched windows on both side walls (three per side)
    // Stained-glass — one deterministic texture per window index, reused on both walls
    // so the left and right sides are perfectly symmetrical.
    const glassColors = [0x8F2C10, 0xC6912F, 0x1a5a8a, 0x4a7a3a, 0x8b3e6c];
    const windowTextures = [];
    for (let i = 0; i < 3; i++) {
      const wcvs = document.createElement('canvas'); wcvs.width = 200; wcvs.height = 380;
      const wg = wcvs.getContext('2d');
      wg.fillStyle = '#1a1210'; wg.fillRect(0,0,200,380);
      wg.fillStyle = '#000';
      wg.beginPath();
      wg.moveTo(20, 380); wg.lineTo(20, 90);
      wg.arc(100, 90, 80, Math.PI, 0);
      wg.lineTo(180, 380); wg.closePath(); wg.fill();
      for (let py = 0; py < 6; py++) {
        for (let px = 0; px < 3; px++) {
          wg.fillStyle = '#' + glassColors[(i + py*3 + px) % glassColors.length].toString(16).padStart(6,'0');
          wg.globalAlpha = 0.55 + 0.35 * (((i*7 + py*3 + px*5) % 10) / 10);
          wg.fillRect(30 + px*47, 100 + py*45, 45, 43);
        }
      }
      wg.globalAlpha = 1;
      wg.strokeStyle = '#0a0a0a'; wg.lineWidth = 3;
      for (let py = 0; py < 7; py++) { wg.beginPath(); wg.moveTo(30, 100 + py*45); wg.lineTo(170, 100 + py*45); wg.stroke(); }
      for (let px = 0; px < 4; px++) { wg.beginPath(); wg.moveTo(30 + px*47, 100); wg.lineTo(30 + px*47, 370); wg.stroke(); }
      wg.strokeStyle = '#3a1a10'; wg.lineWidth = 6;
      wg.beginPath(); wg.moveTo(20, 380); wg.lineTo(20, 90); wg.arc(100, 90, 80, Math.PI, 0); wg.lineTo(180, 380); wg.stroke();
      const wtex = new THREE.CanvasTexture(wcvs); wtex.colorSpace = THREE.SRGBColorSpace;
      windowTextures.push(wtex);
    }
    for (let side = 0; side < 2; side++) {
      const sx = side === 0 ? -1 : 1;
      for (let i = 0; i < 3; i++) {
        const wz = -8 - i * 6;
        const wmesh = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 6.4), new THREE.MeshBasicMaterial({ map: windowTextures[i], transparent: true }));
        wmesh.position.set(sx * 13.7, 9.5, wz); wmesh.rotation.y = sx > 0 ? -Math.PI/2 : Math.PI/2;
        scene.add(wmesh);
        const spill = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 6.6), new THREE.MeshBasicMaterial({ color: 0xffb861, transparent: true, opacity: 0.06 }));
        spill.position.set(sx * 13.4, 9.5, wz); spill.rotation.y = sx > 0 ? -Math.PI/2 : Math.PI/2;
        scene.add(spill);
      }
    }

    // Small "SANCTUARY" sign on back wall stage-right
    const signCvs = document.createElement('canvas'); signCvs.width = 512; signCvs.height = 128;
    const sg = signCvs.getContext('2d');
    sg.fillStyle = '#2a1a14'; sg.fillRect(0,0,512,128);
    sg.strokeStyle = '#C6912F'; sg.lineWidth = 4; sg.strokeRect(6,6,500,116);
    sg.fillStyle = '#f4ebd8'; sg.font = '500 42px "Fraunces", serif'; sg.textAlign = 'center';
    sg.fillText('“Write the vision, make it plain.”', 256, 62);
    sg.font = '600 18px "JetBrains Mono", monospace'; sg.fillStyle = '#ffb861';
    sg.fillText('HABAKKUK 2:2', 256, 96);
    const signTex = new THREE.CanvasTexture(signCvs); signTex.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(4, 1), new THREE.MeshBasicMaterial({ map: signTex, transparent: true }));
    sign.position.set(-8.5, 4.5, -27.8); scene.add(sign);

    // Small cross on the other side of the back wall
    const smCrossV = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.2, 0.08), crossMat);
    smCrossV.position.set(8.5, 4.5, -27.8); scene.add(smCrossV);
    const smCrossH = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.15, 0.08), crossMat);
    smCrossH.position.set(8.5, 4.8, -27.8); scene.add(smCrossH);

    // ==== PREACHER — standing stage-right of the pulpit so his full body is visible ====
    const preacher = new THREE.Group();
    preacher.position.set(1.75, 0.60, -20.30); // beside the pulpit — full body in view
    scene.add(preacher);
    const preachSkin  = new THREE.MeshStandardMaterial({ color: 0x8a5a3a, roughness: 0.75, emissive: 0x2a1408, emissiveIntensity: 0.25 });
    const preachSuit  = new THREE.MeshStandardMaterial({ color: 0x1a1218, roughness: 0.85 });
    const preachShirt = new THREE.MeshStandardMaterial({ color: 0xe8e0d0, roughness: 0.9 });
    const preachHair  = new THREE.MeshStandardMaterial({ color: 0x261410, roughness: 0.95 });
    // Legs
    const pLegL = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.85, 6, 10), preachSuit);
    pLegL.position.set(-0.17, 0.50, 0); preacher.add(pLegL);
    const pLegR = pLegL.clone(); pLegR.position.x = 0.17; preacher.add(pLegR);
    // Torso
    const pTorso = new THREE.Mesh(new THREE.CapsuleGeometry(0.36, 0.55, 8, 12), preachSuit);
    pTorso.position.set(0, 1.35, 0); preacher.add(pTorso);
    // (Shirt-V chest panel removed — it read as a stray pale/orange box.)
    // Neck
    const pNeck = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.16, 12), preachSkin);
    pNeck.position.set(0, 1.78, 0); preacher.add(pNeck);
    // Head
    const pHead = new THREE.Mesh(new THREE.SphereGeometry(0.22, 22, 18), preachSkin);
    pHead.position.set(0, 2.02, 0); pHead.scale.set(1, 1.15, 1); preacher.add(pHead);
    // Hair (full)
    const pHair = new THREE.Mesh(new THREE.SphereGeometry(0.235, 22, 18, 0, Math.PI*2, 0, Math.PI*0.75), preachHair);
    pHair.position.set(0, 2.05, 0); preacher.add(pHair);
    // Trimmed beard hint
    const beard = new THREE.Mesh(new THREE.SphereGeometry(0.19, 16, 12, 0, Math.PI*2, Math.PI*0.55, Math.PI*0.45), preachHair);
    beard.position.set(0, 2.0, 0.03); beard.scale.set(1, 0.7, 0.8); preacher.add(beard);
    // Shoulders
    const pShoulderL = new THREE.Mesh(new THREE.SphereGeometry(0.20, 14, 12), preachSuit);
    pShoulderL.position.set(-0.42, 1.60, 0); preacher.add(pShoulderL);
    const pShoulderR = pShoulderL.clone(); pShoulderR.position.x = 0.42; preacher.add(pShoulderR);
    // Left arm — hanging naturally at his side
    const pArmL = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.55, 6, 10), preachSuit);
    pArmL.position.set(-0.45, 1.15, 0.02); pArmL.rotation.z = 0.15; preacher.add(pArmL);
    const pForeL = new THREE.Mesh(new THREE.CapsuleGeometry(0.10, 0.50, 6, 10), preachSuit);
    pForeL.position.set(-0.5, 0.65, 0.10); pForeL.rotation.x = 0.15; preacher.add(pForeL);
    const pHandL = new THREE.Mesh(new THREE.SphereGeometry(0.10, 14, 10), preachSkin);
    pHandL.position.set(-0.5, 0.35, 0.15); preacher.add(pHandL);
    // Right arm — bent up, HOLDING A HANDHELD MIC, will sway side-to-side while preaching
    const armRGrp = new THREE.Group();
    armRGrp.position.set(0.40, 1.62, 0.05); // pivots at the shoulder
    preacher.add(armRGrp);
    this._preacherArmR = armRGrp;
    // upper arm (shoulder → elbow)
    const pArmR = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.5, 6, 10), preachSuit);
    pArmR.position.set(0.02, -0.24, 0.02); pArmR.rotation.z = -0.25; pArmR.rotation.x = 0.35; armRGrp.add(pArmR);
    // forearm bent up toward the face
    const pForeR = new THREE.Mesh(new THREE.CapsuleGeometry(0.10, 0.42, 6, 10), preachSuit);
    pForeR.position.set(0.16, -0.34, 0.36); pForeR.rotation.x = -1.35; pForeR.rotation.z = -0.20; armRGrp.add(pForeR);
    // hand gripping mic
    const pHandR = new THREE.Mesh(new THREE.SphereGeometry(0.10, 14, 10), preachSkin);
    pHandR.position.set(0.20, -0.20, 0.56); armRGrp.add(pHandR);
    // Handheld mic — body + capsule + foam windscreen
    const micBodyMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.35, metalness: 0.85 });
    const micHandBody = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.30, 16), micBodyMat);
    micHandBody.position.set(0.22, -0.05, 0.60); micHandBody.rotation.x = -0.4;
    armRGrp.add(micHandBody);
    const micHandFoam = new THREE.Mesh(new THREE.SphereGeometry(0.075, 18, 14), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.95 }));
    micHandFoam.position.set(0.24, 0.09, 0.70); armRGrp.add(micHandFoam);
    this._preacher = preacher;

    // ==== CHANDELIERS — real hanging candelabra down the aisle ====
    const brassMat = new THREE.MeshStandardMaterial({ color: 0xC6912F, roughness: 0.32, metalness: 0.9 });
    const chainMat = new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 0.6, metalness: 0.7 });
    const waxMat   = new THREE.MeshStandardMaterial({ color: 0xf4ecda, roughness: 0.85 });
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xffb861 });
    const crystalMat = new THREE.MeshStandardMaterial({ color: 0xf4ecda, roughness: 0.15, metalness: 0.05, transparent: true, opacity: 0.85 });
    const chandelierZs = [-8, -14, -20];
    chandelierZs.forEach((cz, idx) => {
      const grp = new THREE.Group();
      grp.position.set(0, 0, cz);
      scene.add(grp);
      const size = 1.05 + (idx === 1 ? 0.15 : 0);
      // hanging chain (short cylinder acts as chain visual — cheaper than 12 torus links)
      const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 11.5, 6), chainMat);
      chain.position.set(0, 14.0, 0); grp.add(chain);
      // ceiling canopy
      const canopy = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.20, 0.08, 20), brassMat);
      canopy.position.set(0, 19.75, 0); grp.add(canopy);
      // main brass ring
      const ring = new THREE.Mesh(new THREE.TorusGeometry(size, 0.055, 12, 44), brassMat);
      ring.position.set(0, 8.30, 0); ring.rotation.x = Math.PI/2; grp.add(ring);
      // inner smaller ring
      const inner = new THREE.Mesh(new THREE.TorusGeometry(size*0.55, 0.04, 10, 32), brassMat);
      inner.position.set(0, 8.65, 0); inner.rotation.x = Math.PI/2; grp.add(inner);
      // 4 vertical spokes joining top to outer ring
      for (let s = 0; s < 4; s++) {
        const a = (s/4) * Math.PI * 2;
        const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.55, 8), brassMat);
        spoke.position.set(Math.cos(a)*size*0.6, 8.5, Math.sin(a)*size*0.6);
        grp.add(spoke);
      }
      // 8 candles around the ring
      for (let i = 0; i < 8; i++) {
        const a = (i/8) * Math.PI * 2;
        const cx = Math.cos(a) * size;
        const cy = Math.sin(a) * size;
        const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.05, 0.05, 12), brassMat);
        cup.position.set(cx, 8.34, cy); grp.add(cup);
        const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.30, 12), waxMat);
        candle.position.set(cx, 8.52, cy); grp.add(candle);
        const flame = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), flameMat);
        flame.position.set(cx, 8.73, cy); flame.scale.set(0.9, 1.5, 0.9); grp.add(flame);
      }
      // Hanging crystal pendant in the middle
      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), crystalMat);
      crystal.position.set(0, 7.9, 0); grp.add(crystal);
      // Warm point light per chandelier
      const cLight = new THREE.PointLight(0xffb861, 1.6, 16, 2);
      cLight.position.set(0, 8.4, 0); grp.add(cLight);
    });

    // ==== PROJECTOR SCREEN ====
    // Draw a texture for the screen content
    this._screenCanvas = document.createElement('canvas');
    this._screenCanvas.width = 1024; this._screenCanvas.height = 512;
    this._screenTex = new THREE.CanvasTexture(this._screenCanvas);
    this._screenTex.colorSpace = THREE.SRGBColorSpace;

    const screenMat = new THREE.MeshBasicMaterial({ map: this._screenTex });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(9, 4.5), screenMat);
    screen.position.set(0, 6, -25.4); scene.add(screen);
    this._screen = screen;

    // Screen frame
    const frame = new THREE.Mesh(new THREE.BoxGeometry(9.4, 4.9, 0.15), new THREE.MeshStandardMaterial({ color: 0x0a0705, roughness: 1 }));
    frame.position.set(0, 6, -25.5); scene.add(frame);

    // Warm wash plane in front of pews for SHOW glow
    const washMat = new THREE.MeshBasicMaterial({ color: 0xff7a2c, transparent:true, opacity:0, side: THREE.DoubleSide });
    const wash = new THREE.Mesh(new THREE.PlaneGeometry(22, 12), washMat);
    wash.position.set(0, 3, -18); scene.add(wash);
    this._wash = wash;

    // ==== MEDIA DESK ====
    const deskMat = new THREE.MeshStandardMaterial({ color: 0x141010, roughness: 0.7, metalness: 0.15 });
    const desk = new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.15, 2.2), deskMat);
    desk.position.set(0, 1.42, 5.0); scene.add(desk);
    const deskFront = new THREE.Mesh(new THREE.BoxGeometry(7.6, 1.2, 0.15), deskMat);
    deskFront.position.set(0, 0.85, 6.05); scene.add(deskFront);

    // ==== SOUNDBOARD / mixing console (on desk front) ====
    const boardMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1e, roughness: 0.55, metalness: 0.35 });
    const board = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.08, 1.1), boardMat);
    board.position.set(0, 1.5, 5.75); scene.add(board);
    // fader slots + faders (8 channels)
    for (let i = 0; i < 8; i++) {
      const x = -1.96 + i * 0.55;
      const slot = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, 0.4), new THREE.MeshStandardMaterial({ color: 0x050405 }));
      slot.position.set(x, 1.545, 5.95); scene.add(slot);
      const fader = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.07, 0.11), new THREE.MeshStandardMaterial({ color: 0xffb861, emissive: 0x2a1005, emissiveIntensity: 0.4 }));
      fader.position.set(x, 1.575, 5.78 + Math.sin(i*2.1)*0.12); scene.add(fader);
      // green channel LED
      const led = new THREE.Mesh(new THREE.CircleGeometry(0.024, 12), new THREE.MeshBasicMaterial({ color: i < 5 ? 0x4fd18b : 0xff7a2c }));
      led.rotation.x = -Math.PI/2;
      led.position.set(x, 1.545, 5.42); scene.add(led);
    }
    // rotary knobs top row
    for (let i = 0; i < 12; i++) {
      const k = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 14), new THREE.MeshStandardMaterial({ color: i%3===0 ? 0xff7a2c : 0xC6912F, roughness: 0.35, metalness: 0.7 }));
      k.position.set(-2.15 + i * 0.39, 1.555, 5.34); scene.add(k);
    }
    // Illuminated square buttons
    for (let i = 0; i < 6; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.03, 0.11), new THREE.MeshStandardMaterial({ color: 0xff7a2c, emissive: 0xff7a2c, emissiveIntensity: 0.5 }));
      b.position.set(-2.0 + i * 0.35, 1.555, 6.08); scene.add(b);
    }
    // small LCD strip on the board
    const lcd = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.16), new THREE.MeshBasicMaterial({ color: 0x0a1614 }));
    lcd.rotation.x = -Math.PI/2 - 0.15; lcd.position.set(1.5, 1.56, 5.55); scene.add(lcd);

    // ==== FOUR-SCREEN RIG helper ====
    const makeScreen = (w, h, pxW, pxH, x, y, z, ry) => {
      const c = document.createElement('canvas'); c.width = pxW; c.height = pxH;
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex }));
      mesh.position.set(x, y, z); mesh.rotation.y = ry; mesh.rotation.x = -0.06;
      scene.add(mesh);
      const bezel = new THREE.Mesh(new THREE.BoxGeometry(w + 0.12, h + 0.12, 0.05), new THREE.MeshStandardMaterial({ color: 0x0a0505, roughness: 1 }));
      bezel.position.set(x - Math.sin(ry)*0.02, y, z - Math.cos(ry)*0.03); bezel.rotation.y = ry; bezel.rotation.x = -0.06;
      scene.add(bezel);
      // Base sits ON the desk top; stand bridges base → screen bottom. No floating.
      const deskTopY = 1.495;
      const screenBottomY = y - h*0.5;
      const standH = Math.max(0.06, screenBottomY - deskTopY - 0.03);
      const stnd = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.09, standH, 12), deskMat);
      stnd.position.set(x, deskTopY + standH*0.5 + 0.025, z + 0.05); scene.add(stnd);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.05, 20), deskMat);
      base.position.set(x, deskTopY + 0.025, z + 0.05); scene.add(base);
      return { mesh, canvas: c, tex };
    };
    this._pfScr    = makeScreen(2.6, 1.6, 1024, 640,  0.00, 2.55, 4.75,  0.00);
    this._logicScr = makeScreen(2.2, 1.4,  960, 600, -2.55, 2.45, 5.0,   0.36);
    this._bibleScr = makeScreen(2.2, 1.4,  960, 600,  2.55, 2.45, 5.0,  -0.36);
    this._obsScr   = makeScreen(1.7, 1.05, 780, 480,  3.55, 2.52, 5.55, -0.55);
    this._monitor  = this._pfScr.mesh; // backward-compat ref for connector origin

    // ==== MACBOOK (open, warm dock hint) ====
    const mbBaseMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2c, roughness: 0.4, metalness: 0.7 });
    const mbBase = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.05, 1.0), mbBaseMat);
    mbBase.position.set(-3.05, 1.52, 5.5); scene.add(mbBase);
    const mbCanvas = document.createElement('canvas'); mbCanvas.width = 560; mbCanvas.height = 340;
    const mbTex = new THREE.CanvasTexture(mbCanvas); mbTex.colorSpace = THREE.SRGBColorSpace;
    const mbScr = new THREE.Mesh(new THREE.PlaneGeometry(1.44, 0.88), new THREE.MeshBasicMaterial({ map: mbTex }));
    mbScr.position.set(-3.05, 2.0, 5.05); mbScr.rotation.x = -0.24; scene.add(mbScr);
    const mbLid = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.94, 0.04), mbBaseMat);
    mbLid.position.set(-3.05, 2.0, 5.03); mbLid.rotation.x = -0.24; scene.add(mbLid);
    this._mbCanvas = mbCanvas; this._mbTex = mbTex;

    // ==== OPERATOR — a detailed, seated, dozing man ====
    // Brighter base tones + soft emissive so the operator actually reads on camera.
    const skinMat   = new THREE.MeshStandardMaterial({ color: 0x8a5a3a, roughness: 0.75, emissive: 0x2a1408, emissiveIntensity: 0.35 });
    const hairMat   = new THREE.MeshStandardMaterial({ color: 0x3a1e10, roughness: 0.9 });
    const jacketMat = new THREE.MeshStandardMaterial({ color: 0x6a4030, roughness: 0.85, emissive: 0x1a0806, emissiveIntensity: 0.25 });
    const chairMat  = new THREE.MeshStandardMaterial({ color: 0x3a2a2a, roughness: 0.65, metalness: 0.25 });

    const op = new THREE.Group();
    op.position.set(0, 0, 6.25);
    scene.add(op);
    this._operator = op;

    // ==== Ergonomic office chair — 5-star wheel base, cushioned seat + lumbar + headrest + armrests ====
    const chairFrameMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1e, roughness: 0.5, metalness: 0.6 });
    const chairCushMat  = new THREE.MeshStandardMaterial({ color: 0x3a2a2a, roughness: 0.75, metalness: 0.2 });
    // 5-star wheel base
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.06, 0.09), chairFrameMat);
      leg.position.set(Math.cos(a)*0.28, 0.12, Math.sin(a)*0.28);
      leg.rotation.y = -a;
      op.add(leg);
      const wheel = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 10), chairFrameMat);
      wheel.position.set(Math.cos(a)*0.55, 0.08, Math.sin(a)*0.55);
      op.add(wheel);
    }
    // Gas cylinder post
    const chairPost = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.85, 14), chairFrameMat);
    chairPost.position.set(0, 0.62, 0); op.add(chairPost);
    // Seat pan cushion
    const chairSeat = new THREE.Mesh(new THREE.BoxGeometry(1.10, 0.14, 1.05), chairCushMat);
    chairSeat.position.set(0, 1.18, 0); op.add(chairSeat);
    // Seat front lip
    const chairFront = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.10, 0.14), chairCushMat);
    chairFront.position.set(0, 1.14, -0.52); op.add(chairFront);
    // Backrest — reclined slightly (positive rotation.x tilts top toward +z, behind the operator)
    const chairBack = new THREE.Mesh(new THREE.BoxGeometry(1.05, 1.55, 0.14), chairCushMat);
    chairBack.position.set(0, 2.05, 0.58); chairBack.rotation.x = 0.16; op.add(chairBack);
    // Lumbar bulge
    const lumbar = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.32, 0.10), chairCushMat);
    lumbar.position.set(0, 1.60, 0.48); op.add(lumbar);
    // Headrest
    const headrest = new THREE.Mesh(new THREE.BoxGeometry(0.80, 0.32, 0.12), chairCushMat);
    headrest.position.set(0, 2.92, 0.68); headrest.rotation.x = 0.16; op.add(headrest);
    // Armrests
    for (let s = -1; s <= 1; s += 2) {
      const armPost = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.55, 10), chairFrameMat);
      armPost.position.set(s * 0.58, 1.42, 0.06); op.add(armPost);
      const armPad = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.07, 0.52), chairCushMat);
      armPad.position.set(s * 0.58, 1.72, 0.06); op.add(armPad);
    }

    // Torso (slight lean-back)
    const torsoGrp = new THREE.Group();
    torsoGrp.position.set(0, 2.15, 0.12);
    torsoGrp.rotation.x = 0.08;
    op.add(torsoGrp);
    // Slimmer torso — proper build, not chubby
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.95, 8, 14), jacketMat);
    torso.scale.set(1, 1, 0.85);
    torsoGrp.add(torso);

    // Neck
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.22, 12), skinMat);
    neck.position.set(0, 0.68, -0.02); torsoGrp.add(neck);

    // Head group (bobs)
    const headGrp = new THREE.Group();
    headGrp.position.set(0, 0.92, -0.05);
    torsoGrp.add(headGrp);
    this._head = headGrp;

    const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.32, 24, 20), skinMat);
    headMesh.scale.set(1, 1.12, 1);
    headGrp.add(headMesh);
    // Fuller hair — no bald patch, comes down the sides and slightly behind
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.365, 28, 22, 0, Math.PI*2, 0, Math.PI*0.78), hairMat);
    hair.position.set(0, 0.04, 0.03); headGrp.add(hair);
    // Small back-of-head hair volume
    const hairBack = new THREE.Mesh(new THREE.SphereGeometry(0.30, 20, 16, 0, Math.PI*2, 0, Math.PI*0.55), hairMat);
    hairBack.position.set(0, -0.02, -0.08); hairBack.rotation.x = -0.5; headGrp.add(hairBack);
    const earL = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), skinMat);
    earL.position.set(-0.31, -0.02, 0.02); earL.scale.set(0.6, 1, 0.4); headGrp.add(earL);
    const earR = earL.clone(); earR.position.x = 0.31; headGrp.add(earR);

    // Slimmer shoulders
    const shoulderL = new THREE.Mesh(new THREE.SphereGeometry(0.23, 14, 12), jacketMat);
    shoulderL.position.set(-0.47, 0.38, 0); shoulderL.scale.set(1, 0.9, 1);
    torsoGrp.add(shoulderL);
    const shoulderR = shoulderL.clone(); shoulderR.position.x = 0.47; torsoGrp.add(shoulderR);

    // Left arm — resting on soundboard (forward-left)
    const upperArmL = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.5, 6, 10), jacketMat);
    upperArmL.position.set(-0.66, 0.05, -0.14); upperArmL.rotation.z = 0.35; upperArmL.rotation.x = -0.9;
    torsoGrp.add(upperArmL);
    const forearmL = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.5, 6, 10), skinMat);
    forearmL.position.set(-0.9, -0.15, -0.55); forearmL.rotation.x = -1.35;
    torsoGrp.add(forearmL);
    // Hands with finger hints — proper palms + short cylindrical fingers
    const buildHand = (isLeft) => {
      const hand = new THREE.Group();
      const s = isLeft ? -1 : 1;
      const palm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.05, 0.16), skinMat);
      hand.add(palm);
      for (let f = 0; f < 4; f++) {
        const finger = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.11, 8), skinMat);
        finger.position.set(-0.05 + f * 0.033, 0, 0.13);
        finger.rotation.x = Math.PI/2 - 0.15;
        hand.add(finger);
      }
      const thumb = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.018, 0.08, 8), skinMat);
      thumb.position.set(s * 0.08, 0, 0.04);
      thumb.rotation.z = s * -Math.PI/3;
      hand.add(thumb);
      return hand;
    };
    const handL = buildHand(true);
    handL.position.set(-0.95, -0.35, -0.85); handL.rotation.x = 0.3;
    torsoGrp.add(handL);

    // Right arm — near keyboard (forward-right)
    const upperArmR = upperArmL.clone(); upperArmR.material = jacketMat;
    upperArmR.position.set(0.66, 0.05, -0.14); upperArmR.rotation.z = -0.35; upperArmR.rotation.x = -0.8;
    torsoGrp.add(upperArmR);
    const forearmR = forearmL.clone();
    forearmR.position.set(0.9, -0.18, -0.5); forearmR.rotation.x = -1.15;
    torsoGrp.add(forearmR);
    const handR = buildHand(false);
    handR.position.set(0.95, -0.35, -0.78); handR.rotation.x = 0.3;
    torsoGrp.add(handR);
    this._armR = forearmR;

    // Over-ear headphones around neck
    const hpMat  = new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.55 });
    const hpBand = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.03, 8, 24, Math.PI), hpMat);
    hpBand.position.set(0, 0.55, 0.02); hpBand.rotation.x = 0.24; torsoGrp.add(hpBand);
    const cupL = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 18), hpMat);
    cupL.rotation.z = Math.PI/2; cupL.position.set(-0.22, 0.42, 0.06); torsoGrp.add(cupL);
    const cupR = cupL.clone(); cupR.position.x = 0.22; torsoGrp.add(cupR);

    // ==== "Zzz" sprites floating above his head ====
    const makeZ = () => {
      const c = document.createElement('canvas'); c.width = 128; c.height = 128;
      const g = c.getContext('2d');
      g.clearRect(0,0,128,128);
      // Classic cartoon capital Z with a warm glow so it reads from the overview
      g.shadowColor = '#ffb861'; g.shadowBlur = 14;
      g.font = '800 108px "Fraunces", serif';
      g.fillStyle = '#ffb861'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('Z', 64, 70);
      g.shadowBlur = 0;
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42), new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: 0, depthWrite: false }));
      return m;
    };
    // Zzz sprites retired — operator is awake and working the desk now.
    this._zzzs = [];

    // ==== WAVEFORM LINE (mic → desk) ====
    const wfGeom = new THREE.BufferGeometry();
    this._wfPoints = 48;
    const wfPositions = new Float32Array(this._wfPoints * 3);
    wfGeom.setAttribute('position', new THREE.BufferAttribute(wfPositions, 3));
    const wfMat = new THREE.LineBasicMaterial({ color: 0xff7a2c, transparent:true, opacity: 0 });
    const wfLine = new THREE.Line(wfGeom, wfMat);
    scene.add(wfLine);
    this._wfLine = wfLine;

    // ==== BRASS CONNECTOR (desk → screen) — only in MATCH+ ====
    const connGeom = new THREE.BufferGeometry();
    const connPts = [
      new THREE.Vector3(0, 2.6, 4.8),   // monitor
      new THREE.Vector3(0, 4.5, -2),    // apex
      new THREE.Vector3(0, 5.9, -25.2), // screen
    ];
    // curve sample
    const curve = new THREE.CatmullRomCurve3(connPts);
    const curveSamples = curve.getPoints(60);
    const cPos = new Float32Array(curveSamples.length * 3);
    curveSamples.forEach((v,i) => { cPos[i*3]=v.x; cPos[i*3+1]=v.y; cPos[i*3+2]=v.z; });
    connGeom.setAttribute('position', new THREE.BufferAttribute(cPos, 3));
    const connMat = new THREE.LineDashedMaterial({ color: 0xC6912F, dashSize: 0.3, gapSize: 0.15, transparent:true, opacity: 0 });
    const connLine = new THREE.Line(connGeom, connMat);
    connLine.computeLineDistances();
    scene.add(connLine);
    this._connLine = connLine;
    this._connSamples = curveSamples.length;

    // ==== DUST PARTICLES ====
    const dustCount = 220;
    const dustGeom = new THREE.BufferGeometry();
    const dustPos = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount; i++) {
      dustPos[i*3] = (Math.random()-0.5) * 20;
      dustPos[i*3+1] = Math.random() * 10 + 0.5;
      dustPos[i*3+2] = -Math.random() * 24 + 4;
    }
    dustGeom.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
    // Dust removed — floating particles were reading as random specks in the room.
    this._dust = null;

    // set initial states
    this._t = 0;
    this.drawPresentFlow(0);
    this.drawLogic(0);
    this.drawBible(0);
    this.drawOBS(0);
    this.drawMacbook(0);
    this.drawScreen(0, false);
    this._screenTex.needsUpdate = true;

    // start render loop
    this._alive = true;
    this._start = performance.now();
    const loop = () => {
      if (!this._alive) return;
      this._raf = requestAnimationFrame(loop);
      this.tick();
    };
    loop();
  }

  // ==== TEXTURE DRAWERS ====
  _drawMacChrome(ctx, W, title, textCol, barCol) {
    ctx.fillStyle = barCol || '#0a0505'; ctx.fillRect(0, 0, W, 30);
    ['#ff5f57','#febc2e','#28c840'].forEach((c, i) => {
      ctx.fillStyle = c; ctx.beginPath(); ctx.arc(16 + i*18, 15, 5.5, 0, Math.PI*2); ctx.fill();
    });
    const isPF = title && title.indexOf('PresentFlow') === 0;
    ctx.font = '600 13px "Fraunces", serif';
    const titleW = ctx.measureText(title).width;
    const groupW = titleW + (isPF ? 22 : 0);
    const startX = (W - groupW) / 2;
    if (isPF) {
      // PresentFlow play-triangle mark before the title
      ctx.fillStyle = '#ff7a2c';
      ctx.beginPath();
      ctx.moveTo(startX, 8); ctx.lineTo(startX, 22); ctx.lineTo(startX + 14, 15); ctx.closePath(); ctx.fill();
    }
    ctx.textAlign = 'left';
    ctx.fillStyle = textCol || '#F4EFE6';
    ctx.fillText(title, startX + (isPF ? 22 : 0), 20);
  }

  drawPresentFlow(p) {
    const cvs = this._pfScr.canvas; const ctx = cvs.getContext('2d');
    const W = cvs.width, H = cvs.height;
    ctx.fillStyle = '#0a0505'; ctx.fillRect(0,0,W,H);
    this._drawMacChrome(ctx, W, 'PresentFlow — Sunday · 10:47am');
    // PresentFlow branded watermark strip — bottom-left of the main pane
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = '#ff7a2c';
    ctx.beginPath();
    ctx.moveTo(254, H - 30); ctx.lineTo(254, H - 14); ctx.lineTo(268, H - 22); ctx.closePath(); ctx.fill();
    ctx.font = '600 15px "Fraunces", serif';
    ctx.fillStyle = '#F4EFE6'; ctx.fillText('Present', 276, H - 18);
    ctx.font = '300 15px "Fraunces", serif';
    ctx.fillStyle = '#ffb861';
    const pfw = ctx.measureText('Present').width;
    ctx.font = '600 15px "Fraunces", serif'; ctx.fillStyle = '#F4EFE6';
    // reset to draw the "Flow" italic
    ctx.font = '300 italic 15px "Fraunces", serif'; ctx.fillStyle = '#ffb861';
    ctx.fillText('Flow', 276 + pfw, H - 18);
    ctx.restore();
    const b1 = Math.max(0, Math.min(1, p/0.33));
    const b2 = Math.max(0, Math.min(1, (p-0.33)/0.33));
    const b3 = Math.max(0, Math.min(1, (p-0.66)/0.34));

    // LIVE pill top-right
    ctx.fillStyle = '#12595E'; ctx.beginPath(); ctx.arc(W-88, 58, 6, 0, Math.PI*2); ctx.fill();
    ctx.font = '600 15px "JetBrains Mono", monospace'; ctx.fillStyle = '#F4EFE6';
    ctx.fillText('LIVE', W-74, 63);

    // Sidebar
    ctx.fillStyle = '#0f0808'; ctx.fillRect(0, 30, 230, H-30);
    ctx.font = '500 11px "JetBrains Mono", monospace'; ctx.fillStyle = '#9c958b';
    ctx.fillText('SERVICE ORDER', 20, 62);
    const items = ['Praise & worship','Opening prayer','Scripture reading','Sermon · Romans 8','Altar call','Benediction'];
    const scanT = b1 * 0.7 + b2 * 0.3;
    const scanIdx = Math.min(items.length-1, 2 + Math.floor(b2 * 2));
    items.forEach((it, i) => {
      const active = i === scanIdx && (b1 > 0.4 || b2 > 0.02);
      ctx.fillStyle = active ? '#ff7a2c' : (i < scanIdx ? '#F4EFE6' : '#4a4238');
      ctx.font = active ? '600 13px "Plus Jakarta Sans", sans-serif' : '400 13px "Plus Jakarta Sans", sans-serif';
      ctx.fillText('0' + (i+1) + '  ' + it, 20, 96 + i*30);
      if (active) { ctx.fillStyle = '#ff7a2c'; ctx.fillRect(6, 84 + i*30, 3, 22); }
    });

    // Main pane header
    ctx.font = '500 11px "JetBrains Mono", monospace'; ctx.fillStyle = '#ffb861';
    ctx.fillText('LIVE TRANSCRIPT · 40MS/CHAR', 254, 62);

    // Transcript typing
    const full = 'brothers and sisters, turn with me to Romans eight, twenty-eight—';
    const shown = full.slice(0, Math.floor(b1 * full.length));
    ctx.font = '400 16px "JetBrains Mono", monospace'; ctx.fillStyle = '#F4EFE6';
    const words = ('…' + shown).split(' '); let line = ''; let cy = 96;
    words.forEach(w => { const tr = line ? line + ' ' + w : w; if (ctx.measureText(tr).width > W - 274) { ctx.fillText(line, 254, cy); cy += 22; line = w; } else line = tr; });
    if (line) ctx.fillText(line, 254, cy);

    // AI chips row
    ctx.font = '600 11px "JetBrains Mono", monospace';
    const chips = [ ['ROMANS', b1>0.4], ['ROMANS 8', b1>0.75], ['ROMANS 8:28', b2>0.05] ];
    chips.forEach((c, i) => {
      const cx = 254 + i * 122; const active = c[1];
      const w = ctx.measureText(c[0]).width + 20;
      ctx.fillStyle = active ? '#ff7a2c' : '#241618';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(cx, 190, w, 24, 4); else ctx.rect(cx, 190, w, 24);
      ctx.fill();
      ctx.fillStyle = active ? '#0B0B0B' : '#8b7d6a';
      ctx.fillText(c[0], cx + 10, 206);
    });

    // Match card — LARGE and legible from the overview. Story: confidence
    // climbs from 0% and locks at 98% with a clear MATCHED state.
    if (b2 > 0.03) {
      ctx.globalAlpha = b2;
      const dec = Math.min(1, Math.max(0, (b2 - 0.05) / 0.65));
      const locked = dec >= 0.995;
      ctx.fillStyle = locked ? 'rgba(79,209,139,.16)' : 'rgba(255,184,97,.12)';
      ctx.fillRect(254, 238, W - 274, 210);
      ctx.strokeStyle = locked ? '#4fd18b' : '#ffb861'; ctx.lineWidth = 2.5;
      ctx.strokeRect(254, 238, W - 274, 210);

      // Big status strip — story: FINDING THE VERSE… → LOCKED
      ctx.font = '800 24px "JetBrains Mono", monospace';
      ctx.fillStyle = locked ? '#4fd18b' : '#ffb861';
      ctx.fillText(locked ? '✓  MATCHED · KJV' : 'FINDING THE VERSE…', 272, 274);
      // Snap flash on lock
      if (locked) {
        const snap = Math.max(0, 1 - (this._t - (this._lockAt || (this._lockAt = this._t))) / 0.35);
        ctx.globalAlpha = snap * 0.5;
        ctx.strokeStyle = '#4fd18b'; ctx.lineWidth = 6;
        ctx.strokeRect(254 - snap*4, 238 - snap*4, W - 274 + snap*8, 210 + snap*8);
        ctx.globalAlpha = b2;
      }

      // Reference decoding
      const target = 'ROMANS 8:28';
      const scr = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789';
      const nL = Math.floor(dec * target.length);
      let ds = '';
      for (let i = 0; i < target.length; i++) {
        if (i < nL) ds += target[i];
        else if (target[i] === ' ') ds += ' ';
        else ds += scr[(Math.floor(this._t*30) + i*7) % scr.length];
      }
      ctx.font = '500 56px "Fraunces", serif';
      ctx.fillStyle = locked ? '#F4EFE6' : '#ffb861';
      ctx.fillText(ds, 272, 336);

      // Confidence readout
      ctx.font = '600 14px "JetBrains Mono", monospace'; ctx.fillStyle = '#9c958b';
      ctx.fillText('CONFIDENCE', 272, 370);
      ctx.font = '800 32px "JetBrains Mono", monospace';
      ctx.fillStyle = locked ? '#4fd18b' : '#ffb861';
      ctx.fillText(Math.round(dec*98) + '%', 400, 376);
      ctx.font = '500 13px "JetBrains Mono", monospace'; ctx.fillStyle = '#9c958b';
      ctx.fillText('· KJV', 508, 372);

      // Chunky confidence bar with threshold mark
      ctx.fillStyle = 'rgba(255,255,255,.06)'; ctx.fillRect(272, 398, W - 310, 14);
      ctx.fillStyle = locked ? '#4fd18b' : '#ffb861';
      ctx.fillRect(272, 398, (W - 310) * dec, 14);
      ctx.fillStyle = 'rgba(255,255,255,.35)';
      ctx.fillRect(272 + (W - 310) * 0.70 - 1, 394, 2, 22);
      ctx.font = '500 10px "JetBrains Mono", monospace'; ctx.fillStyle = '#9c958b';
      ctx.fillText('threshold 70%', 272 + (W - 310) * 0.70 + 6, 428);
      ctx.globalAlpha = 1;
    }

    // Routing footer
    if (b3 > 0.03) {
      ctx.globalAlpha = b3;
      ctx.font = '500 11px "JetBrains Mono", monospace'; ctx.fillStyle = '#ff7a2c';
      ctx.fillText('→ ROUTING · SCREEN 1 · STAGE · LIVESTREAM', 272, H - 54);
      ctx.font = '400 32px "Fraunces", serif'; ctx.fillStyle = '#F4EFE6';
      const timer = (1.6 * Math.min(1, Math.max(0, (b3-0.3)/0.7))).toFixed(1);
      ctx.textAlign = 'right'; ctx.fillText(timer + 's', W - 30, H - 36); ctx.textAlign = 'left';
      ctx.globalAlpha = 1;
    }

    this._pfScr.tex.needsUpdate = true;
  }

  drawLogic(p) {
    const cvs = this._logicScr.canvas; const ctx = cvs.getContext('2d');
    const W = cvs.width, H = cvs.height;
    ctx.fillStyle = '#141416'; ctx.fillRect(0,0,W,H);
    this._drawMacChrome(ctx, W, 'Logic Pro — Sunday Service.logicx');

    // Transport
    ctx.fillStyle = '#0e0e10'; ctx.fillRect(0, 30, W, 42);
    ctx.strokeStyle = '#2a2a2c'; ctx.strokeRect(0, 30, W, 42);
    ctx.font = '600 14px "JetBrains Mono", monospace'; ctx.fillStyle = '#ff7a2c';
    ctx.fillText('▶', 18, 58);
    ctx.fillStyle = '#F4EFE6'; ctx.fillText('00:12:47', 42, 58);
    ctx.fillStyle = '#9c958b'; ctx.font = '400 12px "JetBrains Mono", monospace';
    ctx.fillText('Cmaj · 4/4 · 115 BPM', W - 220, 58);

    const b1 = Math.max(0, Math.min(1, p/0.33));
    const b2 = Math.max(0, Math.min(1, (p-0.33)/0.33));

    // Playhead
    const playX = 160 + (b1 + b2) * 0.5 * (W - 180);
    ctx.strokeStyle = '#ff7a2c'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(playX, 72); ctx.lineTo(playX, H-30); ctx.stroke();

    const tracks = [
      { name:'Kick',    col:'#ff5c5c' },
      { name:'Snare',   col:'#ffb861' },
      { name:'Hats',    col:'#ffcc88' },
      { name:'Bass',    col:'#4fd18b' },
      { name:'Keys',    col:'#a874d6' },
      { name:'Pad',     col:'#ff7a2c' },
      { name:'Vox Lead',col:'#88c8ff' },
      { name:'Vox BG',  col:'#9c958b' },
    ];
    const laneY0 = 78;
    const laneH = (H - laneY0 - 20) / tracks.length;

    tracks.forEach((t, i) => {
      const y = laneY0 + i * laneH;
      // channel strip
      ctx.fillStyle = '#0e0e10'; ctx.fillRect(0, y, 140, laneH);
      ctx.strokeStyle = '#222'; ctx.strokeRect(0, y, 140, laneH);
      ctx.fillStyle = t.col; ctx.fillRect(0, y, 4, laneH);
      ctx.font = '500 11px "JetBrains Mono", monospace'; ctx.fillStyle = '#F4EFE6';
      ctx.fillText(t.name, 12, y + laneH*0.42);
      // R / M buttons
      ctx.fillStyle = '#2a1a1a'; ctx.fillRect(12, y + laneH*0.55, 14, 10);
      ctx.fillStyle = '#1e1a10'; ctx.fillRect(30, y + laneH*0.55, 14, 10);
      ctx.font = '600 8px "JetBrains Mono", monospace'; ctx.fillStyle = '#ff5c5c'; ctx.fillText('R', 16, y + laneH*0.55 + 8);
      ctx.fillStyle = '#ffb861'; ctx.fillText('M', 34, y + laneH*0.55 + 8);

      // Meter (reactive to arriving room audio)
      const meter = (0.25 + 0.75 * Math.abs(Math.sin(this._t * (1.8 + i*0.35) + i))) * (0.3 + 0.7*b1);
      const mx = 96, mw = 34, mh = laneH - 12;
      ctx.fillStyle = '#050505'; ctx.fillRect(mx, y+6, mw, mh);
      const mFill = mh * meter;
      const grad = ctx.createLinearGradient(0, y+6+mh, 0, y+6);
      grad.addColorStop(0, '#4fd18b'); grad.addColorStop(0.7, '#ffb861'); grad.addColorStop(1, '#ff5c5c');
      ctx.fillStyle = grad; ctx.fillRect(mx, y+6+mh-mFill, mw, mFill);

      // Lane region
      ctx.fillStyle = 'rgba(255,255,255,.02)'; ctx.fillRect(140, y+3, W-148, laneH-6);
      // Waveform bars
      ctx.strokeStyle = t.col; ctx.lineWidth = 1.3;
      ctx.beginPath();
      const cy = y + laneH*0.5;
      for (let x = 140; x < W - 8; x += 3) {
        const nx = (x - 140) / (W - 148);
        const speed = (0.4 + 0.6 * b1);
        const wave = Math.sin(nx * 60 + i * 3 + this._t * 5 * speed) * (0.35 + 0.65*Math.sin(nx*13 + i)) * (laneH*0.35) * (0.4 + 0.6 * b1);
        const yy = cy + wave;
        if (x === 140) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    });

    this._logicScr.tex.needsUpdate = true;
  }

  drawBible(p) {
    const cvs = this._bibleScr.canvas; const ctx = cvs.getContext('2d');
    const W = cvs.width, H = cvs.height;
    ctx.fillStyle = '#F4EFE6'; ctx.fillRect(0,0,W,H);
    this._drawMacChrome(ctx, W, 'Bible — Study', '#1a1a1a', '#eae5dd');

    // Left book list
    ctx.fillStyle = '#e6dfd2'; ctx.fillRect(0, 30, 170, H-30);
    const books = ['Matthew','Mark','Luke','John','Acts','Romans','1 Corinthians','2 Corinthians','Galatians','Ephesians'];
    const b2 = Math.max(0, Math.min(1, (p-0.33)/0.33));
    const jumped = b2 > 0.35;
    ctx.font = '500 12px "Plus Jakarta Sans", sans-serif';
    books.forEach((bk, i) => {
      const active = bk === 'Romans' && jumped;
      if (active) { ctx.fillStyle = '#8F2C10'; ctx.fillRect(0, 62 + i*28 - 18, 170, 26); }
      ctx.fillStyle = active ? '#F4EFE6' : '#4a4238';
      ctx.fillText(bk, 16, 62 + i*28);
    });

    // Translation toggle top-right
    ctx.font = '600 10px "JetBrains Mono", monospace';
    ['KJV','NIV','ESV'].forEach((t, i) => {
      const x = W - 172 + i*54; const on = t === 'KJV';
      ctx.fillStyle = on ? '#8F2C10' : '#eae5dd';
      ctx.fillRect(x, 42, 48, 22);
      ctx.fillStyle = on ? '#F4EFE6' : '#4a4238';
      ctx.textAlign = 'center'; ctx.fillText(t, x + 24, 57); ctx.textAlign = 'left';
    });

    // Verse pane header
    ctx.font = '600 13px "JetBrains Mono", monospace'; ctx.fillStyle = '#8b7d6a';
    ctx.fillText('ROMANS · CHAPTER 8', 190, 60);

    const verses = [
      { n:26, t:"Likewise the Spirit also helpeth our infirmities…" },
      { n:27, t:"And he that searcheth the hearts knoweth what is the mind of the Spirit…" },
      { n:28, t:"And we know that all things work together for good to them that love God, to them who are the called according to his purpose." },
      { n:29, t:"For whom he did foreknow, he also did predestinate to be conformed…" },
      { n:30, t:"Moreover whom he did predestinate, them he also called…" },
    ];
    let y = 90;
    verses.forEach(v => {
      const active = v.n === 28 && jumped;
      if (active) { ctx.fillStyle = 'rgba(143,44,16,.12)'; ctx.fillRect(180, y - 20, W - 200, 90); }
      ctx.font = '600 11px "JetBrains Mono", monospace';
      ctx.fillStyle = active ? '#8F2C10' : '#a68e6a'; ctx.fillText(String(v.n), 188, y);
      ctx.font = active ? '500 15px "Fraunces", serif' : '400 15px "Fraunces", serif';
      ctx.fillStyle = active ? '#0B0B0B' : '#4a4238';
      const words = v.t.split(' '); let line = ''; let cy = y;
      const maxW = W - 240;
      words.forEach(w => {
        const tr = line ? line + ' ' + w : w;
        if (ctx.measureText(tr).width > maxW) { ctx.fillText(line, 216, cy); cy += 20; line = w; }
        else line = tr;
      });
      if (line) ctx.fillText(line, 216, cy);
      y = cy + 34;
    });

    this._bibleScr.tex.needsUpdate = true;
  }

  drawOBS(p) {
    const cvs = this._obsScr.canvas; const ctx = cvs.getContext('2d');
    const W = cvs.width, H = cvs.height;
    ctx.fillStyle = '#1e1e1e'; ctx.fillRect(0,0,W,H);
    this._drawMacChrome(ctx, W, 'OBS Studio · PresentFlow-OUT', '#F4EFE6', '#2a2a2a');

    const pv = { x: 10, y: 40, w: W/2 - 14, h: 140 };
    const pg = { x: W/2 + 4, y: 40, w: W/2 - 14, h: 140 };
    ctx.fillStyle = '#000'; ctx.fillRect(pv.x, pv.y, pv.w, pv.h);
    ctx.fillStyle = '#000'; ctx.fillRect(pg.x, pg.y, pg.w, pg.h);
    // labels
    ctx.font = '600 9px "JetBrains Mono", monospace'; ctx.fillStyle = '#4fd18b';
    ctx.fillText('PREVIEW', pv.x + 6, pv.y + 12);
    ctx.fillStyle = '#ff5c5c'; ctx.fillText('PROGRAM', pg.x + 6, pg.y + 12);

    const b3 = Math.max(0, Math.min(1, (p-0.66)/0.34));
    // Preview: pulpit MCU (warm dark)
    ctx.fillStyle = '#1a0e08'; ctx.fillRect(pv.x+2, pv.y+18, pv.w-4, pv.h-22);
    ctx.font = '400 9px "JetBrains Mono", monospace'; ctx.fillStyle = '#6a5238';
    ctx.fillText('· Pulpit — MCU', pv.x + 10, pv.y + pv.h - 8);

    // Program: shows verse in SHOW
    if (b3 > 0.15) {
      ctx.fillStyle = '#F1EFE8'; ctx.fillRect(pg.x+2, pg.y+18, pg.w-4, pg.h-22);
      ctx.font = '600 10px "JetBrains Mono", monospace'; ctx.fillStyle = '#8F2C10';
      ctx.textAlign = 'center'; ctx.fillText('ROMANS 8:28 (KJV)', pg.x + pg.w/2, pg.y + 42);
      ctx.font = '400 11px "Fraunces", serif'; ctx.fillStyle = '#0B0B0B';
      ctx.fillText('all things work', pg.x + pg.w/2, pg.y + 72);
      ctx.fillText('together for good…', pg.x + pg.w/2, pg.y + 92);
      ctx.textAlign = 'left';
    } else {
      ctx.fillStyle = '#0a0505'; ctx.fillRect(pg.x+2, pg.y+18, pg.w-4, pg.h-22);
    }

    // Scenes list
    const sy = pv.y + pv.h + 14;
    ctx.font = '600 9px "JetBrains Mono", monospace'; ctx.fillStyle = '#9c958b';
    ctx.fillText('SCENES', 12, sy);
    const scenes = ['Worship — Wide', 'Pulpit — MCU', 'Slide — Full', 'Lower-third'];
    ctx.font = '500 10px "JetBrains Mono", monospace';
    scenes.forEach((s, i) => {
      const active = i === (b3 > 0.15 ? 2 : 1);
      if (active) { ctx.fillStyle = '#2a1808'; ctx.fillRect(6, sy + 8 + i*18, W/2 - 14, 16); }
      ctx.fillStyle = active ? '#ff7a2c' : '#4a4238';
      ctx.fillText('· ' + s, 12, sy + 20 + i*18);
    });

    // REC
    ctx.fillStyle = '#ff5c5c'; ctx.beginPath(); ctx.arc(W - 132, sy + 10, 4, 0, Math.PI*2); ctx.fill();
    ctx.font = '600 10px "JetBrains Mono", monospace'; ctx.fillStyle = '#ff5c5c';
    const secs = (18 + Math.floor(this._t * 2)) % 60;
    ctx.fillText('REC 00:42:' + String(secs).padStart(2,'0'), W - 122, sy + 14);
    ctx.fillStyle = '#4fd18b'; ctx.font = '500 9px "JetBrains Mono", monospace';
    ctx.fillText('NDI · PresentFlow-OUT', W - 156, sy + 30);

    // Audio meters
    const b1 = Math.max(0, Math.min(1, p/0.33));
    const activity = 0.3 + 0.7 * b1;
    for (let i = 0; i < 4; i++) {
      const mx = W - 132 + i*16; const my = sy + 46;
      const mh = H - my - 16;
      const level = Math.abs(Math.sin(this._t * (3 + i*0.7) + i*1.5)) * activity;
      ctx.fillStyle = '#050505'; ctx.fillRect(mx, my, 10, mh);
      const fh = mh * level;
      const g = ctx.createLinearGradient(0, my+mh, 0, my);
      g.addColorStop(0, '#4fd18b'); g.addColorStop(0.7, '#ffb861'); g.addColorStop(1, '#ff5c5c');
      ctx.fillStyle = g; ctx.fillRect(mx, my+mh-fh, 10, fh);
    }

    this._obsScr.tex.needsUpdate = true;
  }

  drawMacbook(p) {
    const ctx = this._mbCanvas.getContext('2d');
    const W = this._mbCanvas.width, H = this._mbCanvas.height;
    const g = ctx.createRadialGradient(W/2, H/2, 20, W/2, H/2, W);
    g.addColorStop(0, '#3a1e20'); g.addColorStop(1, '#0e0808');
    ctx.fillStyle = g; ctx.fillRect(0,0,W,H);
    // menu bar
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0,0,W,22);
    ctx.font = '600 11px "JetBrains Mono", monospace'; ctx.fillStyle = '#F4EFE6';
    ctx.fillText('  PresentFlow  ·  File  Edit  Service', 6, 15);
    // dock
    const dy = H - 44;
    ctx.fillStyle = 'rgba(0,0,0,.4)';
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(W/2 - 140, dy, 280, 36, 10); ctx.fill(); }
    else ctx.fillRect(W/2 - 140, dy, 280, 36);
    ['#ff7a2c','#a874d6','#4fd18b','#ff5c5c','#ffb861','#5cc8ff','#F4EFE6'].forEach((c, i) => {
      ctx.fillStyle = c; ctx.beginPath(); ctx.arc(W/2 - 120 + i*40, dy + 18, 12, 0, Math.PI*2); ctx.fill();
    });
    this._mbTex.needsUpdate = true;
  }

  _drawMonitorLegacy_unused(p) {
    const ctx = this._monitorCanvas.getContext('2d');
    const W = this._monitorCanvas.width, H = this._monitorCanvas.height;
    ctx.fillStyle = '#0a0505'; ctx.fillRect(0,0,W,H);
    // chapter
    const inListen = p < 0.33;
    const inMatch = p >= 0.33 && p < 0.66;
    const inShow = p >= 0.66;
    const b1 = Math.max(0, Math.min(1, p/0.33));
    const b2 = Math.max(0, Math.min(1, (p-0.33)/0.33));
    const b3 = Math.max(0, Math.min(1, (p-0.66)/0.34));

    // top bar
    ctx.fillStyle = '#150a0a'; ctx.fillRect(0,0,W,60);
    ctx.font = '600 22px "JetBrains Mono", monospace';
    ctx.fillStyle = '#ff7a2c';
    ctx.fillText('● ' + (inListen ? 'LISTEN' : inMatch ? 'MATCH' : 'SHOW'), 28, 40);
    ctx.fillStyle = '#9c958b';
    ctx.textAlign = 'right';
    ctx.font = '400 18px "JetBrains Mono", monospace';
    ctx.fillText('PRESENTFLOW · v0.1.102', W - 28, 40);
    ctx.textAlign = 'left';

    // Chapter 1: waveform panel
    if (inListen || b1 > 0) {
      ctx.strokeStyle = '#ff7a2c'; ctx.lineWidth = 2;
      ctx.beginPath();
      const midY = H/2;
      for (let i = 0; i < W; i += 4) {
        const nx = i / W;
        const amp = 60 * (0.5 + 0.5 * Math.sin(nx * 40 + this._t*4)) * (0.4 + 0.6*Math.sin(nx*7 + this._t*2)) * b1;
        const y = midY + amp * (Math.sin(nx*90 + this._t*8));
        if (i === 0) ctx.moveTo(i, y); else ctx.lineTo(i, y);
      }
      ctx.stroke();
      // label
      ctx.font = '400 20px "JetBrains Mono", monospace';
      ctx.fillStyle = '#F4EFE6';
      ctx.fillText('LIVE AUDIO · MIC 01', 28, H - 40);
      ctx.fillStyle = '#9c958b'; ctx.fillText('44.1kHz · on-device', 300, H - 40);
    }

    // Chapter 2: setlist + decoding reference
    if (b2 > 0.02) {
      // fade transition from waveform
      ctx.globalAlpha = b2;
      ctx.fillStyle = '#0a0505'; ctx.fillRect(0, 70, W, H-70);
      ctx.font = '400 20px "JetBrains Mono", monospace';
      ctx.fillStyle = '#9c958b';
      const items = ['Praise & worship', 'Opening prayer', 'Scripture reading', 'Sermon · Romans 8', 'Altar call', 'Benediction'];
      // scan pointer
      const scanIdx = Math.min(items.length-1, Math.floor(b2 * items.length * 1.6));
      items.forEach((it, i) => {
        ctx.fillStyle = i === scanIdx ? '#ff7a2c' : (i < scanIdx ? '#F4EFE6' : '#4a4238');
        ctx.fillText((i<9?'0':'') + (i+1) + '   ' + it, 28, 130 + i*36);
        if (i === scanIdx) {
          ctx.fillStyle = '#ff7a2c'; ctx.fillText('▸', 4, 130 + i*36);
        }
      });

      // Decode target: "ROMANS 8:28"
      const target = 'ROMANS 8:28';
      const scrambleChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789';
      const decoded = Math.min(1, Math.max(0, (b2 - 0.35) / 0.55));
      const nLocked = Math.floor(decoded * target.length);
      let decodeStr = '';
      for (let i = 0; i < target.length; i++) {
        if (i < nLocked) decodeStr += target[i];
        else if (target[i] === ' ') decodeStr += ' ';
        else decodeStr += scrambleChars[(Math.floor(this._t*30) + i*7) % scrambleChars.length];
      }
      ctx.font = '500 44px "Fraunces", serif';
      ctx.fillStyle = decoded >= 1 ? '#ff7a2c' : '#ffb861';
      ctx.fillText(decodeStr, W - 380, H - 60);

      // KJV badge + confidence
      if (decoded >= 0.98) {
        ctx.font = '400 16px "JetBrains Mono", monospace';
        ctx.fillStyle = '#4fd18b';
        ctx.fillText('KJV · 98% MATCH', W - 380, H - 30);
      }
      ctx.globalAlpha = 1;
    }

    // Chapter 3: routing to screen (dim, mostly the connector line is doing the work)
    if (b3 > 0.02) {
      ctx.globalAlpha = b3;
      ctx.fillStyle = '#0a0505'; ctx.fillRect(0, 70, W, H-70);
      ctx.font = '600 48px "Fraunces", serif';
      ctx.fillStyle = '#F4EFE6';
      ctx.fillText('ROMANS 8:28', 28, 200);
      ctx.font = '400 22px "JetBrains Mono", monospace';
      ctx.fillStyle = '#ffb861';
      ctx.fillText('→ ROUTING TO PROJECTOR', 28, 260);
      ctx.font = '400 20px "JetBrains Mono", monospace';
      ctx.fillStyle = '#9c958b';
      ctx.fillText('SCREEN 1 · STAGE MONITOR · LIVESTREAM', 28, 320);
      // timer
      ctx.font = '400 96px "Fraunces", serif';
      ctx.fillStyle = '#ff7a2c';
      const timer = (1.6 * Math.min(1, Math.max(0, (b3 - 0.3)/0.7))).toFixed(1);
      ctx.textAlign = 'right';
      ctx.fillText(timer + 's', W - 28, H - 40);
      ctx.textAlign = 'left';
      ctx.globalAlpha = 1;
    }

    this._monitorTex.needsUpdate = true;
  }

  drawScreen(p, lit) {
    const ctx = this._screenCanvas.getContext('2d');
    const W = this._screenCanvas.width, H = this._screenCanvas.height;
    if (!lit) {
      // Off-state: soft warm-lit fabric so the auditorium screen reads on the
      // back wall during LISTEN + MATCH (idle, not showing content).
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#8a7566'); g.addColorStop(1, '#5a4a3e');
      ctx.fillStyle = g; ctx.fillRect(0,0,W,H);
      ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 6; ctx.strokeRect(3, 3, W-6, H-6);
      this._screenTex.needsUpdate = true;
      return;
    }
    ctx.fillStyle = '#F1EFE8'; ctx.fillRect(0,0,W,H);
    const b3 = Math.max(0, Math.min(1, (p-0.66)/0.34));
    const reveal = Math.max(0, Math.min(1, (b3 - 0.15) / 0.85));

    ctx.font = '600 30px "JetBrains Mono", monospace';
    ctx.fillStyle = '#8F2C10';
    ctx.textAlign = 'center';
    ctx.fillText('ROMANS 8:28 (KJV)', W/2, 90);

    // verse — types in
    const verse = 'And we know that all things work together for good to them that love God, to them who are the called according to his purpose.';
    const shown = verse.slice(0, Math.floor(reveal * verse.length));

    ctx.font = '400 44px "Fraunces", serif';
    ctx.fillStyle = '#0B0B0B';
    // wrap
    const words = shown.split(' ');
    const lines = [];
    let line = '';
    ctx.font = '400 44px "Fraunces", serif';
    words.forEach(w => {
      const tryLine = line ? line + ' ' + w : w;
      if (ctx.measureText(tryLine).width > W - 120) { lines.push(line); line = w; }
      else line = tryLine;
    });
    if (line) lines.push(line);
    lines.forEach((l, i) => ctx.fillText(l, W/2, 200 + i * 56));

    this._screenTex.needsUpdate = true;
  }

  tick() {
    const THREE = window.THREE;
    if (!THREE || !this._renderer) return;
    // lerp p
    this._pEased += (this._pTarget - this._pEased) * 0.12;
    const p = this._pEased;
    this._t = (performance.now() - this._start) / 1000;

    // === CAMERA PATH ===
    // p=0: back over shoulder wide (y=4, z=8, look -20)
    // p=0.33: mid pull toward monitor (y=3, z=6.2, look at monitor)
    // p=0.5: close to monitor
    // p=0.7: settling toward stage
    // p=1: framed on stage/screen
    const cam = this._camera;
    const smoothstep = (a,b,x) => { const t = Math.max(0, Math.min(1, (x-a)/(b-a))); return t*t*(3-2*t); };

    // three keyframes blended
    // LISTEN + MATCH: ONE held first-person-lifted overview — raised above the
    // tech desk with the operator, rig and auditorium (church screen) in one
    // frame. No zoom during MATCH. Then a single eased crane out into SHOW.
    // Closer, lower vantage — the operator + rig fill the mid-frame instead
    // of sitting tiny at the bottom, while the church screen stays visible up
    // top. One held POV through LISTEN + MATCH, then eased crane into SHOW.
    // Pulled back to fit the FULL man (head → torso → hands) AND the four
    // uncropped screens AND the sanctuary + church screen behind, in one frame.
    const kf = [
      { p: 0.00, pos: new THREE.Vector3(0.70, 4.85, 10.80), look: new THREE.Vector3(0.10, 2.90, -1.5) }, // held — full man + full rig + sanctuary
      { p: 0.33, pos: new THREE.Vector3(0.55, 4.80, 10.60), look: new THREE.Vector3(0.10, 2.90, -2.0) }, // slow drift only
      { p: 0.66, pos: new THREE.Vector3(0.35, 4.75, 10.35), look: new THREE.Vector3(0.10, 2.95, -2.8) }, // still overview at end of MATCH
      { p: 0.80, pos: new THREE.Vector3(0.20, 4.85, 7.30),  look: new THREE.Vector3(0.05, 4.60, -14) },   // crane starts smoothly
      { p: 0.92, pos: new THREE.Vector3(0.00, 4.60, 3.80),  look: new THREE.Vector3(0, 5.40, -19) },      // approaching stage
      { p: 1.00, pos: new THREE.Vector3(0.00, 4.20, 1.50),  look: new THREE.Vector3(0, 5.80, -22) },      // settled (SHOW unchanged)
    ];
    let kA = kf[0], kB = kf[1];
    for (let i = 0; i < kf.length-1; i++) { if (p >= kf[i].p && p <= kf[i+1].p) { kA = kf[i]; kB = kf[i+1]; break; } }
    const local = kB.p === kA.p ? 0 : smoothstep(0, 1, (p - kA.p)/(kB.p - kA.p));
    const camPos = kA.pos.clone().lerp(kB.pos, local);
    const camLook = kA.look.clone().lerp(kB.look, local);
    cam.position.copy(camPos);
    cam.lookAt(camLook);

    // === CHAPTER SIGNALS ===
    const b1 = Math.max(0, Math.min(1, p/0.33));
    const b2 = Math.max(0, Math.min(1, (p-0.33)/0.33));
    const b3 = Math.max(0, Math.min(1, (p-0.66)/0.34));

    // Mic ring pulse (LISTEN only)
    if (this._micRing) {
      const opacity = (p < 0.4 ? 1 : Math.max(0, 1 - (p-0.4)/0.15));
      const pulse = 1 + 0.35 * Math.sin(this._t * 6);
      this._micRing.scale.set(pulse, pulse, 1);
      this._micRing.material.opacity = 0.9 * opacity;
      this._micRing.lookAt(cam.position);
    }

    // Sonar rings — small, tight expansion right at the mic (no more sweeping across the room)
    if (this._sonarRings) {
      const sonarVis = p < 0.66 ? 1 : Math.max(0, 1 - (p - 0.66)/0.08);
      this._sonarRings.forEach(r => {
        const cyc = ((this._t / 2.4) + r.userData.phase) % 1;
        const scale = 1 + cyc * 3.5; // was 14 — kept local to the mic
        r.scale.setScalar(scale);
        r.position.copy(this._micPos);
        r.lookAt(cam.position);
        r.material.opacity = Math.max(0, 1 - cyc) * 0.55 * sonarVis;
      });
    }

    // ==== MATCH inverse: recolour the actual sanctuary (walls, floor, pews, clothes) ====
    let mT = 0;
    if (p >= 0.33 && p <= 0.72) {
      const inT  = Math.min(1, Math.max(0, (p - 0.34) / 0.10));
      const outT = Math.min(1, Math.max(0, (0.72 - p) / 0.08));
      mT = Math.min(inT, outT);
    }
    if (this._recolor) {
      const lc = (a, b, t) => {
        const ar = (a>>16)&255, ag = (a>>8)&255, ab = a&255;
        const br = (b>>16)&255, bg = (b>>8)&255, bb = b&255;
        return (Math.round(ar + (br-ar)*t) << 16) | (Math.round(ag + (bg-ag)*t) << 8) | Math.round(ab + (bb-ab)*t);
      };
      this._recolor.forEach(m => {
        m.color.setHex(lc(m.userData.darkHex, m.userData.lightHex, mT));
      });
    }

    // ==== Wall sign repaint per chapter (engraved on the LEFT wall, under the windows) ====
    if (this._wallSignCtx && this._wallSignTex) {
      const ctx = this._wallSignCtx;
      // clear + re-tint background
      ctx.clearRect(0, 0, 1024, 400);
      const g = ctx.createLinearGradient(0, 0, 0, 400);
      g.addColorStop(0, 'rgba(198,145,47,0.30)'); g.addColorStop(1, 'rgba(70,44,18,0.22)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 1024, 400);
      ctx.strokeStyle = 'rgba(255,184,97,0.55)'; ctx.lineWidth = 3;
      ctx.strokeRect(14, 14, 996, 372);
      // Chapter-driven copy — engraved look via shadow offsets
      const chapter = p < 0.33 ? 1 : p < 0.66 ? 2 : 3;
      const engrave = (text, y, size, col, weight) => {
        ctx.font = (weight || '600') + ' ' + size + 'px "JetBrains Mono", monospace';
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        // shadow (into the wall)
        ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillText(text, 42, y + 2);
        // highlight (out of the wall)
        ctx.fillStyle = col; ctx.fillText(text, 40, y);
      };
      if (chapter === 1) {
        engrave('• CONNECTED TO PULPIT MIC', 90, 42, '#ff7a2c', '700');
        engrave('LISTENING TO THE ROOM',   190, 38, '#F4EFE6');
        engrave('ON-DEVICE · NOTHING LEAVES THE MACHINE', 285, 30, '#F4EFE6');
      } else if (chapter === 2) {
        engrave('• MATCHING TO YOUR SETLIST', 130, 44, '#ffb861', '700');
        engrave('FINDING THE VERSE → LOCKED', 230, 34, '#F4EFE6');
      } else {
        engrave('• ON THE AUDIENCE SCREEN', 130, 42, '#ff7a2c', '700');
        engrave('IN 1.6 SECONDS', 220, 46, '#F4EFE6', '700');
      }
      this._wallSignTex.needsUpdate = true;
    }

    // Preacher's right arm swaying gently side-to-side as he preaches
    if (this._preacherArmR) {
      this._preacherArmR.rotation.y = Math.sin(this._t * 0.8) * 0.18;
      this._preacherArmR.rotation.z = -0.05 + Math.sin(this._t * 0.55) * 0.08;
    }

    // (In-scene labels moved to the LEFT-hand HUD; nothing to update here.)

    // ==== Per-chapter color grade — smoothly transitions LISTEN → MATCH → SHOW ====
    // LISTEN: warm neutral · MATCH: deeper wine + brighter orange · SHOW: warmest brightest
    const lerp = (a, b, t) => a + (b - a) * t;
    const lerpColor = (a, b, t) => {
      const ar = (a>>16)&255, ag = (a>>8)&255, ab = a&255;
      const br = (b>>16)&255, bg = (b>>8)&255, bb = b&255;
      const r = Math.round(lerp(ar, br, t));
      const g = Math.round(lerp(ag, bg, t));
      const bl = Math.round(lerp(ab, bb, t));
      return (r << 16) | (g << 8) | bl;
    };
    // Three palette targets:
    const listenGrade = { fog: 0x1a1010, amb: 0x4a3222, ambI: 1.90, hemiT: 0xffe4bc, hemiI: 1.15, house: 1.05, key: 1.90, fill: 1.80 };
    const matchGrade  = { fog: 0x1a0a12, amb: 0x5a2820, ambI: 2.10, hemiT: 0xffcda2, hemiI: 1.30, house: 1.15, key: 2.10, fill: 2.10 };
    const showGrade   = { fog: 0x261210, amb: 0x6a3624, ambI: 2.30, hemiT: 0xffddb2, hemiI: 1.55, house: 1.35, key: 2.35, fill: 2.40 };
    // Which two we blend between
    let A, B, tt;
    if (p < 0.33) { A = listenGrade; B = matchGrade; tt = p / 0.33; }
    else if (p < 0.66) { A = matchGrade; B = matchGrade; tt = (p - 0.33) / 0.33; } // hold match tone
    else { A = matchGrade; B = showGrade; tt = (p - 0.66) / 0.34; }
    // Smoothstep the transition for a Meuze-y feel
    const smooth = tt * tt * (3 - 2 * tt);
    if (this._fog)       this._fog.color.setHex(lerpColor(A.fog, B.fog, smooth));
    if (this._ambient)   { this._ambient.color.setHex(lerpColor(A.amb, B.amb, smooth)); this._ambient.intensity = lerp(A.ambI, B.ambI, smooth); }
    if (this._hemi)      { this._hemi.color.setHex(lerpColor(A.hemiT, B.hemiT, smooth)); this._hemi.intensity = lerp(A.hemiI, B.hemiI, smooth); }
    if (this._houseLight)this._houseLight.intensity = lerp(A.house, B.house, smooth);
    if (this._boothKey)  this._boothKey.intensity   = lerp(A.key,   B.key,   smooth);
    if (this._boothFill) this._boothFill.intensity  = lerp(A.fill,  B.fill,  smooth);

    // Waveform line mic→desk
    if (this._wfLine) {
      const attr = this._wfLine.geometry.attributes.position;
      const arr = attr.array;
      const start = this._micPos;
      const end = new THREE.Vector3(0, 2.55, 4.8); // to monitor
      const opacity = Math.max(0, 1 - Math.max(0, (p-0.35)/0.1));
      this._wfLine.material.opacity = opacity * 0.9;
      const n = this._wfPoints;
      // path progress — full path visible immediately; amplitude speaks
      for (let i = 0; i < n; i++) {
        const t = i / (n-1);
        const bx = start.x + (end.x - start.x) * t;
        const by = start.y + (end.y - start.y) * t;
        const bz = start.z + (end.z - start.z) * t;
        // perpendicular oscillation
        const amp = 0.2 * Math.sin(t * 30 - this._t * 8) * (0.4 + 0.6*Math.sin(t*7 + this._t*3)) * (0.4 + 0.6 * b1);
        arr[i*3] = bx;
        arr[i*3+1] = by + amp;
        arr[i*3+2] = bz;
      }
      attr.needsUpdate = true;
    }

    // Brass connector desk→screen (MATCH+)
    if (this._connLine) {
      // Connector begins right at the MATCH lock, then draws steadily up
      // through the crane, carrying the eye from PF screen to projector.
      const showFrom = 0.63;
      const drawT = Math.max(0, Math.min(1, (p - showFrom) / 0.20));
      const total = this._connSamples;
      // hack: hide by lifting far vertices high — simpler: adjust visible via opacity + range
      const draw = Math.floor(drawT * total);
      this._connLine.geometry.setDrawRange(0, draw);
      this._connLine.material.opacity = Math.min(1, drawT * 1.5);
      this._connLine.material.needsUpdate = true;
    }

    // Church projector screen is DARK all through LISTEN + MATCH.
    const screenLit = p >= 0.68;
    this.drawScreen(p, screenLit);
    const washOp = Math.max(0, Math.min(0.28, (p - 0.80) / 0.14 * 0.28));
    if (this._wash) this._wash.material.opacity = washOp;

    // Rim light from monitor
    if (this._rim) this._rim.intensity = 0.6 + b2 * 1.2 + b1 * 0.4;

    // Operator — dozing: gentle head bob + slight forward tilt
    if (this._head) {
      const doze = Math.sin(this._t * 0.9) * 0.5 + 0.5; // 0..1
      // when SHOW hits, he barely stirs — before that, he's asleep
      const bob = (p < 0.66) ? (0.045 * Math.sin(this._t * 0.9)) : (0.02 * Math.sin(this._t * 0.9));
      this._head.position.y = 0.92 + bob;
      this._head.rotation.x = 0.1 + Math.sin(this._t * 0.45) * 0.04; // nodding
      this._head.rotation.z = Math.sin(this._t * 0.3) * 0.02;
    }

    // Zzz — cartoon sleep motif. Each Z spawns small just above his head,
    // rises diagonally up-and-right, growing larger and fading out. Staggered
    // so one is always beginning as the previous finishes.
    if (this._zzzs) {
      const zVis = (p < 0.72) ? 1 : Math.max(0, 1 - (p - 0.72)/0.05);
      const cycleLen = 2.6;
      this._zzzs.forEach(z => {
        const cyc = ((this._t / cycleLen) + z.userData.phase * 0.33) % 1;
        const t = cyc;
        const xLift = 0.35 * t;
        const yLift = 0.10 + t * 1.70;
        z.position.set(0.10 + xLift, 3.22 + yLift, -0.10);
        z.rotation.z = -0.14 + t * 0.32;
        const fadeIn  = Math.min(1, t / 0.14);
        const fadeOut = Math.min(1, (1 - t) / 0.32);
        z.material.opacity = Math.min(fadeIn, fadeOut) * zVis;
        z.scale.setScalar(z.userData.base * (0.45 + t * 1.30));
        z.lookAt(this._camera.position);
      });
    }

    // Pendants flicker
    if (this._pendants) {
      this._pendants.forEach(p => {
        const f = 0.85 + 0.15 * Math.sin(this._t * 3 + p.seed) + (Math.random()-0.5)*0.06;
        p.light.intensity = p.base * f;
        p.mesh.material.opacity = f;
      });
    }

    // (dust removed intentionally)

    // All screen draws (throttle to ~30fps to keep 60fps steady on the render side)
    if (!this._lastDraw || (this._t - this._lastDraw) > 0.033) {
      this.drawPresentFlow(p);
      this.drawLogic(p);
      this.drawBible(p);
      this.drawOBS(p);
      this.drawMacbook(p);
      this._lastDraw = this._t;
    }

    this._renderer.render(this._scene, this._camera);
  }

  renderVals() {
    const s = this.state;
    const p = s.p;
    const b1 = Math.max(0, Math.min(1, p/0.33));
    const b2 = Math.max(0, Math.min(1, (p-0.33)/0.33));
    const b3 = Math.max(0, Math.min(1, (p-0.66)/0.34));

    const chapter = p < 0.33 ? 1 : p < 0.66 ? 2 : 3;
    const chapterLabels = { 1:'LISTEN', 2:'MATCH', 3:'SHOW' };
    // MATCH inverse-wash: bright beige overlay ramps up through MATCH, ramps back out before SHOW settles
    let matchWashOp = 0;
    if (p >= 0.33 && p <= 0.72) {
      const inT  = Math.min(1, Math.max(0, (p - 0.34) / 0.10));
      const outT = Math.min(1, Math.max(0, (0.72 - p) / 0.08));
      matchWashOp = Math.min(inT, outT) * 0.62;
    }

    const capListenOp = chapter === 1 ? 1 : 0;
    const capMatchOp  = chapter === 2 ? 1 : 0;
    const capShowOp   = chapter === 3 ? 1 : 0;
    // Overlap MATCH/SHOW captions on top of the LISTEN block so the sign stays the same size
    const capMatchPos = chapter === 2 ? 'relative' : 'absolute';
    const capMatchMT  = chapter === 2 ? '10px'    : '-56px';
    const capShowPos  = chapter === 3 ? 'relative' : 'absolute';
    const capShowMT   = chapter === 3 ? '10px'    : '-56px';
    const steps = [
      { n:'01', label:'LISTEN', desc:"The desktop app hears the room through whatever mic your media team already runs. On-device transcription. Nothing leaves the machine.", cls: chapter===1 ? 'active' : (chapter>1 ? 'dim' : 'dim') },
      { n:'02', label:'MATCH',  desc:"Every scripture reference, song title, and voice command is detected with a confidence score. Below your threshold, it waits. Above it, it queues.", cls: chapter===2 ? 'active' : 'dim' },
      { n:'03', label:'SHOW',   desc:"The verse pushes to projector, stage monitor, and livestream at the same instant. The operator can override with one key.", cls: chapter===3 ? 'active' : 'dim' },
    ];

    return {
      stageRef: (el) => { if (el && !this._stageEl) { this._stageEl = el; } },
      scrubRef: (el) => { if (el && !this._scrubEl) { this._scrubEl = el; } },
      canvasRef: (el) => { if (el && !this._canvas) { this._canvas = el; } },
      onScroll: (e) => this.onScrollHandler(e.target),

      pPct: (p*100).toFixed(2),
      chapterN: '0' + chapter,
      chapterLabel: chapterLabels[chapter],

      h1o: chapter === 1 ? 1 : 0, h1d: chapter === 1 ? 'block' : 'none',
      h2o: chapter === 2 ? 1 : 0, h2d: chapter === 2 ? 'block' : 'none',
      h3o: chapter === 3 ? 1 : 0, h3d: chapter === 3 ? 'block' : 'none',

      liveOp: chapter === 3 ? 1 : 0,
      timerOp: b3 > 0.3 ? 1 : 0,
      timerVal: (1.6 * Math.min(1, Math.max(0, (b3 - 0.3)/0.7))).toFixed(1),

      steps,
      capListenOp, capMatchOp, capShowOp,
      capMatchPos, capMatchMT, capShowPos, capShowMT,
      matchWashOp,
    };
  }
}
