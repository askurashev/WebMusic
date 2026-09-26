<?php
declare(strict_types=1);

/** Enforce HTTP Basic authentication for protected media and downloads. */
function requireWebMusicAuth(): void
{
	$config = [];
	$configFile = is_file('/etc/webmusic/auth.ini') ? '/etc/webmusic/auth.ini' : __DIR__ . '/auth.ini';
	if (is_file($configFile)) {
		$parsed = parse_ini_file($configFile, false, INI_SCANNER_RAW);
		if (is_array($parsed)) $config = $parsed;
	}
	$username = getenv('WEBMUSIC_USERNAME');
	$password = getenv('WEBMUSIC_PASSWORD');
	$username = $username !== false ? $username : ($config['username'] ?? '');
	$password = $password !== false ? $password : ($config['password'] ?? '');
	if ($username === '' || $password === '') {
		http_response_code(503);
		header('Content-Type: text/plain; charset=utf-8');
		exit("WebMusic authentication is not configured. Set WEBMUSIC_USERNAME and WEBMUSIC_PASSWORD or create auth.ini.\n");
	}

	$providedUser = $_SERVER['PHP_AUTH_USER'] ?? '';
	$providedPassword = $_SERVER['PHP_AUTH_PW'] ?? '';
	if (!hash_equals((string)$username, (string)$providedUser) || !hash_equals((string)$password, (string)$providedPassword)) {
		header('WWW-Authenticate: Basic realm=\"WebMusic\", charset=\"UTF-8\"');
		header('Cache-Control: no-store');
		http_response_code(401);
		header('Content-Type: text/plain; charset=utf-8');
		exit("Authentication required.\n");
	}
}
