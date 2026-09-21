// DOM integration tests. Test-only dependency: linkedom worker at .runtime/linkedom.mjs.
import { readFile } from 'node:fs/promises';
import { Script, createContext } from 'node:vm';
import { parseHTML } from '../.runtime/linkedom.mjs';
const { document, window } = parseHTML(await readFile(new URL('../music.htm', import.meta.url), 'utf8'));
const code = await readFile(new URL('../charts.js', import.meta.url), 'utf8');
const a = 'Artist A/Song A.mp3', b = 'Artist B/Song B.mp3', c = '<script>/Song C.mp3';
let state = { revision: 0, scoring: 'reciprocal-100-v1', weeks: {
    '2026-09-07': { songs: [a, b] }, '2026-09-14': { songs: [b, a] }
} };
let exported = [], confirmResult = true, count = 0;
let lists = [{ name: 'Favorites', songs: [{ path: a }] }], queued = [];
let archived = [], archiveError = false, playlistError = false;
let trackTags = { artist: 'Artist', albumArtist: 'Album artist', title: 'Old title' }, tagsError = false;
let metadataPending = false, metadataFailure = false, releaseMetadata, metadataRequests = [];
const $ = id => document.getElementById('my-chart').shadowRoot.getElementById(id);
// Linkedom deliberately omits some native form control behavior.
const selectPrototype = Object.getPrototypeOf(document.createElement('select'));
Object.defineProperty(selectPrototype, 'value', { configurable: true, get() { return this._value ?? this.querySelector('option')?.value ?? ''; }, set(value) { this._value = value; } });
selectPrototype.add = function(option) { this.append(option); };
for (const select of document.getElementById('my-chart-template').content.querySelectorAll('select')) {
    Object.defineProperty(select, 'value', { value: select.querySelector('option')?.getAttribute('value') || '', writable: true });
    select.add = option => select.append(option);
}
function Option(text, value) { const el = document.createElement('option'); el.textContent = text; el.value = value; return el; }
class TestDate extends Date { constructor(...args) { super(...(args.length ? args : ['2026-09-17T12:00:00'])); } }
const fetch = async (url, options) => {
    const action = new URL(url, 'http://localhost/').searchParams.get('action');
    let data;
    if (action === 'state') data = { state, archived, token: 'test-token', songs: [a, b, c], libraryMissing: false, playlists: lists, metadata: metadataPending ? undefined : { [a]: { duration: 222, year: "2021" }, [b]: { duration: 3665, year: "1998" } }, metadataPending };
    else if (action === 'metadata') {
        if (metadataFailure) return { ok: false, status: 500, json: async () => { throw new Error('empty response'); } };
        const input = JSON.parse(options.body);
        metadataRequests.push(input.paths);
        // Return only one file per request, as the server does when its time budget expires.
        await new Promise(resolve => { releaseMetadata = resolve; });
        data = { metadata: { [input.paths[0]]: { artist: 'Background artist', albumArtist: '', title: 'Background title' } } };
    }
    else if (action === 'tags-read') data = { tags: trackTags, revision: 'tag-revision' };
    else if (action === 'tags-save') {
        if (tagsError) throw new Error('File changed');
        trackTags = JSON.parse(options.body).tags;
        data = { tags: trackTags, revision: 'updated-revision' };
    }
    else if (action === 'archive-set') {
        if (archiveError) throw new Error('Archive unavailable');
        const input = JSON.parse(options.body);
        archived = archived.filter(path => path !== input.path);
        if (input.archived) archived.push(input.path);
        data = { archived };
    }
    else if (action === 'playlist-add' || action === 'playlist-remove') {
        if (playlistError) throw new Error('Playlist unavailable');
        const input = JSON.parse(options.body);
        let list = lists.find(list => list.name === input.name);
        if (!list) { list = { name: input.name, songs: [] }; lists.push(list); }
        if (action === 'playlist-remove') list.songs = list.songs.filter(song => song.path !== input.path);
        else if (!list.songs.some(song => song.path === input.path)) list.songs.push({ path: input.path }); data = { playlists: lists };
    }
    else {
        const input = JSON.parse(options.body);
        if (input.revision !== state.revision) throw new Error('stale revision');
        if (action === 'save') { state.weeks[input.week] = { songs: input.songs }; state.revision++; data = { state }; }
        else { exported.push(input.week); data = { export: { count: state.weeks[input.week].songs.length, path: 'test/current' } }; }
    }
    return { ok: true, json: async () => JSON.parse(JSON.stringify(data)) };
};
let copiedText = '', clipboardError = false;
const navigator = { clipboard: { async writeText(text) { if (clipboardError) throw new Error('Denied'); copiedText = text; } } };
const sandbox = createContext({ document, window, navigator, Option, Date: TestDate, fetch, confirm: () => confirmResult, prompt: () => 'New playlist', console });
new Script(code).runInContext(sandbox);
for (const select of document.getElementById('my-chart').shadowRoot.querySelectorAll('select')) {
    Object.defineProperty(select, 'value', { value: select.querySelector('option')?.getAttribute('value') || '', writable: true });
    select.add = option => select.append(option);
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const check = (condition, label) => { if (!condition) throw new Error('FAIL: ' + label); count++; console.log('PASS ' + label); };
const paths = () => [...$('ranking').querySelectorAll('.info')].map(el => el.dataset.path);
const click = button => button.onclick();
await tick();
check($('week').value === '2026-09-14' && paths().join('|') === [b, a].join('|'), 'open current Monday and saved order');
check($('save').closest('.chart') && $('save').querySelector('svg') && $('save').getAttribute('aria-label'), 'export icon belongs to week chart and has an accessible label');
check(document.getElementById('library') !== $('library'), 'chart and original player have isolated element IDs');
check(!document.getElementById('my-chart').shadowRoot.querySelector('audio'), 'one shared player, no second audio control');
await click($('library').querySelector('.copy-title-button'));
check(copiedText === 'Song A', 'copy falls back to filename without extension when tags are missing');
clipboardError = true;
await click($('library').querySelector('.copy-title-button'));
check($('status').classList.contains('error'), 'clipboard rejection is reported');
clipboardError = false;
let previewPath;
window.playChartSong = path => { previewPath = path; };
click($('library').querySelector('button'));
check(previewPath === a, 'preview delegates to the standard player');
let playback = { path: a, playing: true };
window.getMusicPlaybackState = () => playback;
window.dispatchEvent(new window.Event('music-playback-state'));
const playButtons = () => [...document.getElementById('my-chart').shadowRoot.querySelectorAll('[data-play-path]')];
check(playButtons().filter(el => el.dataset.playPath === a).every(el => el.textContent === 'Ⅱ'), 'playing song shows pause in library and ranking');
const originalRow = $('library').firstElementChild;
playback.playing = false;
window.dispatchEvent(new window.Event('music-playback-state'));
check(playButtons().every(el => el.textContent === '▶') && $('library').firstElementChild === originalRow, 'pause updates icons without rebuilding lists');
playback = { path: b, playing: true };
window.dispatchEvent(new window.Event('music-playback-state'));
check(playButtons().filter(el => el.dataset.playPath === b).every(el => el.getAttribute('aria-pressed') === 'true'), 'automatic track change updates both lists');
const workspace = document.getElementById('my-chart').shadowRoot.querySelector('.workspace');
window.innerHeight = 900; window.scrollY = 0;
workspace.getBoundingClientRect = () => ({ top: 180 - window.scrollY });
Object.defineProperty(document.getElementById('player'), 'offsetHeight', { value: 90, configurable: true });
window.dispatchEvent(new window.Event('resize'));
check(document.getElementById('my-chart').style.getPropertyValue('--workspace-height') === '618px', 'panels fit available viewport above dock');
window.scrollY = 200;
window.dispatchEvent(new window.Event('music-dock-resized'));
check(document.getElementById('my-chart').style.getPropertyValue('--workspace-height') === '618px', 'scrolling does not grow panels or move totals');
check($('stats').children.length === 2, 'initial monthly summary');
check(!$('library').querySelector('script'), 'file names are rendered as text');
click($('ranking').children[1].querySelector('.actions button'));
check(paths().join('|') === [a, b].join('|'), 'move track with keyboard-accessible button');
check($('export').disabled, 'unsaved ranking cannot be exported');
await click($('save'));
check(exported.join() === '2026-09-14', 'saving latest chart automatically exports audio');
click($('next-week'));
check($('week').value === '2026-09-21' && paths().join('|') === [a, b].join('|'), 'next week inherits preceding chart');
click($('ranking').children[1].querySelector('.actions button:last-child'));
const addC = [...$('library').children].find(row => row.querySelector('.info')?.dataset.path === c).querySelectorAll('.actions button')[1];
click(addC);
click($('ranking').children[1].querySelector('.actions button'));
await click($('save'));
check(state.weeks['2026-09-07'].songs.join('|') === [a, b].join('|'), 'older snapshot survives weekly edits');
check(state.weeks['2026-09-21'].songs.join('|') === [c, a].join('|'), 'newcomer, removal and reordering saved');
const summary = [...$('stats').children].map(row => ({ name: row.children[1].querySelector('.info').dataset.path, points: row.children[2].textContent, weeks: row.children[3].textContent }));
check(summary[0].name.includes(a) && summary[0].points === '250' && summary[0].weeks === '3', 'accumulate 100 / rank over weeks');
check(summary[1].name.includes(b) && summary[2].name.includes(c), 'equal points broken by number of weeks');
$('archive').value = '2026-09-07'; $('archive').onchange();
click($('ranking').children[0].querySelectorAll('.actions button')[1]);
await click($('save'));
check(exported.length === 2, 'editing archive does not overwrite current export');
$('period-kind').value = 'year'; $('period-kind').onchange();
check($('period').value === '2026' && $('stats').children.length === 3, 'yearly summary');
$('period').value = '2025'; $('period').oninput();
check($('stats').textContent.includes('пока нет'), 'empty year');
click($('ranking').children[0].querySelectorAll('.actions button')[1]);
confirmResult = false; $('week').value = '2026-10-01'; $('week').onchange();
check($('week').value === '2026-09-07', 'cancel navigation with unsaved changes');
function dragToEnd(row) {
    const start = new window.Event('dragstart', { bubbles: true, cancelable: true });
    start.dataTransfer = { setData() {}, effectAllowed: '' }; row.dispatchEvent(start);
    const drop = new window.Event('drop', { bubbles: true, cancelable: true });
    drop.clientY = 0; $('ranking').dispatchEvent(drop);
}
dragToEnd([...$('library').children].find(row => row.querySelector('.info')?.dataset.path === c));
check(paths().at(-1) === c && paths().length === 3, 'drag library track into chart');
dragToEnd($('ranking').children[0]);
check(paths().join('|') === [b, c, a].join('|'), 'drag existing rank to the end');
check(document.getElementById('library').hidden, 'duplicate stock library is not displayed');
check(document.getElementById('player').contains(document.getElementById('playlistdiv')) && document.getElementById('playlistdiv').hidden, 'queue is collapsed inside docked player');
check(document.getElementById('player').contains(document.getElementById('options')), 'stock tools are inside docked player');
const menuChoice = name => [...$('playlist-menu').querySelectorAll('input')].find(input => input.dataset.name === name);
const choose = async (name, checked) => { const input = menuChoice(name); input.checked = checked; await input.onchange(); };
const setPlaylistFilter = name => {
    click($('playlist-filter'));
    menuChoice('Вся библиотека').onchange();
    if (name) { const input = menuChoice(name); input.checked = true; input.onchange(); }
    click($('playlist-filter'));
};
setPlaylistFilter('Favorites');
check($('library').children.length === 1 && $('library').querySelector('.info').dataset.path === a, 'filter library by saved playlist');
window.queueChartSongs = paths => { queued = [...paths]; return paths.length; };
click($('enqueue-filtered'));
check(queued.join() === a, 'enqueue all adds only filtered playlist songs');
$('search').value = 'no-match'; $('search').oninput();
check($('enqueue-filtered').disabled, 'search intersects playlist filter');
$('search').value = ''; setPlaylistFilter('');
const trackPicker = path => [...$('library').children].find(row => row.querySelector('.info')?.dataset.path === path).querySelector('.playlist-picker');
click(trackPicker(b));
await choose('Favorites', true);
check(lists[0].songs.some(song => song.path === b) && menuChoice('Favorites').checked && !$('playlist-menu').hidden, 'checkbox adds membership and keeps menu open');
click(trackPicker(b));
click(trackPicker(c));
await click($('playlist-menu').querySelector('button'));
check(lists.find(list => list.name === 'New playlist').songs[0].path === c, 'per-track dropdown creates a new playlist');
await choose('Favorites', true);
check(menuChoice('Favorites').checked && menuChoice('New playlist').checked, 'track can belong to multiple checked playlists');
playlistError = true; await choose('Favorites', false);
check(menuChoice('Favorites').checked && !menuChoice('Favorites').disabled, 'failed membership update restores checkbox and allows retry');
playlistError = false;

check(trackPicker(c).closest('.trackrow').querySelectorAll('.playlist-tag').length === 2, 'all membership badges update while menu stays open');
await choose('Favorites', false);
check(!menuChoice('Favorites').checked && menuChoice('New playlist').checked, 'unchecking removes only selected membership');
click(trackPicker(c));
click($('playlist-filter'));
await choose('Favorites', true); await choose('New playlist', true);
check($('library').querySelectorAll('.info').length === 3, 'multiple playlist filter shows union without duplicates');
await choose('Favorites', false);
check($('library').querySelectorAll('.info').length === 1 && $('library').querySelector('.info').dataset.path === c, 'deselecting playlist updates filter');
await choose('Вся библиотека', true); click($('playlist-filter'));
check(paths().join('|') === [b, c, a].join('|'), 'playlist editing preserves chart draft');
click($('enqueue-chart'));
check(queued.join('|') === paths().join('|'), 'enqueue whole chart preserves ranking order');
check($('library').querySelector('.playlist-tag').textContent === 'Favorites', 'playlist membership appears as a tag');
check(!$('library').querySelector('.path') && !$('library').textContent.includes('Artist A/'), 'file path is hidden from secondary text');
check($('library').querySelector('.info').title === a, 'full path remains available as tooltip');
check(!$('library').querySelector('.format-tag') && $('library').querySelector('.track-details').textContent === '3:42 · 2021', 'library shows duration and year instead of MP3');
check($('library').querySelector('.track-meta').firstElementChild.className === 'track-details', 'duration and year precede playlist badges');
check(trackPicker(b).closest('.trackrow').querySelector('.track-details').textContent === '1:01:05 · 1998', 'long durations show hours');
check(trackPicker(c).closest('.trackrow').querySelector('.track-details').textContent === '—:— · год не указан', 'missing metadata is not invented');
$('period').value = '2026'; $('period').oninput();
check($('ranking').querySelector('.playlist-tag') && $('stats').querySelector('.playlist-tag'), 'playlist tags update in rankings and totals');
const libraryPaths = () => [...$('library').querySelectorAll('.info')].map(el => el.dataset.path);
const filter = (id, value) => { if (id === 'playlist-filter') return setPlaylistFilter(value); $(id).value = value; $(id).onchange(); };
filter('chart-filter', 'out');
check(libraryPaths().length === 0, 'chart filter includes unsaved additions');
click($('ranking').children[0].querySelector('.actions button:last-child'));
check(libraryPaths().join() === b, 'chart removal immediately updates uncharted filter');
filter('chart-filter', 'in');
check(libraryPaths().join('|') === [a, c].join('|'), 'chart filter shows only current ranking');
filter('chart-filter', '');
const draft = paths().join('|');
await click($('library').querySelector('.archive-button'));
check(archived.join() === a && paths().join('|') === draft, 'archive persists without changing chart draft');
filter('archive-filter', 'in');
check(libraryPaths().join() === a && $('library').querySelector('.archive-button').getAttribute('aria-pressed') === 'true', 'archived filter and active archive button');
filter('chart-filter', 'out');
check(libraryPaths().length === 0, 'archive and chart filters intersect');
filter('chart-filter', '');
filter('playlist-filter', 'Favorites');
$('search').value = 'Song A'; $('search').oninput();
check(libraryPaths().join() === a, 'archive intersects playlist and search');
click($('enqueue-filtered'));
check(queued.join() === a, 'enqueue uses archive-filtered result');
archiveError = true;
await click($('library').querySelector('.archive-button'));
check(libraryPaths().join() === a && !$('library').querySelector('.archive-button').disabled, 'failed archive update preserves membership and enables retry');
archiveError = false;
await click($('library').querySelector('.archive-button'));
check(libraryPaths().length === 0 && archived.length === 0, 'restore immediately removes song from archive filter');
$('search').value = ''; filter('playlist-filter', ''); filter('archive-filter', 'out');
check(libraryPaths().length === 3, 'unarchived filter shows restored tracks');
filter('archive-filter', '');
$('tag-editor').showModal = function() { this.open = true; };
$('tag-editor').close = function() { this.open = false; this.dispatchEvent(new window.Event('close')); };
await click($('library').querySelector('button[title^="Редактировать теги"]'));
check($('tag-editor').open && $('tag-artist').value === 'Artist' && $('tag-albumArtist').value === 'Album artist', 'editor loads actual file tags into three fields');
$('tag-title').value = '<img src=x onerror=alert(1)> Песня';
$('tag-artist').value = 'Новый исполнитель';
tagsError = true;
await $('tag-form').onsubmit({ preventDefault() {} });
check($('tag-editor').open && $('tag-error').textContent === 'File changed' && !$('tag-save').disabled, 'failed tag save retains edits and allows retry');
tagsError = false;
await $('tag-form').onsubmit({ preventDefault() {} });
check(!$('tag-editor').open && window.musicMetadata[a].artist === 'Новый исполнитель', 'successful tag save closes dialog and updates shared metadata');
check($('library').textContent.includes('<img src=x onerror=alert(1)> Песня') && !$('library').querySelector('img'), 'tag text cannot inject HTML');
check(paths().join('|') === draft, 'tag editing preserves unsaved chart draft');
check($('library').querySelector('.track-details').textContent === '3:42 · 2021', 'editing title preserves duration and year');
await click($('library').querySelector('.copy-title-button'));
check(copiedText === 'Новый исполнитель — <img src=x onerror=alert(1)> Песня', 'copy uses current artist and title as plain text');
$('search').value = 'Новый исполнитель'; $('search').oninput();
check(libraryPaths().join() === a, 'search matches corrected artist');
$('search').value = ''; $('search').oninput();
metadataPending = true;
await click($('reload-library'));
check(!$('reload-library').disabled && libraryPaths().length === 3 && metadataRequests.length === 1, 'library usable while metadata request is pending');
releaseMetadata(); await tick();
check(window.musicMetadata[a].artist === 'Новый исполнитель', 'background tags cannot overwrite newly saved edits');
check(metadataRequests[1].join('|') === [b, c].join('|'), 'partial metadata batch resumes at first unprocessed track');
const openPicker = $('library').querySelector('.playlist-picker');
click(openPicker);
releaseMetadata(); await tick();
check($('library').querySelector('.playlist-picker') === openPicker && openPicker.isConnected, 'background tags preserve focused playlist dropdown');
click(openPicker); await tick();
check($('library').textContent.includes('Background artist'), 'background tags update track labels');
releaseMetadata(); await tick();
check(metadataRequests.length === 3 && paths().join('|') === draft, 'background loading finishes and preserves chart draft');
metadataFailure = true;
await click($('reload-library')); await tick();
check(libraryPaths().length === 3 && $('status').textContent.includes('HTTP 500') && !$('status').textContent.includes('локальный HTML'), 'bad metadata response leaves library usable and reports server error accurately');
console.log(`${count} UI assertions passed.`);
