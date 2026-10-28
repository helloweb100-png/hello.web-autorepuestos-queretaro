/* ==========================================================================
   AUTOREPUESTOS QUERÉTARO | app.js
   --------------------------------------------------------------------------
   Librerías: Three.js r128 (escena 3D), GSAP 3.12 + ScrollTrigger (timelines
   atados al scroll), Lenis (scroll suave). Todo con degradación elegante:
   si una librería no carga, la página sigue siendo completa y usable.

   Índice
     0. Utilidades y configuración
     1. WhatsApp (enlaces y formulario)
     2. Escena 3D: ECU procedural que se arma y desarma
     3. Loader
     4. Scroll suave, header y menú
     5. Animaciones de scroll (hero, anatomía, manifiesto, etc.)
     6. Interacciones (botones, tilt, FAQ, formulario, botón flotante)
     7. Arranque
   ========================================================================== */
(function () {
    'use strict';

    /* ======================================================================
       0. UTILIDADES Y CONFIGURACIÓN
       ====================================================================== */
    var WA_NUMBER = '5214421268860';
    var root = document.documentElement;
    var $ = function (s, c) { return (c || document).querySelector(s); };
    var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };
    var clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };
    var lerp = function (a, b, t) { return a + (b - a) * t; };
    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    var isDesktop = function () { return window.innerWidth >= 900; };

    var hasGSAP = function () { return !!(window.gsap && window.ScrollTrigger); };

    var lenis = null;       // instancia de Lenis (si existe)
    var scene3D = null;     // API de la escena 3D (si existe)

    function waURL(msg) {
        return 'https://wa.me/' + WA_NUMBER + '?text=' + encodeURIComponent(msg);
    }

    /* Divide un texto en palabras conservando el marcado interno (em, span...) */
    function splitWords(el, mode) {
        var original = el.textContent.replace(/\s+/g, ' ').trim();
        var holder = document.createElement('span');
        holder.setAttribute('aria-hidden', 'true');
        while (el.firstChild) holder.appendChild(el.firstChild);
        el.appendChild(holder);

        var sr = document.createElement('span');
        sr.className = 'sr';
        sr.textContent = original;
        el.insertBefore(sr, holder);

        var walker = document.createTreeWalker(holder, NodeFilter.SHOW_TEXT);
        var texts = [];
        while (walker.nextNode()) texts.push(walker.currentNode);

        var words = [];
        texts.forEach(function (node) {
            var frag = document.createDocumentFragment();
            node.nodeValue.split(/(\s+)/).forEach(function (part) {
                if (!part) return;
                if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(' ')); return; }
                var inner = document.createElement('span');
                inner.textContent = part;
                if (mode === 'mask') {
                    var outer = document.createElement('span');
                    outer.className = 'w';
                    inner.className = 'wi';
                    outer.appendChild(inner);
                    frag.appendChild(outer);
                } else {
                    inner.className = 'mw';
                    frag.appendChild(inner);
                }
                words.push(inner);
            });
            node.parentNode.replaceChild(frag, node);
        });
        return words;
    }

    /* ======================================================================
       1. WHATSAPP: enlaces con mensaje y formulario
       ====================================================================== */
    function initWhatsApp() {
        $$('[data-wa]').forEach(function (a) { a.href = waURL(a.getAttribute('data-wa')); });
    }

    function initForm() {
        var form = $('#quote-form');
        if (!form) return;
        var fields = [
            { id: 'f-name', err: 'e-name', msg: 'Escribe tu nombre para saber cómo dirigirnos a ti.' },
            { id: 'f-car', err: 'e-car', msg: 'Indica marca, modelo y año de tu auto.' },
            { id: 'f-part', err: 'e-part', msg: 'Elige la pieza que necesitas.' }
        ];
        var help = $('#form-help');
        var submit = $('#form-submit');

        function check(f) {
            var input = $('#' + f.id);
            var err = $('#' + f.err);
            var ok = input.value.trim() !== '';
            input.closest('.field').classList.toggle('has-error', !ok);
            input.setAttribute('aria-invalid', ok ? 'false' : 'true');
            if (ok) { err.textContent = ''; } else { err.textContent = f.msg; input.setAttribute('aria-describedby', f.err); }
            return ok;
        }
        fields.forEach(function (f) {
            var input = $('#' + f.id);
            input.addEventListener('blur', function () { if (input.value.trim() !== '' || input.closest('.field').classList.contains('has-error')) check(f); });
            input.addEventListener('input', function () { if (input.closest('.field').classList.contains('has-error')) check(f); });
        });

        form.addEventListener('submit', function (e) {
            e.preventDefault();
            var valid = true, firstBad = null;
            fields.forEach(function (f) { if (!check(f)) { valid = false; if (!firstBad) firstBad = $('#' + f.id); } });
            if (!valid) { firstBad.focus(); help.textContent = 'Revisa los campos marcados para continuar.'; return; }

            var msg = [
                'Hola, quiero cotizar una pieza.',
                'Nombre: ' + $('#f-name').value.trim(),
                'Auto: ' + $('#f-car').value.trim(),
                'Pieza: ' + $('#f-part').value,
                $('#f-msg').value.trim() ? 'Detalles: ' + $('#f-msg').value.trim() : ''
            ].filter(Boolean).join('\n');

            // Sin 'noopener' en la cadena de features: con él, window.open siempre devuelve null y no se puede
            // distinguir un popup bloqueado. Se corta el vínculo con opener manualmente.
            var win = window.open(waURL(msg), '_blank');
            if (win) { try { win.opener = null; } catch (err) { /* sin acción */ } }
            else window.location.href = waURL(msg);

            form.classList.add('is-sent');
            $('.btn__label', submit).textContent = 'Listo, abriendo WhatsApp';
            help.textContent = 'Si WhatsApp no se abrió, toca el botón verde de la esquina.';
        });
    }

    /* ======================================================================
       2. ESCENA 3D
       ECU procedural (carcasa, sello, placa, chips, conectores, tapa) con
       tres instancias ancladas a elementos del DOM: hero, anatomía y cierre.
       ====================================================================== */
    function createScene3D() {
        var THREE = window.THREE;
        if (!THREE) throw new Error('Three.js no disponible');

        var canvas = $('#gl');
        var mobile = window.innerWidth < 900;
        var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
        renderer.setClearColor(0x000000, 0);
        renderer.outputEncoding = THREE.sRGBEncoding;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.0;
        var dpr = Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 1.75);
        renderer.setPixelRatio(dpr);

        var scene = new THREE.Scene();
        var FOV = 26, CAM_Z = 18;
        var camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 80);
        camera.position.set(0, 0, CAM_Z);

        var vw = 1, vh = 1, upp = 0.01;
        function resize() {
            vw = window.innerWidth; vh = window.innerHeight;
            renderer.setSize(vw, vh, false);
            camera.aspect = vw / vh;
            camera.updateProjectionMatrix();
            upp = (2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * CAM_Z) / vh;
        }
        resize();

        /* ---------- Iluminación de estudio + entorno reflectivo ---------- */
        // Estudio oscuro con cajas de luz: el metal refleja contraste real y el plástico negro se queda negro,
        // aunque la página sea clara (el canvas es transparente).
        scene.add(new THREE.HemisphereLight(0xdbe6ff, 0x1a2238, 0.35));
        var key = new THREE.DirectionalLight(0xffffff, 1.25); key.position.set(4, 9, 6); scene.add(key);
        var rim = new THREE.DirectionalLight(0x7db0ff, 1.1); rim.position.set(-6, 3, -4); scene.add(rim);

        (function buildEnvironment() {
            var env = new THREE.Scene();
            env.add(new THREE.Mesh(new THREE.BoxGeometry(24, 24, 24), new THREE.MeshBasicMaterial({ color: 0x18233d, side: THREE.BackSide })));
            function panel(w, h, x, y, z, power, color) {
                var c = new THREE.Color(color || 0xffffff).multiplyScalar(power);
                var m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
                m.position.set(x, y, z); m.lookAt(0, 0, 0); env.add(m);
            }
            panel(14, 2.2, 0, 9, 1, 8);                  // franja superior
            panel(2.4, 10, -9, 1, 3, 7);                 // luz lateral izquierda
            panel(2.4, 10, 9, 0, 2, 5, 0xbcd6ff);        // luz lateral derecha azulada
            panel(9, 2, 0, -7, 4, 2.2, 0xffc9a0);        // rebote cálido inferior (guiño al naranja)
            panel(10, 6, 0, 3, 11, 0.5, 0xffffff);       // relleno frontal suave
            var pmrem = new THREE.PMREMGenerator(renderer);
            scene.environment = pmrem.fromScene(env, 0.03).texture;
            pmrem.dispose();
        })();

        /* ---------- Utilidades de texturas y geometría ---------- */
        var maxAniso = renderer.capabilities.getMaxAnisotropy();
        function canvasTex(w, h, draw, srgb) {
            var c = document.createElement('canvas'); c.width = w; c.height = h;
            draw(c.getContext('2d'), w, h);
            var t = new THREE.CanvasTexture(c);
            if (srgb !== false) t.encoding = THREE.sRGBEncoding;
            t.anisotropy = Math.min(8, maxAniso);
            return t;
        }
        function rr(path, w, h, r) {
            var x = -w / 2, y = -h / 2;
            path.moveTo(x + r, y); path.lineTo(x + w - r, y); path.quadraticCurveTo(x + w, y, x + w, y + r);
            path.lineTo(x + w, y + h - r); path.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
            path.lineTo(x + r, y + h); path.quadraticCurveTo(x, y + h, x, y + h - r);
            path.lineTo(x, y + r); path.quadraticCurveTo(x, y, x + r, y);
            return path;
        }
        function slab(w, d, r, depth, bevel) {
            var s = rr(new THREE.Shape(), w, d, r);
            var g = new THREE.ExtrudeGeometry(s, { depth: depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 10 });
            g.rotateX(-Math.PI / 2);
            return g;
        }
        function frame(ow, od, or_, iw, id, ir, depth, bevel) {
            var s = rr(new THREE.Shape(), ow, od, or_);
            s.holes.push(rr(new THREE.Path(), iw, id, ir));
            var g = new THREE.ExtrudeGeometry(s, { depth: depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 10 });
            g.rotateX(-Math.PI / 2);
            return g;
        }
        function rng(seed) { var s = seed; return function () { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }

        /* ---------- Texturas procedurales ---------- */
        var PCB_W = 3.8, PCB_D = 2.6;
        var pulsePaths = [];   // polilíneas (u,v) por las que viajan los pulsos de luz
        var pcbTex = canvasTex(1024, 704, function (g, W, H) {
            var gr = g.createLinearGradient(0, 0, W, H);
            gr.addColorStop(0, '#0d7048'); gr.addColorStop(1, '#075a3a');
            g.fillStyle = gr; g.fillRect(0, 0, W, H);
            var r = rng(7);
            g.lineCap = 'round'; g.lineJoin = 'round';
            for (var i = 0; i < 90; i++) {
                var x = r() * W, y = r() * H, pts = [[x, y]];
                var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
                var d = dirs[Math.floor(r() * 8)];
                var segs = 3 + Math.floor(r() * 4);
                for (var s = 0; s < segs; s++) {
                    var len = 30 + r() * 120;
                    x += d[0] * len; y += d[1] * len; pts.push([x, y]);
                    var nd = dirs[Math.floor(r() * 8)];
                    if (nd[0] === -d[0] && nd[1] === -d[1]) nd = d;
                    d = nd;
                }
                g.strokeStyle = 'rgba(60,170,115,0.85)'; g.lineWidth = 3 + r() * 2;
                g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
                for (var p = 1; p < pts.length; p++) g.lineTo(pts[p][0], pts[p][1]);
                g.stroke();
                g.fillStyle = '#d8b45c';
                g.beginPath(); g.arc(pts[0][0], pts[0][1], 5, 0, 6.283); g.fill();
                g.beginPath(); g.arc(pts[pts.length - 1][0], pts[pts.length - 1][1], 5, 0, 6.283); g.fill();
                var inside = pts.every(function (q) { return q[0] > 20 && q[0] < W - 20 && q[1] > 20 && q[1] < H - 20; });
                if (inside && pulsePaths.length < 16 && i % 5 === 0) pulsePaths.push(pts.map(function (q) { return [q[0] / W, q[1] / H]; }));
            }
            // vías y serigrafía
            g.fillStyle = 'rgba(214,180,92,0.9)';
            for (var v = 0; v < 120; v++) { g.beginPath(); g.arc(r() * W, r() * H, 3.2, 0, 6.283); g.fill(); }
            g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 3; g.strokeRect(26, 26, W - 52, H - 52);
            g.fillStyle = 'rgba(255,255,255,0.6)'; g.font = '500 26px monospace';
            g.fillText('AQ-ECU  12V', 54, H - 52);
            g.fillText('C21  R47  U3', W - 300, 66);
        });
        var chipTex = canvasTex(256, 256, function (g, W, H) {
            var gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, '#1b1f27'); gr.addColorStop(1, '#0c0e12');
            g.fillStyle = gr; g.fillRect(0, 0, W, H);
            g.fillStyle = 'rgba(190,200,215,0.7)'; g.font = '600 30px monospace';
            g.fillText('AQ32', 28, 100); g.font = '400 22px monospace'; g.fillText('ECU-2204', 28, 140);
            g.beginPath(); g.arc(34, 214, 9, 0, 6.283); g.fill();
        });
        var pinTex = canvasTex(256, 256, function (g, W, H) {
            g.fillStyle = '#0d0f13'; g.fillRect(0, 0, W, H);
            var cols = 8, rows = 4, cw = W / cols, ch = H / rows;
            for (var y = 0; y < rows; y++) for (var x = 0; x < cols; x++) {
                g.fillStyle = '#3a414d'; g.fillRect(x * cw + 8, y * ch + 10, cw - 16, ch - 20);
                g.fillStyle = '#c9a24f'; g.fillRect(x * cw + cw / 2 - 5, y * ch + ch / 2 - 5, 10, 10);
            }
        });
        var carbonTex = canvasTex(128, 128, function (g, W, H) {
            g.fillStyle = '#15181d'; g.fillRect(0, 0, W, H);
            for (var y = 0; y < H; y += 16) for (var x = 0; x < W; x += 16) {
                g.fillStyle = ((x + y) / 16) % 2 ? '#262b33' : '#0e1014';
                g.fillRect(x, y, 16, 8); g.fillStyle = ((x + y) / 16) % 2 ? '#0e1014' : '#262b33'; g.fillRect(x, y + 8, 16, 8);
            }
        });
        carbonTex.wrapS = carbonTex.wrapT = THREE.RepeatWrapping; carbonTex.repeat.set(26, 18);
        var labelTex = canvasTex(640, 440, function (g, W, H) {
            var gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, '#12397F'); gr.addColorStop(1, '#06142E');
            g.fillStyle = gr; g.fillRect(0, 0, W, H);
            g.strokeStyle = 'rgba(210,220,235,0.8)'; g.lineWidth = 6; g.strokeRect(14, 14, W - 28, H - 28);
            g.textAlign = 'center';
            g.fillStyle = '#ffffff'; g.font = '800 92px "Barlow Condensed", Impact, sans-serif'; g.fillText('AUTOREPUESTOS', W / 2, 150);
            g.fillStyle = '#F47B20'; g.font = '700 64px "Barlow Condensed", Impact, sans-serif'; g.fillText('QUERÉTARO', W / 2, 218);
            g.fillStyle = '#F47B20'; g.fillRect(W / 2 - 150, 244, 300, 5);
            g.fillStyle = 'rgba(255,255,255,0.85)'; g.font = '500 30px monospace'; g.fillText('MÓDULO ECU  |  442 126 8860', W / 2, 300);
            var r = rng(11);
            for (var x = 70; x < W - 70;) { var w = 2 + Math.floor(r() * 5); g.fillStyle = 'rgba(255,255,255,0.8)'; g.fillRect(x, 330, w, 56); x += w + 3 + Math.floor(r() * 4); }
        });
        var glowTex = canvasTex(256, 256, function (g, W, H) {
            var gr = g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W / 2);
            gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(120,185,255,0.75)'); gr.addColorStop(1, 'rgba(43,123,255,0)');
            g.fillStyle = gr; g.fillRect(0, 0, W, H);
        });
        var discTex = canvasTex(256, 256, function (g, W, H) {
            var gr = g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W / 2);
            gr.addColorStop(0, 'rgba(43,123,255,0.85)'); gr.addColorStop(0.5, 'rgba(43,123,255,0.28)'); gr.addColorStop(1, 'rgba(43,123,255,0)');
            g.fillStyle = gr; g.fillRect(0, 0, W, H);
        });
        var shadowTex = canvasTex(256, 256, function (g, W, H) {
            var gr = g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W / 2);
            gr.addColorStop(0, 'rgba(16,48,106,0.5)'); gr.addColorStop(1, 'rgba(16,48,106,0)');
            g.fillStyle = gr; g.fillRect(0, 0, W, H);
        });
        var dotTex = canvasTex(64, 64, function (g, W, H) {
            var gr = g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W / 2);
            gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
            g.fillStyle = gr; g.fillRect(0, 0, W, H);
        });

        /* ---------- Materiales ---------- */
        var M = {
            alu: new THREE.MeshStandardMaterial({ color: 0xbcc5d3, metalness: 1, roughness: 0.38 }),
            aluDark: new THREE.MeshStandardMaterial({ color: 0x9aa4b4, metalness: 1, roughness: 0.45 }),
            steel: new THREE.MeshStandardMaterial({ color: 0xd3dae5, metalness: 1, roughness: 0.3 }),
            plastic: new THREE.MeshStandardMaterial({ color: 0x14171d, metalness: 0.1, roughness: 0.5, envMapIntensity: 0.35 }),
            rubber: new THREE.MeshStandardMaterial({ color: 0x14161a, metalness: 0, roughness: 0.85, envMapIntensity: 0.3 }),
            gold: new THREE.MeshStandardMaterial({ color: 0xdcb45c, metalness: 1, roughness: 0.28 }),
            chip: new THREE.MeshStandardMaterial({ color: 0xffffff, map: chipTex, metalness: 0.2, roughness: 0.42, envMapIntensity: 0.45 }),
            chipPlain: new THREE.MeshStandardMaterial({ color: 0x15181d, metalness: 0.2, roughness: 0.45, envMapIntensity: 0.4 }),
            orange: new THREE.MeshStandardMaterial({ color: 0xf06a0e, metalness: 0.1, roughness: 0.42, envMapIntensity: 0.4 }),
            label: new THREE.MeshStandardMaterial({ map: labelTex, metalness: 0.2, roughness: 0.45, envMapIntensity: 0.5 }),
            pins: new THREE.MeshStandardMaterial({ map: pinTex, metalness: 0.2, roughness: 0.5, envMapIntensity: 0.4 }),
            resistor: new THREE.MeshStandardMaterial({ color: 0x2a2520, metalness: 0.1, roughness: 0.6, envMapIntensity: 0.4 })
        };
        var geo = {
            chip: function (w, h, d) { return new THREE.BoxGeometry(w, h, d); },
            cap: new THREE.CylinderGeometry(0.085, 0.085, 0.21, 20),
            capTop: new THREE.CylinderGeometry(0.07, 0.07, 0.006, 20),
            screw: new THREE.CylinderGeometry(0.075, 0.075, 0.05, 6),
            pin: new THREE.BoxGeometry(0.028, 0.02, 0.07),
            res: new THREE.BoxGeometry(0.1, 0.03, 0.05)
        };

        /* ---------- Constructor de una ECU completa ---------- */
        function buildECU() {
            var group = new THREE.Group();
            var P = {};

            // Bandeja inferior (carcasa de aluminio)
            P.tray = new THREE.Group();
            P.tray.add(new THREE.Mesh(frame(4.2, 3.0, 0.22, 3.84, 2.64, 0.12, 0.34, 0.02), M.alu));
            var floor = new THREE.Mesh(slab(4.2, 3.0, 0.22, 0.06, 0.01), M.aluDark); P.tray.add(floor);
            [[-1.95, -1.62], [1.95, -1.62], [-1.95, 1.62], [1.95, 1.62]].forEach(function (p) {
                var lug = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.1, 24), M.alu); lug.position.set(p[0], 0.05, p[1]); P.tray.add(lug);
            });
            group.add(P.tray);

            // Placa electrónica
            P.pcb = new THREE.Group();
            var pcbMat = new THREE.MeshStandardMaterial({ map: pcbTex, roughness: 0.5, metalness: 0.12, emissive: new THREE.Color(0x2b7bff), emissiveMap: pcbTex, emissiveIntensity: 0.05, envMapIntensity: 0.5 });
            var maskMat = new THREE.MeshStandardMaterial({ color: 0x0a6a43, roughness: 0.55, metalness: 0.1, envMapIntensity: 0.5 });
            P.pcbBody = new THREE.Mesh(new THREE.BoxGeometry(PCB_W, 0.07, PCB_D), [maskMat, maskMat, pcbMat, maskMat, maskMat, maskMat]);
            P.pcb.add(P.pcbBody);
            // resistencias instanciadas (evitando las zonas de chips grandes)
            var keepOut = [[-0.5, -0.1, 0.62], [0.75, -0.75, 0.4], [0.75, -0.25, 0.4], [-1.5, -0.85, 0.3], [-1.5, -0.35, 0.3], [-1.5, 0.15, 0.3], [0.9, 0.8, 0.28], [1.75, -0.7, 0.75], [1.75, 0.7, 0.75]];
            var rr_ = rng(31), n = mobile ? 40 : 70, resMesh = new THREE.InstancedMesh(geo.res, M.resistor, n), mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), placed = 0, tries = 0;
            while (placed < n && tries < 600) {
                tries++;
                var rx = (rr_() - 0.5) * 3.5, rz = (rr_() - 0.5) * 2.3, ok = true;
                for (var k = 0; k < keepOut.length; k++) if (Math.abs(rx - keepOut[k][0]) < keepOut[k][2] && Math.abs(rz - keepOut[k][1]) < keepOut[k][2]) { ok = false; break; }
                if (!ok) continue;
                e.set(0, rr_() > 0.5 ? 0 : Math.PI / 2, 0); q.setFromEuler(e);
                mtx.compose(new THREE.Vector3(rx, 0.05, rz), q, new THREE.Vector3(1, 1, 1)); resMesh.setMatrixAt(placed++, mtx);
            }
            resMesh.count = placed; resMesh.instanceMatrix.needsUpdate = true; P.pcb.add(resMesh);
            // pulsos de luz que recorren las pistas
            P.pulses = [];
            var glowMat = new THREE.SpriteMaterial({ map: glowTex, color: 0x7fc0ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
            pulsePaths.slice(0, mobile ? 8 : 14).forEach(function (path, i) {
                var spr = new THREE.Sprite(glowMat); spr.scale.set(0.3, 0.3, 1); P.pcb.add(spr);
                var lens = [0], total = 0;
                for (var a = 1; a < path.length; a++) { total += Math.hypot((path[a][0] - path[a - 1][0]) * PCB_W, (path[a][1] - path[a - 1][1]) * PCB_D); lens.push(total); }
                P.pulses.push({ spr: spr, path: path, lens: lens, total: total, speed: 0.35 + (i % 5) * 0.09, off: i * 0.173 });
            });
            P.pcbMat = pcbMat;
            group.add(P.pcb);

            // Chips (cada uno se separa de la placa por su cuenta)
            P.chips = [];
            function addChip(mesh, x, z, h, lift, dx, dz) { group.add(mesh); P.chips.push({ mesh: mesh, x: x, z: z, h: h, lift: lift, dx: dx, dz: dz }); return mesh; }

            // Microcontrolador principal con patillas
            var mcu = new THREE.Group();
            var mcuBody = new THREE.Mesh(geo.chip(0.95, 0.12, 0.95), [M.chipPlain, M.chipPlain, M.chip, M.chipPlain, M.chipPlain, M.chipPlain]); mcu.add(mcuBody);
            var pinCount = 14, pinMesh = new THREE.InstancedMesh(geo.pin, M.steel, pinCount * 4), pi = 0;
            for (var s = 0; s < pinCount; s++) {
                var off = -0.42 + s * (0.84 / (pinCount - 1));
                // [x, z, giro]: dos lados con patillas a lo largo de Z y dos a lo largo de X
                [[off, 0.51, 0], [off, -0.51, 0], [0.51, off, Math.PI / 2], [-0.51, off, Math.PI / 2]].forEach(function (pp) {
                    q.setFromEuler(e.set(0, pp[2], 0));
                    mtx.compose(new THREE.Vector3(pp[0], -0.02, pp[1]), q, new THREE.Vector3(1, 1, 1));
                    pinMesh.setMatrixAt(pi++, mtx);
                });
            }
            pinMesh.instanceMatrix.needsUpdate = true; mcu.add(pinMesh);
            P.mcuPoint = new THREE.Object3D(); P.mcuPoint.position.set(0, 0.08, 0); mcu.add(P.mcuPoint);
            addChip(mcu, -0.5, -0.1, 0.12, 1.1, -0.25, -0.1);

            addChip(new THREE.Mesh(geo.chip(0.55, 0.09, 0.36), M.chip), 0.75, -0.75, 0.09, 1.45, 0.3, -0.2);
            addChip(new THREE.Mesh(geo.chip(0.55, 0.09, 0.36), M.chip), 0.75, -0.25, 0.09, 0.8, 0.35, 0.05);
            [-0.85, -0.35, 0.15].forEach(function (z, i) { addChip(new THREE.Mesh(geo.chip(0.45, 0.07, 0.28), M.chipPlain), -1.5, z, 0.07, 0.55 + i * 0.32, -0.3, 0); });
            var reg = new THREE.Mesh(geo.chip(0.36, 0.11, 0.36), M.chip); addChip(reg, 0.9, 0.8, 0.11, 1.2, 0.1, 0.35);
            addChip(new THREE.Mesh(geo.chip(0.32, 0.1, 0.16), M.steel), -0.3, 1.0, 0.1, 0.95, 0, 0.35);
            [[-1.55, 0.85], [-1.2, 0.97], [0.1, 0.97], [0.5, 0.95]].forEach(function (c, i) {
                var cg = new THREE.Group(); var body = new THREE.Mesh(geo.cap, i % 2 ? M.gold : M.alu); var top = new THREE.Mesh(geo.capTop, M.chipPlain); top.position.y = 0.105; cg.add(body, top);
                addChip(cg, c[0], c[1], 0.21, 0.7 + i * 0.22, (i % 2 ? 0.2 : -0.2), 0.3);
            });
            [[0.05, -1.05], [-0.65, -1.05]].forEach(function (c, i) { addChip(new THREE.Mesh(geo.chip(0.3, 0.18, 0.3), M.chipPlain), c[0], c[1], 0.18, 0.9 + i * 0.3, 0, -0.35); });

            // Conectores multipin con palanca naranja
            P.conn = new THREE.Group();
            [-0.7, 0.7].forEach(function (z) {
                var cg = new THREE.Group();
                cg.add(new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.46, 1.12), M.plastic));
                var face = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.38), M.pins); face.rotation.y = Math.PI / 2; face.position.set(0.505, 0, 0); cg.add(face);
                var latch = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.05, 0.34), M.orange); latch.position.set(-0.02, 0.255, 0); cg.add(latch);
                cg.position.set(1.75, 0.5, z); P.conn.add(cg);
            });
            P.connPoint = new THREE.Object3D(); P.connPoint.position.set(2.3, 0.5, 0); P.conn.add(P.connPoint);
            group.add(P.conn);

            // Sello de goma
            P.gasket = new THREE.Mesh(frame(4.1, 2.9, 0.2, 3.5, 2.3, 0.14, 0.035, 0), M.rubber);
            group.add(P.gasket);

            // Tapa disipadora con aletas, etiqueta de marca y tornillos
            P.cover = new THREE.Group();
            P.cover.add(new THREE.Mesh(slab(4.2, 3.0, 0.22, 0.09, 0.02), M.alu));
            for (var side = -1; side <= 1; side += 2) for (var f = 0; f < 6; f++) {
                var fin = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.14, 2.45), M.alu); fin.position.set(side * (0.92 + f * 0.17), 0.18, 0); P.cover.add(fin);
            }
            var lab = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.17), M.label); lab.rotation.x = -Math.PI / 2; lab.position.set(0, 0.125, 0); P.cover.add(lab);
            [[-1.92, -1.32], [1.92, -1.32], [-1.92, 1.32], [1.92, 1.32]].forEach(function (p) { var sc = new THREE.Mesh(geo.screw, M.steel); sc.position.set(p[0], 0.13, p[1]); P.cover.add(sc); });
            P.coverPoint = new THREE.Object3D(); P.coverPoint.position.set(-1.5, 0.15, 1.1); P.cover.add(P.coverPoint);
            group.add(P.cover);

            P.pcbPoint = new THREE.Object3D(); P.pcbPoint.position.set(1.0, 0.04, 1.0); P.pcb.add(P.pcbPoint);
            return { group: group, parts: P };
        }

        /* ---------- Plataforma de acero con inserto de carbono (guiño al arte del cliente) ---------- */
        function buildPlatform() {
            var g = new THREE.Group();
            var steel = M.steel.clone(); steel.transparent = true;
            var base = new THREE.Mesh(slab(6.0, 4.4, 0.35, 0.26, 0.03), steel); g.add(base);
            var carbonMat = new THREE.MeshStandardMaterial({ map: carbonTex, metalness: 0.5, roughness: 0.35, transparent: true, envMapIntensity: 0.6 });
            var carbon = new THREE.Mesh(new THREE.PlaneGeometry(5.3, 3.7).rotateX(-Math.PI / 2), carbonMat); carbon.position.y = 0.3; g.add(carbon);
            var stripMat = new THREE.MeshBasicMaterial({ color: 0x3d8bff, toneMapped: false, transparent: true });
            var strip = new THREE.Mesh(frame(5.3, 3.7, 0.2, 5.18, 3.58, 0.16, 0.012, 0), stripMat); strip.position.y = 0.3; g.add(strip);
            var discMat = new THREE.MeshBasicMaterial({ map: discTex, transparent: true, depthWrite: false, toneMapped: false });
            var disc = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 5.6).rotateX(-Math.PI / 2), discMat); disc.position.y = 0.33; g.add(disc);
            var rings = [];
            for (var i = 0; i < 3; i++) {
                var rm = new THREE.MeshBasicMaterial({ color: 0x3d8bff, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
                var ring = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 64).rotateX(-Math.PI / 2), rm); ring.position.y = 0.34; g.add(ring); rings.push(ring);
            }
            var shMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.55 });
            var shadow = new THREE.Mesh(new THREE.PlaneGeometry(10, 7.4).rotateX(-Math.PI / 2), shMat); shadow.position.y = -0.04; g.add(shadow);
            g.position.y = -0.78;
            return { group: g, mats: [steel, carbonMat, stripMat, discMat, shMat], strip: stripMat, disc: discMat, rings: rings };
        }

        /* ---------- Instancias ancladas al DOM ---------- */
        var MODEL_W = 6.0;
        var instances = [];
        function createInstance(name, anchorSel, cfg) {
            var anchor = $(anchorSel);
            if (!anchor) return null;
            var root_ = new THREE.Group(), pivot = new THREE.Group(), ecu = buildECU(), plat = buildPlatform();
            pivot.add(plat.group); pivot.add(ecu.group);
            ecu.group.position.y = -0.1;
            root_.add(pivot); scene.add(root_);
            var inst = {
                name: name, anchor: anchor, root: root_, pivot: pivot, parts: ecu.parts, plat: plat, fit: cfg.fit, enabled: true, visible: false, phase: instances.length * 1.7,
                state: Object.assign({ cover: 0, gasket: 0, chips: 0, conn: 0, tray: 0, glow: 0, plat: 1, rotY: -0.5, tilt: 0.62, spin: 0, idle: 1, mouse: 1, float: 1, lift: 0, k: 1 }, cfg.state || {})
            };
            instances.push(inst);
            return inst;
        }

        var vecT = new THREE.Vector3();
        function placeInstance(inst) {
            var r = inst.anchor.getBoundingClientRect();
            var vis = r.width > 0 && r.bottom > -80 && r.top < vh + 80 && inst.enabled;
            inst.root.visible = vis; inst.visible = vis;
            if (!vis) return false;
            inst.root.position.set((r.left + r.width / 2 - vw / 2) * upp, -(r.top + r.height / 2 - vh / 2) * upp, 0);
            inst.root.scale.setScalar(Math.min(r.width, r.height * 1.25) * inst.fit * upp / MODEL_W);
            return true;
        }

        var px = 0, py = 0, tx = 0, ty = 0;
        window.addEventListener('pointermove', function (ev) { tx = (ev.clientX / vw) * 2 - 1; ty = (ev.clientY / vh) * 2 - 1; }, { passive: true });

        function updateInstance(inst, t) {
            var s = inst.state, P = inst.parts, bob = Math.sin(t * 1.15 + inst.phase) * 0.05 * s.float;
            var pcbY = 0.2 - s.tray * 0.7;

            var k = s.k;   // multiplicador de la distancia de separación (más corto en móvil)
            P.tray.position.y = -s.tray * 1.5 * k;
            P.pcb.position.y = pcbY;
            P.gasket.position.set(0, 0.42 + s.gasket * 1.35 * k + bob * 0.5, -s.gasket * 0.45 * k);
            P.cover.position.set(0, 0.46 + s.cover * 2.9 * k + bob, -s.cover * 1.25 * k);
            P.cover.rotation.set(-s.cover * 0.3, s.cover * 0.3, 0);
            P.conn.position.x = s.conn * 1.9 * k;
            P.conn.position.y = pcbY - 0.2 + s.conn * 0.12;
            for (var i = 0; i < P.chips.length; i++) {
                var c = P.chips[i];
                c.mesh.position.set(c.x + c.dx * s.chips * k, pcbY + 0.035 + c.h / 2 + s.chips * c.lift * k + Math.sin(t * 1.6 + i) * 0.018 * s.float, c.z + c.dz * s.chips * k);
            }
            P.pcbMat.emissiveIntensity = 0.04 + s.glow * 0.2 + Math.sin(t * 2.2) * 0.03 * (0.4 + s.glow);
            // pulsos de luz sobre las pistas
            for (var j = 0; j < P.pulses.length; j++) {
                var pu = P.pulses[j], d = ((t * pu.speed * (1 + s.glow * 1.6) + pu.off) % 1) * pu.total, k = 1;
                while (k < pu.lens.length - 1 && pu.lens[k] < d) k++;
                var segLen = pu.lens[k] - pu.lens[k - 1] || 1, f = clamp((d - pu.lens[k - 1]) / segLen, 0, 1);
                var a = pu.path[k - 1], b = pu.path[k];
                pu.spr.position.set((lerp(a[0], b[0], f) - 0.5) * PCB_W, 0.06, (lerp(a[1], b[1], f) - 0.5) * PCB_D);
                pu.spr.material.opacity = 0.55 + s.glow * 0.45;
            }

            // plataforma, halo y ondas
            var pl = inst.plat, on = clamp(s.plat, 0, 1);
            pl.group.visible = on > 0.01; pl.group.scale.setScalar(0.6 + on * 0.4);
            pl.mats.forEach(function (m, idx) { m.opacity = idx === 4 ? 0.55 * on : on; });
            pl.strip.opacity = on * (0.75 + Math.sin(t * 2.4) * 0.25);
            pl.disc.opacity = on * (0.8 + Math.sin(t * 1.6) * 0.2);
            for (var r_ = 0; r_ < pl.rings.length; r_++) {
                var ph = ((t * 0.45 + r_ / 3) % 1);
                pl.rings[r_].scale.setScalar(1.2 + ph * 2.6); pl.rings[r_].material.opacity = (1 - ph) * 0.45 * on;
            }

            // orientación: base + giro + vaivén suave + parallax del puntero
            inst.pivot.rotation.y = s.rotY + s.spin + Math.sin(t * 0.35) * 0.22 * s.idle + px * 0.32 * s.mouse;
            inst.pivot.rotation.x = s.tilt + py * 0.1 * s.mouse;
            inst.pivot.position.y = Math.sin(t * 0.9) * 0.08 * s.float + s.lift;
        }

        /* ---------- Partículas ambientales ---------- */
        var PN = mobile ? 70 : 150, pPos = new Float32Array(PN * 3), pSpd = new Float32Array(PN), pBox = { w: 20, h: 12 };
        for (var i = 0; i < PN; i++) { pPos[i * 3] = (Math.random() - 0.5) * pBox.w; pPos[i * 3 + 1] = (Math.random() - 0.5) * pBox.h; pPos[i * 3 + 2] = -5 + Math.random() * 8; pSpd[i] = 0.12 + Math.random() * 0.35; }
        var pGeo = new THREE.BufferGeometry(); pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
        var pMat = new THREE.PointsMaterial({ map: dotTex, size: 0.14, color: 0x2b7bff, transparent: true, opacity: 0.5, depthWrite: false, sizeAttenuation: true });
        var particles = new THREE.Points(pGeo, pMat); scene.add(particles);
        var pGeo2 = new THREE.BufferGeometry(), pPos2 = new Float32Array(20 * 3);
        for (var n2 = 0; n2 < 20; n2++) { pPos2[n2 * 3] = (Math.random() - 0.5) * pBox.w; pPos2[n2 * 3 + 1] = (Math.random() - 0.5) * pBox.h; pPos2[n2 * 3 + 2] = -3 + Math.random() * 6; }
        pGeo2.setAttribute('position', new THREE.BufferAttribute(pPos2, 3));
        var particles2 = new THREE.Points(pGeo2, new THREE.PointsMaterial({ map: dotTex, size: 0.16, color: 0xf47b20, transparent: true, opacity: 0.6, depthWrite: false })); scene.add(particles2);

        // Las partículas suben solas y además se desplazan con el scroll (parallax por profundidad)
        var lastScroll = window.scrollY || 0;
        function updateParticles(dt) {
            var sy = window.scrollY || 0, ds = (sy - lastScroll) * upp * 0.3; lastScroll = sy;
            var halfW = (vw * upp) / 2 + 2, halfH = (vh * upp) / 2 + 1;
            function step(arr, i, speed, depthK) {
                var iy = i * 3 + 1;
                arr[iy] += speed * dt + ds * depthK;
                if (arr[iy] > halfH) { arr[iy] -= halfH * 2; arr[i * 3] = (Math.random() - 0.5) * halfW * 2; }
                else if (arr[iy] < -halfH) { arr[iy] += halfH * 2; arr[i * 3] = (Math.random() - 0.5) * halfW * 2; }
            }
            for (var i = 0; i < PN; i++) step(pPos, i, pSpd[i], 0.4 + (pPos[i * 3 + 2] + 5) / 13);
            pGeo.attributes.position.needsUpdate = true;
            for (var j = 0; j < 20; j++) step(pPos2, j, 0.22, 0.9);
            pGeo2.attributes.position.needsUpdate = true;
        }

        /* ---------- Bucle de render ---------- */
        var frameHook = null, slowFrames = 0, sampled = 0, time = 0;
        function render(dt) {
            if (document.hidden) return;
            time += dt;
            px += (tx - px) * 0.06; py += (ty - py) * 0.06;
            var anyVisible = false;
            for (var i = 0; i < instances.length; i++) {
                var inst = instances[i];
                if (placeInstance(inst)) { updateInstance(inst, time); anyVisible = true; }
            }
            updateParticles(dt);
            renderer.render(scene, camera);
            if (frameHook) frameHook(camera, vw, vh);

            // Calidad adaptativa: si el equipo no da la talla, baja la resolución una vez
            if (sampled < 120) { sampled++; if (dt > 0.034) slowFrames++; if (sampled === 120 && slowFrames > 70 && dpr > 1) { dpr = 1; renderer.setPixelRatio(1); resize(); } }
            return anyVisible;
        }

        var api = {
            resize: resize,
            render: render,
            instances: instances,
            create: createInstance,
            project: function (obj) {
                obj.getWorldPosition(vecT); vecT.project(camera);
                return { x: (vecT.x * 0.5 + 0.5) * vw, y: (-vecT.y * 0.5 + 0.5) * vh };
            },
            onFrame: function (fn) { frameHook = fn; }
        };
        return api;
    }

    /* ======================================================================
       3. LOADER
       ====================================================================== */
    function startLoader() {
        var loader = $('#loader');
        var num = $('#ld-num'), status = $('#ld-status'), arc = $('.ld__arc');
        var messages = ['Iniciando sistemas', 'Conectando módulos', 'Leyendo sensores', 'Calibrando catálogo', 'Listo para arrancar'];
        var MIN = reduceMotion ? 600 : 2600;
        var t0 = performance.now(), progress = 0, cap = 86, released = false, finished = false, resolveDone;
        var done = new Promise(function (res) { resolveDone = res; });

        function frame(now) {
            if (finished) return;
            var timeTarget = Math.min((now - t0) / MIN, 1) * 100;
            var target = Math.min(timeTarget, released ? 100 : cap);
            progress += (target - progress) * 0.14;
            var shown = Math.min(100, Math.round(progress));
            num.textContent = shown;
            arc.style.setProperty('--p', progress.toFixed(2));
            var m = messages[Math.min(messages.length - 1, Math.floor(progress / 21))];
            if (status.textContent !== m) status.textContent = m;
            if (released && progress > 99.3) { finished = true; num.textContent = '100'; arc.style.setProperty('--p', '100'); exit(); return; }
            requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);

        function exit() {
            if (!hasGSAP() || reduceMotion) {
                loader.style.transition = 'opacity .5s'; loader.style.opacity = '0';
                setTimeout(function () { loader.remove(); root.classList.remove('is-loading'); }, 520);
                resolveDone(); return;
            }
            var tl = gsap.timeline({ defaults: { ease: 'power3.inOut' } });
            tl.to('.ld__core', { scale: 0.9, opacity: 0, duration: 0.55 }, 0.25)
              .to('.ld__seam', { opacity: 1, scaleX: 1, duration: 0.5 }, 0.2)
              .add(function () { root.classList.remove('is-loading'); resolveDone(); }, 0.75)
              .to('.ld__panel--a', { yPercent: -101, duration: 1.05, ease: 'power4.inOut' }, 0.75)
              .to('.ld__panel--b', { yPercent: 101, duration: 1.05, ease: 'power4.inOut' }, 0.75)
              .to('.ld__seam', { opacity: 0, duration: 0.3 }, 0.95)
              .add(function () { loader.remove(); }, '>');
        }
        return { release: function () { released = true; }, done: done };
    }

    /* ======================================================================
       4. SCROLL SUAVE, HEADER Y MENÚ
       ====================================================================== */
    function initSmoothScroll() {
        if (reduceMotion || !window.Lenis || !hasGSAP()) return;
        lenis = new window.Lenis({ lerp: 0.085, wheelMultiplier: 0.95, smoothWheel: true });
        window.lenis = lenis;   // útil para depurar y para enlaces externos
        lenis.on('scroll', ScrollTrigger.update);
        gsap.ticker.add(function (time) { lenis.raf(time * 1000); });
        gsap.ticker.lagSmoothing(0);
    }

    function scrollToTarget(target) {
        if (lenis) lenis.scrollTo(target, { duration: 1.7, easing: function (t) { return 1 - Math.pow(1 - t, 4); } });
        else target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    }

    function initAnchors() {
        document.addEventListener('click', function (e) {
            var a = e.target.closest('a[href^="#"]');
            if (!a) return;
            var hash = a.getAttribute('href');
            if (hash.length < 2) return;
            var target = $(hash);
            if (!target) return;
            e.preventDefault();
            closeMenu();
            scrollToTarget(target);
            history.replaceState(null, '', hash);
        });
    }

    var menuEl, burger;
    function closeMenu() {
        if (!menuEl || !menuEl.classList.contains('is-open')) return;
        menuEl.classList.remove('is-open'); menuEl.setAttribute('aria-hidden', 'true');
        burger.setAttribute('aria-expanded', 'false'); burger.setAttribute('aria-label', 'Abrir menú');
        root.classList.remove('menu-open'); if (lenis) lenis.start();
    }
    function initHeaderAndMenu() {
        var nav = $('#nav');
        // Header con fondo al hacer scroll: IntersectionObserver sobre un centinela
        var sentinel = document.createElement('div');
        sentinel.style.cssText = 'position:absolute;top:0;left:0;width:1px;height:24px;pointer-events:none';
        document.body.prepend(sentinel);
        new IntersectionObserver(function (en) { nav.classList.toggle('is-scrolled', !en[0].isIntersecting); }).observe(sentinel);

        menuEl = $('#menu'); burger = $('#burger');
        burger.addEventListener('click', function () {
            var open = !menuEl.classList.contains('is-open');
            menuEl.classList.toggle('is-open', open);
            menuEl.setAttribute('aria-hidden', open ? 'false' : 'true');
            burger.setAttribute('aria-expanded', open ? 'true' : 'false');
            burger.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');
            root.classList.toggle('menu-open', open);
            if (lenis) { if (open) lenis.stop(); else lenis.start(); }
        });
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenu(); });
        window.matchMedia('(min-width: 1040px)').addEventListener('change', closeMenu);
    }

    /* ======================================================================
       5. ANIMACIONES DE SCROLL
       ====================================================================== */
    function initScrollAnimations() {
        gsap.registerPlugin(ScrollTrigger);
        ScrollTrigger.config({ ignoreMobileResize: true });

        // Barra de progreso global
        gsap.to('#progress-bar', { scaleX: 1, ease: 'none', scrollTrigger: { start: 0, end: 'max', scrub: 0 } });

        // IMPORTANTE: primero los elementos fijados (pin), en orden de documento. Los ScrollTriggers
        // de las secciones inferiores se crean después para que cuenten el espacio que añade cada pin.
        /* ---------- Piezas que dependen del tamaño de pantalla ---------- */
        var mm = gsap.matchMedia();
        mm.add({ desktop: '(min-width: 900px)', mobile: '(max-width: 899px)' }, function (ctx) {
            var desktop = ctx.conditions.desktop, vh = window.innerHeight;
            var hero = scene3D && scene3D.hero, anat = scene3D && scene3D.anat, fin = scene3D && scene3D.final;

            // Hero: el texto se aleja y la tapa del módulo empieza a levantarse
            gsap.to('.hero__copy', { yPercent: -14, opacity: 0.15, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } });
            gsap.to('.hero__bg', { yPercent: 12, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } });
            // fromTo explícito + immediateRender:false para no pisar la animación de entrada
            if (hero) gsap.fromTo(hero.state, { cover: 0.36, gasket: 0.14, spin: 0, tilt: 0.62 }, { cover: 1.05, gasket: 0.5, spin: 0.9, tilt: 0.8, ease: 'none', immediateRender: false, scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom 20%', scrub: 0.6 } });

            // Anatomía: el módulo se desarma pieza por pieza
            if (anat) {
                var steps = $$('.callout'), rail = $$('.anat__rail li'), activeStep = -1;
                var partFor = ['coverPoint', 'pcbPoint', 'mcuPoint', 'connPoint', null];
                var line = $('#leader-line'), dot = $('#leader-dot'), halo = $('#leader-halo'), pin = $('.anat__pin');
                var A = anat.state;
                function setStep(i) {
                    if (i === activeStep) return; activeStep = i;
                    steps.forEach(function (el, k) { el.classList.toggle('is-on', k === i); });
                    rail.forEach(function (el, k) { el.classList.toggle('is-on', k === i); el.classList.toggle('is-done', k < i); });
                }
                var tl = gsap.timeline({
                    defaults: { ease: 'power2.inOut' },
                    scrollTrigger: { trigger: '.anat', start: 'top top', end: '+=' + Math.round(vh * (desktop ? 5.2 : 4.4)), pin: true, scrub: 0.7, anticipatePin: 1, onUpdate: function (self) { setStep(clamp(Math.floor(self.progress * 5), 0, 4)); } }
                });
                tl.to(A, { cover: 1, gasket: 1, rotY: 0.45, tilt: 0.78, duration: 1 }, 0)
                  .to(A, { glow: 1, cover: 1.75, gasket: 1.25, rotY: 0.95, tilt: 0.86, duration: 1 }, 1)
                  .to(A, { chips: 1, gasket: 1.9, cover: 2.1, rotY: 1.35, duration: 1 }, 2)
                  .to(A, { conn: 1, tray: 1, rotY: 1.9, tilt: 0.7, duration: 1 }, 3)
                  .to(A, { cover: 0, gasket: 0, chips: 0, conn: 0, tray: 0, glow: 0.4, rotY: Math.PI * 2 - 0.5, tilt: 0.62, lift: -0.35, duration: 1 }, 4)
                  .fromTo(A, { plat: 0 }, { plat: 1, duration: 0.6, ease: 'power2.out', immediateRender: false }, 4.3);

                // La tarjeta de explicación sigue a la pieza activa y una línea guía las une
                var card = $('.anat__callouts'), cx = 0, cy = 0, cardInit = false;
                function hideLeader() { line.style.visibility = 'hidden'; dot.style.visibility = 'hidden'; halo.style.visibility = 'hidden'; }
                scene3D.onFrame(function (camera, vw, vh) {
                    if (!desktop || !anat.visible) { hideLeader(); return; }
                    var pr = pin.getBoundingClientRect(), cw = card.offsetWidth, ch = card.offsetHeight;
                    var attached = activeStep >= 0 && partFor[activeStep];
                    var tx, ty, pt = null;
                    if (attached) {
                        pt = scene3D.project(anat.parts[partFor[activeStep]]);
                        tx = clamp(pt.x + 70, pr.left + vw * 0.34, vw - cw - 28);
                        ty = clamp(pt.y - ch - 46, 84, vh - ch - 28);
                    } else { tx = vw - cw - 40; ty = vh * 0.2; }
                    if (!cardInit) { cx = tx; cy = ty; cardInit = true; }
                    cx += (tx - cx) * 0.14; cy += (ty - cy) * 0.14;
                    card.style.transform = 'translate3d(' + (cx - pr.left).toFixed(1) + 'px,' + (cy - pr.top).toFixed(1) + 'px,0)';
                    if (!pt) { hideLeader(); return; }
                    // punto más cercano del borde de la tarjeta a la pieza
                    var ex = clamp(pt.x, cx, cx + cw), ey = clamp(pt.y, cy, cy + ch);
                    var x1 = pt.x - pr.left, y1 = pt.y - pr.top;
                    line.setAttribute('x1', x1); line.setAttribute('y1', y1); line.setAttribute('x2', ex - pr.left); line.setAttribute('y2', ey - pr.top);
                    [dot, halo].forEach(function (c) { c.setAttribute('cx', x1); c.setAttribute('cy', y1); c.style.visibility = 'visible'; });
                    line.style.visibility = 'visible';
                });
            }

            // Zoom: la imagen se abre hasta ocupar toda la pantalla
            (function zoom() {
                var frame = $('#zoom-frame'), img = $('#zoom-img'), content = $('#zoom-content'); if (!frame) return;
                gsap.set(frame, { clipPath: desktop ? 'inset(22% 27% round 28px)' : 'inset(25% 8% round 22px)' });
                gsap.set(img, { scale: 0.7 });
                gsap.set(content, { opacity: 0, y: 40 });
                var tl = gsap.timeline({ defaults: { ease: 'none' }, scrollTrigger: { trigger: '.zoom', start: 'top top', end: '+=' + Math.round(vh * 2.1), pin: true, scrub: 0.8, anticipatePin: 1 } });
                tl.to(frame, { clipPath: 'inset(0% 0% round 0px)', duration: 1, ease: 'power2.inOut' }, 0)
                  .to(img, { scale: 1, duration: 1, ease: 'power2.inOut' }, 0)
                  .to('.zoom__word--l', { yPercent: -150, opacity: 0, duration: 0.8, ease: 'power2.in' }, 0.05)
                  .to('.zoom__word--r', { yPercent: 150, opacity: 0, duration: 0.8, ease: 'power2.in' }, 0.05)
                  .to(content, { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' }, 0.78)
                  .to({}, { duration: 0.45 });
            })();

            // Proceso: recorrido horizontal con barra de avance
            (function process() {
                var track = $('#process-track'), bar = $('#process-bar'); if (!track) return;
                var dist = function () { return Math.max(0, track.offsetWidth - window.innerWidth); };
                var tween = gsap.to(track, {
                    x: function () { return -dist(); }, ease: 'none',
                    scrollTrigger: { trigger: '.process', start: 'top top', end: function () { return '+=' + dist(); }, pin: true, scrub: 1, anticipatePin: 1, invalidateOnRefresh: true, onUpdate: function (self) { bar.style.transform = 'scaleX(' + self.progress.toFixed(4) + ')'; } }
                });
                $$('.pstep:not(.pstep--intro)').forEach(function (s) {
                    gsap.fromTo(s, { opacity: 0.35, scale: 0.92 }, { opacity: 1, scale: 1, ease: 'none', scrollTrigger: { trigger: s, containerAnimation: tween, start: 'left 96%', end: 'left 62%', scrub: true } });
                });
            })();

            // Cierre: el módulo se vuelve a armar al llegar al formulario
            if (fin) {
                var F = fin.state;
                gsap.set(F, { cover: 1, gasket: 1, chips: 1, conn: 1, tray: 1, rotY: -1.4, plat: 0.2 });
                gsap.to(F, { cover: 0, gasket: 0, chips: 0, conn: 0, tray: 0, rotY: -0.5, plat: 1, ease: 'power2.inOut', scrollTrigger: { trigger: '.contact__stage', start: 'top 92%', end: 'center 45%', scrub: 0.9 } });
            }
        });

        // Marquee: velocidad y sesgo reaccionan a la velocidad del scroll
        (function marquee() {
            var track = $('#marquee-track'); if (!track) return;
            var lists = $$('.marquee__list', track), x = 0, dir = -1, vel = 0, lastY = window.scrollY, onScreen = true, base = 70;
            new IntersectionObserver(function (en) { onScreen = en[0].isIntersecting; }).observe(track.parentElement);
            if (reduceMotion) return;
            gsap.ticker.add(function (t, dtms) {
                var dt = Math.min(dtms, 50) / 1000, y = window.scrollY, pps = (y - lastY) / Math.max(dt, 0.001);
                lastY = y; vel = lerp(vel, pps, 0.08);
                if (!onScreen) return;
                if (Math.abs(vel) > 40) dir = vel > 0 ? -1 : 1;
                x += dir * (base + Math.min(Math.abs(vel) * 0.35, 520)) * dt;
                var w = lists[0].offsetWidth;
                if (x <= -w) x += w; else if (x > 0) x -= w;
                track.style.transform = 'translate3d(' + x.toFixed(1) + 'px,0,0) skewX(' + clamp(-vel / 260, -9, 9).toFixed(2) + 'deg)';
            });
        })();

        // Titulares con revelado por palabras (máscara)
        $$('[data-words]').forEach(function (h) {
            var words = splitWords(h, 'mask');
            gsap.set(words, { yPercent: 118 });
            ScrollTrigger.create({ trigger: h, start: 'top 86%', once: true, onEnter: function () { gsap.to(words, { yPercent: 0, duration: 1.15, ease: 'power4.out', stagger: 0.055 }); } });
        });

        // Revelado genérico por lotes
        var revealSel = ['.section-head .eyebrow', '.section-head__sub', '.faq__side .eyebrow', '.faq__side .btn', '.tile', '.more', '.stock__title', '.stock__item', '.ship__card', '.ship__order', '.acc__item', '.where__addr', '.where__note', '.where__actions', '.social', '.where__map', '.form', '.contact__stage', '.foot__grid > *', '.anat__lead'];
        revealSel.forEach(function (sel) {
            var els = $$(sel); if (!els.length) return;
            gsap.set(els, { opacity: 0, y: 36 });
            ScrollTrigger.batch(els, {
                start: 'top 90%', once: true,
                onEnter: function (batch) { gsap.to(batch, { opacity: 1, y: 0, duration: 1.1, ease: 'power3.out', stagger: 0.09, onComplete: function () { gsap.set(batch, { clearProps: 'transform,opacity' }); } }); }
            });
        });

        // Manifiesto: las palabras se encienden con el scroll
        (function manifesto() {
            var p = $('#manifesto-text'); if (!p) return;
            var words = splitWords(p, 'plain');
            gsap.set(words, { opacity: 0.14 });
            gsap.to(words, { opacity: 1, ease: 'none', stagger: 0.12, scrollTrigger: { trigger: p, start: 'top 80%', end: 'bottom 48%', scrub: 0.6 } });
        })();

        // Tarjetas apiladas: la anterior se encoge al llegar la siguiente
        (function stack() {
            var cards = $$('.pcard');
            cards.forEach(function (card, i) {
                if (i === cards.length - 1) return;
                gsap.to(card, { scale: 0.93, opacity: 0.55, ease: 'none', scrollTrigger: { trigger: cards[i + 1], start: 'top 88%', end: 'top 20%', scrub: true } });
            });
        })();

        // Cierre: footer con texto gigante que sube
        gsap.fromTo('#foot-giant', { yPercent: 55, opacity: 0.2 }, { yPercent: 0, opacity: 1, ease: 'none', scrollTrigger: { trigger: '.foot', start: 'top 85%', end: 'bottom bottom', scrub: true } });

    }

    /* Entrada del hero: textos con máscara y módulo que se ensambla */
    function prepareIntro() {
        if (!hasGSAP()) return;
        gsap.set('.hero__title .line__in', { yPercent: 112 });
        gsap.set('[data-hero="item"]', { opacity: 0, y: 26 });
        gsap.set('.seal', { opacity: 0, scale: 0.6, rotate: -40 });
        gsap.set('.nav', { opacity: 0, yPercent: -40 });
        if (scene3D && scene3D.hero) {
            var h = scene3D.hero.state;
            h.cover = 2.2; h.gasket = 1.4; h.chips = 1.4; h.conn = 1.2; h.tray = 1; h.spin = 2.4; h.plat = 0;
        }
    }
    function playIntro() {
        if (!hasGSAP()) { root.classList.remove('is-loading'); return; }
        var tl = gsap.timeline({ defaults: { ease: 'power4.out' } });
        tl.to('.hero__title .line__in', { yPercent: 0, duration: 1.3, stagger: 0.14 }, 0.05)
          .to('[data-hero="item"]', { opacity: 1, y: 0, duration: 1, stagger: 0.12 }, 0.3)
          .to('.seal', { opacity: 1, scale: 1, rotate: 0, duration: 1.4 }, 0.7)
          .to('.nav', { opacity: 1, yPercent: 0, duration: 1.1 }, 0.4);
        if (scene3D && scene3D.hero) {
            var h = scene3D.hero.state;
            gsap.to(h, { spin: 0, duration: 2.8, ease: 'power3.out' });
            gsap.to(h, { cover: 0.36, gasket: 0.14, chips: 0.07, conn: 0, tray: 0, duration: 2.6, ease: 'power3.inOut', delay: 0.2 });
            gsap.to(h, { plat: 1, duration: 1.8, ease: 'power2.out', delay: 0.9 });
        }
        var wa = $('#wa-float');
        setTimeout(function () { wa.classList.add('is-visible'); }, 1600);
        setTimeout(function () { wa.classList.add('show-tip'); }, 6500);
        setTimeout(function () { wa.classList.remove('show-tip'); }, 12000);
    }

    /* ======================================================================
       6. INTERACCIONES
       ====================================================================== */
    function initInteractions() {
        // Botones: el relleno nace donde entra el cursor; el contenido sigue al puntero
        $$('.btn').forEach(function (btn) {
            function setXY(e) {
                var r = btn.getBoundingClientRect();
                btn.style.setProperty('--x', ((e.clientX - r.left) / r.width * 100).toFixed(1) + '%');
                btn.style.setProperty('--y', ((e.clientY - r.top) / r.height * 100).toFixed(1) + '%');
            }
            btn.addEventListener('pointerenter', setXY);
            btn.addEventListener('pointerleave', setXY);
            if (finePointer && hasGSAP() && !reduceMotion) {
                var inner = $$('.btn__label, i', btn);
                btn.addEventListener('pointermove', function (e) {
                    var r = btn.getBoundingClientRect();
                    gsap.to(inner, { x: (e.clientX - r.left - r.width / 2) * 0.12, y: (e.clientY - r.top - r.height / 2) * 0.2, duration: 0.5, ease: 'power3.out', overwrite: 'auto' });
                });
                btn.addEventListener('pointerleave', function () { gsap.to(inner, { x: 0, y: 0, duration: 0.7, ease: 'elastic.out(1,0.5)', overwrite: 'auto' }); });
            }
        });

        // Bento: inclinación 3D y reflector de luz
        if (finePointer && !reduceMotion) {
            $$('[data-tilt]').forEach(function (tile) {
                tile.addEventListener('pointermove', function (e) {
                    var r = tile.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
                    tile.style.setProperty('--ry', ((x - 0.5) * 9).toFixed(2) + 'deg');
                    tile.style.setProperty('--rx', ((0.5 - y) * 9).toFixed(2) + 'deg');
                    tile.style.setProperty('--mx', (x * 100).toFixed(1) + '%');
                    tile.style.setProperty('--my', (y * 100).toFixed(1) + '%');
                });
                tile.addEventListener('pointerleave', function () { tile.style.setProperty('--rx', '0deg'); tile.style.setProperty('--ry', '0deg'); });
            });
        }

        // FAQ: acordeón accesible (uno abierto a la vez)
        var items = $$('.acc__item');
        items.forEach(function (item) {
            var btn = $('.acc__btn', item);
            btn.addEventListener('click', function () {
                var open = !item.classList.contains('is-open');
                items.forEach(function (it) { it.classList.remove('is-open'); $('.acc__btn', it).setAttribute('aria-expanded', 'false'); });
                if (open) { item.classList.add('is-open'); btn.setAttribute('aria-expanded', 'true'); }
                if (hasGSAP()) setTimeout(function () { ScrollTrigger.refresh(); }, 650);
            });
        });
    }

    /* ======================================================================
       7. ARRANQUE
       ====================================================================== */
    function withTimeout(p, ms) { return Promise.race([p, new Promise(function (r) { setTimeout(r, ms); })]); }

    function boot() {
        if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
        window.scrollTo(0, 0);

        initWhatsApp();
        initForm();
        initHeaderAndMenu();
        initAnchors();
        initInteractions();
        var animOK = hasGSAP();
        if (reduceMotion || !animOK) root.classList.add('reduced');

        var loader = startLoader();

        var windowLoaded = new Promise(function (res) { if (document.readyState === 'complete') res(); else window.addEventListener('load', res, { once: true }); });
        var fontsReady = (document.fonts && document.fonts.load)
            ? Promise.all([document.fonts.load('800 40px "Barlow Condensed"'), document.fonts.load('400 16px "Geist"'), document.fonts.ready])
            : Promise.resolve();

        withTimeout(Promise.all([windowLoaded, withTimeout(fontsReady, 4500)]), 9000).then(function () {
            // 3D: se construye cuando las fuentes ya están listas (la etiqueta de la ECU las usa)
            if (window.THREE && animOK && !reduceMotion) {
                try {
                    var s = createScene3D();
                    s.hero = s.create('hero', '[data-anchor="hero"]', { fit: 0.92, state: { cover: 0.36, gasket: 0.14, chips: 0.07, plat: 1 } });
                    s.anat = s.create('anatomy', '[data-anchor="anatomy"]', { fit: isDesktop() ? 0.64 : 0.8, state: { plat: 0, tilt: 0.66, rotY: -0.4, mouse: 0.5, lift: isDesktop() ? -0.95 : -0.55, k: isDesktop() ? 1 : 0.55 } });
                    s.final = s.create('final', '[data-anchor="final"]', { fit: 0.92, state: { cover: 0, plat: 1 } });
                    scene3D = s;
                    window.addEventListener('resize', function () { s.resize(); });
                    gsap.ticker.add(function (t, dtms) { s.render(Math.min(dtms, 50) / 1000); });
                } catch (err) {
                    console.warn('Escena 3D desactivada:', err);
                    root.classList.add('no-webgl');
                    scene3D = null;
                }
            } else {
                root.classList.add('no-webgl');
            }

            if (animOK && !reduceMotion) {
                try {
                    initSmoothScroll();
                    initScrollAnimations();
                    ScrollTrigger.refresh();
                    prepareIntro();   // después del refresh, para que el estado "desarmado" no se sobrescriba
                    var rt; window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(function () { ScrollTrigger.refresh(); }, 250); });
                } catch (err) {
                    console.warn('Animaciones de scroll desactivadas:', err);
                    root.classList.add('reduced');
                }
            }

            loader.release();
            return loader.done;
        }).then(function () {
            if (animOK && !reduceMotion) playIntro();
            else { var wa = $('#wa-float'); wa.classList.add('is-visible'); }
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
