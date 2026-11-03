# ============================================================
# Stage 1: Build the React frontend
# ============================================================
FROM node:20-alpine AS frontend
WORKDIR /app/client
COPY client/package.json client/package-lock.json* ./
RUN npm install
COPY client/ .
RUN npm run build

# ============================================================
# Stage 2: Run the Express backend serving the React app
# ============================================================
FROM node:20-alpine AS runner
WORKDIR /app

# Install backend dependencies
COPY server/package.json server/package-lock.json* ./
RUN npm install

# Copy built frontend from frontend stage
COPY --from=frontend /app/client/dist ./client/dist

# Copy backend source
COPY server/index.js ./index.js

# Data directory for encrypted local config (mounted as volume)
RUN mkdir -p /app/data /app/data/logs

ENV PORT=3000
ENV SEERR_URL=http://10.0.0.134:5055
ENV NODE_ENV=production

EXPOSE 3000

# Health check for Docker
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "const http=require('http');http.get('http://localhost:3000/health',(r)=>{process.exit(r.statusCode===200?0:1);}).on('error',()=>process.exit(1));"

CMD ["node", "index.js"]
