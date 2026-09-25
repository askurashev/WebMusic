FROM php:8.4-apache

RUN apt-get update \
    && apt-get install -y --no-install-recommends zip apache2-utils \
    && rm -rf /var/lib/apt/lists/*

RUN printf '%s\n' 'DirectoryIndex music.htm' > /etc/apache2/conf-available/webmusic.conf \
    && a2enconf webmusic \
    && a2enmod auth_basic authn_file authz_user

COPY . /var/www/html/\nCOPY docker/webmusic-auth.conf /etc/apache2/conf-available/webmusic-auth.conf\nCOPY docker/webmusic-entrypoint.sh /usr/local/bin/webmusic-entrypoint.sh

RUN chown -R www-data:www-data /var/www/html \
    && mkdir -p /var/www/html/music.pls /var/www/html/chart-data /var/www/html/chart-exports \
    && chown -R www-data:www-data /var/www/html/music.pls /var/www/html/chart-data /var/www/html/chart-exports

RUN a2enconf webmusic-auth\n\nENV APACHE_DOCUMENT_ROOT=/var/www/html\n\nENTRYPOINT ["sh", "/usr/local/bin/webmusic-entrypoint.sh"]

EXPOSE 80
