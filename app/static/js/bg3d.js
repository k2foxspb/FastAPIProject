/* Fokin System — мягкий 3D-фон (Three.js через CDN). Подключается на публичных страницах. */
(function () {
    'use strict';

    var THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js';
    var PALETTE = [0x7c9cff, 0x5b47b0, 0xc4d0ff, 0x2a1f5c];

    var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var isTouch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    var lowPower = navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4;

    function webglAvailable() {
        try {
            var c = document.createElement('canvas');
            return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')));
        } catch (e) { return false; }
    }

    // Круглая радиальная текстура с заданными опорными точками градиента
    function makeTexture(THREE, size, stops) {
        var c = document.createElement('canvas');
        c.width = c.height = size;
        var g = c.getContext('2d');
        var grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
        for (var s = 0; s < stops.length; s++) grad.addColorStop(stops[s][0], stops[s][1]);
        g.fillStyle = grad;
        g.fillRect(0, 0, size, size);
        return new THREE.CanvasTexture(c);
    }

    function start(THREE) {
        var canvas = document.createElement('canvas');
        canvas.className = 'bg-canvas';
        canvas.setAttribute('aria-hidden', 'true');
        document.body.insertBefore(canvas, document.body.firstChild);

        var mobile = isTouch || window.innerWidth < 720;
        var count = mobile || lowPower ? 180 : 420;
        var renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: false, powerPreference: 'low-power' });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1 : 1.25));

        var scene = new THREE.Scene();
        scene.fog = new THREE.FogExp2(0x02040a, 0.085);
        var camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
        camera.position.z = 14;

        // Вращающаяся туманность: светящиеся частицы в диске со спиральными рукавами
        var tilt = 0.45;
        var geo = new THREE.BufferGeometry();
        var pos = new Float32Array(count * 3);
        var col = new Float32Array(count * 3);
        var rad = new Float32Array(count), ang = new Float32Array(count);
        var hgt = new Float32Array(count), phs = new Float32Array(count);
        var tmp = new THREE.Color();
        for (var i = 0; i < count; i++) {
            rad[i] = 2.2 + Math.pow(Math.random(), 0.7) * 9;
            ang[i] = Math.random() * Math.PI * 2 + (i % 2 ? Math.PI : 0) + rad[i] * 0.35 + (Math.random() - 0.5) * 0.6;
            hgt[i] = (Math.random() - 0.5) * (0.4 + rad[i] * 0.1);
            phs[i] = Math.random() * Math.PI * 2;
            tmp.setHex(PALETTE[i % PALETTE.length]);
            col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
        }
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        var points = new THREE.Points(geo, new THREE.PointsMaterial({
            size: 0.3, map: makeTexture(THREE, 64, [[0, 'rgba(255,255,255,1)'], [0.3, 'rgba(255,255,255,0.6)'], [1, 'rgba(255,255,255,0)']]),
            vertexColors: true, transparent: true, opacity: 0.28, depthWrite: false, blending: THREE.AdditiveBlending
        }));
        points.rotation.x = tilt;
        scene.add(points);

        // Далёкие тусклые звёзды на фоне, для глубины
        var sgeo = new THREE.BufferGeometry();
        var spos = new Float32Array(260 * 3);
        for (var s = 0; s < 260; s++) {
            spos[s * 3] = (Math.random() - 0.5) * 60;
            spos[s * 3 + 1] = (Math.random() - 0.5) * 40;
            spos[s * 3 + 2] = -10 - Math.random() * 20;
        }
        sgeo.setAttribute('position', new THREE.BufferAttribute(spos, 3));
        var stars = new THREE.Points(sgeo, new THREE.PointsMaterial({
            size: 0.12, map: makeTexture(THREE, 32, [[0, 'rgba(255,255,255,1)'], [0.5, 'rgba(255,255,255,0.4)'], [1, 'rgba(255,255,255,0)']]),
            color: 0xc8d2ff, transparent: true, opacity: 0.5, depthWrite: false
        }));
        scene.add(stars);

        // Чёрная дыра в центре: горизонт событий, аккреционный диск, светящееся кольцо и ореол
        var horizon = new THREE.Mesh(new THREE.SphereGeometry(1.5, 48, 32), new THREE.MeshBasicMaterial({ color: 0x000000 }));
        scene.add(horizon);

        var disk = new THREE.Mesh(
            new THREE.RingGeometry(1.7, 4.2, 128),
            new THREE.MeshBasicMaterial({
                map: makeTexture(THREE, 256, [[0, 'rgba(0,0,0,0)'], [0.4, 'rgba(0,0,0,0)'], [0.44, 'rgba(230,236,255,0.95)'], [0.6, 'rgba(124,156,255,0.45)'], [1, 'rgba(106,76,199,0)']]),
                transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending
            })
        );
        disk.rotation.x = tilt;
        scene.add(disk);

        var ring = new THREE.Mesh(
            new THREE.TorusGeometry(1.6, 0.03, 12, 128),
            new THREE.MeshBasicMaterial({ color: 0xe3eaff, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending })
        );
        ring.rotation.x = tilt;
        scene.add(ring);

        var halo = new THREE.Sprite(new THREE.SpriteMaterial({
            map: makeTexture(THREE, 128, [[0, 'rgba(124,156,255,0.3)'], [0.4, 'rgba(106,76,199,0.12)'], [1, 'rgba(106,76,199,0)']]),
            transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
        }));
        halo.scale.set(10, 10, 1);
        scene.add(halo);

        // Расчёт позиций туманности: внутренние части вращаются быстрее (дифференциальное вращение)
        function layout(t) {
            var p = geo.attributes.position.array;
            for (var k = 0; k < count; k++) {
                var idx = k * 3;
                var a = ang[k] + t * 0.12 / Math.sqrt(rad[k]);
                var rr = rad[k] * (1 + Math.sin(t * 0.3 + phs[k]) * 0.03);
                p[idx] = Math.cos(a) * rr;
                p[idx + 1] = Math.sin(a) * rr;
                p[idx + 2] = hgt[k];
            }
            geo.attributes.position.needsUpdate = true;
        }
        layout(0);

        function resize() {
            var w = window.innerWidth, h = window.innerHeight;
            renderer.setSize(w, h, false);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
        }
        resize();
        window.addEventListener('resize', resize);

        // Контроль FPS: на слабых мобильных устройствах отключаем анимацию
        var frames = 0, sampleStart = performance.now(), stopped = false;
        var t0 = performance.now();
        var rafId = 0, visible = !document.hidden;

        var lastFrame = 0;
        function render(now) {
            if (stopped || !visible) return;
            // На мобильных ограничиваем частоту кадров до ~30 FPS
            if (mobile && now - lastFrame < 33) {
                rafId = requestAnimationFrame(render);
                return;
            }
            lastFrame = now;
            var t = (now - t0) / 1000;
            layout(t);
            points.rotation.z = t * 0.02;
            var pulse = 1 + Math.sin(t * 0.7) * 0.04;
            var tiltNow = tilt + Math.sin(t * 0.2) * 0.04;
            disk.rotation.x = tiltNow;
            ring.rotation.x = tiltNow;
            points.rotation.x = tiltNow;
            halo.scale.set(10 * pulse, 10 * pulse, 1);
            camera.position.x = Math.sin(t * 0.05) * 0.8;
            camera.lookAt(0, 0, 0);
            renderer.render(scene, camera);
            rafId = requestAnimationFrame(render);
            sampleFps(now);
        }

        function sampleFps(now) {
            frames++;
            if (now - sampleStart >= 3000) {
                var fps = frames * 1000 / (now - sampleStart);
                frames = 0; sampleStart = now;
                if (mobile && fps < 28) {
                    stopped = true;
                    cancelAnimationFrame(rafId);
                    renderer.render(scene, camera);
                    canvas.style.opacity = '0.5';
                }
            }
        }

        document.addEventListener('visibilitychange', function () {
            visible = !document.hidden;
            if (visible && !stopped && !reduceMotion) rafId = requestAnimationFrame(render);
        });

        if (reduceMotion) {
            renderer.render(scene, camera);
        } else {
            rafId = requestAnimationFrame(render);
        }
    }

    function init() {
        if (reduceMotion || !webglAvailable()) return;
        // Фон не нужен на служебной странице WebSocket-теста
        if (document.documentElement.hasAttribute('data-no-bg')) return;
        import(THREE_URL).then(start).catch(function () { /* CDN недоступен — сайт работает без фона */ });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
