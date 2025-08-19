FROM node:18

# Set working directory
WORKDIR /app

# Install system dependencies for Puppeteer/Chromium
RUN apt-get update && apt-get install -y \
    ca-certificates \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libgbm1 \
    libnspr4 \
    libnss3 \
    libpangocairo-1.0-0 \
    libpango-1.0-0 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libxss1 \
    libxtst6 \
    lsb-release \
    xdg-utils \
    && apt-get clean

# Copy package.json and install dependencies
COPY package*.json ./
RUN npm install

# Install Chrome for Puppeteer explicitly
RUN npx puppeteer browsers install chrome

# Copy the rest of the application code
COPY . .

# Set environment variable for Puppeteer cache (optional, Render uses /opt/render/.cache/puppeteer by default)
ENV PUPPETEER_CACHE_DIR=/opt/render/.cache/puppeteer

# Expose port
EXPOSE 3000

# Start the application
CMD ["node", "index.js"]