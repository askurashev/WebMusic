#!/bin/sh
set -eu

AUTH_FILE=/var/www/html/auth.ini
PASS_FILE=/etc/apache2/webmusic.htpasswd

if [ ! -f "$AUTH_FILE" ]; then
    echo "WebMusic authentication is not configured: auth.ini is missing." >&2
    exit 1
fi

USERNAME="$(php -r '$c=parse_ini_file("/var/www/html/auth.ini", false, INI_SCANNER_RAW); echo $c["username"] ?? "";')"
PASSWORD="$(php -r '$c=parse_ini_file("/var/www/html/auth.ini", false, INI_SCANNER_RAW); echo $c["password"] ?? "";')"

if [ -z "$USERNAME" ] || [ -z "$PASSWORD" ]; then
    echo "WebMusic authentication is not configured: username/password is empty." >&2
    exit 1
fi

if printf '%s' "$USERNAME" | grep -q ':'; then
    echo "WebMusic authentication username must not contain ':'."
    exit 1
fi

printf '%s\n' "$PASSWORD" | htpasswd -i -B -c "$PASS_FILE" "$USERNAME" >/dev/null
unset PASSWORD

chown root:www-data "$PASS_FILE"
chmod 0640 "$PASS_FILE"

exec apache2-foreground
