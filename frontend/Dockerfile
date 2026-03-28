FROM node:20-slim AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Pass backend URLs at build time
ARG VITE_CO_HOST_WS_URL
ARG VITE_SOUND_BOARD_URL
ARG VITE_HYPE_PRODUCER_URL

RUN npm run build

# Serve with lightweight node server
FROM node:20-slim

WORKDIR /app
RUN npm install -g serve

COPY --from=build /app/dist ./dist

ENV PORT=8080
EXPOSE 8080

CMD ["serve", "-s", "dist", "-l", "8080"]
