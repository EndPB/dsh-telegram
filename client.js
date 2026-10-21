/**
 * dsh-telegram — browser half.
 *
 *  - settings.section (`telegram`): the only place login, logout, proxy,
 *    whitelist and DSH-chat/bot operations can be performed. Those actions
 *    grant authority, so no agent tool exposes them.
 *  - The page is a plain host-styled form: theme tokens only, one column on
 *    phones, touch-sized controls, no hover-only affordances.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-telegram',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const CHANNEL = '/dsh-telegram'
    const NS = 'dsh-telegram'

    const DICTS = {
      en: {
        'settings.nav': 'Telegram',
        'title': 'Telegram',
        'lead': 'Your own Telegram account over MTProto. Sign in here; the agent reads channels and may only post to chats you allow below.',
        'loading': 'Loading Telegram settings…',
        'loadError': 'Could not load Telegram settings.',
        'retry': 'Retry',
        'ok': 'Done',
        'account': 'Account',
        'notConfigured': 'Not configured',
        'notLoggedIn': 'Not signed in',
        'signedIn': 'Signed in',
        'connect': 'Connection',
        'connected': 'Connected',
        'disconnected': 'Disconnected',
        'network': 'Network path',
        'inbox': 'Unread inbox',
        'settingsFile': 'Settings file',
        'refresh': 'Refresh',
        'login': 'Sign in',
        'loginLead': 'api_id and api_hash come from my.telegram.org/apps. The code arrives in your Telegram app.',
        'apiId': 'api_id',
        'apiHash': 'api_hash',
        'phone': 'Phone number',
        'sendCode': 'Send code',
        'code': 'Login code',
        'submitCode': 'Submit code',
        'password': 'Two-step password',
        'submitPassword': 'Submit password',
        'logout': 'Sign out',
        'logoutHint': 'Clears the local MTProto session. You will need a new code to sign in again.',
        'reauth': 'Sign in again',
        'proxy': 'Proxy',
        'proxyAuto': 'Automatic (system proxy)',
        'proxyOff': 'Direct connection',
        'proxyCustom': 'Custom SOCKS5 host:port',
        'proxyApply': 'Apply',
        'proxyHint': 'Telegram data centers are unreachable from some networks; automatic reuses the Windows proxy when it answers a SOCKS5 check.',
        'whitelist': 'Send whitelist',
        'whitelistHint': 'The only chats the agent may post into as you. Adding one grants permission, so only this page can do it.',
        'whitelistEmpty': 'Empty — every send is refused.',
        'whitelistAdd': 'Add chat',
        'whitelistPlaceholder': '@channel, t.me link, numeric id, or exact title',
        'remove': 'Remove',
        'dshChat': 'DSH chat',
        'dshChatMissing': 'Not created yet. Creating it makes a private group with you and the DSH bot.',
        'createChat': 'Create chat',
        'repairChat': 'Re-check',
        'bot': 'DSH bot',
        'botMissing': 'No bot yet. The bot is what carries DSH’s name and avatar in that chat.',
        'createBot': 'Create bot',
        'botReady': 'Ready',
        'botNotInChat': 'Not in the chat',
        'botHint': 'Created through @BotFather from your account. The token stays on this machine.',
        'bridge': 'Telegram → DSH bridge',
        'bridgeHint': 'When on, a message you write in the DSH chat becomes a prompt in a DSH session, and the answer is posted back by the bot.',
        'bridgeSession': 'Target session',
        'bridgeAuto': 'Most recently active session',
        'bridgeOff': 'Off',
        'bridgeOn': 'On',
        'mobileHint': 'Works on phones too: the settings panel switches to a single column.',
        'noticeProxy': 'Network path updated',
        'noticeLoginStart': 'Code sent — check your Telegram app',
        'noticeCode': 'Code accepted',
        'noticePassword': 'Password accepted',
        'noticeLogout': 'Signed out',
        'noticeWhitelistAdd': 'Whitelist updated',
        'noticeWhitelistRemove': 'Removed from the whitelist',
        'noticeChat': 'DSH chat ready',
        'noticeBot': 'Bot ready',
        'noticeBridge': 'Bridge updated',
        'working': 'Working…',
      },
      zh: {
        'settings.nav': 'Telegram',
        'title': 'Telegram',
        'lead': '用你自己的 Telegram 账号（MTProto）。在这里登录；DSH 可以读频道，但只允许发到下面白名单里的会话。',
        'loading': '正在加载 Telegram 设置…',
        'loadError': '读取 Telegram 设置失败。',
        'retry': '重试',
        'ok': '完成',
        'account': '账号',
        'notConfigured': '未配置',
        'notLoggedIn': '未登录',
        'signedIn': '已登录',
        'connect': '连接',
        'connected': '已连接',
        'disconnected': '未连接',
        'network': '网络路径',
        'inbox': '未读消息',
        'settingsFile': '设置文件',
        'refresh': '刷新',
        'login': '登录',
        'loginLead': 'api_id / api_hash 来自 my.telegram.org/apps；验证码会发到你的 Telegram 客户端。',
        'apiId': 'api_id',
        'apiHash': 'api_hash',
        'phone': '手机号',
        'sendCode': '发送验证码',
        'code': '验证码',
        'submitCode': '提交验证码',
        'password': '两步验证密码',
        'submitPassword': '提交密码',
        'logout': '退出登录',
        'logoutHint': '清除本机 MTProto 会话；再次登录需要新的验证码。',
        'reauth': '重新登录',
        'proxy': '代理',
        'proxyAuto': '自动（复用系统代理）',
        'proxyOff': '直连',
        'proxyCustom': '自定义 SOCKS5 host:port',
        'proxyApply': '应用',
        'proxyHint': '有些网络连不上 Telegram 数据中心；「自动」会在系统代理通过 SOCKS5 探测时复用它。',
        'whitelist': '发送白名单',
        'whitelistHint': '只有这些会话允许 DSH 以你的身份发言。加入白名单等于授权，所以只有这个页面能做。',
        'whitelistEmpty': '空 —— 所有发送都会被拒绝。',
        'whitelistAdd': '添加会话',
        'whitelistPlaceholder': '@频道、t.me 链接、数字 id 或精确标题',
        'remove': '移除',
        'dshChat': 'DSH 私聊',
        'dshChatMissing': '尚未创建。创建后会得到你和 DSH 机器人的私有群。',
        'createChat': '创建私聊',
        'repairChat': '重新检查',
        'bot': 'DSH 机器人',
        'botMissing': '还没有机器人。群里显示 DSH 的名字和头像靠它。',
        'createBot': '创建机器人',
        'botReady': '就绪',
        'botNotInChat': '不在群里',
        'botHint': '用你的账号通过 @BotFather 创建；token 只保存在本机。',
        'bridge': 'Telegram → DSH 桥接',
        'bridgeHint': '开启后，你在 DSH 私聊里发的消息会作为提示进入某个 DSH 会话，回答再由机器人发回群里。',
        'bridgeSession': '目标会话',
        'bridgeAuto': '最近活跃的会话',
        'bridgeOff': '关闭',
        'bridgeOn': '开启',
        'mobileHint': '手机端同样可用：窄屏时设置页自动变成单列。',
        'noticeProxy': '网络路径已更新',
        'noticeLoginStart': '验证码已发送，请查看 Telegram',
        'noticeCode': '验证码已通过',
        'noticePassword': '密码已通过',
        'noticeLogout': '已退出登录',
        'noticeWhitelistAdd': '白名单已更新',
        'noticeWhitelistRemove': '已从白名单移除',
        'noticeChat': 'DSH 私聊就绪',
        'noticeBot': '机器人就绪',
        'noticeBridge': '桥接设置已更新',
        'working': '处理中…',
      },
    }

    const CSS = [
      '.tg-settings{display:flex;flex-direction:column;width:100%;max-width:760px;min-width:0;color:var(--dsw-alias-label-primary);padding-bottom:calc(16px + env(safe-area-inset-bottom))}',
      '.tg-title{margin:0;font-size:16px;line-height:24px;font-weight:600}',
      '.tg-lead{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;margin:6px 0 14px;overflow-wrap:anywhere}',
      '.tg-card{border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-1);margin:0 0 14px;overflow:hidden;min-width:0}',
      '.tg-card-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 14px;background:var(--dsw-alias-bg-layer-2)}',
      '.tg-card-title{font-size:13px;font-weight:600;line-height:20px;min-width:0;overflow-wrap:anywhere}',
      '.tg-card-body{padding:2px 14px 10px;min-width:0}',
      '.tg-row{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;padding:10px 0;border-bottom:.5px solid var(--dsw-alias-border-l2);min-width:0}',
      '.tg-row:last-child{border-bottom:0}',
      '.tg-row-label{flex:1;min-width:0}',
      '.tg-row-title{font-size:13px;line-height:20px}',
      '.tg-row-hint{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;margin-top:2px;overflow-wrap:anywhere}',
      '.tg-row-control{flex:0 0 auto;max-width:58%;display:flex;flex-direction:column;align-items:flex-end;gap:6px;min-width:0}',
      '.tg-value{font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);text-align:right;overflow-wrap:anywhere}',
      '.tg-muted{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;overflow-wrap:anywhere}',
      '.tg-input,.tg-select{border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;padding:7px 9px;min-width:200px;max-width:100%;outline:none;box-sizing:border-box}',
      '.tg-input:focus,.tg-select:focus{border-color:var(--dsw-alias-brand-primary)}',
      '.tg-input:disabled,.tg-select:disabled{opacity:.55}',
      '.tg-input-wide{min-width:260px;width:100%}',
      '.tg-btn{font:inherit;font-size:12px;line-height:18px;padding:5px 11px;border-radius:9px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer;min-height:30px;touch-action:manipulation}',
      '.tg-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}',
      '.tg-btn:disabled{opacity:.5;cursor:default}',
      '.tg-btn-primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff}',
      '.tg-btn-primary:hover:not(:disabled){filter:brightness(1.06);background:var(--dsw-alias-brand-primary)}',
      '.tg-btn-danger{color:var(--dsw-alias-state-error-primary)}',
      '.tg-btns{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end;max-width:100%}',
      '.tg-pill{display:inline-flex;align-items:center;gap:6px;font-size:12px;line-height:18px;color:var(--dsw-alias-state-warn-primary);white-space:nowrap}',
      '.tg-pill.ok{color:var(--dsw-alias-state-success-primary)}',
      '.tg-pill.off{color:var(--dsw-alias-state-idle-primary)}',
      '.tg-dot{width:7px;height:7px;border-radius:50%;background:currentColor;flex:0 0 auto}',
      '.tg-switch{position:relative;flex:0 0 auto;width:40px;height:24px;border-radius:999px;border:0;background:var(--dsw-alias-state-idle-primary);cursor:pointer;padding:0;transition:background .15s;touch-action:manipulation}',
      '.tg-switch[aria-checked="true"]{background:var(--dsw-alias-brand-primary)}',
      '.tg-switch:disabled{opacity:.5;cursor:default}',
      '.tg-switch-knob{position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;transition:transform .15s}',
      '.tg-switch[aria-checked="true"] .tg-switch-knob{transform:translateX(16px)}',
      '.tg-list{list-style:none;margin:4px 0 0;padding:0;display:flex;flex-direction:column;gap:6px}',
      '.tg-list-item{display:flex;align-items:center;justify-content:space-between;gap:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:8px 10px;min-width:0}',
      '.tg-list-main{min-width:0;flex:1}',
      '.tg-list-title{font-size:13px;line-height:19px;overflow-wrap:anywhere}',
      '.tg-list-meta{color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px;overflow-wrap:anywhere}',
      '.tg-notice{display:flex;align-items:flex-start;gap:8px;font-size:12px;line-height:18px;padding:8px 10px;border-radius:9px;margin:0 0 12px;overflow-wrap:anywhere}',
      '.tg-notice.ok{color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent)}',
      '.tg-notice.error{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent)}',
      '.tg-details{margin-top:2px}',
      '.tg-details summary{cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:22px;user-select:none}',
      '.tg-stack{display:flex;flex-direction:column;gap:8px;width:100%;max-width:100%}',
      '.tg-footer{color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px;margin-top:4px;overflow-wrap:anywhere}',
      '@media (max-width:640px){',
      '.tg-settings{max-width:100%}',
      '.tg-row{flex-direction:column;align-items:stretch;gap:8px}',
      '.tg-row-control{max-width:100%;align-items:stretch;min-width:0}',
      '.tg-value{text-align:left}',
      '.tg-input,.tg-select{min-width:0;width:100%;font-size:16px;padding:10px 12px;border-radius:10px}',
      '.tg-input-wide{min-width:0}',
      '.tg-btn{min-height:42px;padding:9px 14px;font-size:14px;border-radius:10px;flex:1 1 auto}',
      '.tg-btns{gap:8px}',
      '.tg-btns .tg-btn{flex:1 1 46%}',
      '.tg-card-head{padding:12px 14px}',
      '.tg-card-body{padding:0 14px 8px}',
      '.tg-switch{width:46px;height:28px}',
      '.tg-switch-knob{width:22px;height:22px}',
      '.tg-switch[aria-checked="true"] .tg-switch-knob{transform:translateX(18px)}',
      '}',
    ].join('\n')

    function installStyles() {
      const tag = document.createElement('style')
      tag.dataset.dshTelegram = '1'
      tag.textContent = CSS
      document.head.append(tag)
      return () => tag.remove()
    }

    function createRpc(ctx) {
      return async function call(endpoint, payload) {
        const response = await ctx.connection.rpc.call(CHANNEL, endpoint, payload ?? null)
        if (response === null || typeof response !== 'object' || response.ok !== true) {
          const message = response?.error?.message
          throw new Error(typeof message === 'string' && message !== '' ? message : 'Telegram request failed')
        }
        return response.value
      }
    }

    function displayProxy(network) {
      if (!network || typeof network !== 'object') return ''
      const description = typeof network.description === 'string' ? network.description : ''
      const source = typeof network.source === 'string' ? network.source : ''
      if (description !== '') return description
      return source === 'direct' ? 'direct' : source
    }

    function Row({ title, hint, children }) {
      return h(
        'div',
        { className: 'tg-row' },
        h('div', { className: 'tg-row-label' }, h('div', { className: 'tg-row-title' }, title), hint ? h('div', { className: 'tg-row-hint' }, hint) : null),
        h('div', { className: 'tg-row-control' }, children),
      )
    }

    function Card({ title, action, children }) {
      return h(
        'section',
        { className: 'tg-card' },
        h('div', { className: 'tg-card-head' }, h('div', { className: 'tg-card-title' }, title), action ?? null),
        h('div', { className: 'tg-card-body' }, children),
      )
    }

    function Switch({ checked, onChange, disabled, label }) {
      return h(
        'button',
        {
          type: 'button',
          role: 'switch',
          'aria-checked': checked === true,
          'aria-label': label,
          className: 'tg-switch',
          disabled: disabled === true,
          onClick: onChange,
        },
        h('span', { className: 'tg-switch-knob' }),
      )
    }

    function TelegramSettings({ rpc, t }) {
      const tx = React.useCallback((key, fallback) => {
        const value = typeof t === 'function' ? t(key) : key
        return typeof value === 'string' && value !== key ? value : fallback
      }, [t])

      const [state, setState] = React.useState({ status: 'loading', data: null, error: null })
      const [notice, setNotice] = React.useState(null)
      const [busy, setBusy] = React.useState('')
      const [step, setStep] = React.useState(null)
      const [sessions, setSessions] = React.useState([])
      const [form, setForm] = React.useState({ apiId: '', apiHash: '', phone: '', code: '', password: '', proxy: '', whitelist: '' })

      const load = React.useCallback(async () => {
        setState((previous) => ({ ...previous, status: 'loading', error: null }))
        try {
          const data = await rpc('status')
          setState({ status: 'ready', data, error: null })
          setForm((previous) => ({ ...previous, phone: data.phone ?? previous.phone, proxy: previous.proxy }))
        } catch (error) {
          setState({ status: 'error', data: null, error: String(error?.message ?? error) })
        }
      }, [rpc])

      const loadSessions = React.useCallback(async () => {
        try {
          const value = await rpc('sessions')
          setSessions(Array.isArray(value?.items) ? value.items : [])
        } catch {
          setSessions([])
        }
      }, [rpc])

      React.useEffect(() => {
        void load()
        void loadSessions()
      }, [load, loadSessions])

      const run = async (key, endpoint, payload, successText) => {
        setBusy(key)
        setNotice(null)
        try {
          const value = await rpc(endpoint, payload)
          setNotice({ kind: 'ok', text: successText })
          void load()
          return value
        } catch (error) {
          setNotice({ kind: 'error', text: String(error?.message ?? error) })
          return null
        } finally {
          setBusy('')
        }
      }

      const set = (key) => (event) => {
        const value = event.target.value
        setForm((previous) => ({ ...previous, [key]: value }))
      }

      const data = state.data
      const authorized = data?.authorized === true
      const configured = data?.configured === true
      const me = data?.me ?? null
      const bot = data?.bot ?? null
      const dshChat = data?.dshChat ?? null
      const bridge = data?.bridge ?? { enabled: false, sessionId: null }
      const whitelist = Array.isArray(data?.whitelist) ? data.whitelist : []
      const network = data?.network ?? null
      const proxyChoice = form.proxy !== ''
        ? form.proxy
        : network?.mode === 'off'
          ? 'off'
          : network?.mode === 'custom' && typeof network?.proxy?.ip === 'string'
            ? `${network.proxy.ip}:${network.proxy.port}`
            : 'auto'

      const sendCode = async () => {
        const value = await run('loginStart', 'loginStart', {
          apiId: form.apiId.trim() === '' ? undefined : Number(form.apiId.trim()),
          apiHash: form.apiHash.trim() === '' ? undefined : form.apiHash.trim(),
          phone: form.phone.trim() === '' ? undefined : form.phone.trim(),
        }, tx('noticeLoginStart', 'Code sent'))
        if (value?.step === 'code' || value?.step === 'password') setStep(value.step)
      }

      const submitCode = async () => {
        const value = await run('loginCode', 'loginCode', { code: form.code }, tx('noticeCode', 'Code accepted'))
        if (value?.step === 'password') setStep('password')
        else if (value?.step === 'done') setStep(null)
      }

      const submitPassword = async () => {
        const value = await run('loginPassword', 'loginPassword', { password: form.password }, tx('noticePassword', 'Password accepted'))
        if (value?.step === 'done') setStep(null)
      }

      const applyProxy = async () => {
        const value = form.proxy.trim() === '' ? proxyChoice : form.proxy.trim()
        const result = await run('setProxy', 'setProxy', { value }, tx('noticeProxy', 'Network path updated'))
        if (result !== null) setForm((previous) => ({ ...previous, proxy: '' }))
      }

      const addWhitelist = async () => {
        const entries = form.whitelist.split(/[,，\n]/u).map((item) => item.trim()).filter((item) => item !== '')
        if (entries.length === 0) return
        const value = await run('whitelistAdd', 'whitelistAdd', { entries }, tx('noticeWhitelistAdd', 'Whitelist updated'))
        if (value !== null) setForm((previous) => ({ ...previous, whitelist: '' }))
      }

      const removeWhitelist = async (peerId) => {
        await run(`whitelistRemove:${peerId}`, 'whitelistRemove', { entries: [peerId] }, tx('noticeWhitelistRemove', 'Removed'))
      }

      const ensureChat = async () => {
        await run('dshEnsure', 'dshEnsure', {}, tx('noticeChat', 'DSH chat ready'))
      }

      const ensureBot = async () => {
        const value = await run('botEnsure', 'botEnsure', {}, tx('noticeBot', 'Bot ready'))
        if (value !== null && value.inChat !== true) {
          setNotice({ kind: 'error', text: value.note ?? 'Bot created but not added to the chat' })
        }
      }

      const setBridge = async (enabled, sessionId) => {
        await run('setBridge', 'setBridge', { enabled, sessionId }, tx('noticeBridge', 'Bridge updated'))
      }

      if (state.status === 'loading' && data === null) {
        return h('div', { className: 'tg-settings' }, h('div', { className: 'tg-muted' }, tx('loading', 'Loading…')))
      }
      if (state.status === 'error' && data === null) {
        return h(
          'div',
          { className: 'tg-settings' },
          h('div', { className: 'tg-notice error' }, tx('loadError', 'Could not load Telegram settings.')),
          h('div', { className: 'tg-muted' }, state.error),
          h('button', { type: 'button', className: 'tg-btn', onClick: () => void load() }, tx('retry', 'Retry')),
        )
      }

      const noticeNode = notice === null ? null : h('div', { className: `tg-notice ${notice.kind}`, role: 'status' }, notice.text)
      const who = me === null
        ? ''
        : [me.firstName, me.lastName].filter(Boolean).join(' ') || (me.username ? `@${me.username}` : String(me.id))

      return h(
        'div',
        { className: 'tg-settings' },
        h('h2', { className: 'tg-title' }, tx('title', 'Telegram')),
        h('p', { className: 'tg-lead' }, tx('lead', '')),
        noticeNode,

        // Status ---------------------------------------------------------
        h(
          Card,
          { title: tx('account', 'Account') },
          h(Row, {
            title: authorized ? tx('signedIn', 'Signed in') : configured ? tx('notLoggedIn', 'Not signed in') : tx('notConfigured', 'Not configured'),
            hint: me === null ? null : `${who}${me.username ? ` · @${me.username}` : ''} · ${me.id}`,
          }, h('span', { className: `tg-pill ${authorized ? 'ok' : 'off'}` }, h('span', { className: 'tg-dot' }), authorized ? tx('connected', 'Connected') : tx('disconnected', 'Disconnected'))),
          h(Row, { title: tx('network', 'Network path'), hint: network?.mode ?? null },
            h('span', { className: 'tg-value' }, displayProxy(network))),
          h(Row, { title: tx('inbox', 'Unread inbox') },
            h('span', { className: 'tg-value' }, String(data?.inboxPending ?? 0))),
          h(Row, { title: tx('settingsFile', 'Settings file') },
            h('span', { className: 'tg-muted' }, data?.settingsFile ?? '')),
          h('div', { className: 'tg-btns' },
            h('button', { type: 'button', className: 'tg-btn', onClick: () => void load(), disabled: busy === 'status' }, tx('refresh', 'Refresh'))),
        ),

        // Login ----------------------------------------------------------
        !authorized
          ? h(
            Card,
            { title: tx('login', 'Sign in') },
            h('p', { className: 'tg-muted' }, tx('loginLead', '')),
            h('div', { className: 'tg-stack' },
              !configured
                ? h('input', { className: 'tg-input', inputMode: 'numeric', placeholder: tx('apiId', 'api_id'), value: form.apiId, onChange: set('apiId'), autoComplete: 'off' })
                : null,
              !configured
                ? h('input', { className: 'tg-input', placeholder: tx('apiHash', 'api_hash'), value: form.apiHash, onChange: set('apiHash'), autoComplete: 'off' })
                : null,
              h('input', { className: 'tg-input', type: 'tel', placeholder: tx('phone', 'Phone number'), value: form.phone, onChange: set('phone'), autoComplete: 'off' }),
              h('div', { className: 'tg-btns' },
                h('button', { type: 'button', className: 'tg-btn tg-btn-primary', onClick: () => void sendCode(), disabled: busy === 'loginStart' },
                  busy === 'loginStart' ? tx('working', 'Working…') : tx('sendCode', 'Send code'))),
              step === null ? null : h('input', { className: 'tg-input', inputMode: 'numeric', placeholder: tx('code', 'Login code'), value: form.code, onChange: set('code'), autoComplete: 'one-time-code' }),
              step === null ? null : h('div', { className: 'tg-btns' },
                h('button', { type: 'button', className: 'tg-btn tg-btn-primary', onClick: () => void submitCode(), disabled: busy === 'loginCode' }, tx('submitCode', 'Submit code'))),
              step !== 'password' ? null : h('input', { className: 'tg-input', type: 'password', placeholder: tx('password', 'Two-step password'), value: form.password, onChange: set('password'), autoComplete: 'current-password' }),
              step !== 'password' ? null : h('div', { className: 'tg-btns' },
                h('button', { type: 'button', className: 'tg-btn tg-btn-primary', onClick: () => void submitPassword(), disabled: busy === 'loginPassword' }, tx('submitPassword', 'Submit password'))),
            ),
          )
          : h(
            Card,
            { title: tx('login', 'Sign in') },
            h('p', { className: 'tg-muted' }, tx('logoutHint', '')),
            h('div', { className: 'tg-btns' },
              h('button', { type: 'button', className: 'tg-btn tg-btn-danger', onClick: () => void run('logout', 'logout', {}, tx('noticeLogout', 'Signed out')).then(() => setStep(null)) },
                tx('logout', 'Sign out'))),
          ),

        // Proxy ----------------------------------------------------------
        h(
          Card,
          { title: tx('proxy', 'Proxy') },
          h('p', { className: 'tg-muted' }, tx('proxyHint', '')),
          h('div', { className: 'tg-stack' },
            h('select', {
              className: 'tg-select',
              value: proxyChoice,
              onChange: (event) => setForm((previous) => ({ ...previous, proxy: event.target.value })),
            },
            h('option', { value: 'auto' }, tx('proxyAuto', 'Automatic')),
            h('option', { value: 'off' }, tx('proxyOff', 'Direct')),
            typeof network?.proxy?.ip === 'string'
              ? h('option', { value: `${network.proxy.ip}:${network.proxy.port}` }, `${network.proxy.ip}:${network.proxy.port}`)
              : null,
            ),
            h('input', {
              className: 'tg-input tg-input-wide',
              placeholder: '127.0.0.1:7890',
              value: proxyChoice === 'auto' || proxyChoice === 'off' ? '' : proxyChoice,
              onChange: (event) => setForm((previous) => ({ ...previous, proxy: event.target.value })),
              autoComplete: 'off',
            }),
            h('div', { className: 'tg-btns' },
              h('button', { type: 'button', className: 'tg-btn tg-btn-primary', onClick: () => void applyProxy(), disabled: busy === 'setProxy' },
                tx('proxyApply', 'Apply'))),
          ),
        ),

        // Whitelist ------------------------------------------------------
        h(
          Card,
          { title: tx('whitelist', 'Send whitelist') },
          h('p', { className: 'tg-muted' }, tx('whitelistHint', '')),
          whitelist.length === 0
            ? h('p', { className: 'tg-muted' }, tx('whitelistEmpty', 'Empty'))
            : h('ul', { className: 'tg-list' }, whitelist.map((entry) => h(
              'li',
              { className: 'tg-list-item', key: String(entry.peerId) },
              h('div', { className: 'tg-list-main' },
                h('div', { className: 'tg-list-title' }, entry.title || entry.handle || String(entry.peerId)),
                h('div', { className: 'tg-list-meta' }, [entry.handle, String(entry.peerId)].filter(Boolean).join(' · '))),
              h('button', {
                type: 'button',
                className: 'tg-btn tg-btn-danger',
                disabled: busy === `whitelistRemove:${entry.peerId}`,
                onClick: () => void removeWhitelist(entry.peerId),
              }, tx('remove', 'Remove')),
            ))),
          h('div', { className: 'tg-stack', style: { marginTop: '10px' } },
            h('input', { className: 'tg-input tg-input-wide', placeholder: tx('whitelistPlaceholder', ''), value: form.whitelist, onChange: set('whitelist'), autoComplete: 'off' }),
            h('div', { className: 'tg-btns' },
              h('button', { type: 'button', className: 'tg-btn tg-btn-primary', onClick: () => void addWhitelist(), disabled: busy === 'whitelistAdd' || form.whitelist.trim() === '' },
                tx('whitelistAdd', 'Add chat')))),
        ),

        // DSH chat + bot -------------------------------------------------
        h(
          Card,
          { title: tx('dshChat', 'DSH chat') },
          h(Row, {
            title: dshChat?.title ?? tx('dshChatMissing', 'Not created'),
            hint: dshChat?.peerId ? String(dshChat.peerId) : null,
          }, h('div', { className: 'tg-btns' },
            h('button', { type: 'button', className: 'tg-btn tg-btn-primary', onClick: () => void ensureChat(), disabled: busy === 'dshEnsure' },
              dshChat ? tx('repairChat', 'Re-check') : tx('createChat', 'Create chat')))),
          h(Row, {
            title: bot === null ? tx('botMissing', 'No bot yet') : `${bot.name}${bot.handle ? ` · ${bot.handle}` : ''}`,
            hint: bot === null ? tx('botHint', '') : `id ${bot.id}`,
          }, h('div', { className: 'tg-btns' },
            h('span', { className: `tg-pill ${bot === null ? 'off' : 'ok'}` }, h('span', { className: 'tg-dot' }), bot === null ? tx('disconnected', 'Off') : tx('botReady', 'Ready')),
            h('button', { type: 'button', className: 'tg-btn tg-btn-primary', onClick: () => void ensureBot(), disabled: busy === 'botEnsure' || !configured },
              bot === null ? tx('createBot', 'Create bot') : tx('repairChat', 'Re-check')))),
        ),

        // Bridge ---------------------------------------------------------
        h(
          Card,
          { title: tx('bridge', 'Telegram → DSH bridge') },
          h(Row, {
            title: tx('bridge', 'Telegram → DSH bridge'),
            hint: tx('bridgeHint', ''),
          }, h(Switch, {
            checked: bridge.enabled === true,
            label: tx('bridge', 'Bridge'),
            disabled: busy === 'setBridge',
            onChange: () => void setBridge(bridge.enabled !== true, bridge.sessionId ?? null),
          })),
          h(Row, {
            title: tx('bridgeSession', 'Target session'),
            hint: tx('bridgeAuto', ''),
          }, h('select', {
            className: 'tg-select',
            value: bridge.sessionId ?? '',
            disabled: busy === 'setBridge',
            onChange: (event) => {
              const value = event.target.value
              void setBridge(bridge.enabled === true, value === '' ? null : value)
            },
          },
          h('option', { value: '' }, tx('bridgeAuto', 'Most recently active session')),
          sessions.map((item) => h('option', { key: item.id, value: item.id }, item.label)),
          )),
          h('p', { className: 'tg-muted' }, tx('mobileHint', '')),
          bridge.last
            ? h('p', { className: 'tg-muted' },
              `${new Date(bridge.last.at).toLocaleString()} · ${bridge.last.ok === true ? tx('botReady', 'OK') : (bridge.last.error ?? 'failed')}`)
            : null,
        ),
      )
    }

    return {
      name: '@local/dsh-telegram',
      inject: ['slots', 'connection', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, 'en', DICTS.en), 'dsh-telegram: en locale')
        ctx.effect(() => ctx.locale.register(NS, 'zh', DICTS.zh), 'dsh-telegram: zh locale')
        const t = ctx.locale.bind(NS)
        const rpc = createRpc(ctx)

        ctx.effect(() => installStyles(), 'dsh-telegram: settings styles')

        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'telegram',
              order: 13,
              label: () => t('settings.nav'),
              inject: () => ({ rpc, t }),
            },
            TelegramSettings,
          ),
        )
      },
    }
  },
})
