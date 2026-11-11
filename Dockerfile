# 치과 CRM 운영 이미지 (T10-1). 설명·명령은 docs/DEPLOY.md.
#
# 단계
#   deps    : npm ci (이미지 안에서 설치한다. 호스트의 node_modules를 복사하지 않는다 → arm64에서는 arm64용 패키지가 깔린다)
#   build   : prisma generate + next build (output: "standalone")
#   migrate : prisma migrate deploy / db seed 를 한 번 실행하는 도구 이미지 (docker build --target migrate)
#   runtime : standalone 결과물과 정적 파일(.next/static, public/)만 담은 실행 이미지 (기본 대상)
#
# 원칙
# - 특정 CPU 전용 바이너리를 직접 내려받지 않는다. 같은 파일로 amd64·arm64(EC2 t4g)를 빌드한다.
#   Prisma 7 + pg 어댑터는 네이티브 쿼리 엔진이 없다(쿼리 컴파일러는 wasm). 네이티브 파일은
#   @node-rs/argon2(플랫폼별 선택 패키지)와 migrate 단계의 schema-engine뿐이고, 둘 다 npm ci가 빌드 플랫폼에 맞게 받는다.
# - 비밀값을 이미지에 넣지 않는다. .env는 .dockerignore로 빠지고, 값은 실행할 때 env_file로 넣는다.
# - 실행은 root가 아닌 node 사용자(uid 1000)로 한다. 앱 파일은 root 소유·읽기 전용이다.
#
# BuildKit 없이(구형 빌더) 빌드해도 되도록 COPY --chmod, RUN --mount 같은 BuildKit 전용 문법은 쓰지 않는다.

FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    CHECKPOINT_DISABLE=1

# ---------------------------------------------------------------------------
FROM base AS deps
# Prisma CLI(schema-engine)가 OpenSSL 버전을 확인하고 libssl을 쓴다. slim 이미지에는 없어 설치한다.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
# postinstall(prisma generate)이 스키마와 prisma.config.ts를 읽으므로 함께 복사한다.
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma/schema.prisma ./prisma/schema.prisma
RUN npm ci --no-audit --no-fund

# ---------------------------------------------------------------------------
FROM deps AS build
COPY . .
# DATABASE_URL은 빌드에 쓰지 않는다. 모듈을 불러올 때 값이 있는지만 확인하는 코드가 있어
# 접속할 수 없는 자리표시 주소를 이 명령에만 준다(비밀값 아님, 이미지에 남지 않는다).
RUN npx prisma generate \
 && DATABASE_URL=postgresql://build:build@127.0.0.1:1/build npx next build \
 && mkdir -p public
# standalone 결과물에는 public/이 들어가지 않는다. 지금은 public/이 없어도 빈 폴더를 만들어 두고
# runtime 단계에서 항상 복사한다. 나중에 public/에 파일(파비콘 등)을 넣어도 이미지에서 빠지지 않는다.

# ---------------------------------------------------------------------------
# 마이그레이션·시드 도구. 앱 실행 이미지와 따로 둔다(앱 이미지에 Prisma CLI·개발 도구를 넣지 않기 위해).
#   docker-compose -f docker-compose.prod.yml run --rm migrate                   → prisma migrate deploy
#   docker-compose -f docker-compose.prod.yml run --rm migrate prisma db seed    → 시드
FROM deps AS migrate
ENV PATH=/app/node_modules/.bin:$PATH \
    NPM_CONFIG_UPDATE_NOTIFIER=false
COPY prisma ./prisma
COPY tsconfig.json ./
COPY src/lib ./src/lib
COPY src/server ./src/server
RUN npx prisma generate
USER node
CMD ["prisma", "migrate", "deploy"]

# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# 파일은 root 소유로 두고 node 사용자는 읽기만 한다(앱이 자기 코드를 고칠 수 없게).
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY scripts/docker/healthcheck.mjs ./healthcheck.mjs
# Next.js가 쓰기를 시도하는 캐시 폴더만 node 소유로 만든다(compose에서는 이 자리에 tmpfs를 올린다).
RUN mkdir -p .next/cache && chown node:node .next/cache

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD ["node", "healthcheck.mjs"]
CMD ["node", "server.js"]
