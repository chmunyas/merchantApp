FROM node:20-slim

# Baileys pulls libsignal from a git-hosted (SSH) URL. Install git + ssh so npm
# can resolve it.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git openssh-client ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps — rewrite GitHub SSH URLs to HTTPS in the SAME layer so no SSH
# keys are needed for the public libsignal repo.
COPY package.json ./
RUN git config --global url."https://github.com/".insteadOf "ssh://git@github.com/" \
    && git config --global url."https://github.com/".insteadOf "git+ssh://git@github.com/" \
    && git config --global url."https://github.com/".insteadOf "git@github.com:" \
    && npm install --omit=dev

COPY index.mjs ./

ENV BRIDGE_PORT=8090
EXPOSE 8090

CMD ["node", "index.mjs"]
