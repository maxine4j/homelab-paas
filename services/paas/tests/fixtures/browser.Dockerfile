ARG PLAYWRIGHT_VERSION
FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble
RUN apt-get update \
    && apt-get install -y --no-install-recommends libnss3-tools \
    && rm -rf /var/lib/apt/lists/*
