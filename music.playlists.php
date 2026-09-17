<?php
// Shared storage for the stock player and the library's per-track playlist actions.
declare(strict_types=1);
function mfpPlaylistName(string $name): string {
    $name = trim($name);
    if ($name === '' || strlen($name) > 180 || preg_match('~[<>:"/\\\\|?*\x00-\x1f]~u', $name) || substr($name, -1) === '.' || in_array($name, ['.', '..'], true))
        throw new RuntimeException('Укажите название без символов / \\ : * ? " < > |.');
    return $name;
}
function mfpPlaylistLock(string $dir) {
    if (!is_dir($dir) && !mkdir($dir, 0777, true)) throw new RuntimeException('Не удалось создать папку плейлистов.');
    $lock = fopen($dir . '/.playlists.lock', 'c');
    if (!$lock || !flock($lock, LOCK_EX)) throw new RuntimeException('Не удалось открыть плейлисты для записи.');
    return $lock;
}
function mfpReadPlaylist(string $file) {
    $value = json_decode(file_get_contents($file), true, 512, JSON_THROW_ON_ERROR);
    if (is_string($value)) $value = json_decode($value, true, 512, JSON_THROW_ON_ERROR);
    if (!is_array($value)) throw new RuntimeException('Повреждён плейлист: ' . basename($file));
    $songs = $value['playlist'] ?? $value;
    if (!is_array($songs) || array_values($songs) !== $songs) throw new RuntimeException('Некорректный список композиций.');
    foreach ($songs as $song) if (!is_array($song) || !is_string($song['path'] ?? null)) throw new RuntimeException('Некорректная композиция в плейлисте.');
    return $value;
}
function mfpWritePlaylist(string $file, array $playlist): void {
    // The stock player expects a JSON-encoded string containing its JSON playlist.
    $data = json_encode(json_encode($playlist, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR), JSON_THROW_ON_ERROR);
    $temp = tempnam(dirname($file), '.mfp-');
    try {
        if (file_put_contents($temp, $data) !== strlen($data)) throw new RuntimeException('Не удалось записать плейлист.');
        if (is_file($file) && !copy($file, $file . '.' . gmdate('YmdHis') . '-' . bin2hex(random_bytes(3)))) throw new RuntimeException('Не удалось сохранить предыдущую версию плейлиста.');
        if (!rename($temp, $file)) throw new RuntimeException('Не удалось обновить плейлист.');
    } finally { if (is_file($temp)) unlink($temp); }
}
function mfpListPlaylists(string $dir): array {
    $result = [];
    foreach (glob($dir . '/*.mfp.json') ?: [] as $file) {
        $name = substr(basename($file), 0, -9);
        try {
            $value = mfpReadPlaylist($file);
            $result[] = ['name' => $name, 'songs' => $value['playlist'] ?? $value];
        } catch (Throwable $e) {
            $result[] = ['name' => $name, 'songs' => [], 'error' => 'Файл плейлиста повреждён.'];
        }
    }
    return $result;
}
