<?php
require_once __DIR__ . '/auth.php';
requireWebMusicAuth();

// Let PHP's development server handle existing files only after authentication.
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
$file = __DIR__ . DIRECTORY_SEPARATOR . ltrim(str_replace('/', DIRECTORY_SEPARATOR, (string)$path), DIRECTORY_SEPARATOR);
if ($path !== '/' && is_file($file)) return false;

http_response_code(404);
header('Content-Type: text/plain; charset=utf-8');
echo "Not found.\n";
