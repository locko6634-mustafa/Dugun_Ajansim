FROM nginx:stable-alpine

ARG APP_ORIGIN

RUN test -n "${APP_ORIGIN}" \
    && case "${APP_ORIGIN}" in https://*) ;; *) exit 1 ;; esac \
    && rm -rf /usr/share/nginx/html/*

COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY *.html /usr/share/nginx/html/
COPY assets /usr/share/nginx/html/assets
COPY css /usr/share/nginx/html/css
COPY js /usr/share/nginx/html/js

RUN grep -RIl '__APP_ORIGIN__' /usr/share/nginx/html \
    | xargs -r sed -i "s|__APP_ORIGIN__|${APP_ORIGIN}|g" \
    && ! grep -RIl '__APP_ORIGIN__' /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1/healthz || exit 1
