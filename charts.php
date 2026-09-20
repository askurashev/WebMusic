<?php
// A separate endpoint: the original player and its playlist format stay compatible.
declare(strict_types=1);
ini_set('display_errors', '0');
error_reporting(E_ALL);
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
const CHART_HEADER = "<?php exit; ?>\n";
require_once __DIR__ . '/music.playlists.php';
require_once __DIR__ . '/music.metadata.php';

function fail(string $message, int $status = 400): void {
    http_response_code($status);
    echo json_encode(['error' => $message], JSON_UNESCAPED_UNICODE);
    exit;
}
function jsonText($value): string {
    return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
}
function inside(string $path, string $root): bool {
    $path = str_replace('\\', '/', $path);
    $root = rtrim(str_replace('\\', '/', $root), '/') . '/';
    if (PHP_OS_FAMILY === 'Windows') { $path = strtolower($path); $root = strtolower($root); }
    return strpos($path, $root) === 0;
}
function localPath(string $path): string {
    if (preg_match('~^(?:[A-Za-z]:[\\\\/]|/)~', $path)) return $path;
    return __DIR__ . '/' . $path;
}
function validWeek($value): string {
    if (!is_string($value)) fail('Не указана неделя.');
    $date = DateTimeImmutable::createFromFormat('!Y-m-d', $value);
    if (!$date || $date->format('Y-m-d') !== $value || $date->format('N') !== '1')
        fail('Выберите понедельник нужной недели.');
    return $value;
}
function songFile(string $path, array $cfg): ?string {
    if ($path === '' || preg_match('~[\\\\\x00-\x1f:]~', $path) || $path[0] === '/' || in_array('..', explode('/', $path), true)) return null;
    if (!in_array(strtolower(pathinfo($path, PATHINFO_EXTENSION)), $cfg['extensions'], true)) return null;
    $root = realpath(localPath($cfg['root']));
    $file = $root ? realpath($root . '/' . $path) : false;
    return $file && inside($file, $root) && is_file($file) && is_readable($file) ? $file : null;
}
function scanSongs(string $dir, string $relative, int $depth, array $cfg, array &$songs): void {
    foreach (scandir($dir) ?: [] as $name) {
        if ($name[0] === '.' || is_link($dir . '/' . $name)) continue;
        $path = $relative . $name;
        if (is_dir($dir . '/' . $name)) {
            if ($depth < (int)$cfg['maxdepth']) scanSongs($dir . '/' . $name, $path . '/', $depth + 1, $cfg, $songs);
        } elseif (songFile($path, $cfg)) $songs[] = $path;
    }
}
function writeState(string $file, array $state): void {
    $temporary = $file . '.tmp.php';
    $contents = CHART_HEADER . jsonText($state);
    if (file_put_contents($temporary, $contents) !== strlen($contents) || !rename($temporary, $file))
        throw new RuntimeException('Не удалось сохранить историю чартов. Проверьте права записи и свободное место.');
}
// Only touch a flat directory explicitly owned by this feature, never arbitrary files.
function ownedFiles(string $dir): array {
    if (is_link($dir)) throw new RuntimeException('Папка экспорта не должна быть символической ссылкой.');
    $manifest = $dir . '/.mfp-export.json';
    if (is_link($manifest) || !is_file($manifest)) throw new RuntimeException('Папка current уже существует и не принадлежит чартам. Переименуйте её.');
    $meta = json_decode(file_get_contents($manifest), true, 512, JSON_THROW_ON_ERROR);
    if (($meta['owner'] ?? '') !== 'music-folder-charts' || !is_array($meta['files'] ?? null)) throw new RuntimeException('Повреждён список файлов экспорта.');
    $files = array_merge($meta['files'], ['.mfp-export.json']);
    foreach ($files as $name) {
        if (!is_string($name) || $name === '' || $name !== basename($name) || strpos($name, '\\') !== false || $name === '.' || $name === '..')
            throw new RuntimeException('Некорректное имя файла экспорта.');
    }
    foreach (array_diff(scandir($dir), ['.', '..']) as $name) {
        if (!in_array($name, $files, true) || !is_file($dir . '/' . $name) || is_link($dir . '/' . $name))
            throw new RuntimeException('В current есть посторонние файлы. Переместите их перед обновлением экспорта.');
    }
    return $files;
}
function cleanOwned(string $dir, string $parent): void {
    $resolved = realpath($dir);
    if (!$resolved || !inside($resolved, $parent)) return;
    foreach (ownedFiles($dir) as $name) if (is_file($dir . '/' . $name)) unlink($dir . '/' . $name);
    rmdir($dir);
}
function exportChart(array $state, string $week, array $cfg): array {
    $chart = $state['weeks'][$week];
    $sources = [];
    foreach ($chart['songs'] as $path) {
        $file = songFile($path, $cfg);
        if (!$file) fail('Файл недоступен: ' . $path . '. Верните его в библиотеку или удалите из чарта.');
        $sources[] = $file;
    }
    $parent = __DIR__ . '/chart-exports';
    if (is_link($parent)) throw new RuntimeException('chart-exports не должна быть символической ссылкой.');
    if (!is_dir($parent) && !mkdir($parent)) throw new RuntimeException('Не удалось создать chart-exports.');
    $parent = realpath($parent);
    $root = realpath(localPath($cfg['root']));
    if ($root && ($parent === $root || inside($parent, $root))) throw new RuntimeException('Папка библиотеки не должна включать chart-exports.');
    $current = $parent . '/current';
    if (file_exists($current) || is_link($current)) ownedFiles($current);
    $stage = $parent . '/.building-' . bin2hex(random_bytes(8));
    if (!mkdir($stage)) throw new RuntimeException('Не удалось создать временную папку экспорта.');
    $files = [];
    $published = false;
    try {
        foreach ($sources as $i => $source) {
            $stem = pathinfo($chart['songs'][$i], PATHINFO_FILENAME);
            $stem = preg_replace('~[<>:"/\\\\|?*\x00-\x1f]~u', '_', $stem);
            // Keep names portable, leaving room for the rank and extension.
            while (strlen($stem) > 150) $stem = preg_replace('/.$/us', '', $stem);
            $name = sprintf('%0' . max(3, strlen((string)count($sources))) . 'd - %s.%s', $i + 1, rtrim($stem, '. '), strtolower(pathinfo($source, PATHINFO_EXTENSION)));
            $files[] = $name;
            if (!copy($source, $stage . '/' . $name) || filesize($source) !== filesize($stage . '/' . $name))
                throw new RuntimeException('Не удалось скопировать ' . $chart['songs'][$i] . '. Проверьте свободное место.');
        }
        $manifest = ['owner' => 'music-folder-charts', 'week' => $week, 'revision' => $state['revision'], 'files' => $files];
        $text = jsonText($manifest);
        if (file_put_contents($stage . '/.mfp-export.json', $text) !== strlen($text)) throw new RuntimeException('Не удалось записать описание экспорта.');
        $backup = $parent . '/.previous-' . bin2hex(random_bytes(8));
        $hadCurrent = is_dir($current);
        if ($hadCurrent && !rename($current, $backup)) throw new RuntimeException('Папка current занята. Закройте использующие её программы.');
        if (!rename($stage, $current)) {
            if ($hadCurrent) rename($backup, $current);
            throw new RuntimeException('Не удалось опубликовать папку current.');
        }
        $published = true;
        $warning = '';
        if ($hadCurrent) {
            try { cleanOwned($backup, $parent); }
            catch (Throwable $e) { $warning = 'Предыдущая выгрузка осталась в ' . $backup; }
        }
        return ['week' => $week, 'revision' => $state['revision'], 'path' => str_replace('\\', '/', $current), 'count' => count($files), 'warning' => $warning];
    } finally {
        if (!$published && is_dir($stage) && inside(realpath($stage), $parent)) {
            // Names here were generated by this request; no recursive deletion.
            foreach (array_merge($files, ['.mfp-export.json']) as $file) if (is_file($stage . '/' . $file)) unlink($stage . '/' . $file);
            rmdir($stage);
        }
    }
}

