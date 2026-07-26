# Zero runtime dependencies — everything is Node stdlib (node:http, node:http2),
# so there's no install step.
FROM node:22-alpine

WORKDIR /app

COPY package.json ./
COPY src ./src

ENV PORT=8787
EXPOSE 8787

USER node

CMD ["node", "src/index.js"]
