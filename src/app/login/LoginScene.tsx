"use client";

/**
 * Login backdrop — a receding paper-line grid with a monolith at the vanishing
 * point (ported from the PresentFlow login redesign). Lazy-loaded and skipped
 * under reduced-motion. Purely decorative; the form works with or without it.
 */
import { useEffect, useRef } from "react";
import * as THREE from "three";

export default function LoginScene() {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#0a0908");
    scene.fog = new THREE.Fog("#0a0908", 18, 60);

    const camera = new THREE.PerspectiveCamera(38, container.clientWidth / container.clientHeight, 0.1, 200);
    camera.position.set(0, 1.35, 8.5);
    camera.lookAt(0, 0.8, -30);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    const lineMat = new THREE.LineBasicMaterial({ color: 0xece7e0, transparent: true, opacity: 0.55 });
    const lineDim = new THREE.LineBasicMaterial({ color: 0xece7e0, transparent: true, opacity: 0.18 });
    const lineBright = new THREE.LineBasicMaterial({ color: 0xece7e0, transparent: true, opacity: 0.85 });

    const ground = new THREE.Group();
    scene.add(ground);
    const GRID_LEN = 220, GRID_WID = 60, LINES_LONG = 61, LINES_LAT = 90;

    for (let i = 0; i < LINES_LONG; i++) {
      const x = (i / (LINES_LONG - 1) - 0.5) * GRID_WID;
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, 0, 2), new THREE.Vector3(x, 0, -GRID_LEN)]);
      ground.add(new THREE.Line(g, i % 10 === 0 ? lineMat : lineDim));
    }
    for (let j = 0; j < LINES_LAT; j++) {
      const z = 2 - Math.pow(j / (LINES_LAT - 1), 1.15) * GRID_LEN;
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-GRID_WID / 2, 0, z), new THREE.Vector3(GRID_WID / 2, 0, z)]);
      ground.add(new THREE.Line(g, j % 5 === 0 ? lineMat : lineDim));
    }
    {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-200, 0.001, -GRID_LEN), new THREE.Vector3(200, 0.001, -GRID_LEN)]);
      ground.add(new THREE.Line(g, lineBright));
    }

    const shaftMat = new THREE.MeshBasicMaterial({ color: 0xece7e0, transparent: true, opacity: 0.95 });
    const monolith = new THREE.Group();
    monolith.position.set(0, 0, -GRID_LEN + 2);
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.55, 6, 0.55), shaftMat);
    shaft.position.y = 3;
    monolith.add(shaft);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.9, 4), shaftMat);
    cap.rotation.y = Math.PI / 4;
    cap.position.y = 6.45;
    monolith.add(cap);
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.25, 1.4), shaftMat);
    plinth.position.y = 0.125;
    monolith.add(plinth);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xece7e0, transparent: true, opacity: 0.45, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.6, 1.62, 96), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 3.2;
    monolith.add(ring);
    scene.add(monolith);

    const floaterMeta: { line: THREE.Line; speed: number }[] = [];
    for (let i = 0; i < 14; i++) {
      const w = 6 + Math.random() * 10;
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-w / 2, 0, 0), new THREE.Vector3(w / 2, 0, 0)]);
      const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xece7e0, transparent: true, opacity: 0.15 + Math.random() * 0.3 }));
      line.position.set(0, 1.2 + Math.random() * 4.5, -Math.random() * GRID_LEN);
      scene.add(line);
      floaterMeta.push({ line, speed: 0.6 + Math.random() * 0.9 });
    }

    const start = performance.now();
    let raf = 0;
    let alive = true;
    const tick = () => {
      if (!alive) return;
      const t = (performance.now() - start) / 1000;
      camera.position.x = Math.sin(t * 0.12) * 0.35;
      camera.position.y = 1.35 + Math.sin(t * 0.18) * 0.08;
      camera.lookAt(Math.sin(t * 0.06) * 0.15, 0.85, -30);
      ground.position.z = (t * 3.5) % ((GRID_LEN / (LINES_LAT - 1)) * 6);
      for (const f of floaterMeta) {
        f.line.position.z += f.speed * 0.03;
        if (f.line.position.z > 6) {
          f.line.position.z = -GRID_LEN + Math.random() * 20;
          f.line.position.y = 1.2 + Math.random() * 4.5;
        }
        const d = Math.min(1, Math.max(0, -f.line.position.z / GRID_LEN));
        (f.line.material as THREE.LineBasicMaterial).opacity = 0.08 + (1 - d) * 0.35;
      }
      ring.material.opacity = 0.25 + Math.sin(t * 0.9) * 0.15;
      ring.scale.setScalar(1 + Math.sin(t * 0.7) * 0.03);
      shaft.material.opacity = 0.85 + Math.sin(t * 1.3) * 0.08;
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    tick();

    const onResize = () => {
      const w = container.clientWidth, h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", onResize);

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
      });
      renderer.domElement.parentNode?.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={ref} style={{ position: "absolute", inset: 0 }} aria-hidden="true" />;
}
