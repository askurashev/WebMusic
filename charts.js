'use strict';
(() => {
    const host = document.getElementById('my-chart');
    if (!host) return;
    const app = host.attachShadow({ mode: 'open' });
    app.append(document.getElementById('my-chart-template').content.cloneNode(true));
    const $ = id => app.getElementById(id);
    let state, token, library = [], available = new Set(), ranking = [], week, dirty = false, busy = false, shown = 100;
    let dragged = null, lastExport = null;
    let archived = new Set(), archiveBusy = false;
    let metadata = {}, editingPath = null, editingRevision = '', tagBusy = false;
    let metadataGeneration = 0;
    const editedMetadata = new Set();
    let savedPlaylists = [], onlinePlaylists = true, playlistBusy = false, visiblePaths = [];
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
            metadata[editingPath] = result.tags; receiveMetadata(metadata);
            renderLibrary(); renderRanking(); renderStats();
            $('tag-editor').close(); status('Теги сохранены в MP3. Резервная копия создана.');
        } catch (error) { $('tag-error').textContent = error.message; }
        finally {
            tagBusy = false; $('tag-save').disabled = false; $('tag-cancel').disabled = false;
            for (const field of ['artist', 'albumArtist', 'title']) $('tag-' + field).disabled = false;
        }
    };
    function info(path) {
        const el = node('div', undefined, 'info');
        el.dataset.path = path; el.title = path;
        const tags = node('div', undefined, 'track-meta');
        if (archived.has(path)) tags.append(node('span', 'В архиве', 'archive-tag'));
        for (const list of savedPlaylists) {
            if (list.songs.some(song => song.path === path)) tags.append(node('span', list.name, 'playlist-tag'));
        }
        tags.append(node('span', path.split('.').pop().toUpperCase(), 'format-tag'));
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
        const terms = $('search').value.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
        const selected = savedPlaylists.find(list => list.name === $('playlist-filter').value);
        const playlistPaths = selected ? new Set(selected.songs.map(song => song.path)) : null;
        const chartFilter = $('chart-filter').value, archiveFilter = $('archive-filter').value;
        const chartPaths = new Set(ranking);
        const filtered = library.filter(path => (!playlistPaths || playlistPaths.has(path))
            && (!chartFilter || chartPaths.has(path) === (chartFilter === 'in'))
            && (!archiveFilter || archived.has(path) === (archiveFilter === 'in'))
            && terms.every(term => `${path} ${title(path)} ${metadata[path]?.albumArtist || ''}`.toLocaleLowerCase().includes(term)));
        visiblePaths = filtered;
        window.filterChartLibrary?.(filtered, [selected?.name, chartFilter && (chartFilter === 'in' ? 'В чарте недели' : 'Не в чарте недели'), archiveFilter && (archiveFilter === 'in' ? 'В архиве' : 'Не в архиве'), $('search').value.trim()].filter(Boolean).join(' · '));
        $('library-count').textContent = `${filtered.length} треков`;
        $('enqueue-filtered').disabled = busy || !filtered.length;
        $('playlist-note').textContent = selected?.error || (selected ? `В плейлисте: ${selected.songs.length}` : '');
        const fragment = document.createDocumentFragment();
        for (const path of filtered.slice(0, shown)) {
            const row = node('div', undefined, 'trackrow'); draggable(row, path);
            const actions = node('div', undefined, 'actions');
            actions.append(button('＋', `Добавить ${title(path)} в очередь`, () => enqueue([path])), button(ranking.includes(path) ? '✓' : '★', `Добавить ${title(path)} в чарт`, () => add(path), ranking.includes(path)));
            const archiveButton = button('', `${archived.has(path) ? 'Вернуть из архива' : 'В архив'}: ${title(path)}`, () => toggleArchived(path), archiveBusy);
            archiveButton.className = 'archive-button';
            archiveButton.setAttribute('aria-pressed', String(archived.has(path)));
            archiveButton.innerHTML = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3h18v5H3zM5 8v13h14V8M10 12h4"/></svg>';
            actions.append(archiveButton);
            if (/\.mp3$/i.test(path)) actions.append(button('✎', `Редактировать теги: ${title(path)}`, () => editTags(path)));
            const picker = node('select', undefined, 'playlist-picker');
            picker.setAttribute('aria-label', `Добавить ${title(path)} в плейлист`);
            picker.add(new Option('В плейлист…', ''));
            savedPlaylists.forEach((list, index) => {
                const included = list.songs.some(song => song.path === path);
                const option = new Option((included ? '✓ ' : '') + list.name, `p:${index}`);
                option.disabled = included || !!list.error; picker.add(option);
            });
            picker.add(new Option('＋ Создать новый…', 'new'));
            picker.disabled = busy || playlistBusy || !onlinePlaylists;
            picker.onchange = () => {
                const value = picker.value; picker.value = '';
                if (value) return addToPlaylist(path, value === 'new' ? null : savedPlaylists[Number(value.slice(2))].name);
            };
            row.append(playButton(path), info(path), actions, picker);
            fragment.append(row);
        }
        if (!filtered.length) fragment.append(node('p', library.length ? 'Ничего не найдено.' : 'В библиотеке пока нет музыки.', 'empty'));
        $('library').replaceChildren(fragment); $('more').hidden = filtered.length <= shown;
    }
    function dates() { return Object.keys(state.weeks).sort(); }
    function controls() {
        for (const id of ['week', 'archive', 'next-week', 'search', 'more', 'playlist-filter', 'chart-filter', 'archive-filter', 'reload-library']) $(id).disabled = busy || !state;
        $('save').disabled = busy || !state || (!dirty && !!state.weeks[week]);
        const saveLabel = busy ? 'Сохраняем…' : state && week >= (dates().at(-1) || week) ? 'Сохранить чарт и создать папку' : 'Сохранить изменения недели';
        $('save').title = saveLabel; $('save').setAttribute('aria-label', saveLabel); $('save').setAttribute('aria-busy', String(busy));
        $('export').disabled = busy || !state || dirty || !state.weeks[week] || week !== dates().at(-1);
    }
    function renderPlaylistFilter() {
        const selected = $('playlist-filter').value;
        $('playlist-filter').replaceChildren(new Option('Вся библиотека', ''));
        savedPlaylists.sort((a, b) => collator.compare(a.name, b.name));
        for (const list of savedPlaylists) $('playlist-filter').add(new Option(list.name, list.name));
        $('playlist-filter').value = savedPlaylists.some(list => list.name === selected) ? selected : '';
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
    async function addToPlaylist(path, existingName) {
        if (playlistBusy || busy) return;
        const name = existingName ?? prompt('Название нового плейлиста:');
        if (!name || !name.trim()) return;
        playlistBusy = true; renderLibrary();
        try {
            const data = await api('playlist-add', { name: name.trim(), path, create: existingName === null });
            savedPlaylists = data.playlists; renderPlaylistFilter(); renderRanking(); renderStats();
            status(`«${title(path)}» добавлен в плейлист «${name.trim()}».`);
        } catch (error) { status(error.message, true); }
        finally { playlistBusy = false; renderLibrary(); }
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
            receiveMetadata(data.metadata || metadata);
            archived = new Set(data.archived || []);
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
        ranking.forEach((path, index) => {
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
        $('ranking').replaceChildren(fragment); controls();
    }
    function changed() {
        dirty = true; $('week-note').textContent = 'Есть несохранённые изменения.';
        $('export-result').replaceChildren(); renderRanking(); renderLibrary();
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
        week = next; $('week').value = week;
        const existing = state.weeks[week];
        const preceding = dates().filter(date => date < week).at(-1);
        ranking = [...(existing ? existing.songs : preceding ? state.weeks[preceding].songs : [])];
        dirty = !existing;
        $('week-note').textContent = existing ? `Сохранённый чарт · ${week}` : preceding ? `Новая неделя: скопирован чарт от ${preceding}. Измените места и сохраните.` : 'Новый чарт. Добавьте любимые композиции.';
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
        if (busy) return;
        if (state.weeks[week] && !confirm(`Обновить сохранённый чарт от ${week}? Итоги месяца и года будут пересчитаны.`)) return;
        busy = true; renderRanking(); renderLibrary(); status('Сохраняем чарт…', false, true);
        try {
            const result = await api('save', { week, songs: ranking, revision: state.revision });
            state = result.state; dirty = false; lastExport = null;
            $('week-note').textContent = `Сохранённый чарт · ${week}`;
            renderArchive(); renderStats();
            if (week === dates().at(-1)) {
                status('Чарт сохранён. Копируем аудиофайлы для телефона…', false, true);
                try { showExport((await api('export', { week, revision: state.revision })).export); }
                catch (error) { status('Чарт сохранён, но папка не обновлена: ' + error.message, true); }
            } else status('Чарт сохранён. Итоги пересчитаны.');
        } catch (error) { status(error.message, true); }
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
    $('search').oninput = () => { shown = 100; renderLibrary(); };
    $('playlist-filter').onchange = () => { shown = 100; renderLibrary(); };
    for (const id of ['chart-filter', 'archive-filter']) $(id).onchange = () => { shown = 100; renderLibrary(); };
    $('reload-library').onclick = refreshLibrary;
    $('enqueue-filtered').onclick = () => enqueue(visiblePaths);
    $('enqueue-chart').onclick = () => enqueue(ranking);
    $('more').onclick = () => { shown += 100; renderLibrary(); };
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
    window.addEventListener('music-playback-state', () => app.querySelectorAll('[data-play-path]').forEach(syncPlaybackButton));
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
        try { savedPlaylists = (await api('playlists')).playlists; renderPlaylistFilter(); renderLibrary(); renderRanking(); renderStats(); }
        catch (error) { status(error.message, true); }
    });
    window.findChartLibrary = text => {
        if (!state) return;
        $('playlist-filter').value = ''; $('search').value = text;
        $('chart-filter').value = ''; $('archive-filter').value = '';
        shown = 100; renderLibrary(); host.scrollIntoView({ behavior: 'smooth', block: 'start' }); $('search').focus({ preventScroll: true });
    };
    controls();
    (async () => {
        try {
            const data = await api('state'); state = data.state; token = data.token;
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
