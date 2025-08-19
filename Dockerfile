```
# Use Node.js 24 as the base image
FROM node:24

# Install Chromium and Puppeteer dependencies
RUN apt-get update && apt-get install -y \
  chromium \
  fonts-liberation \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libcairo2 \
  libcups2 \
  libgbm1 \
  libgtk-3-0 \
  libpango-1.0-0 \
  libxcomposite1 \
  libxdamage1 \
  libxrandr2 \
  --no-install-recommends && \
  rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json (if exists)
COPY package*.json ./

# Install Node.js dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Set environment variable for Puppeteer to use installed Chromium
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Expose the port (optional, for documentation; Render assigns PORT dynamically)
EXPOSE 10000

# Start the application
CMD ["npm", "run", "start:render"]
```
