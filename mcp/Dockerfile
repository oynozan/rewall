# Build from the repo root, not from mcp/, because the SDK is linked in by relative path
#   docker build -f mcp/Dockerfile -t rewall-mcp .
FROM node:22-alpine

RUN corepack enable

WORKDIR /rewall

# The SDK is built first, since consumers import its dist rather than its source
COPY sdk/package.json sdk/pnpm-lock.yaml ./sdk/
RUN cd sdk && pnpm install --frozen-lockfile
COPY sdk/ ./sdk/
RUN cd sdk && pnpm run build

COPY mcp/package.json mcp/pnpm-lock.yaml ./mcp/
RUN cd mcp && pnpm install --frozen-lockfile
COPY mcp/ ./mcp/

WORKDIR /rewall/mcp

# REWALL_NAME and REWALL_IDENTITY_SEED come from the host's secret store, never from the image
ENV PORT=8787
# Binding every interface inside a container is what the published port confines, not what it exposes
ENV REWALL_MCP_HOST=0.0.0.0
EXPOSE 8787

CMD ["node", "--experimental-strip-types", "src/http.ts"]
