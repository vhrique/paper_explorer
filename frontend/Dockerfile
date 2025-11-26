FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (use --legacy-peer-deps for React 19 compatibility)
RUN npm install --legacy-peer-deps

# Copy application code
COPY . .

# Expose Vite dev server port
EXPOSE 5173

# Run Vite dev server with host binding for container access
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
