<?php
declare(strict_types=1);

// A deliberately narrow ID3 editor. Unedited frames and audio are copied verbatim.
// Complex tag headers are rejected rather than silently dropping their data.
function mfpTagNumber(string $bytes, bool $sync = false): int {
    $value = 0;
    foreach (str_split($bytes) as $byte) {
        $n = ord($byte);
        if ($sync && $n > 127) throw new RuntimeException('Повреждён размер ID3-тега.');
        $value = ($value << ($sync ? 7 : 8)) | $n;
    }
    return $value;
}
function mfpTagSize(int $value, bool $sync = true, int $length = 4): string {
    $out = '';
    for ($i = 0; $i < $length; $i++) { $out = chr($value & ($sync ? 127 : 255)) . $out; $value >>= $sync ? 7 : 8; }
    return $out;
}
function mfpTagText(string $data): string {
    if ($data === '') return '';
    $encodings = ['ISO-8859-1', 'UTF-16', 'UTF-16BE', 'UTF-8'];
    $encoding = $encodings[ord($data[0])] ?? null;
    if (!$encoding) throw new RuntimeException('Неизвестная кодировка ID3-тега.');
    $value = @iconv($encoding, 'UTF-8', substr($data, 1));
    if ($value === false) throw new RuntimeException('Повреждён текст ID3-тега.');
    return trim(str_replace("\0", '; ', rtrim($value, "\0")));
}
function mfpReadTags(string $file): array {
    $stream = fopen($file, 'rb');
    if (!$stream) throw new RuntimeException('Не удалось прочитать MP3.');
    try {
        $header = fread($stream, 10);
        $version = 3; $offset = 0; $frames = [];
        $tags = ['artist' => '', 'albumArtist' => '', 'title' => ''];
        $found = [];
        if (substr($header, 0, 3) === 'ID3') {
            if (strlen($header) !== 10) throw new RuntimeException('Обрезан заголовок ID3.');
            $version = ord($header[3]);
            if (!in_array($version, [2, 3, 4], true) || ord($header[4]) !== 0 || ord($header[5]) !== 0)
                throw new RuntimeException('Этот вариант ID3 пока не поддерживается (расширенный заголовок, сжатие или unsynchronisation). Файл не изменён.');
            $size = mfpTagNumber(substr($header, 6, 4), true);
            if ($size > 16777216) throw new RuntimeException('ID3-тег превышает 16 МБ.');
            $body = $size ? fread($stream, $size) : '';
            if (strlen($body) !== $size) throw new RuntimeException('Обрезан ID3-тег.');
            $offset = 10 + $size; $pos = 0; $head = $version === 2 ? 6 : 10;
            $names = $version === 2 ? ['TP1'=>'artist', 'TP2'=>'albumArtist', 'TT2'=>'title'] : ['TPE1'=>'artist', 'TPE2'=>'albumArtist', 'TIT2'=>'title'];
            while ($pos < $size) {
                if ($body[$pos] === "\0") {
                    if (trim(substr($body, $pos), "\0") !== '') throw new RuntimeException('Повреждено заполнение ID3-тега.');
                    break;
                }
                $idLength = $version === 2 ? 3 : 4;
                $id = substr($body, $pos, $idLength);
                if ($size - $pos < $head || !preg_match('/^[A-Z0-9]{' . $idLength . '}$/D', $id)) throw new RuntimeException('Повреждена структура ID3-тега.');
                $length = mfpTagNumber(substr($body, $pos + $idLength, $version === 2 ? 3 : 4), $version === 4);
                if ($length <= 0 || $pos + $head + $length > $size) throw new RuntimeException('Повреждён блок ID3-тега.');
                $raw = substr($body, $pos, $head + $length);
                if (isset($names[$id])) {
                    if ($version !== 2 && substr($raw, 8, 2) !== "\0\0") throw new RuntimeException('Редактируемое поле ID3 защищено или использует специальные флаги.');
                    $tags[$names[$id]] = mfpTagText(substr($raw, $head));
                    $found[$names[$id]] = true;
                }
                $frames[] = ['id' => $id, 'raw' => $raw]; $pos += $head + $length;
            }
        }
        $v1 = '';
        if (fstat($stream)['size'] >= 128) {
            fseek($stream, -128, SEEK_END); $tail = fread($stream, 128);
            if (substr($tail, 0, 3) === 'TAG') {
                $v1 = $tail;
                foreach (['title'=>3, 'artist'=>33] as $field => $start) {
                    if (!isset($found[$field])) $tags[$field] = trim(iconv('ISO-8859-1', 'UTF-8', rtrim(substr($tail, $start, 30), "\0 ")));
                }
            }
        }
        return ['tags'=>$tags, 'version'=>$version, 'offset'=>$offset, 'frames'=>$frames, 'v1'=>$v1];
    } finally { fclose($stream); }
}
function mfpMetadata(string $file): array {
    $read = mfpReadTags($file);
    return ['tags'=>$read['tags'], 'revision'=>hash_file('sha256', $file)];
}
function mfpLibraryMetadata(array $songs, array $cfg): array {
    $result = []; $started = microtime(true);
    foreach ($songs as $path) {
        if (!is_string($path) || strtolower(pathinfo($path, PATHINFO_EXTENSION)) !== 'mp3') continue;
        $result[$path] = null;
        try { $file = songFile($path, $cfg); if ($file) $result[$path] = mfpReadTags($file)['tags']; }
        catch (Throwable $e) { /* A bad tag must not prevent the library from loading. */ }
        // Bound each request, including cold filesystem reads on large libraries.
        if (microtime(true) - $started >= 1) break;
    }
    return $result;
}
function mfpSaveTags(string $file, array $tags, string $revision): array {
    $tags = array_intersect_key($tags, array_flip(['artist', 'albumArtist', 'title']));
    foreach (['artist', 'albumArtist', 'title'] as $field) {
        if (!isset($tags[$field]) || !is_string($tags[$field]) || strlen($tags[$field]) > 4096 || preg_match('/[\x00-\x1f\x7f]/', $tags[$field]) || !preg_match('//u', $tags[$field]))
            throw new RuntimeException('Некорректное поле тега (максимум 4096 байт, без управляющих символов).');
        $tags[$field] = trim($tags[$field]);
    }
    $current = hash_file('sha256', $file);
    if (!hash_equals($current, $revision)) throw new RuntimeException('Файл изменился. Закройте редактор и откройте его снова.');
    if (!is_writable($file) || !is_writable(dirname($file))) throw new RuntimeException('Нет прав на запись MP3 или его папки.');
    $read = mfpReadTags($file); $version = $read['version'];
    $names = $version === 2 ? ['artist'=>'TP1', 'albumArtist'=>'TP2', 'title'=>'TT2'] : ['artist'=>'TPE1', 'albumArtist'=>'TPE2', 'title'=>'TIT2'];
    $body = '';
    foreach ($read['frames'] as $frame) if (!in_array($frame['id'], $names, true)) $body .= $frame['raw'];
    foreach ($names as $field => $id) {
        $value = $version === 4 ? "\3" . $tags[$field] : "\1\xff\xfe" . iconv('UTF-8', 'UTF-16LE', $tags[$field]);
        $body .= $id . mfpTagSize(strlen($value), $version === 4, $version === 2 ? 3 : 4) . ($version === 2 ? '' : "\0\0") . $value;
    }
    $body .= str_repeat("\0", 1024);
    $header = 'ID3' . chr($version) . "\0\0" . mfpTagSize(strlen($body));
    $temp = tempnam(dirname($file), '.mfp-tags-');
    if (!$temp) throw new RuntimeException('Не удалось создать временный MP3.');
    try {
        $source = fopen($file, 'rb'); $target = fopen($temp, 'wb');
        if (!$source || !$target) throw new RuntimeException('Не удалось открыть временный MP3.');
        try {
            $prefix = $header . $body;
            if (fwrite($target, $prefix) !== strlen($prefix)) throw new RuntimeException('Не удалось записать теги.');
            fseek($source, $read['offset']);
            $remaining = filesize($file) - $read['offset'] - strlen($read['v1']);
            if (stream_copy_to_stream($source, $target, $remaining) !== $remaining) throw new RuntimeException('Не удалось скопировать звук.');
            if ($read['v1'] !== '') {
                $v1 = $read['v1'];
                foreach (['title'=>3, 'artist'=>33] as $field => $start) {
                    $text = iconv('UTF-8', 'ISO-8859-1//TRANSLIT', $tags[$field]);
                    $v1 = substr_replace($v1, str_pad(substr($text, 0, 30), 30, "\0"), $start, 30);
                }
                if (fwrite($target, $v1) !== 128) throw new RuntimeException('Не удалось записать ID3v1.');
            }
            if (!fflush($target) || !fsync($target)) throw new RuntimeException('Не удалось завершить запись MP3.');
        } finally { fclose($source); fclose($target); }
        if (mfpReadTags($temp)['tags'] != $tags) throw new RuntimeException('Проверка записанных тегов не пройдена.');
        if (!hash_equals($current, hash_file('sha256', $file))) throw new RuntimeException('Файл изменился во время сохранения. Повторите действие.');
        // Keep the original of each distinct file revision; hidden PHP prefix prevents HTTP downloads.
        $backupDir = __DIR__ . '/chart-data/tag-backups';
        if (is_link($backupDir) || (!is_dir($backupDir) && !mkdir($backupDir, 0777, true))) throw new RuntimeException('Не удалось создать папку резервных копий.');
        $backup = $backupDir . '/' . hash('sha256', $file . $current) . '.php';
        if (is_link($backup)) throw new RuntimeException('Некорректная резервная копия.');
        if (!is_file($backup)) {
            $in = fopen($file, 'rb'); $out = fopen($backup, 'xb');
            if (!$in || !$out) throw new RuntimeException('Не удалось создать резервную копию.');
            try {
                if (fwrite($out, "<?php exit; ?>\n") !== 15 || stream_copy_to_stream($in, $out) !== filesize($file) || !fflush($out) || !fsync($out)) {
                    throw new RuntimeException('Не удалось завершить резервную копию.');
                }
            } catch (Throwable $e) { fclose($in); fclose($out); unlink($backup); throw $e; }
            fclose($in); fclose($out);
        }
        $check = fopen($backup, 'rb');
        if (!$check) throw new RuntimeException('Не удалось проверить резервную копию.');
        try {
            $digest = hash_init('sha256');
            if (fread($check, 15) !== "<?php exit; ?>\n") throw new RuntimeException('Повреждена резервная копия.');
            hash_update_stream($digest, $check);
            if (!hash_equals($current, hash_final($digest))) throw new RuntimeException('Повреждена резервная копия.');
        } finally { fclose($check); }
        @chmod($temp, fileperms($file) & 0777);
        if (!rename($temp, $file)) throw new RuntimeException('Не удалось заменить MP3. Остановите воспроизведение и повторите сохранение.');
        return mfpMetadata($file);
    } finally { if (is_file($temp)) unlink($temp); }
}
