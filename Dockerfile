# Official Node.js LTS image. Pin an audited digest when promoting production releases.
FROM node:24-bookworm-slim AS checked
WORKDIR /app
COPY package.json server.mjs Dockerfile .dockerignore compose.yaml ./
COPY lib/ ./lib/
COPY public/ ./public/
COPY test/ ./test/
COPY scripts/ ./scripts/
RUN npm run check

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=checked --chown=node:node /app/package.json /app/server.mjs ./
COPY --from=checked --chown=node:node /app/lib/ ./lib/
COPY --from=checked --chown=node:node /app/public/ ./public/
COPY --from=checked --chown=node:node /app/scripts/init-ai-budget.mjs ./scripts/init-ai-budget.mjs
RUN mkdir -p /app/state && chown node:node /app/state && chmod 700 /app/state
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+(process.env.BASE_PATH||'')+'/api/health',{signal:AbortSignal.timeout(2500)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
