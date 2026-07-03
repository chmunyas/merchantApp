# syntax=docker/dockerfile:1

# PesaSwap Merchant App — local Docker image.
#
# Runs the Vite dev server (TanStack Start SSR + API routes). This mirrors the
# documented local workflow (`npm run dev`). The Cloudflare Workers runtime is
# only used for production builds/deploys, so a plain Node image is all that is
# needed to run the app locally.
FROM node:22-bookworm-slim

WORKDIR /app

# Install dependencies first for better layer caching.
COPY package.json package-lock.json ./
RUN npm ci

# Copy the rest of the application source.
COPY . .

# The lovable vite config defaults the dev server to port 8080.
EXPOSE 8080

# Bind to all interfaces so the server is reachable from the host machine.
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "8080"]
