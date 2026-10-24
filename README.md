# dsh-telegram — Telegram 用户号（MTProto）插件

用**你自己的 Telegram 账号**（userbot / MTProto，不是 Bot API）给 [DeepSeek Harness](https://github.com/deepseek-ai/dsh) 提供频道与消息能力。
Bot API 看不到你账号里的频道；这个插件直接以你的会话登录，能看到的和你手机/桌面端完全一致。

同一个插件里还带一个**机器人身份**：在专用群里以「DSH」的名字和头像说话，并把群里的话桥接进 DSH 会话。

## 能力

- **13 个工具**：会话列表、消息（分页 / 单条 / 频道内全文搜索 / 媒体过滤）、全账号服务端搜索、
  内联按钮读写与点击、评论区、链接与网页正文、白名单发送、加入退出、转发、收件箱、DSH 私聊。
- **设置页**（DSH 设置 → Telegram）：登录、代理、白名单、DSH 群与机器人、桥接开关；宽度 < 640px 自动单列，
  控件 42px、输入框 16px（不触发 iOS 缩放）、支持 `env(safe-area-inset-bottom)`，手机上直接可用。
- **授权类操作只由人来做**：`tg_login` 只有 `status`，`tg_whitelist` 只有 `list`。登录、退出、改代理、增删白名单
  都不是工具，模型无法给自己扩权。
- **出口归一化**：工具返回值统一走 `toLossless`（BigInt、`undefined`、TL 记录都不会让调用炸掉），再渲染成紧凑文本。
- **省 token 的结果渲染**：一条消息一行、标题只出现一次、按条数分配正文预算，见下文「结果形状」与「省 token」。

## 安装

仓库：<https://github.com/EndPB/dsh-telegram>

### 在 DSH Desktop 里（推荐）

1. DSH 设置 → **插件** → **添加插件**，粘贴 `https://github.com/EndPB/dsh-telegram`，点安装。
2. 第一次会以 `build-blocked` 结束（原因见下节），点 **「允许这些脚本并重试」** 即可，不用敲命令。
3. 重启 DSH 一次：新安装且带 `dsh.client` 的包只在启动时登记客户端模块，设置页才会出现。

### 用 pnpm（DSH 的 profile 目录）

1. 在 DSH 桌面版的 profile 目录（默认 `%USERPROFILE%\.dsh\profiles\desktop`）：

   ```powershell
   cd $env:USERPROFILE\.dsh\profiles\desktop
   pnpm add "@local/dsh-telegram@github:EndPB/dsh-telegram"
   ```

2. 在同一个 profile 的 `package.json` 里，把 `@local/dsh-telegram` 加进 `dsh.profile.bundles` 数组。
3. 重启 DSH 一次。

升级：重复安装步骤拉默认分支；要钉版本就写 `…@github:EndPB/dsh-telegram#<tag 或 commit>`。
仓库里已经提交了 `lib/` 与 `client.js`（没有 `prepare` 构建步），所以 `pnpm` 直接从 git 装出来的包即可运行。
### 安卓 DSHA（手机 / 平板）

DSHA 用 GitHub 的 codeload 压缩包取插件，然后在设备上跑 `pnpm install`。安卓的 node-gyp 没有 `make`，
`telegram` 依赖树里 `websocket` 的两个可选原生包（`bufferutil`、`utf-8-validate`）会编译失败，
DSHA 把非 0 退出码报成 `PNPM_FAILED`。所以本仓库**刻意提交了 `node_modules/`**：`telegram@2.26.22` 的完整
运行期依赖树（hoisted、无软链、已去掉那两个可选原生包）。插件管理器发现依赖已经完整，就直接跳过 pnpm，
不联网、不编译。

1. DSHA → **插件** → **从链接安装**，填 `EndPB/dsh-telegram` → 解析安装。
2. 装完重启 DSHA，设置页里才会出现插件的配置入口。

压缩包约 2 MB（解压 6 MB）。桌面端走 pnpm 安装时这份 `node_modules` 会被忽略，不影响正常流程。
`websocket` 硬依赖 `bufferutil` / `utf-8-validate`（原生 addon，靠 node-gyp 编译），所以仓库里这两个包换成了
**纯 JS 实现**（`mask`/`unmask` 的 XOR 与 UTF-8 校验），没有编译产物，安卓上也能直接 import。

### 安装时 `build-blocked` / `pnpm` 失败怎么办

pnpm 11 默认拦下依赖的安装脚本，而本插件依赖的 GramJS（`telegram`）树里有三个包带 `install` / `postinstall`：
`bufferutil`、`utf-8-validate`（`websocket` 的可选原生加速，有预编译二进制）和 `es5-ext`（只打一行自检）。
DSH 在 profile 里启用了 `strictDepBuilds`，所以第一次安装会以 `build-blocked` 结束，并在结果里给出 `pendingBuilds`。
包其实已经抓取成功，只是脚本没有权限运行。

任选一种放行后重试：

- DSH 插件页：安装失败时点 **「允许这些脚本并重试」**；
- 工具调用：`plugin_manager action=install_bundle` 带上
  `approvedBuilds: ["bufferutil", "es5-ext", "utf-8-validate"]`（需要使用者先同意，授权按包名保存在该 profile）；
- 手工：在 profile 的 `pnpm-workspace.yaml` 里加上

  ```yaml
  allowBuilds:
    bufferutil: true
    es5-ext: true
    utf-8-validate: true
  ```

这三条脚本只决定 WebSocket 用不用原生加速，不跑也能正常收发消息。

## 第一次使用

1. 到 <https://my.telegram.org/apps> 创建应用，拿到 `api_id` / `api_hash`（验证码发到你**已登录**的 Telegram 客户端，不发短信）。
2. DSH 设置 → **Telegram**：填 api_id / api_hash / 手机号（国际格式 `+86…`）→「发送验证码」→ 填验证码 →（需要时）两步验证密码。
3. 登录后把允许发消息的会话加进白名单：`@频道`、t.me 链接、数字 id 或精确标题，逐个可移除。

登录成功得到 StringSession（MTProto auth key），保存在运行态 `settings.json`（0600），重启后自动重连。
运行态文件：`%DSH_HOME%\dsh-telegram\settings.json`（`%DSH_HOME%` 默认 `%USERPROFILE%\.dsh`）。

## 设置页

DSH 设置 → **Telegram**（与「语音」并列）。页面分六块：

| 区块 | 内容 |
| --- | --- |
| 账号 | 是否已登录、姓名/@username/id、网络路径、未读收件箱条数、settings.json 路径、刷新 |
| 登录 | 首次：api_id / api_hash / 手机号 → 发送验证码 → 验证码 →（需要时）两步验证密码；已登录：退出 |
| 代理 | 自动（跟随系统代理）/ 直连 / 自定义 `host:port`（SOCKS5），应用后立即重连 |
| 白名单 | 列出已允许的会话，逐个「移除」；输入 `@频道`、t.me 链接、数字 id 或精确标题后「添加」 |
| DSH 私聊 | 群是否存在、peer id；创建/重新检查；机器人状态（名字、@username、id）、创建/重新检查 |
| 桥接 | 总开关；目标会话下拉（默认「最近活跃的会话」，可绑定到具体会话） |

页面用宿主的主题 token（`--dsw-alias-*`）着色，不依赖任何 Client 包，也不写 `document.body`。
改动立即写进 `settings.json`，Host 侧按 mtime 热重载，不需要重启。

## 工具一览

| 工具 | 用途 |
| --- | --- |
| `tg_login` | 只读：`status`（登录状态、代理、身份、白名单、DSH 群、未读数） |
| `tg_dialogs` | 列出会话：频道、群、私聊；按类型、标题、@username、peer id 过滤 |
| `tg_messages` | 读消息：分页（before/after）、单条（id）、频道内全文搜索（search）、媒体过滤（filter） |
| `tg_search` | 高级搜索：`global` 全账号服务端搜索（日期区间、媒体类型、只看频道）、`chat` 频道内搜索、`channels` 找公开频道 |
| `tg_buttons` | 读/按消息上的按钮：`list` 列出内联键盘与回复键盘（带 1-based 序号），`press` 按序号或文字点击（`GetBotCallbackAnswer`，`DATA_INVALID` 时退化为发送按钮文字），返回机器人回调应答、被编辑的消息和/或新消息 |
| `tg_comments` | 打开频道帖子的评论区（GetDiscussionMessage + GetReplies），白名单内可 `reply` 回复 |
| `tg_links` | 抓取消息里的链接；把 `t.me` 深链解析成具体消息；`fetch=true` 抓网页正文 |
| `tg_send` | 在白名单频道发消息（白名单外一律拒绝） |
| `tg_join` | 加入/退出频道、群（@username、t.me、`t.me/+邀请码`、标题片段） |
| `tg_whitelist` | 只读：`list`；增删只能由人在设置页操作 |
| `tg_forward` | 转发频道消息到指定会话，默认转发到 DSH 专用私聊 |
| `tg_dsh` | DSH 私聊：`ensure` 创建并把机器人拉进去 / `send` 以机器人身份发言 / `read` 读取（带 fromDsh 标记） |
| `tg_inbox` | 收件箱：DSH 私聊里的留言、白名单频道的回复、评论区新评论（MTProto updates 实时收集） |

### 结果形状

工具结果不是 JSON，而是给人读的紧凑文本：

- 一条消息一行：`#id 时间 发送者[标记] 正文`，会话标题只出现一次；`…+N` 表示省略了 N 个字。
- 标记：`[dsh]` 机器人发出、`[media]`、`[pin]`、`[edit]`、`[fwd:x]`、`[r:id]` 回复、`[th:id]` 讨论串、`[c:N]` 评论数。
- 需要全文时调 `tg_messages id=…`（单条返回完整正文，最多 4000 字）；分页页眉会直接给出下一页的 `before`。

## 网络与代理

- 直连不通时，插件**自动复用系统代理**：读 Windows `HKCU\…\Internet Settings` 的 `ProxyServer`，
  先做一次真实 SOCKS5 握手探测，通了才用；没代理或探测失败就退回直连。
- 设置页「代理」可在 自动 / 直连 / 自定义 之间切换，切换后立即断开重连。
- Bot API（`api.telegram.org`）先直连，失败再用同一个代理做 CONNECT 重试；成功的那条路径会被记住，
  不会每条消息都等一次超时。
- 也认环境变量 `TG_PROXY` / `ALL_PROXY` / `HTTPS_PROXY`。

## 白名单与安全

- 只有白名单里的会话能通过 `tg_send` / `tg_comments.reply` 发消息；白名单为空时**所有发送都被拒绝**。
- 白名单里的会话会自动加入 `watch`，收到的新消息进 `tg_inbox`。
- 白名单、登录、代理都是**人独有的权力**：工具层没有对应动作，模型无法给自己加频道或改网络。
- `settings.json` 里有 auth key 和机器人 token（等同密码），文件权限 0600，不要外传；退出登录会清掉会话。
- 模型侧还有一条硬规矩写进系统提示：不转发用户没让它发的内容，不在会话之间搬运内容，不吐 api_hash / session / bot token。

## DSH 私聊、机器人与桥接

- **群**：一个只有你 + 机器人的私有 megagroup（设置页「DSH 私聊」可创建/重新检查，peer id 存在 `settings.json`）。
- **机器人**：你自己的账号通过 @BotFather 创建（`/newbot` → `/setname` → `/setuserpic`），token 只存在本机；
  `scripts/setup-bot.mjs`、`scripts/attach-bot.mjs`、`scripts/bot-setname.mjs`、`scripts/bot-setpic.mjs` 是等价的命令行做法。
- **DSH 说话**：`tg_dsh action=send` → Bot API `sendMessage`，群里显示机器人的名字和头像；
  机器人发送失败时退回你的账号发送，并在返回值里注明 `via: "account"`。
- **回声不脏收件箱**：发送返回的 `message_id` 直接写进 `outbox`，`readDsh` 也会按 sender id 标记 `fromDsh`。
- **桥接**：你在群里发消息 → 插件 1.5s 去抖后把它作为一条提示 `sessionController.prompt(...)` 送进目标会话
  （设置页可绑定，默认最近活跃会话）→ 模型看到提示后用 `tg_dsh action=send` 回复。
  每次桥接的结果（时间、成功/失败、会话 id、条数）记在 `settings.bridge.last`，设置页可据此排查。
- 桥接可随时在设置页关掉；关掉后消息只进收件箱，等模型主动调用 `tg_inbox`。

## 搜索群（发关键词的机器人）

很多「资源搜索」群不是靠 Telegram 搜索：你把关键词当普通消息发出去，机器人**删掉你的消息**，
再回一条带内联按钮的结果（`关键词：…`、`🔍共 N 条结果，当前第 X 页，共 Y 页`、`群组/频道/视频/更多筛选`、`➡️下一页`）。

1. `tg_send` 把关键词发进群（需要白名单，否则拒绝）。
2. 等 1–3 秒，`tg_messages` 看最新一条机器人结果，或直接 `tg_buttons action=list chat=…`（省略 msgId = 取最近一条带按钮的消息）。
3. `tg_buttons action=press` 点 `➡️下一页` / `视频` / `群组` / `频道` / `更多筛选`：
   机器人**原地编辑同一条消息**，所以 `updated` 里就是新一页的内容，`msgId` 不变。
4. 别人可能同时在搜：他们的结果会成为**新消息**，不影响你这条；所以一定要带 `msgId`（或按 label）操作。

键盘是**动态的**（点「视频」后第 4 个按钮会从「更多筛选」变成「收起筛选」），
按序号容易点错，优先用 `label`；返回值里的 `pressed.text` 才是真正点到的按钮。

## 省 token

这个插件每次对话要付两笔账：**常驻开销**（13 个工具的定义 + 系统提示段落，每次请求都发）和
**单次调用开销**（工具结果的文本）。两笔都压过：

1. **紧凑结果渲染**（`lib/render.js`，工具返回值本身不变）：一条消息一行，会话标题只出现一次；
   不再为每条消息重复 `chatId`/`chat`、派生字段（links / hashtags / mentions）和 `views`/`forwards`。
2. **按长度分配正文预算**：3 条消息时每条最多 600 字（短页直接给全文，不用再查一次），
   20 条 300 字，50 条 120 字；截断处标 `…+N`，看全文用 `tg_messages id=…`。
3. **工具定义瘦身**：说明改成一句话，参数里重复的说明删掉，`CHAT_DESCRIPTION` 缩短；
   系统提示只留状态与约定（工具用途不再复述）。
4. **默认页大小下调**：会话 30、消息 20、搜索 20、搜频道 15、评论 30、收件箱 30、DSH 私聊 20。

实测（估算 token：1 个中文字/emoji ≈ 1，3.5 个 ASCII ≈ 1）：

| 指标 | 0.2 | 0.3 |
| --- | --- | --- |
| 13 个工具定义 | 3759 tok | **2908 tok** |
| 系统提示段落 | 599 tok | **357 tok** |
| **每次请求常驻** | **4341 tok** | **3254 tok**（-25%） |
| 一次会话列表（3 条） | 406 tok | **196 tok**（-52%） |
| 一次消息列表（3 条） | 563 tok | **353 tok**（-37%） |

复现：`node scripts/measure-tokens.mjs .`（在装有依赖的目录里跑；样本在 `scripts/fixtures/`，
结构与真实返回一致，id 与文本已脱敏）。

## 架构

```
index.js            apply()：13 个工具、system prompt 段、设置页 RPC、Telegram→DSH 桥接、生命周期
client.js           设置页（settings.section `telegram`，React + 主题 token + 响应式 CSS）
lib/session.js      TelegramSession：登录、客户端复用、peer 解析、收发、评论、inbox、机器人、群
lib/botapi.js       Bot API：直连 + HTTP 代理 CONNECT + 长消息切分
lib/store.js        settings.json 持久化（原子写、0600、按 mtime 热重载）
lib/format.js       TL 对象 → 模型友好的紧凑记录（链接、hashtag、媒体类型、回复关系）
lib/proxy.js        系统代理探测（SOCKS5 握手）+ 手动代理
lib/tools.js        工具定义（JSON Schema + 执行，出口统一 toLossless 归一化 BigInt/undefined）
lib/render.js       工具结果的紧凑文本渲染（token 预算、…+N、回查提示）
scripts/            一次性运维脚本（建机器人、改名、换头像、拉群）+ token 度量
```

设置页与 Host 之间走 `connection.rpc` 的 `/dsh-telegram` 通道：状态、登录、代理、白名单、机器人、会话列表、桥接设置。
通道只有在同时注入 `connection` 与 `webServer` 的上下文里注册，才会挂到 webServer 上。

对话列表缓存 60s；inbox 是内存 + settings 的环形缓冲（400 条），写入防抖 1.2s；桥接对多条消息做 1.5s 合并。

## 已知限制

- 只处理文本与媒体标记，不下载文件/图片字节。
- 客户端（设置页）的首次加载需要 DSH 重启一次：客户端模块表在启动时扫描，之前没有 `dsh.client` 的包会被缓存为
  「不是客户端包」。之后改 Host 代码用插件开关热重载即可；改设置页代码需要重启 DSH（或 `pnpm run dev:web` 时靠 HMR）。
- 桥接用的是「最近活跃的会话」或设置页绑定的会话；不会按话题自动分流。
- 机器人无法读群历史（Bot API 限制），读取始终由 userbot 完成；机器人若被踢出群，`tg_dsh send` 会报错并回退到账号。
- `t.me/c/…` 私有消息链接要求该频道已在会话列表里，否则拿不到 access hash。
- 已在真实账号上逐一验证：登录（含两步验证路径）、会话列表、消息分页与媒体过滤、频道内全文搜索、
  全账号服务端搜索、搜索群发词→机器人删消息→回按钮→翻页/筛选、评论区、t.me 深链解析、白名单拒绝与放行、
  转发、DSH 私聊创建/发送/读取、入群退群、机器人建号改名换头像、桥接 prompt。

## 许可

未附许可证文件：作者保留权利。需要复用请先联系仓库所有者。