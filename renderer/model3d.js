// Renders a brainrot's game model (parts sent by the scanner, meshes parsed in main,
// textures as data URLs) to a transparent 512x512 PNG, seen from the front like in game.
// cf array (x y z R00..R22, Roblox CFrame components) -> THREE.Matrix4
function cfMatrix(c) {
  return new THREE.Matrix4().set(c[3], c[4], c[5], c[0], c[6], c[7], c[8], c[1], c[9], c[10], c[11], c[2], 0, 0, 0, 1);
}
async function renderModel3D({ parts, meshes, textures, bones = {} }) {
  // per bone: live pose relative to rest (both in model space)
  const delta = {};
  for (const [name, b] of Object.entries(bones || {})) delta[name] = cfMatrix(b.pose).multiply(cfMatrix(b.rest).invert());
  const S = 512;
  const canvas = document.createElement('canvas'); canvas.width = S; canvas.height = S;
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  // bright, mostly frontal light like the game's own brainrot viewports
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a96, 1.05));
  const sun = new THREE.DirectionalLight(0xffffff, 0.55); sun.position.set(0.3, 0.8, -1); scene.add(sun);

  // Roblox shows the part's Color through the see-through areas of a MeshPart texture, so
  // each texture is painted over its part colour (one canvas per texture + colour pair)
  const imgCache = {}, texCache = {};
  const loadImage = id => imgCache[id] || (imgCache[id] = new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = textures[id]; }));
  const tex = async (id, under) => {
    if (!id || !textures[id]) return null;
    const key = id + '|' + (under || '');
    if (!texCache[key]) texCache[key] = loadImage(id).then(img => {
      if (!img) return null;
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const g = c.getContext('2d');
      if (under) { g.fillStyle = '#' + under; g.fillRect(0, 0, c.width, c.height); }
      g.drawImage(img, 0, 0);
      const t = new THREE.CanvasTexture(c);
      t.magFilter = THREE.NearestFilter; t.encoding = THREE.sRGBEncoding;
      return t;
    });
    return texCache[key];
  };
  const meshGeom = m => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(m.positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(m.normals, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(m.uvs, 2));
    g.setIndex(m.indices);
    if (!m.normals.some(v => v !== 0)) g.computeVertexNormals();   // no normals stored: shade from faces
    return g;
  };
  // Roblox fits a MeshPart's mesh to its Size: centre the mesh bounds, scale per axis
  const fitTo = (g, size) => {
    g.computeBoundingBox();
    const b = g.boundingBox, c = new THREE.Vector3(), d = new THREE.Vector3();
    b.getCenter(c); b.getSize(d);
    g.translate(-c.x, -c.y, -c.z);
    g.scale(d.x ? size[0] / d.x : 1, d.y ? size[1] / d.y : 1, d.z ? size[2] / d.z : 1);
    return g;
  };
  const primitive = (shape, size) => {
    if (shape === 'Ball' || shape === 'Sphere' || shape === 'Head') {
      const g = new THREE.SphereGeometry(0.5, 24, 16); g.scale(size[0], size[1], size[2]); return g;
    }
    if (shape === 'Cylinder') {   // Roblox cylinders run along X
      const g = new THREE.CylinderGeometry(0.5, 0.5, 1, 24); g.rotateZ(Math.PI / 2); g.scale(size[0], size[1], size[2]); return g;
    }
    return new THREE.BoxGeometry(size[0], size[1], size[2]);
  };

  for (const p of parts) {
    // see-through plain parts are trait effects (Bubblegum bubbles etc.) that cover the
    // brainrot; see-through MESH parts belong to the brainrot itself and stay
    if ((p.transparency || 0) >= 0.5 && !p.mesh && !p.special) continue;
    // keep the body and trait add-ons ("_Trait.Sombrero"); skip mutation effects ("EclipseOrbit")
    if (p.group && !/^_Trait\./.test(p.group)) continue;
    let geom = null, map = null;
    try {
      if (p.mesh && meshes[p.mesh]) {
        geom = fitTo(meshGeom(meshes[p.mesh]), p.size); map = await tex(p.texture, p.color);
      } else if (p.special) {
        const sp = p.special;
        if (sp.type === 'FileMesh' && sp.mesh && meshes[sp.mesh]) {
          geom = meshGeom(meshes[sp.mesh]); geom.scale(sp.scale[0], sp.scale[1], sp.scale[2]);
        } else {
          geom = primitive(sp.type === 'Brick' ? 'Block' : sp.type, p.size.map((v, i) => v * (sp.scale[i] || 1)));
        }
        geom.translate(sp.offset[0], sp.offset[1], sp.offset[2]);
        map = await tex(sp.texture || p.texture, p.color);
      } else if (p.mesh) {
        continue;   // mesh failed to download / parse: skip rather than draw a grey box
      } else {
        geom = primitive(p.shape || 'Block', p.size);
        if (p.decals && p.decals.length) map = await tex(p.decals[0].texture);
      }
    } catch { continue; }
    const mat = new THREE.MeshLambertMaterial({
      map: map || null, color: map ? 0xffffff : new THREE.Color('#' + p.color).convertSRGBToLinear(),
      // glass parts of the brainrot itself: in game they sit over a lit map, on the dark card
      // they would vanish, so they keep at least 60% cover
      transparent: p.transparency > 0, opacity: Math.max(1 - (p.transparency || 0), p.transparency > 0 ? 0.6 : 1), side: THREE.DoubleSide,
      depthWrite: !(p.transparency > 0)   // see-through parts must not cut lines into what is behind them
    });
    const partM = cfMatrix(p.cf);   // part placement relative to the model pivot
    const skin = p.mesh && meshes[p.mesh] && meshes[p.mesh].skin;
    if (skin && Object.keys(delta).length) {
      // skinned mesh: move every vertex to model space, then blend its bones' live poses
      geom.applyMatrix4(partM);
      const pos = geom.getAttribute('position');
      const v = new THREE.Vector3(), acc = new THREE.Vector3(), t = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        acc.set(0, 0, 0); let wsum = 0;
        for (let k = 0; k < 4; k++) {
          const w = skin.weights[i * 4 + k], d = delta[skin.bones[i * 4 + k]];
          if (!w || !d) continue;
          t.copy(v).applyMatrix4(d); acc.addScaledVector(t, w); wsum += w;
        }
        if (wsum > 0) { acc.addScaledVector(v, 1 - wsum); pos.setXYZ(i, acc.x, acc.y, acc.z); }
      }
      pos.needsUpdate = true;
      geom.computeVertexNormals();
      scene.add(new THREE.Mesh(geom, mat));
      continue;
    }
    const mesh = new THREE.Mesh(geom, mat);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(partM);
    scene.add(mesh);
  }
  scene.updateMatrixWorld(true);

  // frame it: the model faces -Z (Roblox LookVector); camera in front, a bit right and above
  const box = new THREE.Box3().setFromObject(scene);
  if (box.isEmpty()) { renderer.dispose(); return null; }
  const center = new THREE.Vector3(), size = new THREE.Vector3();
  box.getCenter(center); box.getSize(size);
  // fit the larger of width / height (plus a little depth) to the frame
  const fov = 30, half = Math.max(size.x, size.y, size.z * 0.6) / 2;
  const dist = half / Math.tan(THREE.MathUtils.degToRad(fov / 2)) * 1.12 + size.z / 2;
  const cam = new THREE.PerspectiveCamera(fov, 1, 0.05, dist * 10);
  cam.position.copy(center).add(new THREE.Vector3(0, 0.1, -1).normalize().multiplyScalar(dist));   // straight on, like in game
  cam.lookAt(center);
  renderer.render(scene, cam);
  const url = canvas.toDataURL('image/png');
  scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  renderer.dispose(); renderer.forceContextLoss();
  return url;
}
