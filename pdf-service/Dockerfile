FROM node:24.21.0-bookworm-slim
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-liberation \
    fonts-noto-cjk \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc1 \
    libglib2.0-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxkbcommon0 \
    libxrandr2 \
    libxrender1 \
    libxshmfence1 \
    libxss1 \
    libxtst6 \
    lsb-release \
    xdg-utils \
  && rm -rf /var/lib/apt/lists/* /var/cache/apt/*

ENV PUPPETEER_CHROME_SKIP_DOWNLOAD=true
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
RUN node --input-type=module -e "import puppeteer from 'puppeteer'; const browser = await puppeteer.launch({ headless: 'shell', args: ['--no-sandbox', '--disable-setuid-sandbox'] }); await browser.close();" \
  && PUPPETEER_BIN=$(find /root/.cache/puppeteer -name chrome-headless-shell -type f -perm -u+x | head -n 1) \
  && ln -s "$PUPPETEER_BIN" /usr/local/bin/chrome-headless-shell
ENV PUPPETEER_EXECUTABLE_PATH=/usr/local/bin/chrome-headless-shell
COPY src ./src
RUN node src/verify-delivery-trends-package.mjs
ENV NODE_ENV=production
CMD ["node", "src/server.js"]
