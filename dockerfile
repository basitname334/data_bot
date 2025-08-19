# Use Node.js 18 as the base image
FROM node:18

# Set working directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install system dependencies for Puppeteer
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

# Install Node.js dependencies
RUN npm install

# Install Chrome for Puppeteer
RUN npx puppeteer browsers install chrome@139.0.7258.68

# Copy the rest of the application code
COPY . .

# Ensure cache directory permissions
RUN mkdir -p /opt/render/.cache/puppeteer && chmod -R 755 /opt/render/.cache/puppeteer

# Expose the port
EXPOSE 3000

# Start the application
CMD ["node", "server.js"]