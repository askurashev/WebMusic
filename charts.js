'use strict';
(() => {
    const host = document.getElementById('my-chart');
    if (!host) return;
    const app = host.attachShadow({ mode: 'open' });
    app.append(document.getElementById('my-chart-template').content.cloneNode(true));
    const $ = id => app.getElementById(id);
    let state, token, library = [], available = new Set(), ranking = [], week, dirty = false, busy = false, shown = 100, rankingShown = 100;
    let dragged = null, lastExport = null, saveTimer;
    let archived = new Set(), archiveBusy = false;
    let metadata = {}, editingPath = null, editingRevision = '', tagBusy = false;
    let playCounts = {};
    let metadataGeneration = 0;
    const editedMetadata = new Set();
    let savedPlaylists = [], onlinePlaylists = true, playlistBusy = false, uploadsEnabled = false, uploadMaxBytes = 104857600, uploadBusy = false, visiblePaths = [];
    let focusedPlaylistPicker = null, libraryRenderPending = false;
    const selectedPlaylists = new Set();
    let menuAnchor = null, menuPath = null;
    const playlistMenu = node('div', undefined, 'playlist-menu');
    playlistMenu.id = 'playlist-menu'; playlistMenu.hidden = true; playlistMenu.setAttribute('role', 'group');
    playlistMenu.setAttribute('popover', 'manual'); app.append(playlistMenu);
    function closePlaylistMenu(restoreFocus = false, flush = true) {
        if (!menuAnchor) return;
        const anchor = menuAnchor;
        playlistMenu.hidePopover?.(); playlistMenu.hidden = true;
        anchor.setAttribute('aria-expanded', 'false');
        menuAnchor = null; focusedPlaylistPicker = null;
        const path = menuPath;
        if (flush && libraryRenderPending) renderLibrary();
        if (restoreFocus) {
            const target = anchor.isConnected ? anchor : [...$('library').querySelectorAll('.trackrow')].find(row => row.querySelector('.info')?.dataset.path === path)?.querySelector('.playlist-picker');
            (target || $('playlist-filter')).focus();
        }
    }
    function fillPlaylistMenu() {
        const path = menuPath;
        playlistMenu.replaceChildren();
        function choice(name, checked, change, disabled = false) {
            const label = node('label', undefined, 'playlist-choice');
            const input = node('input'); input.type = 'checkbox'; input.checked = checked;
            input.disabled = disabled; input.dataset.name = name; input.onchange = () => change(input);
            label.append(input, node('span', name)); playlistMenu.append(label);
        }
        function updateFilter() {
            const inputs = [...playlistMenu.querySelectorAll('input')];
            inputs.forEach((input, index) => input.checked = index === 0 ? !selectedPlaylists.size : selectedPlaylists.has(input.dataset.name));
            renderPlaylistFilter(); shown = 100; renderLibrary();
        }
        if (path === null) choice('Вся библиотека', !selectedPlaylists.size, () => { selectedPlaylists.clear(); updateFilter(); });
        for (const list of savedPlaylists) choice(list.name,
            path === null ? selectedPlaylists.has(list.name) : list.songs.some(song => song.path === path),
            input => {
                if (path !== null) return addToPlaylist(path, list.name, input.checked);
                if (input.checked) selectedPlaylists.add(list.name); else selectedPlaylists.delete(list.name);
                updateFilter();
            }, !!list.error || (path !== null && (busy || playlistBusy || !onlinePlaylists)));
        if (path !== null) playlistMenu.append(button('＋ Создать новый…', 'Создать новый плейлист', () => addToPlaylist(path, null), playlistBusy || !onlinePlaylists));
        else if (!savedPlaylists.length) playlistMenu.append(node('p', 'Сохранённых плейлистов пока нет.', 'muted'));
    }
    function openPlaylistMenu(anchor, path = null) {
        if (menuAnchor === anchor) { closePlaylistMenu(); return; }
        closePlaylistMenu(false, false); menuAnchor = anchor; menuPath = path;
        if (path !== null) focusedPlaylistPicker = anchor;
        anchor.setAttribute('aria-expanded', 'true');
        playlistMenu.setAttribute('aria-label', path === null ? 'Фильтр по плейлистам' : `Плейлисты: ${title(path)}`);
        fillPlaylistMenu(); playlistMenu.hidden = false; playlistMenu.showPopover?.();
        const rect = anchor.getBoundingClientRect?.() || { left: 0, bottom: 0 };
        playlistMenu.style.left = Math.max(8, Math.min(rect.left, (window.innerWidth || 1024) - 300)) + 'px';
        playlistMenu.style.top = Math.max(8, Math.min(rect.bottom + 4, (window.innerHeight || 768) - (playlistMenu.offsetHeight || 280) - 8)) + 'px';
        playlistMenu.querySelector('input, button')?.focus();
    }
    app.addEventListener('click', event => {
        if (menuAnchor && !playlistMenu.contains(event.target) && event.target !== menuAnchor) closePlaylistMenu();
    });
    document.addEventListener('pointerdown', event => { if (!event.composedPath().includes(host) && event.target !== document.getElementById('player-playlist-toggle')) closePlaylistMenu(); });
    app.addEventListener('keydown', event => {
        if (!menuAnchor) return;
        event.stopPropagation();
        if (event.key === 'Escape') { event.preventDefault(); closePlaylistMenu(true); }
    });
    window.addEventListener('resize', () => closePlaylistMenu());
    const collator = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' });
    const localDate = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    function monday(value) {
        const date = new Date(value + 'T12:00:00');
        if (Number.isNaN(date.getTime())) return null;
        date.setDate(date.getDate() - (date.getDay() + 6) % 7);
        return localDate(date);
    }
    function shiftWeek(value, days) {
        const date = new Date(value + 'T12:00:00'); date.setDate(date.getDate() + days); return localDate(date);
    }
    let statusTimer;
    function status(text, error = false, persistent = false) {
        window.clearTimeout(statusTimer);
        const toast = $('status');
        toast.replaceChildren();
        toast.classList.toggle('error', error);
        if (!text) return;
        const message = node('span', text);
        const dismiss = node('button', '×', 'toast-dismiss');
        dismiss.type = 'button'; dismiss.title = 'Закрыть уведомление';
        dismiss.setAttribute('aria-label', 'Закрыть уведомление');
        dismiss.onclick = () => status('');
        toast.append(message, dismiss);
        if (!error && !persistent) statusTimer = window.setTimeout(() => status(''), 4500);
    }
    function node(tag, text, className) {
        const element = document.createElement(tag);
        if (text !== undefined) element.textContent = text;
        if (className) element.className = className;
        return element;
    }
    function title(path) {
        const tags = metadata[path];
        const name = tags?.title || path.split('/').pop().replace(/\.[^.]+$/, '');
        return tags?.artist ? `${tags.artist} — ${name}` : name;
    }
    function showLyrics(path) {
        const lyrics = metadata[path]?.lyrics;
        if (!lyrics) return;
        const windowEl = $('lyrics-window');
        $('lyrics-heading').textContent = title(path);
        $('lyrics-text').textContent = lyrics;
        if (!windowEl.open) windowEl.show();
    }
    async function copySongTitle(path) {
        try {
            await navigator.clipboard.writeText(title(path));
            status('Название и исполнители скопированы.');
        } catch (_) {
            status('Не удалось скопировать название и исполнителей в буфер обмена.', true);
        }
    }
    function receiveMetadata(value) {
        metadata = value || {};
        window.musicMetadata = metadata;
        window.refreshMusicMetadata?.();
    }
    async function loadMetadata() {
        const generation = ++metadataGeneration;
        const paths = library.filter(path => /\.mp3$/i.test(path));
        let index = 0;
        try {
            while (index < paths.length && generation === metadataGeneration) {
                const result = await api('metadata', { paths: paths.slice(index, index + 25) });
                if (generation !== metadataGeneration) return;
                const entries = Object.entries(result.metadata || {});
                if (!entries.length) break;
                for (const [path, tags] of entries) if (!editedMetadata.has(path)) metadata[path] = tags;
                index += entries.length;
                receiveMetadata(metadata);
                renderLibrary(); renderRanking(); renderStats();
            }
        } catch (error) {
            if (generation === metadataGeneration) status('Библиотека загружена, но теги загрузить не удалось: ' + error.message, true);
        }
    }
    async function editTags(path) {
        if (tagBusy || editingPath) return;
        editingPath = path; tagBusy = true;
        $('tag-path').textContent = path; $('tag-error').textContent = '';
        $('tag-save').disabled = true;
        for (const field of ['artist', 'albumArtist', 'title']) { $('tag-' + field).value = ''; $('tag-' + field).disabled = true; }
        $('tag-editor').showModal();
        try {
            const result = await api('tags-read', { path });
            if (editingPath !== path) return;
            editingRevision = result.revision;
            for (const field of ['artist', 'albumArtist', 'title']) { $('tag-' + field).value = result.tags[field]; $('tag-' + field).disabled = false; }
            $('tag-save').disabled = false; $('tag-artist').focus();
        } catch (error) { $('tag-error').textContent = error.message; }
        finally { tagBusy = false; }
    }
    $('tag-cancel').onclick = () => { if (!tagBusy) $('tag-editor').close(); };
    $('tag-editor').addEventListener('keydown', event => event.stopPropagation());
    $('tag-editor').addEventListener('cancel', event => { if (tagBusy) event.preventDefault(); });
    $('tag-editor').addEventListener('close', () => { editingPath = null; });
    $('tag-form').onsubmit = async event => {
        event.preventDefault();
        if (tagBusy || !editingPath || $('tag-save').disabled) return;
        const tags = {};
        for (const field of ['artist', 'albumArtist', 'title']) tags[field] = $('tag-' + field).value;
        tagBusy = true; $('tag-save').disabled = true; $('tag-cancel').disabled = true; $('tag-error').textContent = '';
        for (const field of ['artist', 'albumArtist', 'title']) $('tag-' + field).disabled = true;
        try {
            const result = await api('tags-save', { path: editingPath, tags, revision: editingRevision });
            editedMetadata.add(editingPath);
            metadata[editingPath] = { ...metadata[editingPath], ...result.tags, ...result.details }; receiveMetadata(metadata);
            renderLibrary(); renderRanking(); renderStats();
            $('tag-editor').close(); status('Теги сохранены в MP3. Резервная копия создана.');
        } catch (error) { $('tag-error').textContent = error.message; }
        finally {
            tagBusy = false; $('tag-save').disabled = false; $('tag-cancel').disabled = false;
            for (const field of ['artist', 'albumArtist', 'title']) $('tag-' + field).disabled = false;
        }
    };
    function durationLabel(value) {
        if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '—:—';
        const seconds = Math.round(value);
        const hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds / 60) % 60;
        return (hours ? `${hours}:${String(minutes).padStart(2, '0')}` : String(minutes)) + ':' + String(seconds % 60).padStart(2, '0');
    }
    function info(path, libraryRow = false) {
        const el = node('div', undefined, 'info');
        el.dataset.path = path; el.title = path;
        const tags = node('div', undefined, 'track-meta');
        if (libraryRow) {
            const details = metadata[path];
            const year = /^[1-9][0-9]{3}$/.test(String(details?.year)) ? details.year : 'год не указан';
            const duration = durationLabel(details?.duration);
            const summary = node('span', `${duration} · ${year}`, 'track-details');
            summary.title = `Длительность: ${duration}; год выпуска: ${year}`;
            tags.append(summary);
            const plays = Number(playCounts[path]) || 0;
            const playSummary = node('span', `${plays} прослуш.`, 'track-details play-count');
            playSummary.title = `Число проигрываний: ${plays}`;
            tags.append(playSummary);
        }
        if (archived.has(path)) tags.append(node('span', 'В архиве', 'archive-tag'));
        for (const list of savedPlaylists) {
            if (list.songs.some(song => song.path === path)) tags.append(node('span', list.name, 'playlist-tag'));
        }
        if (!libraryRow) tags.append(node('span', path.split('.').pop().toUpperCase(), 'format-tag'));
        if (!available.has(path)) tags.append(node('span', 'Файл недоступен', 'missing-tag'));
        el.append(node('span', title(path), 'title'), tags);
        return el;
    }
    function button(text, label, action, disabled = false) {
        const el = node('button', text); el.type = 'button'; el.title = label; el.setAttribute('aria-label', label);
        el.disabled = disabled || busy; el.onclick = action; return el;
    }
    function syncPlaybackButton(el) {
        const playback = window.getMusicPlaybackState?.();
        const playing = playback?.path === el.dataset.playPath && playback.playing;
        el.textContent = playing ? 'Ⅱ' : '▶';
        const label = (playing ? 'Приостановить ' : 'Воспроизвести ') + title(el.dataset.playPath);
        el.title = label; el.setAttribute('aria-label', label);
        el.setAttribute('aria-pressed', String(!!playing));
    }
    function playButton(path, disabled = false) {
        const el = button('', '', () => preview(path), disabled);
        el.dataset.playPath = path;
        syncPlaybackButton(el);
        return el;
    }
    function fitWorkspace() {
        const workspace = app.querySelector('.workspace');
        if (!workspace.getBoundingClientRect || !window.innerHeight) return;
        const top = workspace.getBoundingClientRect().top + window.scrollY;
        const dock = document.getElementById('player')?.offsetHeight || 0;
        // Document position keeps the panels stable while scrolling to the totals.
        const height = Math.max(180, window.innerHeight - top - dock - 12);
        host.style.setProperty('--workspace-height', height + 'px');
    }
    async function api(action, body) {
        const response = await fetch(`charts.php?action=${action}`, body === undefined ? { cache: 'no-store' } : {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Chart-Token': token }, body: JSON.stringify(body)
        });
        let result;
        try { result = await response.json(); } catch (_) {
            throw new Error(window.location?.protocol === 'file:'
                ? 'Откройте страницу через PHP-сервер, а не как локальный HTML-файл.'
                : `Сервер вернул некорректный ответ (HTTP ${response.status}). Повторите действие; подробности — в журнале PHP.`);
        }
        if (!response.ok || result.error) throw new Error(result.error || 'Ошибка сервера.');
        return result;
    }
    async function uploadSelectedFiles(files) {
        if (!files.length || uploadBusy || !uploadsEnabled) return;
        const tooLarge = files.find(file => file.size > uploadMaxBytes);
        if (tooLarge) { status(`Файл «${tooLarge.name}» превышает лимит ${Math.ceil(uploadMaxBytes / 1048576)} МБ.`, true); return; }
        uploadBusy = true; $('upload-library').disabled = true;
        const uploaded = [], skipped = [];
        try {
            for (let i = 0; i < files.length; i++) {
                status(`Загрузка ${i + 1} из ${files.length}: ${files[i].name}`, false, true);
                const form = new FormData(); form.append('audio[]', files[i], files[i].name);
                const response = await fetch('charts.php?action=upload', { method: 'POST', headers: { 'X-Chart-Token': token }, body: form, cache: 'no-store' });
                let result;
                try { result = await response.json(); } catch (_) { throw new Error(`Сервер вернул некорректный ответ при загрузке «${files[i].name}».`); }
                if (!response.ok || result.error) throw new Error(result.error || `Не удалось загрузить «${files[i].name}».`);
                uploaded.push(...(result.uploaded || []));
                skipped.push(...(result.skipped || []));
            }
            await refreshLibrary();
            status(`Загружено файлов: ${uploaded.length}; пропущено с совпадающим именем: ${skipped.length}.`);
        } catch (error) { status(error.message, true); }
        finally { uploadBusy = false; $('upload-library').disabled = false; }
    }
    function preview(path) {
        try {
            if (typeof window.playChartSong !== 'function') throw new Error('Плеер ещё загружается. Повторите через несколько секунд.');
            window.playChartSong(path);
            status('В плеере: ' + title(path));
        } catch (error) { status(error.message, true); }
    }
    function draggable(row, path) {
        row.draggable = !busy;
        row.addEventListener('dragstart', event => {
            if (busy) { event.preventDefault(); return; }
            dragged = path; event.dataTransfer.setData('text/plain', path); event.dataTransfer.effectAllowed = 'copyMove';
        });
        row.addEventListener('dragend', () => { dragged = null; clearDrop(); });
    }
    function renderLibrary() {
        // Preserve the open track menu while choosing several playlists.
        if (focusedPlaylistPicker?.isConnected) { libraryRenderPending = true; return; }
        libraryRenderPending = false;
        const terms = $('search').value.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
        const selected = savedPlaylists.filter(list => selectedPlaylists.has(list.name));
        const playlistPaths = selected.length ? new Set(selected.flatMap(list => list.songs.map(song => song.path))) : null;
        const chartFilter = $('chart-filter').value, archiveFilter = $('archive-filter').value;
        const chartPaths = new Set(ranking);
        const filtered = library.filter(path => (!playlistPaths || playlistPaths.has(path))
            && (!chartFilter || chartPaths.has(path) === (chartFilter === 'in'))
            && (!archiveFilter || archived.has(path) === (archiveFilter === 'in'))
            && terms.every(term => `${path} ${title(path)} ${metadata[path]?.albumArtist || ''}`.toLocaleLowerCase().includes(term)));
        const sort = $('library-sort').value;
        filtered.sort((a, b) => {
            if (sort === 'year') {
                const yearA = Number(metadata[a]?.year) || 0, yearB = Number(metadata[b]?.year) || 0;
                if (yearA !== yearB) return yearB - yearA;
            } else if (sort === 'plays') {
                const plays = (Number(playCounts[b]) || 0) - (Number(playCounts[a]) || 0);
                if (plays) return plays;
            }
            return collator.compare(title(a), title(b)) || collator.compare(a, b);
        });
        visiblePaths = filtered;
        window.filterChartLibrary?.(filtered, [selected.map(list => list.name).join(', '), chartFilter && (chartFilter === 'in' ? 'В чарте недели' : 'Не в чарте недели'), archiveFilter && (archiveFilter === 'in' ? 'В архиве' : 'Не в архиве'), $('search').value.trim()].filter(Boolean).join(' · '));
        $('library-count').textContent = `${filtered.length} треков`;
        $('enqueue-filtered').disabled = busy || !filtered.length;
        $('playlist-note').textContent = selected.map(list => list.error).filter(Boolean).join('; ') || (selected.length ? `Плейлистов: ${selected.length} · Треков: ${playlistPaths.size}` : '');
        const fragment = document.createDocumentFragment();
        for (const path of filtered.slice(0, shown)) {
            const row = node('div', undefined, 'trackrow'); draggable(row, path);
            const actions = node('div', undefined, 'actions');
            const lyricsButton = button('♫', `Текст песни: ${title(path)}`, () => showLyrics(path), !metadata[path]?.lyrics);
            lyricsButton.className = 'lyrics-button'; actions.append(lyricsButton);
            const chartButton = button('★', `${chartPaths.has(path) ? 'Убрать из чарта' : 'Добавить в чарт'}: ${title(path)}`, () => {
                if (busy) return;
                const index = ranking.indexOf(path);
                if (index < 0) add(path);
                else { ranking.splice(index, 1); changed(); }
            });
            chartButton.className = 'chart-button';
            chartButton.setAttribute('aria-pressed', String(chartPaths.has(path)));
            actions.append(button('＋', `Добавить ${title(path)} в очередь`, () => enqueue([path])), chartButton);
            const archiveButton = button('', `${archived.has(path) ? 'Вернуть из архива' : 'В архив'}: ${title(path)}`, () => toggleArchived(path), archiveBusy);
            archiveButton.className = 'archive-button';
            archiveButton.setAttribute('aria-pressed', String(archived.has(path)));
            archiveButton.innerHTML = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3h18v5H3zM5 8v13h14V8M10 12h4"/></svg>';
            actions.append(archiveButton);
            const copyButton = button('', `Копировать название и исполнителей: ${title(path)}`, () => copySongTitle(path));
            copyButton.className = 'copy-title-button';
            copyButton.innerHTML = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3"/></svg>';
            actions.append(copyButton);
            if (/\.mp3$/i.test(path)) actions.append(button('✎', `Редактировать теги: ${title(path)}`, () => editTags(path)));
            const picker = button('В плейлист… ▾', `Плейлисты: ${title(path)}`, () => openPlaylistMenu(picker, path), playlistBusy || !onlinePlaylists);
            picker.className = 'playlist-picker'; picker.setAttribute('aria-expanded', 'false');
            picker.setAttribute('aria-controls', 'playlist-menu');
            row.append(playButton(path), info(path, true), actions, picker);
            fragment.append(row);
        }
        if (!filtered.length) fragment.append(node('p', library.length ? 'Ничего не найдено.' : 'В библиотеке пока нет музыки.', 'empty'));
        $('library').replaceChildren(fragment); $('more').hidden = filtered.length <= shown;
        syncPlayerActions();
    }
    function syncPlayerActions() {
        const path = window.getMusicPlaybackState?.()?.path || '';
        const chartButton = document.getElementById('player-chart-toggle');
        const archiveButton = document.getElementById('player-archive-toggle');
        const playlistButton = document.getElementById('player-playlist-toggle');
        const editButton = document.getElementById('player-edit-tags');
        const lyricsButton = document.getElementById('player-lyrics');
        if (!chartButton || !archiveButton || !playlistButton || !editButton || !lyricsButton) return;
        const active = !!path && !!state && available.has(path);
        const inChart = ranking.includes(path), inArchive = archived.has(path);
        chartButton.disabled = !active || busy;
        chartButton.textContent = inChart ? '★' : '☆';
        chartButton.title = `${inChart ? 'Убрать из' : 'Добавить в'} чарт недели: ${title(path) || 'текущий трек'}`;
        chartButton.setAttribute('aria-label', chartButton.title);
        chartButton.setAttribute('aria-pressed', String(inChart));
        archiveButton.disabled = !active || busy || archiveBusy;
        archiveButton.textContent = inArchive ? '▣' : '□';
        archiveButton.title = `${inArchive ? 'Вернуть из архива' : 'Архивировать'}: ${title(path) || 'текущий трек'}`;
        archiveButton.setAttribute('aria-label', archiveButton.title);
        archiveButton.setAttribute('aria-pressed', String(inArchive));
        const inPlaylist = savedPlaylists.some(list => list.songs.some(song => song.path === path));
        playlistButton.disabled = !active || busy || playlistBusy || !onlinePlaylists;
        playlistButton.textContent = inPlaylist ? '✓ Плейлист' : '＋ Плейлист';
        playlistButton.title = `Плейлисты: ${title(path) || 'текущий трек'}`;
        playlistButton.setAttribute('aria-label', playlistButton.title);
        editButton.disabled = !active || busy || tagBusy || !/\.mp3$/i.test(path);
        editButton.title = `Редактировать теги: ${title(path) || 'текущий трек'}`;
        editButton.setAttribute('aria-label', editButton.title);
        lyricsButton.disabled = !active || busy || !metadata[path]?.lyrics;
        lyricsButton.title = `Показать текст песни: ${title(path) || 'текущий трек'}`;
        lyricsButton.setAttribute('aria-label', lyricsButton.title);
    }
    function dates() { return Object.keys(state.weeks).sort(); }
    function controls() {
        for (const id of ['week', 'archive', 'next-week', 'search', 'more', 'more-ranking', 'playlist-filter', 'chart-filter', 'archive-filter', 'reload-library', 'auto-save']) $(id).disabled = busy || !state;
        $('save').disabled = busy || !state || (!dirty && !!state.weeks[week]);
        const saveLabel = 'Сохранить плейлист';
        $('save').title = saveLabel; $('save').setAttribute('aria-label', saveLabel); $('save').setAttribute('aria-busy', String(busy));
        $('export').disabled = busy || !state || dirty || !state.weeks[week] || week !== dates().at(-1);
        syncPlayerActions();
    }
    function renderPlaylistFilter() {
        savedPlaylists.sort((a, b) => collator.compare(a.name, b.name));
        for (const name of selectedPlaylists) if (!savedPlaylists.some(list => list.name === name)) selectedPlaylists.delete(name);
        const label = selectedPlaylists.size ? [...selectedPlaylists].join(', ') : 'Вся библиотека';
        $('playlist-filter').textContent = label + ' ▾'; $('playlist-filter').title = label;
    }

    async function toggleArchived(path) {
        if (archiveBusy || busy) return;
        const value = !archived.has(path);
        archiveBusy = true; renderLibrary();
        try {
            const data = await api('archive-set', { path, archived: value });
            archived = new Set(data.archived);
            renderRanking(); renderStats();
            status(`«${title(path)}» ${value ? 'добавлен в архив' : 'возвращён из архива'}.`);
        } catch (error) { status(error.message, true); }
        finally { archiveBusy = false; renderLibrary(); }
    }
    async function addToPlaylist(path, existingName, included = true) {
        if (playlistBusy || busy) return;
        const name = existingName ?? prompt('Название нового плейлиста:');
        if (!name || !name.trim()) return;
        const focusedName = app.activeElement?.dataset.name;
        playlistBusy = true; renderLibrary();
        playlistMenu.querySelectorAll('input, button').forEach(el => el.disabled = true);
        try {
            const data = await api(included ? 'playlist-add' : 'playlist-remove', { name: name.trim(), path, create: existingName === null });
            savedPlaylists = data.playlists; renderPlaylistFilter(); renderRanking(); renderStats();
            status(`«${title(path)}» ${included ? 'добавлен в плейлист' : 'удалён из плейлиста'} «${name.trim()}».`);
        } catch (error) { status(error.message, true); }
        finally {
            playlistBusy = false;
            if (menuAnchor) {
                fillPlaylistMenu();
                [...playlistMenu.querySelectorAll('input')].find(input => input.dataset.name === focusedName)?.focus();
                app.querySelectorAll('.info').forEach(el => { if (el.dataset.path === path) el.replaceWith(info(path, !!el.closest('#library'))); });
            }
            renderLibrary();
        }
    }
    function enqueue(paths) {
        try {
            if (!window.queueChartSongs) throw new Error('Плеер ещё загружается.');
            const count = window.queueChartSongs(paths);
            status(count ? `Добавлено в очередь: ${count}.` : 'Композиции уже стоят в очереди.');
        } catch (error) { status(error.message, true); }
    }
    async function refreshLibrary() {
        if (busy || archiveBusy) return;
        metadataGeneration++;
        busy = true; controls(); renderLibrary(); status('Обновляем библиотеку…', false, true);
        try {
            if (window.reloadMusicLibrary) await window.reloadMusicLibrary();
            const data = await api('state');
            token = data.token; library = data.songs; available = new Set(library);
            uploadsEnabled = data.uploadsEnabled === true; uploadMaxBytes = Number(data.uploadMaxBytes) || uploadMaxBytes;
            $('upload-library').hidden = !uploadsEnabled;
            receiveMetadata(data.metadata || metadata);
            archived = new Set(data.archived || []);
            playCounts = data.playCounts || {};
            savedPlaylists = data.playlists || []; onlinePlaylists = data.onlinePlaylists !== false;
            // Preserve the draft and its revision; never overwrite unsaved ranking edits.
            renderPlaylistFilter(); renderStats(); status(`Библиотека обновлена: ${library.length} треков.`);
            if (data.metadataPending) void loadMetadata();
        } catch (error) { status(error.message, true); }
        finally { busy = false; renderRanking(); renderLibrary(); }
    }
    function renderRanking() {
        const previous = state.weeks[shiftWeek(week, -7)]?.songs || [];
        const previousPlaces = new Map(previous.map((path, index) => [path, index]));
        const historical = new Set(dates().filter(date => date < week).flatMap(date => state.weeks[date].songs));
        $('chart-count').textContent = `${ranking.length} треков`;
        $('enqueue-chart').disabled = busy || !ranking.length;
        const fragment = document.createDocumentFragment();
        ranking.slice(0, rankingShown).forEach((path, index) => {
            const row = node('li', undefined, 'trackrow'); row.dataset.index = index; draggable(row, path);
            const pos = node('div', String(index + 1), 'rank');
            const old = previousPlaces.get(path) ?? -1;
            const earlier = historical.has(path);
            const movement = old < 0 ? (earlier ? 'ВОЗВРАТ' : 'NEW') : old === index ? '—' : old > index ? `↑ ${old - index}` : `↓ ${index - old}`;
            pos.append(node('span', movement, 'movement'));
            const actions = node('div', undefined, 'actions');
            actions.append(button('↑', `Поднять ${title(path)}`, () => move(index, index - 1), index === 0), button('↓', `Опустить ${title(path)}`, () => move(index, index + 1), index === ranking.length - 1), button('×', `Убрать ${title(path)} из чарта`, () => { ranking.splice(index, 1); changed(); }));
            row.append(pos, playButton(path, !available.has(path)), info(path), actions);
            fragment.append(row);
        });
        if (!ranking.length) fragment.append(node('li', 'Перетащите сюда композиции из библиотеки. Количество треков не ограничено.', 'empty'));
        $('ranking').replaceChildren(fragment); $('more-ranking').hidden = ranking.length <= rankingShown; controls();
    }
    function changed() {
        dirty = true; showSaveNote();
        scheduleSave();
        $('export-result').replaceChildren(); renderRanking(); renderLibrary();
    }
    function showSaveNote() {
        $('week-note').textContent = $('auto-save').checked
            ? 'Изменения будут сохранены автоматически…'
            : 'Есть несохранённые изменения. Нажмите «Сохранить плейлист».';
    }
    function scheduleSave() {
        window.clearTimeout(saveTimer);
        if (!$('auto-save').checked) return;
        saveTimer = window.setTimeout(() => {
            if (busy) scheduleSave();
            else if (dirty) void save();
        }, 500);
    }
    function add(path, at = ranking.length) {
        if (busy || !available.has(path) || ranking.includes(path)) return;
        ranking.splice(at, 0, path); changed();
    }
    function move(from, to) {
        if (busy || to < 0 || to >= ranking.length) return;
        const [path] = ranking.splice(from, 1); ranking.splice(to, 0, path); changed();
    }
    function clearDrop() {
        $('ranking').classList.remove('dragover');
        $('ranking').querySelectorAll('.drop-before, .drop-after').forEach(el => el.classList.remove('drop-before', 'drop-after'));
    }
    function dropTarget(event) {
        const row = event.target.closest('li[data-index]');
        const after = row && event.clientY > row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2;
        return { row, after, index: row ? Number(row.dataset.index) + (after ? 1 : 0) : ranking.length };
    }
    $('ranking').addEventListener('dragover', event => {
        if (!dragged || busy) return;
        event.preventDefault(); clearDrop(); $('ranking').classList.add('dragover');
        const target = dropTarget(event); target.row?.classList.add(target.after ? 'drop-after' : 'drop-before');
    });
    $('ranking').addEventListener('drop', event => {
        event.preventDefault(); clearDrop();
        if (!dragged || busy) return;
        let at = dropTarget(event).index;
        const from = ranking.indexOf(dragged);
        if (from >= 0) {
            if (from < at) at--;
            const [path] = ranking.splice(from, 1); ranking.splice(at, 0, path); changed();
        } else add(dragged, at);
        dragged = null;
    });
    function renderArchive() {
        $('archive').replaceChildren(new Option('Выберите неделю', ''));
        for (const date of dates().reverse()) $('archive').add(new Option(`${date} · ${state.weeks[date].songs.length} треков`, date));
        $('archive').value = state.weeks[week] ? week : '';
    }
    function openWeek(value, force = false) {
        if (!value || busy) return;
        const next = monday(value);
        if (!next) return;
        if (!force && next === week) { $('week').value = week; return; }
        if (!force && dirty && !confirm('Перейти к другой неделе без сохранения текущих изменений?')) { $('week').value = week; renderArchive(); return; }
        window.clearTimeout(saveTimer);
        week = next; $('week').value = week;
        rankingShown = 100;
        const existing = state.weeks[week];
        const preceding = dates().filter(date => date < week).at(-1);
        ranking = [...(existing ? existing.songs : preceding ? state.weeks[preceding].songs : [])];
        dirty = !existing;
        $('week-note').textContent = existing ? `Сохранённый чарт · ${week}` : preceding ? `Новая неделя: скопирован чарт от ${preceding}.` : 'Новый чарт. Добавьте любимые композиции.';
        $('export-result').replaceChildren(); renderArchive(); renderRanking(); renderLibrary();
    }
    function renderStats() {
        if (!state) return;
        const prefix = $('period').value;
        const totals = new Map(); let weeks = 0;
        for (const date of dates()) {
            if (!prefix || !date.startsWith(prefix)) continue;
            weeks++;
            state.weeks[date].songs.forEach((path, index) => {
                const rank = index + 1;
                const item = totals.get(path) || { path, points: 0, weeks: 0, peak: Infinity, sum: 0, first: date };
                item.points += 100 / rank; item.weeks++; item.peak = Math.min(item.peak, rank); item.sum += rank;
                totals.set(path, item);
            });
        }
        const sorted = [...totals.values()].sort((a, b) => Math.abs(b.points - a.points) > 1e-9 ? b.points - a.points : b.weeks - a.weeks || a.peak - b.peak || a.sum / a.weeks - b.sum / b.weeks || a.first.localeCompare(b.first) || collator.compare(a.path, b.path));
        const fragment = document.createDocumentFragment();
        sorted.forEach((item, index) => {
            const row = node('tr'); const name = node('td'); name.append(info(item.path));
            row.append(node('td', String(index + 1)), name, node('td', item.points.toLocaleString('ru', { maximumFractionDigits: 2 })), node('td', String(item.weeks)), node('td', String(item.peak)), node('td', (item.sum / item.weeks).toFixed(1)));
            fragment.append(row);
        });
        if (!sorted.length) { const row = node('tr'); const cell = node('td', 'За этот период пока нет сохранённых композиций.', 'empty'); cell.colSpan = 6; row.append(cell); fragment.append(row); }
        $('stats').replaceChildren(fragment);
        $('stats-rule').textContent = `100 ÷ место за каждую неделю. Баллы суммируются без промежуточного округления. При равенстве: больше недель, лучшее место, среднее место, ранний дебют. Сохранённых недель в периоде: ${weeks}.`;
    }
    async function save() {
        if (busy || !dirty) return;
        window.clearTimeout(saveTimer);
        busy = true; renderRanking(); renderLibrary(); status('Сохраняем чарт…', false, true);
        try {
            const result = await api('save', { week, songs: ranking, revision: state.revision });
            state = result.state; dirty = false; lastExport = null;
            $('week-note').textContent = `Сохранённый чарт · ${week}`;
            renderArchive(); renderStats();
            status('Плейлист сохранён.');
        } catch (error) {
            $('week-note').textContent = 'Плейлист не сохранён. Нажмите «Сохранить плейлист», чтобы повторить.';
            status(error.message, true);
        }
        finally { busy = false; renderRanking(); renderLibrary(); }
    }
    async function exportFiles() {
        if (busy || dirty) return;
        busy = true; renderRanking(); renderLibrary(); status('Копируем аудиофайлы. Большая подборка может занять несколько минут…', false, true);
        try {
            const result = await api('export', { week, revision: state.revision }); showExport(result.export);
        } catch (error) { status(error.message, true); }
        finally { busy = false; renderRanking(); renderLibrary(); }
    }
    function showExport(result) {
        lastExport = result;
        const text = node('p', `Готово: ${lastExport.count} аудиофайлов. Скопируйте эту папку на телефон:`);
        $('export-result').replaceChildren(text, node('code', lastExport.path));
        status(lastExport.warning || 'Папка current обновлена. Исходные музыкальные файлы сохранены.', !!lastExport.warning);
    }
    $('week').onchange = () => openWeek($('week').value);
    $('archive').onchange = () => { if ($('archive').value) openWeek($('archive').value); };
    $('next-week').onclick = () => openWeek(shiftWeek(week, 7));
    $('save').onclick = save; $('export').onclick = exportFiles;
    $('auto-save').onchange = () => {
        window.clearTimeout(saveTimer);
        if (dirty) { showSaveNote(); scheduleSave(); }
    };
    $('search').oninput = () => { shown = 100; renderLibrary(); };
    $('library-sort').onchange = () => { shown = 100; renderLibrary(); };
    document.getElementById('player-chart-toggle').onclick = () => {
        const path = window.getMusicPlaybackState?.()?.path;
        if (!path || busy) return;
        const index = ranking.indexOf(path);
        if (index < 0) add(path); else { ranking.splice(index, 1); changed(); }
        syncPlayerActions();
    };
    document.getElementById('player-archive-toggle').onclick = () => {
        const path = window.getMusicPlaybackState?.()?.path;
        if (path) void toggleArchived(path);
    };
    document.getElementById('player-playlist-toggle').onclick = event => {
        const path = window.getMusicPlaybackState?.()?.path;
        if (path) openPlaylistMenu(event.currentTarget, path);
    };
    document.getElementById('player-edit-tags').onclick = () => {
        const path = window.getMusicPlaybackState?.()?.path;
        if (path && /\.mp3$/i.test(path)) void editTags(path);
    };
    document.getElementById('player-lyrics').onclick = () => {
        const path = window.getMusicPlaybackState?.()?.path;
        if (path) showLyrics(path);
    };
    $('lyrics-close').onclick = () => $('lyrics-window').close();
    $('lyrics-window').addEventListener('click', event => {
        if (event.target === event.currentTarget) event.currentTarget.close();
    });
    $('playlist-filter').onclick = () => openPlaylistMenu($('playlist-filter'));
    $('playlist-filter').setAttribute('aria-controls', 'playlist-menu');
    for (const id of ['chart-filter', 'archive-filter']) $(id).onchange = () => { shown = 100; renderLibrary(); };
    $('reload-library').onclick = refreshLibrary;
    $('upload-library').onclick = () => $('upload-files').click();
    $('upload-files').onchange = () => { const files = [...$('upload-files').files]; $('upload-files').value = ''; void uploadSelectedFiles(files); };
    $('enqueue-filtered').onclick = () => enqueue(visiblePaths);
    $('enqueue-chart').onclick = () => enqueue(ranking);
    $('more').onclick = () => { shown += 100; renderLibrary(); };
    $('more-ranking').onclick = () => { rankingShown += 100; renderRanking(); };
    $('period').oninput = renderStats;
    $('period-kind').onchange = () => {
        const year = $('period').value.slice(0, 4) || String(new Date().getFullYear());
        const yearly = $('period-kind').value === 'year';
        $('period').setAttribute('aria-label', yearly ? 'Год' : 'Месяц');
        $('period').title = yearly ? 'Год' : 'Месяц';
        $('period').type = yearly ? 'number' : 'month';
        $('period').value = yearly ? year : year + '-01'; renderStats();
    };
    window.addEventListener('beforeunload', event => { if (dirty || busy || playlistBusy || archiveBusy || editingPath) { event.preventDefault(); event.returnValue = ''; } });
    window.addEventListener('music-library-ready', () => { if (state) renderLibrary(); fitWorkspace(); });
    window.addEventListener('music-playback-state', () => {
        app.querySelectorAll('[data-play-path]').forEach(syncPlaybackButton);
        syncPlayerActions();
    });
    window.addEventListener('music-play-counted', event => {
        const { path, count } = event.detail || {};
        if (path && Number.isFinite(count)) { playCounts[path] = count; renderLibrary(); }
    });
    window.addEventListener('resize', fitWorkspace);
    window.addEventListener('music-dock-resized', fitWorkspace);
    if (window.ResizeObserver) {
        const observer = new window.ResizeObserver(fitWorkspace);
        observer.observe(app.querySelector('header'));
        observer.observe(app.querySelector('.weekbar'));
    }
    document.fonts?.ready.then(fitWorkspace);
    fitWorkspace();
    window.addEventListener('music-playlists-changed', async () => {
        try { savedPlaylists = (await api('playlists')).playlists; renderPlaylistFilter(); if (menuAnchor) fillPlaylistMenu(); renderLibrary(); renderRanking(); renderStats(); }
        catch (error) { status(error.message, true); }
    });
    window.findChartLibrary = text => {
        if (!state) return;
        closePlaylistMenu(); selectedPlaylists.clear(); renderPlaylistFilter(); $('search').value = text;
        $('chart-filter').value = ''; $('archive-filter').value = '';
        shown = 100; renderLibrary(); host.scrollIntoView({ behavior: 'smooth', block: 'start' }); $('search').focus({ preventScroll: true });
    };
    controls();
    (async () => {
        try {
            const data = await api('state'); state = data.state; token = data.token;
            uploadsEnabled = data.uploadsEnabled === true; uploadMaxBytes = Number(data.uploadMaxBytes) || uploadMaxBytes;
            $('upload-library').hidden = !uploadsEnabled;
            library = data.songs; available = new Set(library);
            receiveMetadata(data.metadata);
            archived = new Set(data.archived || []);
            savedPlaylists = data.playlists || []; onlinePlaylists = data.onlinePlaylists !== false; renderPlaylistFilter();
            const today = localDate(new Date()); $('period').value = today.slice(0, 7);
            openWeek(monday(today), true); renderStats();
            status(data.libraryMissing ? `Папка музыки «${data.root}» не найдена. Настройте root в music.ini и обновите страницу.` : '', data.libraryMissing);
            if (data.metadataPending) void loadMetadata();
        } catch (error) { status(error.message, true); controls(); }
    })();
})();
