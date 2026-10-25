# @idxlz-0705/cortico-world-wows · 战舰世界桌宠

Coopanion（Cortico）的 World 扩展：截屏看《战舰世界》的战场画面，用千问视觉模型（qwen-vl）读出战况，把变化推给桌宠开口解说。

## 它做什么

- **自动观战**：内置哨兵每几秒截一次屏并比对画面，只在画面明显变化时调用视觉模型（限速：战斗中 ≥20 秒一次，非战斗 ≥60 秒一次；每场战斗有调用上限）。
- **战况事件**：检测到进入/离开战斗、击沉数、比分、我舰血量、战斗阶段、新情况时推送 `wows.*` 事件。事件正文只陈述画面事实，怎么解说由 Coopanion 的人格决定。
- **随时插话**：工具 `wows_look_now` 让桌宠主动看一眼战场，可附带问题（如"我还在中路吗"）。

## 安装

1. 在 Coopanion 设置里打开**高级模式**，进入**扩展**页，选择**本机目录**安装这个包的目录（link 安装，改代码后重启进程生效）。
2. 在 World 页启用「战舰世界桌宠」，并在配置里填 **DashScope API Key**（阿里云百炼，`sk-` 开头；也可设环境变量 `DASHSCOPE_API_KEY`）。
3. 用无边框窗口模式运行《战舰世界》，确保游戏在主屏（或在配置的「显示器」里填对应屏幕 id）。

## 配置（worlds.wows.*，全部热改生效）

| 键 | 默认 | 说明 |
|---|---|---|
| captureIntervalMs | 3000 | 哨兵截屏比对间隔 |
| motionThreshold | 0.035 | 画面变化像素占比阈值，超过才调用模型 |
| screen | （空） | 显示器 id，空 = 主屏 |
| vlmBaseUrl | DashScope 兼容端点 | OpenAI 兼容接口地址 |
| vlmModel | qwen3-vl-plus | 视觉模型，可换任意 OpenAI 兼容端点模型 |
| vlmApiKey | （空） | DashScope API Key |
| autoCommentary | true | 自动观战开关 |
| maxCallsPerBattle | 25 | 每场战斗调用上限 |
| emitBattleStarted / emitBattleEvents / emitBattleEnded | true | 各类事件开关 |
| commentaryTone | 热血 | 解说基调：热血 / 温柔 / 毒舌 / 冷静 |

## 事件

| type | 投递 | 含义 |
|---|---|---|
| wows.started | flush | World 挂载完成（internal） |
| wows.battle_started | flush | 进入一场战斗 |
| wows.battle_event | debounce（重大变化 flush） | 击沉 / 比分 / 血量 / 阶段 / 新情况 |
| wows.battle_ended | flush | 离开战斗 |

## 开发

```bash
corepack pnpm install
pnpm test
pnpm typecheck
```

只依赖纯 JS 包（screenshot-desktop 截屏、jimp 图像处理），没有原生构建。
