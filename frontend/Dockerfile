FROM node:20-alpine AS base

WORKDIR /app

COPY package*.json .
RUN npm ci

# ── Development ────────────────────────────────────────────────────────────────
FROM base AS dev
COPY . .
EXPOSE 8080
CMD ["npm", "run", "dev", "--", "--host"]

# ── Build stage ────────────────────────────────────────────────────────────────
FROM base AS build
COPY . .

ARG VITE_API_BASE_URL=/api/v1
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

RUN npm run build

# ── Production (nginx) ───────────────────────────────────────────────────────
FROM nginx:alpine AS prod

RUN apk add --no-cache curl && \
    rm -f /etc/nginx/conf.d/default.conf

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

RUN chown -R 1000:1000 /var/cache/nginx /usr/share/nginx/html /etc/nginx/conf.d && \
    touch /var/run/nginx.pid && \
    chown 1000:1000 /var/run/nginx.pid

USER 1000:1000

EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
