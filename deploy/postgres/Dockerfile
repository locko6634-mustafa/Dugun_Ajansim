FROM postgres:17.10-alpine3.23@sha256:8189a1f6e40904781fc9e2612687877791d21679866db58b1de996b31fc312e4 AS patched

RUN apk upgrade --no-cache \
    && apk add --no-cache "su-exec=0.3-r0" \
    && rm -f /usr/local/bin/gosu \
    && ln -s /sbin/su-exec /usr/local/bin/gosu \
    && gosu nobody true

# Alt katmandaki kullanılamaz eski gosu baytlarını nihai imaja taşımadan yalnız görünür
# dosya sistemini kopyala. Böylece CVE tarayıcıları silinmiş katman içeriğini çalıştırılabilir
# sanmaz ve konteynerde gerçekten yalnız küçük C tabanlı su-exec kalır.
FROM scratch

COPY --from=patched / /

ENV PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    LANG=en_US.utf8 \
    PG_MAJOR=17 \
    PG_VERSION=17.10 \
    PGDATA=/var/lib/postgresql/data

VOLUME /var/lib/postgresql/data
EXPOSE 5432
STOPSIGNAL SIGINT
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["postgres"]
