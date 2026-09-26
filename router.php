<?php
require_once __DIR__ . '/auth.php';
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
$query = [];
parse_str((string)parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_QUERY), $query);
// Gate audio streams, legacy downloads, and direct audio URLs in the library.
if (($path === '/charts.php' && ($query['action'] ?? '') === 'audio') ||
	($path === '/music.php' && (isset($query['dl']) || isset($query['dlpl']))) ||
	preg_match('~^/library/.*\.(?:mp3|flac|fla|ogg|opus|m4a|mp4|aac|wav|webm)$~i', (string)$path)) {
	requireWebMusicAuth();
}

// Let PHP's development server handle existing files; everything else returns 404.
$file = __DIR__ . DIRECTORY_SEPARATOR . ltrim(str_replace('/', DIRECTORY_SEPARATOR, (string)$path), DIRECTORY_SEPARATOR);
if ($path !== '/' && is_file($file)) return false;

http_response_code(404);
header('Content-Type: text/plain; charset=utf-8');
echo "Not found.\n";
