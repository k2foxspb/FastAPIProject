/* Fokin System — общий скрипт сайта и документации (vanilla JS, без зависимостей) */
(function () {
    'use strict';

    var root = document.documentElement;
    var STORAGE_KEY = 'fokin-theme';
    var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* ---------- Тема (применяется сразу, чтобы не было мерцания) ---------- */
    function storedTheme() {
        try { return localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
    }
    function systemTheme() {
        return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }
    function applyTheme(theme) { root.setAttribute('data-theme', theme); }
    applyTheme(storedTheme() || systemTheme());

    function $(sel, ctx) { return (ctx || document).querySelector(sel); }
    function $$(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }

    function ready(fn) {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
        else fn();
    }

    /* ---------- Toast ---------- */
    var toastRegion;
    function toast(message) {
        if (!toastRegion) {
            toastRegion = document.createElement('div');
            toastRegion.className = 'toast-region';
            toastRegion.setAttribute('role', 'status');
            toastRegion.setAttribute('aria-live', 'polite');
            document.body.appendChild(toastRegion);
        }
        var el = document.createElement('div');
        el.className = 'toast';
        el.textContent = message;
        toastRegion.appendChild(el);
        setTimeout(function () {
            if (el.parentNode) el.parentNode.removeChild(el);
        }, 2200);
    }

    function copyText(text) {
        if (navigator.clipboard && window.isSecureContext) {
            return navigator.clipboard.writeText(text);
        }
        return new Promise(function (resolve, reject) {
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            try {
                document.execCommand('copy') ? resolve() : reject(new Error('copy failed'));
            } catch (e) { reject(e); }
            document.body.removeChild(ta);
        });
    }

    /* ---------- Переключатель темы ---------- */
    function initThemeToggle() {
        var bar = $('.topbar');
        if (!bar) return;
        var host = $('.topbar-actions', bar);
        if (!host) {
            host = document.createElement('div');
            host.className = 'topbar-actions';
            // Существующее содержимое топбара не трогаем, кнопку добавляем в конец
            bar.appendChild(host);
        }
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'icon-btn theme-toggle';
        function refresh() {
            var light = root.getAttribute('data-theme') === 'light';
            btn.textContent = light ? '\u263E' : '\u2600';
            btn.setAttribute('aria-label', light ? 'Включить тёмную тему' : 'Включить светлую тему');
            btn.setAttribute('title', btn.getAttribute('aria-label'));
            btn.setAttribute('aria-pressed', light ? 'true' : 'false');
        }
        btn.addEventListener('click', function () {
            var next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
            applyTheme(next);
            try { localStorage.setItem(STORAGE_KEY, next); } catch (e) { /* ignore */ }
            refresh();
        });
        host.appendChild(btn);
        refresh();

        // Следим за системной темой, пока пользователь не выбрал свою
        if (window.matchMedia) {
            var mq = window.matchMedia('(prefers-color-scheme: light)');
            var onChange = function () {
                if (!storedTheme()) { applyTheme(systemTheme()); refresh(); }
            };
            if (mq.addEventListener) mq.addEventListener('change', onChange);
        }
    }

    /* ---------- Прогресс чтения и «Наверх» ---------- */
    function initProgressAndTop() {
        var bar = document.createElement('div');
        bar.className = 'progress-bar';
        bar.setAttribute('aria-hidden', 'true');
        document.body.appendChild(bar);

        var top = document.createElement('button');
        top.type = 'button';
        top.className = 'to-top';
        top.setAttribute('aria-label', 'Наверх');
        top.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="18 15 12 9 6 15"></polyline></svg>';
        top.addEventListener('click', function () {
            window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
        });
        document.body.appendChild(top);

        var ticking = false;
        function update() {
            var h = document.documentElement;
            var max = h.scrollHeight - h.clientHeight;
            var ratio = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
            bar.style.transform = 'scaleX(' + ratio + ')';
            top.classList.toggle('visible', window.scrollY > 500);
            ticking = false;
        }
        window.addEventListener('scroll', function () {
            if (!ticking) { ticking = true; requestAnimationFrame(update); }
        }, { passive: true });
        window.addEventListener('resize', update);
        update();
    }

    /* ---------- Якоря у заголовков ---------- */
    function slugify(text) {
        return text.toLowerCase().replace(/[^a-z0-9\u0400-\u04ff]+/g, '-').replace(/^-+|-+$/g, '') || 'section';
    }
    function initAnchors() {
        var used = {};
        $$('[id]').forEach(function (el) { used[el.id] = true; });
        $$('.container h2, .container h3').forEach(function (h) {
            if (!h.id) {
                var base = slugify(h.textContent), id = base, n = 2;
                while (used[id]) id = base + '-' + (n++);
                used[id] = true;
                h.id = id;
            }
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'anchor-btn';
            btn.textContent = '#';
            btn.setAttribute('aria-label', 'Скопировать ссылку на раздел');
            btn.addEventListener('click', function () {
                var url = location.origin + location.pathname + '#' + h.id;
                history.replaceState(null, '', '#' + h.id);
                copyText(url).then(function () { toast('Ссылка скопирована'); },
                                   function () { toast('Не удалось скопировать ссылку'); });
            });
            h.appendChild(btn);
        });
    }

    /* ---------- Копирование кода ---------- */
    function initCopyButtons() {
        $$('.code-block').forEach(function (block) {
            var pre = $('pre', block);
            if (!pre || $('.copy-btn', block)) return;
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'icon-btn copy-btn';
            btn.textContent = 'Копировать';
            btn.addEventListener('click', function () {
                copyText(pre.textContent.replace(/\s+$/, '')).then(function () {
                    toast('Скопировано в буфер обмена');
                    btn.textContent = 'Готово \u2713';
                    setTimeout(function () { btn.textContent = 'Копировать'; }, 1600);
                }, function () { toast('Не удалось скопировать'); });
            });
            block.appendChild(btn);
        });
    }

    /* ---------- Вкладки ---------- */
    function initTabs() {
        $$('[data-tabs]').forEach(function (group, gi) {
            var list = $('.tablist', group);
            var tabs = $$('.tab-btn', group);
            var panels = $$('.tabpanel', group);
            if (!list || !tabs.length) return;
            list.setAttribute('role', 'tablist');
            tabs.forEach(function (tab, i) {
                var panel = panels[i];
                var tid = 'tab-' + gi + '-' + i, pid = 'panel-' + gi + '-' + i;
                tab.id = tid; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', pid);
                if (panel) { panel.id = pid; panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', tid); }
            });
            function select(index, focus) {
                tabs.forEach(function (tab, i) {
                    var on = i === index;
                    tab.setAttribute('aria-selected', on ? 'true' : 'false');
                    tab.tabIndex = on ? 0 : -1;
                    if (panels[i]) panels[i].hidden = !on;
                });
                if (focus) tabs[index].focus();
            }
            tabs.forEach(function (tab, i) {
                tab.addEventListener('click', function () { select(i, false); });
                tab.addEventListener('keydown', function (e) {
                    var n = tabs.length, next = null;
                    if (e.key === 'ArrowRight') next = (i + 1) % n;
                    else if (e.key === 'ArrowLeft') next = (i - 1 + n) % n;
                    else if (e.key === 'Home') next = 0;
                    else if (e.key === 'End') next = n - 1;
                    if (next !== null) { e.preventDefault(); select(next, true); }
                });
            });
            var start = tabs.findIndex ? tabs.findIndex(function (t) { return t.getAttribute('aria-selected') === 'true'; }) : 0;
            select(start < 0 ? 0 : start, false);
        });
    }

    /* ---------- FAQ: развернуть/свернуть всё ---------- */
    function initFaqControls() {
        $$('[data-faq-all]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var open = btn.getAttribute('data-faq-all') === 'open';
                $$('details.faq').forEach(function (d) { d.open = open; });
            });
        });
    }

    /* ---------- Мобильное меню содержания ---------- */
    function initSidebar() {
        var sidebar = $('.sidebar');
        if (!sidebar) return;
        var toggle = $('[data-menu-toggle]');
        var backdrop = $('.sidebar-backdrop');
        function setOpen(open) {
            sidebar.classList.toggle('open', open);
            if (backdrop) backdrop.classList.toggle('open', open);
            if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
            if (open) {
                var f = $('input, a', sidebar);
                if (f) f.focus();
            }
        }
        if (toggle) toggle.addEventListener('click', function () { setOpen(!sidebar.classList.contains('open')); });
        if (backdrop) backdrop.addEventListener('click', function () { setOpen(false); });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && sidebar.classList.contains('open')) {
                setOpen(false);
                if (toggle) toggle.focus();
            }
        });
        $$('a[href^="#"]', sidebar).forEach(function (a) {
            a.addEventListener('click', function () { setOpen(false); });
        });
    }

    /* ---------- Scroll-spy ---------- */
    function initScrollSpy() {
        var links = $$('.toc a[href^="#"]');
        if (!links.length || !('IntersectionObserver' in window)) return;
        var map = {};
        links.forEach(function (a) { map[a.getAttribute('href').slice(1)] = a; });
        var sections = $$('.doc-section[id]').filter(function (s) { return map[s.id]; });
        var visible = {};
        function setActive(id) {
            links.forEach(function (a) {
                var on = a === map[id];
                a.classList.toggle('active', on);
                if (on) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
            });
        }
        var io = new IntersectionObserver(function (entries) {
            entries.forEach(function (en) { visible[en.target.id] = en.isIntersecting; });
            for (var i = 0; i < sections.length; i++) {
                if (visible[sections[i].id]) { setActive(sections[i].id); return; }
            }
        }, { rootMargin: '-80px 0px -60% 0px', threshold: 0 });
        sections.forEach(function (s) { io.observe(s); });
    }

    /* ---------- Поиск с подсветкой и фильтрацией ---------- */
    function clearMarks(ctx) {
        $$('mark.hl', ctx).forEach(function (m) {
            var p = m.parentNode;
            p.replaceChild(document.createTextNode(m.textContent), m);
            p.normalize();
        });
    }
    function highlight(ctx, query) {
        var q = query.toLowerCase();
        var walker = document.createTreeWalker(ctx, NodeFilter.SHOW_TEXT, {
            acceptNode: function (n) {
                var p = n.parentNode;
                if (!n.nodeValue.trim() || /^(SCRIPT|STYLE|BUTTON|TEMPLATE)$/.test(p.nodeName)) return NodeFilter.FILTER_REJECT;
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        var nodes = [], n;
        while ((n = walker.nextNode())) nodes.push(n);
        var count = 0;
        nodes.forEach(function (node) {
            var text = node.nodeValue, low = text.toLowerCase(), idx = low.indexOf(q);
            if (idx === -1) return;
            var frag = document.createDocumentFragment(), last = 0;
            while (idx !== -1) {
                frag.appendChild(document.createTextNode(text.slice(last, idx)));
                var mark = document.createElement('mark');
                mark.className = 'hl';
                mark.textContent = text.slice(idx, idx + q.length);
                frag.appendChild(mark);
                count++;
                last = idx + q.length;
                idx = low.indexOf(q, last);
            }
            frag.appendChild(document.createTextNode(text.slice(last)));
            node.parentNode.replaceChild(frag, node);
        });
        return count;
    }
    function initSearch() {
        var input = $('[data-doc-search]');
        if (!input) return;
        var status = $('.search-status');
        var sections = $$('.doc-section');
        var tocItems = $$('.toc li');
        var content = $('.container');
        var timer;

        function run() {
            var q = input.value.trim();
            clearMarks(content);
            if (!q) {
                sections.forEach(function (s) { s.hidden = false; });
                tocItems.forEach(function (li) { li.hidden = false; });
                if (status) status.textContent = '';
                return;
            }
            var total = 0, shown = 0;
            sections.forEach(function (s, i) {
                var found = highlight(s, q);
                s.hidden = found === 0;
                if (tocItems[i]) tocItems[i].hidden = found === 0;
                if (found) {
                    shown++; total += found;
                    $$('details.faq', s).forEach(function (d) {
                        if ($('mark.hl', d)) d.open = true;
                    });
                    $$('.tabpanel', s).forEach(function (p) {
                        // Если совпадение в скрытой вкладке — переключаем на неё
                        if (p.hidden && $('mark.hl', p)) {
                            var tab = document.getElementById(p.getAttribute('aria-labelledby'));
                            if (tab) tab.click();
                        }
                    });
                }
            });
            if (status) {
                status.textContent = total ? ('Совпадений: ' + total + ' · разделов: ' + shown) : 'Ничего не найдено';
            }
        }
        input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(run, 120); });
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                var m = $('mark.hl', content);
                if (m) m.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
            } else if (e.key === 'Escape') {
                input.value = ''; run(); input.blur();
            }
        });
        document.addEventListener('keydown', function (e) {
            var tag = (document.activeElement && document.activeElement.tagName) || '';
            var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (document.activeElement && document.activeElement.isContentEditable);
            if ((e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) ||
                ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) {
                e.preventDefault();
                var sidebar = $('.sidebar');
                if (sidebar && !sidebar.classList.contains('open') && window.matchMedia('(max-width: 960px)').matches) {
                    var t = $('[data-menu-toggle]');
                    if (t) t.click();
                }
                input.focus(); input.select();
            }
        });
        var hint = $('[data-search-focus]');
        if (hint) hint.addEventListener('click', function () { input.focus(); });
    }

    /* ---------- Интерактивная схема ---------- */
    function initFlow() {
        $$('[data-flow]').forEach(function (flow) {
            var detail = $('.flow-detail', flow);
            var nodes = $$('.flow-node', flow);
            if (!detail || !nodes.length) return;
            function show(node) {
                nodes.forEach(function (n) { n.setAttribute('aria-pressed', n === node ? 'true' : 'false'); });
                var src = document.getElementById(node.getAttribute('data-info'));
                if (src) detail.innerHTML = src.innerHTML;
            }
            nodes.forEach(function (node) {
                node.setAttribute('aria-pressed', 'false');
                node.addEventListener('click', function () { show(node); });
            });
            show(nodes[0]);
        });
    }

    /* ---------- Появление при прокрутке ---------- */
    function initReveal() {
        var items = $$('.reveal');
        if (!items.length) return;
        if (reduceMotion || !('IntersectionObserver' in window)) {
            items.forEach(function (el) { el.classList.add('is-visible'); });
            return;
        }
        var io = new IntersectionObserver(function (entries) {
            entries.forEach(function (en) {
                if (en.isIntersecting) { en.target.classList.add('is-visible'); io.unobserve(en.target); }
            });
        }, { threshold: 0.08, rootMargin: '0px 0px -30px 0px' });
        items.forEach(function (el) { io.observe(el); });
    }

    ready(function () {
        root.classList.add('js');
        initThemeToggle();
        initProgressAndTop();
        initAnchors();
        initCopyButtons();
        initTabs();
        initFaqControls();
        initSidebar();
        initScrollSpy();
        initSearch();
        initFlow();
        initReveal();
    });
})();
