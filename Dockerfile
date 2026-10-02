FROM node:20-alpine
WORKDIR /app

# 零第三方依赖，无需 npm install
COPY package.json ./
COPY server.js ./
COPY src/ ./src/
COPY data/ ./data/
COPY public/ ./public/
COPY scripts/ ./scripts/

ENV PORT=3000
EXPOSE 3000

# 大模型密钥通过运行时环境变量注入，不打包进镜像
# docker run -e LLM_API_KEY=sk-xxx -e LLM_BASE_URL=... -e LLM_MODEL=... -p 3000:3000 yongong-guanjia
CMD ["node", "server.js"]
