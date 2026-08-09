FROM nginx:stable-alpine@sha256:97d490c12ba55b4946b01546d1c3ed324e8d41ab1c9fcb2a616aa470620e5b46

ARG APP_ORIGIN
ARG BUILD_REVISION=unknown

LABEL org.opencontainers.image.revision="${BUILD_REVISION}"

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
    && ! grep -RIl '__APP_ORIGIN__' /usr/share/nginx/html \
    && chown -R nginx:nginx \
      /etc/nginx/conf.d \
      /usr/share/nginx/html \
      /var/cache/nginx \
      /run \
      /var/run

USER nginx
EXPOSE 8080
STOPSIGNAL SIGQUIT

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8080/healthz || exit 1
