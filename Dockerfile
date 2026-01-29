# Stage 1: Build webapp
FROM oven/bun:1 AS builder

WORKDIR /app

# Copy package files and root tsconfig (needed for shared package build)
COPY package.json bun.lock* tsconfig.json ./
COPY packages/webapp/package.json ./packages/webapp/
COPY packages/backend/package.json ./packages/backend/
COPY packages/shared/package.json ./packages/shared/
COPY packages/cloudflare-worker/package.json ./packages/cloudflare-worker/

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source code
COPY packages/webapp ./packages/webapp
COPY packages/backend ./packages/backend
COPY packages/shared ./packages/shared
COPY packages/cloudflare-worker ./packages/cloudflare-worker

# Build webapp
RUN bun run webapp:build

# Copy webapp build to backend public folder
RUN rm -rf packages/backend/public && cp -r packages/webapp/build packages/backend/public

# Stage 2: Production image
FROM oven/bun:1-slim AS production

WORKDIR /app

# Copy package files (all workspace package.json files needed for lockfile resolution)
COPY package.json bun.lock* tsconfig.json ./
COPY packages/webapp/package.json ./packages/webapp/
COPY packages/backend/package.json ./packages/backend/
COPY packages/shared/package.json ./packages/shared/
COPY packages/cloudflare-worker/package.json ./packages/cloudflare-worker/

# Install production dependencies only
RUN bun install --frozen-lockfile --production

# Copy backend source and built static files
COPY packages/backend ./packages/backend
COPY packages/shared ./packages/shared
COPY --from=builder /app/packages/backend/public ./packages/backend/public

# Set environment defaults
ENV NODE_ENV=production
ENV PORT=8000
ENV OPENAI_MODEL=gpt-5.2

# Runtime environment variables (must be provided at deployment):
# - OPENAI_API_KEY: Required for AI extraction
# - SUPABASE_DATABASE_URL: Required to enable caching and result sharing

# Expose port
EXPOSE 8000

# Start the server using shell form for PORT env var expansion
CMD bun run start
