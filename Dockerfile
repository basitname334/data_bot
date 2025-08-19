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
    wget \
    && apt-get clean

# Copy package.json and install dependencies
COPY package*.json ./
RUN npm install

# Create cache directory with appropriate permissions
RUN mkdir -p /opt/render/.cache/puppeteer && chmod -R 777 /opt/render/.cache/puppeteer

# Check available disk space before installing Chrome
RUN df -h > /disk_space_before.txt

# Install Chrome for Puppeteer with retries and debugging
RUN npm install -g npm@latest && \
    npx puppeteer browsers install chrome --retry 3 || (echo "Chrome installation failed" && exit 1)

# Debug: List contents of cache directory to verify Chrome installation
RUN ls -la /opt/render/.cache/puppeteer/chrome > /chrome_cache_contents.txt || echo "No Chrome binary found in cache"

# Verify Chrome binary exists and is executable
RUN test -f /opt/render/.cache/puppeteer/chrome/linux-127.0.6533.88/chrome-linux64/chrome && \
    chmod +x /opt/render/.cache/puppeteer/chrome/linux-127.0.6533.88/chrome-linux64/chrome || \
    echo "Chrome binary not found or not executable"

# Check disk space after installation
RUN df -h > /disk_space_after.txt

# Copy the rest of the application code
COPY . .

# Set environment variables for Puppeteer
ENV PUPPETEER_CACHE_DIR=/opt/render/.cache/puppeteer
ENV PUPPETEER_EXECUTABLE_PATH=/opt/render/.cache/puppeteer/chrome/linux-127.0.6533.88/chrome-linux64/chrome

# Expose port
EXPOSE 3000

# Start the application
CMD ["node", "index.js"]