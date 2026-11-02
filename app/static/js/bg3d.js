/* Fokin System — мягкий 3D-фон (Three.js через CDN). Подключается на публичных страницах. */
(function () {
    'use strict';

    var THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
    var PALETTE = [0xf0a04b, 0xd9643a, 0xf6c28b, 0x9a3a46];

    var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var isTouch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    var lowPower = navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4;

    function webglAvailable() {
        try {
            var c = document.createElement('canvas');
            return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')));
        } catch (e) { return false; }
    }

    function start(THREE) {
        var canvas = document.createElement('canvas');
        canvas.className = 'bg-canvas';
        canvas.setAttribute('aria-hidden', 'true');
        document.body.insertBefore(canvas, document.body.firstChild);

        var mobile = isTouch || window.innerWidth < 720;
        var count = mobile || lowPower ? 380 : 900;
        var renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: false, powerPreference: 'low-power' });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1 : 1.5));

        var scene = new THREE.Scene();
        scene.fog = new THREE.FogExp2(0x1d1411, 0.085);
        var camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
        camera.position.z = 14;

        // Дрейфующие частицы
        var geo = new THREE.BufferGeometry();
        var pos = new Float32Array(count * 3);
        var col = new Float32Array(count * 3);
        var base = new Float32Array(count * 3);
        var tmp = new THREE.Color();
        for (var i = 0; i < count; i++) {
            var x = (Math.random() - 0.5) * 34, y = (Math.random() - 0.5) * 22, z = (Math.random() - 0.5) * 22;
            pos[i * 3] = base[i * 3] = x;
            pos[i * 3 + 1] = base[i * 3 + 1] = y;
            pos[i * 3 + 2] = base[i * 3 + 2] = z;
            tmp.setHex(PALETTE[i % PALETTE.length]);
            col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
        }
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        var points = new THREE.Points(geo, new THREE.PointsMaterial({
            size: 0.09, vertexColors: true, transparent: true, opacity: 0.75, depthWrite: false
        }));
        scene.add(points);

        // Мягко пульсирующая сфера-сетка
        var orb = new THREE.Mesh(
            new THREE.IcosahedronGeometry(3.2, 2),
            new THREE.MeshBasicMaterial({ color: 0xf0a04b, wireframe: true, transparent: true, opacity: 0.12 })
        );
        scene.add(orb);

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

        function render(now) {
            if (stopped || !visible) return;
            var t = (now - t0) / 1000;
            var p = geo.attributes.position.array;
            for (var k = 0; k < count; k++) {
                var idx = k * 3;
                p[idx + 1] = base[idx + 1] + Math.sin(t * 0.2 + k) * 0.35;
                p[idx] = base[idx] + Math.cos(t * 0.12 + k * 0.5) * 0.25;
            }
            geo.attributes.position.needsUpdate = true;
            points.rotation.y = t * 0.02;
            var s = 1 + Math.sin(t * 0.9) * 0.05;
            orb.scale.set(s, s, s);
            orb.rotation.y = t * 0.08;
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
