FROM node:20-alpine AS build

WORKDIR /app
RUN apk add --no-cache openssl

COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund --fetch-retries=5 --fetch-retry-factor=2 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000

COPY tsconfig.json tsconfig.seed.json ./
COPY src ./src
COPY contracts ./contracts
COPY config ./config
RUN npm run prisma:generate
RUN npm run build
RUN npm prune --omit=dev

FROM node:20-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache openssl

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/config ./config

EXPOSE 3000
CMD ["node", "dist/server.js"]
