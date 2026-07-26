# Debian (not Alpine) on purpose: the app shells out to curl, and only a
# Debian/OpenSSL curl build produces the TLS/HTTP2 fingerprint Cloudflare serves
# the labyrinth link to. Alpine's musl curl gets the plain, link-less page.
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
COPY src ./src

ENV PORT=8787
EXPOSE 8787

USER node

CMD ["node", "src/index.js"]
