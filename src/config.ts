import type { ConfigGroup } from 'cortico/core/types.ts';

/** config.json 的 worlds.wows 段，默认禁用；由部署启用。全部键热改生效。 */
export interface WowsConfigSection {
  enabled: boolean;
  /** 哨兵截屏轮询间隔（毫秒）；热改。 */
  captureIntervalMs: number;
  /** 画面变化比例阈值（0-1），超过才考虑调用视觉模型；热改。 */
  motionThreshold: number;
  /** 截屏的显示器 id（screenshot-desktop 的 display id），空串 = 主屏；热改。 */
  screen: string;
  /** 千问视觉模型的 OpenAI 兼容地址；热改。 */
  vlmBaseUrl: string;
  /** 视觉模型名；热改。 */
  vlmModel: string;
  /** DashScope API Key；留空也可用环境变量 DASHSCOPE_API_KEY；热改。 */
  vlmApiKey: string;
  /** 自动观战解说开关：哨兵发现画面明显变化时自动调用视觉模型；热改。 */
  autoCommentary: boolean;
  /** 每场战斗自动观察的视觉模型调用上限；热改。 */
  maxCallsPerBattle: number;
  /** 推送战斗开始事件；热改。 */
  emitBattleStarted: boolean;
  /** 推送战斗结束事件；热改。 */
  emitBattleEnded: boolean;
  /** 推送战斗过程中的战况事件；热改。 */
  emitBattleEvents: boolean;
  /** 解说基调：热血 / 温柔 / 毒舌 / 冷静；注入 ENV_PROMPT，热改。 */
  commentaryTone: '热血' | '温柔' | '毒舌' | '冷静';
}

export const WOWS_DEFAULTS: WowsConfigSection = {
  enabled: false,
  captureIntervalMs: 3000,
  motionThreshold: 0.035,
  screen: '',
  vlmBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  vlmModel: 'qwen3-vl-plus',
  vlmApiKey: '',
  autoCommentary: true,
  maxCallsPerBattle: 25,
  emitBattleStarted: true,
  emitBattleEnded: true,
  emitBattleEvents: true,
  commentaryTone: '热血',
};

/** World 配置的 JSON Schema 声明。 */
export const WOWS_CONFIG_GROUP: ConfigGroup = {
  id: 'world:wows',
  owner: 'world:wows',
  schema: {
    type: 'object',
    title: '战舰世界桌宠',
    description: '截屏看《战舰世界》战况并报告。视觉模型走 DashScope 的 OpenAI 兼容接口，API Key 只存在本机部署配置里。',
    properties: {
      'worlds.wows.captureIntervalMs': {
        type: 'integer',
        title: '哨兵轮询间隔',
        description: '截屏比对的间隔，毫秒。只比对画面，不调用模型。',
        minimum: 1000,
        maximum: 30000,
        'x-hot': true,
        'x-suffix': 'ms',
      },
      'worlds.wows.motionThreshold': {
        type: 'number',
        title: '画面变化阈值',
        description: '降采样画面上变化像素占比超过该值时才调用视觉模型。调大更省调用，调小更灵敏。',
        minimum: 0.005,
        maximum: 0.5,
        'x-hot': true,
      },
      'worlds.wows.screen': {
        type: 'string',
        title: '显示器',
        description: '截取哪台显示器。留空为主屏；多屏填系统显示 id（如 \\\\.\\DISPLAY2）。',
        'x-hot': true,
      },
      'worlds.wows.vlmBaseUrl': {
        type: 'string',
        title: '视觉模型地址',
        description: 'OpenAI 兼容的 chat/completions 服务地址，默认阿里云百炼。',
        'x-hot': true,
      },
      'worlds.wows.vlmModel': {
        type: 'string',
        title: '视觉模型',
        description: '默认 qwen3-vl-plus。支持任意 OpenAI 兼容视觉端点的模型（如千问 qwen3-vl-plus、智谱 glm-4v 等）。',
        'x-hot': true,
      },
      'worlds.wows.vlmApiKey': {
        type: 'string',
        title: '视觉模型 API Key',
        description: '粘贴后保存一次即可：密钥会立即转入部署密钥存储（仅本机用户可读），此处随后显示为空、不再出现明文。留空则读环境变量 DASHSCOPE_API_KEY。',
        'x-hot': true,
      },
      'worlds.wows.autoCommentary': {
        type: 'boolean',
        title: '自动观战',
        description: '开启后哨兵盯画面，发现明显变化就叫视觉模型看一眼并推送战况事件；关闭后只能靠 wows_look_now 手动看。',
        'x-hot': true,
      },
      'worlds.wows.maxCallsPerBattle': {
        type: 'integer',
        title: '每场战斗调用上限',
        description: '一场战斗内自动观察最多调用视觉模型的次数，控制花费。手动 wows_look_now 也计入。',
        minimum: 1,
        maximum: 200,
        'x-hot': true,
      },
      'worlds.wows.emitBattleStarted': {
        type: 'boolean',
        title: '战斗开始事件',
        description: '检测到进入战斗时推送 wows.battle_started。',
        'x-hot': true,
      },
      'worlds.wows.emitBattleEvents': {
        type: 'boolean',
        title: '战况事件',
        description: '检测到击沉、比分、血量、阶段等变化时推送 wows.battle_event。',
        'x-hot': true,
      },
      'worlds.wows.emitBattleEnded': {
        type: 'boolean',
        title: '战斗结束事件',
        description: '检测到离开战斗时推送 wows.battle_ended。',
        'x-hot': true,
      },
      'worlds.wows.commentaryTone': {
        type: 'string',
        title: '解说基调',
        description: 'Coo 解说战况时的情绪基调，注入环境提示词。',
        enum: ['热血', '温柔', '毒舌', '冷静'],
        'x-hot': true,
      },
    },
  },
};
