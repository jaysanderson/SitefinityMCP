# Zero-dependency MCP server: no install step, just copy source and run.
FROM node:22-alpine

WORKDIR /app

# Source only — there are no npm dependencies to install.
COPY package.json ./
COPY src ./src

ENV NODE_ENV=production \
    MCP_TRANSPORT=http \
    HOST=0.0.0.0 \
    PORT=8080 \
    SITEFINITY_BASE_URL=https://sta.eftm2.cloud.sitefinity.com

EXPOSE 8080

# Basic container healthcheck against the liveness endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
