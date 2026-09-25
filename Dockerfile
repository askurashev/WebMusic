FROM php:8.4-apache

RUN apt-get update \
    && apt-get install -y --no-install-recommends zip \
    && rm -rf /var/lib/apt/lists/*

RUN printf '%s\n' 'DirectoryIndex music.htm' > /etc/apache2/conf-available/webmusic.conf \
    && a2enconf webmusic

COPY . /var/www/html/

RUN chown -R www-data:www-data /var/www/html \
    && mkdir -p /var/www/html/music.pls /var/www/html/chart-data /var/www/html/chart-exports \
    && chown -R www-data:www-data /var/www/html/music.pls /var/www/html/chart-data /var/www/html/chart-exports

ENV APACHE_DOCUMENT_ROOT=/var/www/html

EXPOSE 80
