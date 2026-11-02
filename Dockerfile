# ChatMT — container image.
#
# The interface is an ES-module page that reads the API, so an application server is required:
# nginx serving the files alone would show a page whose every request fails. This image
# therefore runs the Node backend, which answers /api and serves /frontend on the same origin.
#
# Build:  docker build -t chatmt .
# Run:    docker run --rm -p 8080:3080 chatmt
# Open:   http://localhost:8080/          (redirects to /frontend/)

FROM node:22-alpine

LABEL org.opencontainers.image.title="ChatMT" \
      org.opencontainers.image.description="Reflective and regenerative AI prototype — colour preference engine, profile and background assistant" \
      org.opencontainers.image.source="https://github.com/ChatMT-23/ChatMT"

WORKDIR /app

# Only the declared dependency is installed, from the lockfile, with no dev dependencies.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

# The server listens on all interfaces inside the container. The memory is written to /data,
# which is a volume so that it survives the container.
ENV CHATMT_HOST=0.0.0.0 \
    PORT=3080 \
    CHATMT_DATA_DIR=/data

RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 3080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:3080/api/health || exit 1

CMD ["node", "backend/server.js"]