try {
    $ini = parse_ini_file(__DIR__ . '/music.defaults.ini', true, INI_SCANNER_RAW);
    if (is_file(__DIR__ . '/music.ini')) $ini = array_replace_recursive($ini, parse_ini_file(__DIR__ . '/music.ini', true, INI_SCANNER_RAW));
    $cfg = $ini['server'];
    $cfg['extensions'] = array_map('strtolower', explode(',', $cfg['ext_songs']));
    $action = $_GET['action'] ?? 'state';
    // Stream by validated library path; also supports libraries outside the web root.
    if ($action === 'audio') {
        $file = songFile((string)($_GET['path'] ?? ''), $cfg);
        if (isset($_GET['source']) && is_string($_GET['source'])) {
            // The stock player uses root + path, including shared folders and single-song links.
            $libraryRoot = realpath(localPath($cfg['root']));
            $source = realpath(localPath($_GET['source']));
            $file = $libraryRoot && $source && inside($source, $libraryRoot)
                ? songFile(str_replace('\\', '/', substr($source, strlen($libraryRoot) + 1)), $cfg) : null;
        }
        if (!$file) fail('Трек не найден.', 404);
        $size = filesize($file); $start = 0; $end = $size - 1;
        if (isset($_SERVER['HTTP_RANGE'])) {
            if (!preg_match('/^bytes=(\d*)-(\d*)$/', $_SERVER['HTTP_RANGE'], $match) || ($match[1] === '' && $match[2] === '')) {
                header('Content-Range: bytes */' . $size); fail('Недопустимый диапазон.', 416);
            }
            if ($match[1] === '') $start = max(0, $size - (int)$match[2]);
            else { $start = (int)$match[1]; if ($match[2] !== '') $end = min($end, (int)$match[2]); }
            if ($start > $end || $start >= $size) { header('Content-Range: bytes */' . $size); fail('Недопустимый диапазон.', 416); }
            http_response_code(206); header("Content-Range: bytes $start-$end/$size");
        }
        $types = ['mp3'=>'audio/mpeg','flac'=>'audio/flac','fla'=>'audio/flac','ogg'=>'audio/ogg','opus'=>'audio/ogg','m4a'=>'audio/mp4','mp4'=>'audio/mp4','aac'=>'audio/aac','wav'=>'audio/wav','webm'=>'audio/webm'];
        header('Content-Type: ' . ($types[strtolower(pathinfo($file, PATHINFO_EXTENSION))] ?? 'application/octet-stream'));
        header('Accept-Ranges: bytes'); header('Content-Length: ' . max(0, $end - $start + 1));
        if ($_SERVER['REQUEST_METHOD'] !== 'HEAD') {
            $stream = fopen($file, 'rb'); fseek($stream, $start); $remaining = $end - $start + 1;
            while ($remaining > 0 && !feof($stream) && !connection_aborted()) { $chunk = fread($stream, min(65536, $remaining)); if ($chunk === false || $chunk === '') break; echo $chunk; $remaining -= strlen($chunk); }
            fclose($stream);
        }
        exit;
    }
    session_start(['cookie_httponly' => true, 'cookie_samesite' => 'Strict', 'cookie_secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off']);
    if (!isset($_SESSION['charts_token'])) $_SESSION['charts_token'] = bin2hex(random_bytes(24));
    $token = $_SESSION['charts_token']; session_write_close();
    if (!in_array($action, ['state', 'save', 'export', 'playlists', 'playlist-add', 'archive-set', 'tags-read', 'tags-save', 'metadata'], true)) fail('Неизвестное действие.', 404);
    if (!in_array($action, ['state', 'playlists'], true) && ($_SERVER['REQUEST_METHOD'] !== 'POST' || !hash_equals($token, $_SERVER['HTTP_X_CHART_TOKEN'] ?? ''))) fail('Обновите страницу и повторите действие.', 403);
    $playlistDir = localPath($cfg['playlistdir']);
    if ($action === 'metadata') {
        if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 65536) fail('Слишком большой запрос.', 413);
        $input = json_decode(file_get_contents('php://input'), true, 512, JSON_THROW_ON_ERROR);
        $paths = $input['paths'] ?? null;
        if (!is_array($paths) || count($paths) > 25 || !$paths || count(array_filter($paths, 'is_string')) !== count($paths)) fail('Некорректный список MP3.');
        echo jsonText(['metadata' => mfpLibraryMetadata($paths, $cfg)]);
        exit;
    }
    if ($action === 'playlists' || $action === 'playlist-add') {
        if (($ini['client']['onlinepls'] ?? 'true') !== 'true') fail('Сохранение плейлистов отключено в настройках.', 403);
        $playlistLock = mfpPlaylistLock($playlistDir);
        try {
            if ($action === 'playlist-add') {
                $input = json_decode(file_get_contents('php://input'), true, 512, JSON_THROW_ON_ERROR);
                $name = mfpPlaylistName((string)($input['name'] ?? ''));
                $path = $input['path'] ?? '';
                if (!is_string($path) || !songFile($path, $cfg)) fail('Композиция не найдена в библиотеке.');
                $playlistFile = $playlistDir . '/' . $name . '.mfp.json';
                if (!empty($input['create']) && file_exists($playlistFile)) fail('Плейлист с таким названием уже существует.', 409);
                if (empty($input['create']) && !file_exists($playlistFile)) fail('Плейлист удалён. Обновите список.', 404);
                $value = is_file($playlistFile) ? mfpReadPlaylist($playlistFile) : [];
                $entries = $value['playlist'] ?? $value;
                if (!in_array($path, array_column($entries, 'path'), true)) {
                    $entry = ['path' => $path];
                    $source = songFile($path, $cfg);
                    foreach (scandir(dirname($source)) as $image) {
                        if (in_array(strtolower(pathinfo($image, PATHINFO_EXTENSION)), explode(',', $cfg['ext_images']), true)) {
                            if (!isset($entry['cover']) || preg_match('/^(cover|folder)/i', $image)) $entry['cover'] = $image;
                        }
                    }
                    $entries[] = $entry;
                    if (isset($value['playlist'])) $value['playlist'] = $entries; else $value = $entries;
                    mfpWritePlaylist($playlistFile, $value);
                }
            }
            echo jsonText(['playlists' => mfpListPlaylists($playlistDir)]);
        } finally { flock($playlistLock, LOCK_UN); fclose($playlistLock); }
        exit;
    }
    $storage = __DIR__ . '/chart-data';
    if (is_link($storage)) throw new RuntimeException('chart-data не должна быть символической ссылкой.');
    if (!is_dir($storage) && !mkdir($storage)) throw new RuntimeException('Не удалось создать chart-data. Проверьте права записи.');
    $lock = fopen($storage . '/lock.php', 'c+');
    if (!$lock || !flock($lock, LOCK_EX)) throw new RuntimeException('Не удалось заблокировать историю чартов.');
    if ($action === 'tags-read' || $action === 'tags-save') {
        if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 65536) fail('Слишком большой запрос.', 413);
        $input = json_decode(file_get_contents('php://input'), true, 512, JSON_THROW_ON_ERROR);
        $path = $input['path'] ?? null;
        $source = is_string($path) ? songFile($path, $cfg) : null;
        if (!$source || strtolower(pathinfo($source, PATHINFO_EXTENSION)) !== 'mp3') fail('Выберите MP3 из библиотеки.', 400);
        if ($action === 'tags-save' && (!is_array($input['tags'] ?? null) || !is_string($input['revision'] ?? null))) fail('Некорректные данные тегов.');
        echo jsonText($action === 'tags-read' ? mfpMetadata($source) : mfpSaveTags($source, $input['tags'], $input['revision']));
        flock($lock, LOCK_UN); fclose($lock); exit;
    }
    $file = $storage . '/history.php';
    $state = ['revision' => 0, 'scoring' => 'reciprocal-100-v1', 'weeks' => []];
    if (is_file($file)) {
        $raw = file_get_contents($file);
        if (strpos($raw, CHART_HEADER) !== 0) throw new RuntimeException('Повреждён файл истории.');
        $state = json_decode(substr($raw, strlen(CHART_HEADER)), true, 512, JSON_THROW_ON_ERROR);
    }
    // Track archive is independent of chart revisions and weekly snapshots.
    $archiveFile = $storage . '/archive.php';
    $archived = [];
    if (is_file($archiveFile)) {
        $raw = file_get_contents($archiveFile);
        if (strpos($raw, CHART_HEADER) !== 0) throw new RuntimeException('Повреждён файл архива треков.');
        $archived = json_decode(substr($raw, strlen(CHART_HEADER)), true, 512, JSON_THROW_ON_ERROR);
        if (!is_array($archived) || array_values($archived) !== $archived || count(array_filter($archived, 'is_string')) !== count($archived))
            throw new RuntimeException('Повреждён список архивных треков.');
    }
    if ($action === 'archive-set') {
        if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 2097152) fail('Слишком большой запрос.', 413);
        $input = json_decode(file_get_contents('php://input'), true, 512, JSON_THROW_ON_ERROR);
        $path = $input['path'] ?? null;
        $value = $input['archived'] ?? null;
        if (!is_string($path) || !is_bool($value)) fail('Некорректный запрос архива.');
        if (!songFile($path, $cfg) && ($value || !in_array($path, $archived, true))) fail('Композиция не найдена в библиотеке.');
        $archived = array_values(array_diff($archived, [$path]));
        if ($value) $archived[] = $path;
        writeState($archiveFile, $archived);
        echo jsonText(['archived' => $archived]);
    } elseif ($action === 'state') {
        $songs = []; $root = realpath(localPath($cfg['root']));
        if ($root && is_dir($root)) scanSongs($root, '', 0, $cfg, $songs);
        natcasesort($songs);
        echo jsonText(['state' => $state, 'metadataPending' => true, 'archived' => $archived, 'token' => $token, 'songs' => array_values($songs), 'libraryMissing' => !$root, 'root' => $cfg['root'], 'playlists' => mfpListPlaylists($playlistDir), 'onlinePlaylists' => ($ini['client']['onlinepls'] ?? 'true') === 'true']);
    } else {
        if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 2097152) fail('Слишком большой запрос.', 413);
        $input = json_decode(file_get_contents('php://input'), true, 512, JSON_THROW_ON_ERROR);
        if (!is_array($input)) fail('Некорректный запрос.');
        if (($input['revision'] ?? null) !== $state['revision']) fail('История изменена в другой вкладке. Обновите страницу перед сохранением.', 409);
        $week = validWeek($input['week'] ?? null);
        if ($action === 'save') {
            $songs = $input['songs'] ?? null;
            if (!is_array($songs) || array_values($songs) !== $songs) fail('Некорректный список композиций.');
            $known = [];
            foreach ($state['weeks'] as $chart) foreach ($chart['songs'] as $path) $known[$path] = true;
            $seen = [];
            foreach ($songs as $path) {
                if (!is_string($path) || isset($seen[$path])) fail('В чарте есть повторяющиеся или некорректные треки.');
                if (!isset($known[$path]) && !songFile($path, $cfg)) fail('Трек не найден в библиотеке: ' . $path);
                $seen[$path] = true;
            }
            $state['weeks'][$week] = ['songs' => $songs, 'updatedAt' => gmdate('c')];
            ksort($state['weeks']); $state['revision']++;
            writeState($file, $state);
            echo jsonText(['state' => $state]);
        } else {
            $dates = array_keys($state['weeks']); sort($dates);
            if (!$dates || $week !== end($dates)) fail('Выгружать можно только самую новую сохранённую неделю.');
            set_time_limit(0);
            echo jsonText(['export' => exportChart($state, $week, $cfg)]);
        }
    }
    flock($lock, LOCK_UN); fclose($lock);
} catch (Throwable $e) {
    error_log('Music charts: ' . $e->getMessage());
    fail($e instanceof RuntimeException ? $e->getMessage() : 'Не удалось обработать данные чартов. Подробности в журнале PHP.', 500);
}
