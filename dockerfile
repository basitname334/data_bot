FROM node:18
WORKDIR /usr/src/app
COPY package*.json ./
RUN apt-get update && apt-get install -y \
    fonts-liberation \
    libappindicator3-1 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcairo2 \
    libcups2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    && apt-get clean
RUN npm install
RUN npx puppeteer browsers install chrome
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]