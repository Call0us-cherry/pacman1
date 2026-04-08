# Stage 1: Build the application
FROM node:18-alpine AS builder

# Install git (required for some dependencies)
RUN apk add --no-cache git

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the source code
COPY . .

# Apply the required "hack" to aframe-extras
RUN sed -i '5,6s/schema: {/schema: {\n        lookAtTarget: {default: true},/' node_modules/aframe-extras/src/pathfinding/nav-agent.js && \
    sed -i '83s/if (data.lookAtTarget)/if (data.lookAtTarget)/' node_modules/aframe-extras/src/pathfinding/nav-agent.js

# Build the production bundle (outputs to dist/ or similar)
RUN npm run build

# Stage 2: Serve the application
FROM node:18-alpine

# Install a lightweight static server
RUN npm install -g serve

WORKDIR /app

# Copy the built assets (dist folder) and the root HTML/CSS files
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/index.html ./
COPY --from=builder /app/index.css ./
COPY --from=builder /app/assets ./assets
COPY --from=builder /app/package.json ./
COPY --from=builder /app/webpack.config.js ./
COPY --from=builder /app/src ./src

# Use the PORT environment variable provided by Cloud Run (default 8080)
ENV PORT=8080

# Expose the port
EXPOSE ${PORT}

# Serve the current directory (which contains index.html)
CMD serve -s . -l ${PORT}
