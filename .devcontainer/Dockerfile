FROM mcr.microsoft.com/devcontainers/typescript-node:26-trixie

# Everything runs as root, the user the dev container runs as, so the pnpm store
# under ${HOME} matches at build and run time.

# Keep browser downloads outside the bind-mounted workspace.
ENV PLAYWRIGHT_BROWSERS_PATH=/root/ms-playwright

USER root

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        curl \
        git \
        jq \
        yq

WORKDIR /workspaces/github-vicomp

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN npm install --global \
    "$(jq -er '.devEngines.packageManager | .name + "@" + .version' package.json)" \
    && pnpm --version

# Rebuild this image after manifest or lockfile updates to refresh dependencies.
RUN pnpm install --frozen-lockfile

RUN pnpm exec playwright install-deps chromium firefox webkit
