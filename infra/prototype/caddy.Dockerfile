# Route 53 DNS 인증 모듈을 넣은 Caddy (공식 이미지에는 없음)
FROM caddy:2.10-builder AS build
RUN xcaddy build --with github.com/caddy-dns/route53@v1.6.2

FROM caddy:2.10
COPY --from=build /usr/bin/caddy /usr/bin/caddy
COPY Caddyfile /etc/caddy/Caddyfile
