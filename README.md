# Rubo AI Backend

Rubo AI 浏览器扩展的后端代理。一个轻量的 Express 服务,做三件事:

1. **鉴权** —— 校验扩展传来的 `X-Rubo-Token`,挡掉非法请求。
2. **注入人设** —— 根据请求里的 `mode` 选一段提示词,作为输入变量传给上游 AI 服务。
3. **流式转发** —— 把上游的 SSE 回复原样透传回扩展,边生成边吐字。


## 快速开始

```bash
npm install
cp .env.example .env   # 然后填好 .env（见下）
node main.js
```

启动后默认监听 `PORT`(`.env` 里设为 `8888`,与扩展 dev 默认对齐;代码兜底默认 `3000`)。看到这行即正常:

```
Rubo AI backend running on http://localhost:8888
```

## 环境变量

复制 `.env.example` 为 `.env` 并填写。`.env` 已被 `.gitignore` 排除,**切勿提交**。

| 变量 | 必填 | 说明 |
| --- | :---: | --- |
| `API_KEY` | ✓ | 上游 AI 服务的 API Key,以 `Bearer` 方式发送 |
| `BASE_URL` | ✓ | 上游 AI 服务的接口 base URL |
| `RUBO_TOKEN` | ✓ | 扩展鉴权口令,必须与扩展构建时的 `VITE_RUBO_TOKEN` 一致。未设置则服务直接退出 |
| `PORT` | | 监听端口,默认 `3000`(本项目约定 `8888`) |
| `ALLOWED_ORIGINS` | | 逗号分隔的 CORS 白名单;`*` 放行所有,生产建议填 `chrome-extension://<id>`。留空则拒绝所有浏览器请求 |
| `PROMPT_ROAST` | | `roast`(锐评)人设提示词 |
| `PROMPT_YINYANG` | | `yinyang`(阴阳)人设提示词 |
| `PROMPT_ACCELERATE` | | `accelerate`(加速)人设提示词 |
| `PROMPT_REPLY` | | `reply`(包子帝回复)人设提示词 |
| `PROMPT_CHAT` | | `chat`(包子帝陪聊)人设提示词 |

生成一个 `RUBO_TOKEN`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> 提示词用单引号包裹字面值(`PROMPT_ROAST='...'`),内部可含 ASCII 双引号。留空的 `mode` → 中立,不附加任何人设。

## API

### `POST /api/chat`

需鉴权(`X-Rubo-Token` 头)。请求体:

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `query` | string | 必填,用户输入。上限 5000 字 |
| `mode` | string | 人设:`roast` / `yinyang` / `accelerate` / `reply` / `chat`,其余值或留空 → 中立 |
| `conversationId` | string | 上游会话 id,多轮对话时回传以保持上下文 |
| `userId` | string | 用户标识,默认 `rubo_user` |

响应为 `text/event-stream`(SSE),逐行 `data: {...}`,客户端解析 `message` / `message_end` / `error` 事件。客户端断开连接时,服务会中止上游请求,避免空转和无谓消耗。

```bash
curl -N -X POST http://localhost:8888/api/chat \
  -H "Content-Type: application/json" \
  -H "X-Rubo-Token: <你的 RUBO_TOKEN>" \
  -d '{"query":"测试一下","mode":"roast"}'
```

### `GET /health`

健康检查,返回 `{ "ok": true }`。无需鉴权。

## 安全设计

- `helmet` 安全响应头
- 请求体 10KB 上限 + `query` 5000 字上限
- 每路由 token 鉴权
- CORS 白名单
- 上游请求 60s 超时,客户端断连即中止
- 收到 `SIGINT` / `SIGTERM` 时优雅关闭

## 技术栈

Node.js · Express 5 · axios · helmet · cors · dotenv。
