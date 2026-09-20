<?php
// Run: php tests/charts-test.php. Everything is created in an isolated temporary directory.
declare(strict_types=1);
$fixture = sys_get_temp_dir() . '/webmusic-charts-test-' . bin2hex(random_bytes(8));
mkdir($fixture);
foreach (['charts.php', 'music.defaults.ini', 'music.playlists.php', 'music.metadata.php', 'music.php', 'music.lang.en.ini'] as $file) copy(dirname(__DIR__) . '/' . $file, $fixture . '/' . $file);
mkdir($fixture . '/library'); mkdir($fixture . '/library/Альбом'); mkdir($fixture . '/library/Другой');
$a = 'Альбом/Одна песня.mp3'; $b = 'Другой/Одна песня.mp3'; $c = 'Третья.flac';
foreach ([$a => 'first-audio-bytes', $b => 'second-audio-bytes', $c => 'third-audio-bytes'] as $path => $bytes) file_put_contents($fixture . '/library/' . $path, $bytes);
file_put_contents($fixture . '/library/cover.jpg', 'not-music');
$socket = stream_socket_server('tcp://127.0.0.1:0', $errno, $error);
$address = stream_socket_get_name($socket, false); fclose($socket);
$process = proc_open([PHP_BINARY, '-S', $address, '-t', $fixture], [['pipe', 'r'], ['file', $fixture . '/server.log', 'a'], ['file', $fixture . '/server.log', 'a']], $pipes);
fclose($pipes[0]);
$cookie = ''; $token = ''; $assertions = 0;
function check(bool $condition, string $label): void {
    global $assertions;
    if (!$condition) throw new RuntimeException('FAIL: ' . $label);
    $assertions++; echo "PASS $label\n";
}
function request(string $action, ?array $body = null, bool $authorized = true, array $extra = []): array {
    global $address, $cookie, $token;
    $headers = ['Cookie: ' . $cookie];
    if ($body !== null) { $headers[] = 'Content-Type: application/json'; if ($authorized) $headers[] = 'X-Chart-Token: ' . $token; }
    $context = stream_context_create(['http' => ['method' => $body === null ? 'GET' : 'POST', 'header' => implode("\r\n", array_merge($headers, $extra)), 'content' => $body === null ? '' : json_encode($body), 'ignore_errors' => true, 'timeout' => 10]]);
    $raw = file_get_contents('http://' . $address . '/charts.php?action=' . $action, false, $context);
    $responseHeaders = http_get_last_response_headers();
    foreach ($responseHeaders as $header) if (stripos($header, 'Set-Cookie:') === 0) $cookie = explode(';', substr($header, 12))[0];
    preg_match('/\s(\d{3})\s/', $responseHeaders[0], $match);
    $data = json_decode($raw, true);
    if (isset($data['token'])) $token = $data['token'];
    return [(int)$match[1], $data, $raw];
}
try {
    for ($i = 0; $i < 50; $i++) { $ready = @fsockopen(explode(':', $address)[0], (int)explode(':', $address)[1]); if ($ready) { fclose($ready); break; } usleep(100000); }
    [$code, $data] = request('state');
    check($code === 200 && count($data['songs']) === 3, 'scan music, nested Cyrillic paths, exclude cover');
    check($data['state']['revision'] === 0, 'fresh history');
    $originalAudio = file_get_contents($fixture . '/library/' . $a);
    check(request('tags-read', ['path'=>$a], false)[0] === 403, 'tag reads require session token');
    check(request('tags-read', ['path'=>'../music.defaults.ini'])[0] === 400, 'tag editor rejects traversal');
    check(request('tags-read', ['path'=>$c])[0] === 400, 'tag editor only accepts MP3');
    $tagRead = request('tags-read', ['path'=>$a])[1];
    $tagValues = ['artist'=>'Исполнитель <b>', 'albumArtist'=>'Исполнитель альбома', 'title'=>'Песня 🎵'];
    $tagInput = ['path'=>$a, 'tags'=>$tagValues, 'revision'=>$tagRead['revision']];
    check(request('tags-save', $tagInput, false)[0] === 403, 'tag writes require session token');
    [$tagCode, $tagResult] = request('tags-save', $tagInput);
    check($tagCode === 200 && $tagResult['tags'] === $tagValues, 'write and read Unicode MP3 tags');
    check(request('tags-save', $tagInput)[0] === 500, 'reject stale file revision');
    check(request('state')[1]['metadataPending'] === true, 'library state defers tag reads');
    check(request('metadata', ['paths'=>[$a]])[1]['metadata'][$a] === $tagValues, 'metadata batch reads saved tags');
    check(request('metadata', ['paths'=>[$a]], false)[0] === 403, 'metadata batch requires token');
    check(request('metadata', ['paths'=>array_fill(0, 26, $a)])[0] === 400, 'metadata batch size is bounded');
    check(request('metadata', ['paths'=>['../outside.mp3']])[1]['metadata']['../outside.mp3'] === null, 'metadata batch cannot read outside library');
    $backups = glob($fixture . '/chart-data/tag-backups/*.php');
    check(count($backups) === 1 && substr(file_get_contents($backups[0]), 15) === $originalAudio, 'backup contains exact original bytes');
    check(file_get_contents('http://' . $address . '/chart-data/tag-backups/' . basename($backups[0])) === '', 'backup is protected from direct HTTP reads');
    check(str_ends_with(file_get_contents($fixture . '/library/' . $a), $originalAudio), 'audio payload unchanged after tag write');
    file_put_contents($fixture . '/library/' . $a, $originalAudio);
    check($data['archived'] === [], 'empty track archive on existing installations');
    $archive = ['path' => $a, 'archived' => true];
    check(request('archive-set', $archive, false)[0] === 403, 'archive requires session token');
    check(request('archive-set', $archive)[1]['archived'] === [$a], 'archive track');
    check(request('archive-set', $archive)[1]['archived'] === [$a], 'archive is idempotent');
    request('archive-set', ['path' => $b, 'archived' => true]);
    $archiveState = request('state')[1];
    check($archiveState['archived'] === [$a, $b] && $archiveState['state']['revision'] === 0, 'archive persists independently without losing other tracks');
    check(count($archiveState['songs']) === 3 && is_file($fixture . '/library/' . $a), 'archiving preserves library and files');
    check(request('archive-set', ['path' => '../music.defaults.ini', 'archived' => true])[0] === 400, 'archive rejects paths outside library');
    check(request('archive-set', ['path' => $a, 'archived' => 'false'])[0] === 400, 'archive requires boolean membership');
    check(request('archive-set', ['path' => $a, 'archived' => false])[1]['archived'] === [$b], 'restore leaves other archived tracks intact');
    check(request('archive-set', ['path' => $b, 'archived' => false])[1]['archived'] === [], 'restore last archived track');
    check(file_get_contents('http://' . $address . '/chart-data/archive.php') === '', 'track archive is protected from direct reads');
    $newPlaylist = ['name' => 'Любимое', 'path' => $a, 'create' => true];
    check(request('playlist-add', $newPlaylist, false)[0] === 403, 'playlist changes require session token');
    [$code, $data] = request('playlist-add', $newPlaylist);
    check($code === 200 && $data['playlists'][0]['songs'][0]['path'] === $a, 'create named playlist with a track');
    $legacy = json_decode(file_get_contents('http://' . $address . '/music.php?pl'), true);
    check(json_decode($legacy['Любимое'], true)[0]['path'] === $a, 'new playlist is readable by stock player endpoint');
    check(request('playlist-add', $newPlaylist)[0] === 409, 'creating same name cannot overwrite playlist');
    check(request('playlist-add', ['name' => 'Любимое', 'path' => $b])[0] === 200, 'append to existing playlist');
    [$code, $data] = request('playlist-add', ['name' => 'Любимое', 'path' => $b]);
    check($code === 200 && count($data['playlists'][0]['songs']) === 2, 'playlist append is idempotent');
    check(request('playlist-add', ['name' => '../escape', 'path' => $a, 'create' => true])[0] >= 400 && !file_exists($fixture . '/escape.mfp.json'), 'playlist name cannot escape storage');
    check(request('playlist-add', ['name' => 'Любимое', 'path' => '../music.defaults.ini'])[0] === 400, 'playlist only accepts music files in library');
    file_put_contents($fixture . '/music.pls/Position.mfp.json', json_encode(json_encode(['index' => 0, 'playlist' => [['path' => $a]]])));
    request('playlist-add', ['name' => 'Position', 'path' => $b]);
    $withPosition = json_decode(json_decode(file_get_contents($fixture . '/music.pls/Position.mfp.json')), true);
    check($withPosition['index'] === 0 && count($withPosition['playlist']) === 2, 'append preserves stock saved-position format');
    $legacyBody = json_encode(['name' => 'Legacy save', 'songs' => json_encode([['path' => $c]])]);
    $legacyContext = stream_context_create(['http' => ['method' => 'POST', 'header' => 'Content-Type: application/json', 'content' => $legacyBody]]);
    check(file_get_contents('http://' . $address . '/music.php', false, $legacyContext) === '', 'stock save returns successful empty response');
    $list = request('playlists')[1]['playlists'];
    check(in_array('Legacy save', array_column($list, 'name'), true), 'library reads playlists created by stock save');
    $save = ['week' => '2026-09-07', 'revision' => 0, 'songs' => [$a, $b]];
    check(request('save', $save, false)[0] === 403, 'reject missing CSRF token');
    check(request('save', array_replace($save, ['week' => '2026-09-08']))[0] === 400, 'reject non-Monday');
    check(request('save', array_replace($save, ['songs' => [$a, $a]]))[0] === 400, 'reject duplicate tracks');
    check(request('save', array_replace($save, ['songs' => ['../music.defaults.ini']]))[0] === 400, 'reject path traversal');
    [$code, $data] = request('save', $save);
    check($code === 200 && $data['state']['revision'] === 1, 'save first week');
    check(request('save', $save)[0] === 409, 'reject stale concurrent save');
    [$code, $data] = request('export', ['week' => '2026-09-07', 'revision' => 1]);
    check($code === 200 && $data['export']['count'] === 2, 'export real audio copies');
    $out = $fixture . '/chart-exports/current';
    check(file_get_contents($out . '/001 - Одна песня.mp3') === 'first-audio-bytes' && file_get_contents($out . '/002 - Одна песня.mp3') === 'second-audio-bytes', 'preserve duplicate basenames and file bytes');
    [$code, $data] = request('save', ['week' => '2026-09-14', 'revision' => 1, 'songs' => [$c, $a]]);
    check($code === 200 && $data['state']['weeks']['2026-09-07']['songs'] === [$a, $b], 'next week preserves old snapshot');
    check(request('export', ['week' => '2026-09-07', 'revision' => 2])[0] === 400, 'old chart cannot replace current export');
    check(request('export', ['week' => '2026-09-14', 'revision' => 2])[0] === 200, 'replace current folder');
    check(!is_file($out . '/002 - Одна песня.mp3') || file_get_contents($out . '/002 - Одна песня.mp3') === 'first-audio-bytes', 'removed entry is no longer in exported chart');
    check(count(glob($out . '/*.mp3')) === 1 && count(glob($out . '/*.flac')) === 1, 'export contains exact current membership');
    check(is_file($fixture . '/library/' . $b), 'originals are never removed');
    file_put_contents($out . '/my-notes.txt', 'keep me');
    check(request('export', ['week' => '2026-09-14', 'revision' => 2])[0] === 500 && file_get_contents($out . '/my-notes.txt') === 'keep me', 'refuse to overwrite foreign files');
    unlink($out . '/my-notes.txt');
    rename($fixture . '/library/' . $c, $fixture . '/library/missing.tmp');
    check(request('export', ['week' => '2026-09-14', 'revision' => 2])[0] === 400 && is_file($out . '/001 - Третья.flac'), 'missing source leaves old export intact');
    check(request('save', ['week' => '2026-09-14', 'revision' => 2, 'songs' => [$a, $c]])[0] === 200, 'missing historical track can remain in archive');
    [$code, , $raw] = request('audio&path=' . rawurlencode($a), null, true, ['Range: bytes=0-4']);
    check($code === 206 && $raw === 'first', 'audio byte ranges');
    [$code, , $raw] = request('audio&source=' . rawurlencode('library/' . $a), null, true, ['Range: bytes=6-10']);
    check($code === 206 && $raw === 'audio', 'stock player URL returns exact bytes from middle of file');
    [$code, , $raw] = request('audio&source=' . rawurlencode('library/' . $a), null, true, ['Range: bytes=-5']);
    check($code === 206 && $raw === 'bytes', 'suffix range for audio metadata');
    check(request('audio&source=' . rawurlencode('library/' . $a), null, true, ['Range: bytes=999999-'])[0] === 416, 'reject out-of-bounds audio range');
    check(request('audio&source=' . rawurlencode('music.defaults.ini'))[0] === 404, 'stock player source cannot read outside music library');
    check(request('audio&path=' . rawurlencode('../music.defaults.ini'))[0] === 404, 'audio cannot read outside library');
    $raw = file_get_contents('http://' . $address . '/chart-data/history.php');
    check($raw === '', 'history not exposed as a direct file');
    $many = [];
    for ($i = 0; $i < 105; $i++) { $path = "track-$i.mp3"; file_put_contents($fixture . '/library/' . $path, 'music'); $many[] = $path; }
    check(request('save', ['week' => '2026-09-21', 'revision' => 3, 'songs' => $many])[0] === 200, 'chart accepts more than 100 tracks');
    check(request('save', ['week' => '2026-09-28', 'revision' => 4, 'songs' => []])[0] === 200, 'save an empty week');
    check(request('export', ['week' => '2026-09-28', 'revision' => 5])[0] === 200 && count(glob($out . '/*.mp3')) === 0 && count(glob($out . '/*.flac')) === 0, 'empty chart clears only managed export copies');
    echo "\n$assertions assertions passed.\n";
} finally {
    proc_terminate($process); proc_close($process);
    // The resolved target must be our generated fixture directly under the temporary directory.
    $resolved = realpath($fixture);
    if ($resolved && dirname($resolved) === realpath(sys_get_temp_dir()) && strpos(basename($resolved), 'webmusic-charts-test-') === 0) {
        $items = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($resolved, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST);
        foreach ($items as $item) { if ($item->isDir() && !$item->isLink()) rmdir($item->getPathname()); else unlink($item->getPathname()); }
        rmdir($resolved);
    }
}
