FROM node:22-bookworm-slim
WORKDIR /controller
COPY controller.mjs pool.mjs ./
USER node
CMD ["node", "controller.mjs"]
