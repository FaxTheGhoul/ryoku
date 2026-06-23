FROM node:20-slim

# Instalar dependencias del sistema para Playwright/Chromium
RUN apt-get update && apt-get install -y \
    chromium \
    libnss3 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# Decirle a Playwright que use el Chromium del sistema
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Copiar dependencias del servidor
COPY server/package*.json ./server/
RUN cd server && npm install --omit=dev

# Copiar extractores compartidos
COPY extractors/ ./extractors/

# Copiar el servidor
COPY server/ ./server/

WORKDIR /app/server

EXPOSE 3001

CMD ["node", "index.js"]
