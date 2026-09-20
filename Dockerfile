# Hosted BAIT demo. Any container host works; Render can also use render.yaml directly.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production HOSTED=1 NANSEN_LIVE=0
# Runtime dependencies live in validation/, which owns the only lockfile.
COPY package.json ./
COPY validation/package.json validation/package-lock.json ./validation/
RUN npm ci --omit=dev --prefix validation
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
