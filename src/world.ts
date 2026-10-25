/**
 * 战舰世界桌宠 World：截屏哨兵盯画面，明显变化时叫千问视觉模型看一眼，
 * 把战况变化作为事件推给 Coopanion；wows_look_now 工具供随时主动看一眼。
 * 事件与回执只陈述画面可确认的事实，解说风格归 Persona。
 */
import { fileURLToPath } from 'node:url';
import type { ToolDef, ToolOutcome, World, WorldHost, WorldWebUiDecl, TriggerMode } from 'cortico/core/types.ts';
import { nowIso } from 'cortico/core/util.ts';
import { WOWS_CONFIG_GROUP, type WowsConfigSection } from './config.ts';
import { captureScreen, resizeToMaxWidth, type CapturedFrame } from './capture.ts';
import { MotionSentinel } from './sentinel.ts';
import {
  observeBattleImage,
  observationText,
  type BattleObservation,
  type ObserveResult,
  type VisionClientOptions,
  type VisionImage,
} from './vision.ts';

const ENV_PROMPT_FILE = fileURLToPath(new URL('./ENV_PROMPT.md', import.meta.url));

/** 视觉模型全局限速：战斗中至少间隔 30 秒，不在战斗中至少 60 秒。 */
export const MIN_VLM_INTERVAL_BATTLE_MS = 30_000;
export const MIN_VLM_INTERVAL_IDLE_MS = 60_000;
/** 同一类战况事件的推送冷却。 */
export const EVENT_COOLDOWN_MS = 30_000;
/** 我舰血量一次下跌达到该值才报；达到 major 值时立即投递。 */
const HP_DROP_REPORT = 20;
const HP_DROP_MAJOR = 40;

/** API Key 在部署密钥存储中的名字；写入后配置页不再持有明文。 */
export const WOWS_SECRET = 'WOWS_VLM_API_KEY';

export interface WowsWorldOptions {
  /** `worlds.wows` 的活引用。 */
  cfg: WowsConfigSection;
  timezone: string;
  /** 截屏实现，测试可注入假实现。 */
  capture?: (screen?: string) => Promise<CapturedFrame>;
  /** 视觉模型调用实现，测试可注入假实现。 */
  observe?: (opts: VisionClientOptions, image: VisionImage, question?: string) => Promise<ObserveResult>;
  /** 时钟，测试可注入。 */
  now?: () => number;
  /** 读部署密钥存储（WorldContext.secret）。 */
  secret?: (name: string) => string;
  /** 写部署密钥存储（WorldContext.storeSecret）。 */
  storeSecret?: (name: string, value: string) => void;
  /** 写回配置（WorldContext.persist）。 */
  persist?: (patch: Partial<WowsConfigSection>) => void;
}

/** 全部工具的声明；定义里的 describe 与 `tools()` 都取它。 */
export const WOWS_TOOL_DECLS: ReadonlyArray<Omit<ToolDef, 'handler'>> = [
  {
    name: 'wows_look_now',
    description:
      'Look at the World of Warships screen right now: take a fresh screenshot, analyze it with the vision model, and report the current battle situation. Optionally ask a specific question about the scene.',
    tags: ['read', 'snapshot'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        question: {
          type: 'string',
          description: 'Optional question about the current scene, e.g. "我旁边还有队友吗".',
        },
      },
    },
  },
];

interface BattleEvent {
  category: string;
  text: string;
  major: boolean;
}

export class WowsWorld implements World {
  readonly id = 'wows';

  private host: WorldHost | null = null;
  private readonly sentinel = new MotionSentinel();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private busy = false;
  private lastVlmAt = 0;
  private callsThisBattle = 0;
  private lastObs: BattleObservation | null = null;
  private lastObsAt: string | null = null;
  private readonly seenFacts = new Set<string>();
  private readonly lastEventAt = new Map<string, number>();

  constructor(private readonly opts: WowsWorldOptions) {}

  private get cfg(): WowsConfigSection {
    return this.opts.cfg;
  }

  private get capture(): (screen?: string) => Promise<CapturedFrame> {
    return this.opts.capture ?? captureScreen;
  }

  private get observe(): (opts: VisionClientOptions, image: VisionImage, question?: string) => Promise<ObserveResult> {
    return this.opts.observe ?? observeBattleImage;
  }

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  private apiKey(): string {
    return (this.opts.secret?.(WOWS_SECRET) ?? '').trim()
      || (process.env.DASHSCOPE_API_KEY ?? '').trim()
      || this.cfg.vlmApiKey.trim();
  }

  /** 配置页收到的明文 Key 立即转入密钥存储并清空配置字段，之后任何界面与模型都看不到它。 */
  private migrateApiKey(): void {
    const plain = this.cfg.vlmApiKey.trim();
    if (!plain || !this.opts.storeSecret) return;
    this.opts.storeSecret(WOWS_SECRET, plain);
    this.cfg.vlmApiKey = '';
    this.opts.persist?.({ vlmApiKey: '' });
  }

  /** 只报值；前缀文本一律来自 ENV_PROMPT.md 模板。 */
  envPromptVars(): Record<string, string> {
    const state = !this.cfg.autoCommentary
      ? '自动观战关闭，只能被 wows_look_now 叫去看'
      : this.lastObs?.inBattle
        ? '观战中，当前在战斗里'
        : '观战中，当前不在战斗里';
    return {
      'wows.watchState': state,
      'wows.lastObservedAt': this.lastObsAt ?? '尚无',
      'wows.lastSummary': this.lastObs?.summary || '尚无观察',
      'wows.commentaryTone': this.cfg.commentaryTone,
    };
  }

  tools(): ToolDef[] {
    return [
      {
        ...WOWS_TOOL_DECLS[0],
        handler: async (args) => this.lookNow(args),
      },
    ];
  }

  webUi(): WorldWebUiDecl {
    return {
      lamps: [
        {
          label: '视觉模型',
          state: this.apiKey() ? (this.cfg.autoCommentary ? 'online' : 'offline') : 'error',
          hint: this.apiKey()
            ? `模型 ${this.cfg.vlmModel}，${this.cfg.autoCommentary ? '自动观战中' : '仅手动调用'}`
            : '未配置 DashScope API Key',
        },
      ],
      config: [WOWS_CONFIG_GROUP],
      promptDocs: [
        {
          key: 'worlds.wows.envPrompt',
          title: '战舰世界桌宠 · 环境提示词',
          description: '战舰世界桌宠 World 进 system 前缀的那一段。',
          path: ENV_PROMPT_FILE,
          role: 'envPrompt',
          vars: [
            { name: 'wows.watchState', description: '当前观战状态：关闭 / 观战中 / 战斗中。' },
            { name: 'wows.lastObservedAt', description: '最近一次画面观察的时间。' },
            { name: 'wows.lastSummary', description: '最近一次观察的一句话战况。' },
          ],
        },
      ],
    };
  }

  /** 挂载时投递状态事件；origin: internal 表示 World 的内部机制事件。 */
  async start(host: WorldHost): Promise<void> {
    this.host = host;
    this.migrateApiKey();
    await host.pushEvent({
      type: 'wows.started',
      ts: nowIso(this.opts.timezone),
      source: this.id,
      origin: 'internal',
      senderKey: this.id,
      text: this.cfg.autoCommentary
        ? `战舰世界桌宠已挂载：哨兵每 ${this.cfg.captureIntervalMs}ms 看一次画面，明显变化时调用 ${this.cfg.vlmModel}；wows_look_now 可用。`
        : '战舰世界桌宠已挂载：自动观战关闭，wows_look_now 可用。',
    });
    this.scheduleNext();
  }

  async stop(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.host = null;
    this.sentinel.reset();
  }

  /** 哨兵主循环：截屏比对，明显变化且限额允许时调用视觉模型。 */
  private scheduleNext(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.tick().catch((error) => {
        this.host?.log.warn('wows 哨兵这一轮失败', { err: String(error) });
      });
      this.scheduleNext();
    }, Math.max(1000, this.cfg.captureIntervalMs));
  }

  private async tick(): Promise<void> {
    if (!this.host || !this.cfg.autoCommentary || this.busy) return;
    this.migrateApiKey();
    this.busy = true;
    try {
      const frame = await this.capture(this.cfg.screen || undefined);
      const ratio = await this.sentinel.ingest(frame.bytes);
      if (ratio < this.cfg.motionThreshold) return;
      if (!this.vlmAllowed()) return;
      await this.observeAndHandle(frame);
    } finally {
      this.busy = false;
    }
  }

  /** 视觉模型调用的限速与配额。 */
  private vlmAllowed(): boolean {
    if (!this.apiKey()) return false;
    const minInterval = this.lastObs?.inBattle ? MIN_VLM_INTERVAL_BATTLE_MS : MIN_VLM_INTERVAL_IDLE_MS;
    if (this.now() - this.lastVlmAt < minInterval) return false;
    if (this.lastObs?.inBattle && this.callsThisBattle >= this.cfg.maxCallsPerBattle) return false;
    return true;
  }

  /** 调视觉模型看一帧，并把观察差分转成事件。发模型前统一降采样到 960 宽以省 token，缩放失败用原图。 */
  private async observeAndHandle(frame: VisionImage, question?: string): Promise<BattleObservation> {
    let image = frame;
    try {
      image = await resizeToMaxWidth(frame as CapturedFrame, 960);
    } catch { /* 缩放失败不阻塞观察 */ }
    const result = await this.observe(
      { baseUrl: this.cfg.vlmBaseUrl, apiKey: this.apiKey(), model: this.cfg.vlmModel },
      image,
      question,
    );
    this.lastVlmAt = this.now();
    if (this.lastObs?.inBattle) this.callsThisBattle += 1;
    if (result.usage) {
      this.host?.reportUsage(
        {
          promptTokens: result.usage.promptTokens,
          completionTokens: result.usage.completionTokens,
          cacheHitTokens: 0,
          cacheMissTokens: result.usage.promptTokens,
        },
        { model: this.cfg.vlmModel, label: 'wows 视觉' },
      );
    }
    sanitizeScore(this.lastObs, result.observation);
    const events = this.diffObservations(this.lastObs, result.observation);
    this.lastObs = result.observation;
    this.lastObsAt = nowIso(this.opts.timezone);
    for (const event of events) await this.pushBattleEvent(event);
    return result.observation;
  }

  /** 相邻两次观察的差分 → 只陈述事实的事件列表。 */
  private diffObservations(prev: BattleObservation | null, obs: BattleObservation): BattleEvent[] {
    const out: BattleEvent[] = [];
    if (obs.inBattle && !prev?.inBattle) {
      this.callsThisBattle = 0;
      this.seenFacts.clear();
      for (const f of obs.facts) this.seenFacts.add(f);
      this.lastEventAt.clear();
      out.push({ category: 'battle_started', text: `战斗开始。${obs.summary}`, major: true });
      return out;
    }
    if (!obs.inBattle && prev?.inBattle) {
      out.push({ category: 'battle_ended', text: `战斗结束。${obs.summary}`.trim(), major: true });
      return out;
    }
    if (!obs.inBattle || !prev?.inBattle) return out;

    if (prev.phase !== obs.phase && obs.phase !== '未知') {
      out.push({ category: 'phase', text: `战斗阶段：${prev.phase} → ${obs.phase}。`, major: true });
    }
    if (prev.kills != null && obs.kills != null && obs.kills > prev.kills) {
      out.push({ category: 'kills', text: `我方击沉 ${prev.kills} → ${obs.kills}。`, major: true });
    }
    if (prev.score != null && obs.score != null && prev.score !== obs.score) {
      out.push({ category: 'score', text: `比分 ${prev.score} → ${obs.score}。`, major: false });
    }
    if (prev.playerHpPct != null && obs.playerHpPct != null && prev.playerHpPct - obs.playerHpPct >= HP_DROP_REPORT) {
      out.push({
        category: 'hp',
        text: `我舰血量 ${prev.playerHpPct}% → ${obs.playerHpPct}%。`,
        major: prev.playerHpPct - obs.playerHpPct >= HP_DROP_MAJOR,
      });
    }
    if (prev.spotted != null && obs.spotted != null && obs.spotted > prev.spotted) {
      out.push({ category: 'spotted', text: `已发现敌舰 ${prev.spotted} → ${obs.spotted}。`, major: false });
    }
    const newFacts = obs.facts.filter((f) => !this.seenFacts.has(f));
    if (newFacts.length) {
      for (const f of newFacts) this.seenFacts.add(f);
      out.push({ category: 'fact', text: `新情况：${newFacts.join('；')}`, major: false });
    }

    // 高光时刻：画面可确认的、值得 Coo 激动接梗的事件
    if (prev.kills != null && obs.kills != null && obs.kills - prev.kills >= 2) {
      out.push({ category: 'highlight', text: `高光时刻：我方短时间内连续击沉 ${obs.kills - prev.kills} 艘敌舰（${prev.kills} → ${obs.kills}）。`, major: true });
    }
    if (prev.playerHpPct != null && obs.playerHpPct != null && prev.playerHpPct <= 25 && obs.playerHpPct > prev.playerHpPct) {
      out.push({ category: 'highlight', text: `高光时刻：我舰血量从 ${prev.playerHpPct}% 恢复到 ${obs.playerHpPct}%。`, major: true });
    }
    if (prev.spotted != null && obs.spotted != null && obs.spotted - prev.spotted >= 3) {
      out.push({ category: 'highlight', text: `高光时刻：短时间内新发现 ${obs.spotted - prev.spotted} 艘敌舰（${prev.spotted} → ${obs.spotted}）。`, major: false });
    }

    return out;
  }

  /** 按类别冷却推送事件；major 用 flush 立即投递，其余 debounce 合批。 */
  private async pushBattleEvent(event: BattleEvent): Promise<void> {
    if (!this.host) return;
    if (event.category === 'battle_started') {
      if (!this.cfg.emitBattleStarted) return;
    } else if (event.category === 'battle_ended') {
      if (!this.cfg.emitBattleEnded) return;
    } else if (event.category === 'highlight') {
      if (!this.cfg.emitBattleEvents) return;
      // 高光不受 30 秒冷却限制，major 立即投递，非 major 也随 debounce 合批
    } else {
      if (!this.cfg.emitBattleEvents) return;
      const last = this.lastEventAt.get(event.category) ?? 0;
      if (this.now() - last < EVENT_COOLDOWN_MS) return;
      this.lastEventAt.set(event.category, this.now());
    }
    const trigger: TriggerMode = event.major ? 'flush' : 'debounce';
    const eventType = event.category === 'battle_started' ? 'battle_started' : event.category === 'battle_ended' ? 'battle_ended' : event.category === 'highlight' ? 'highlight' : 'battle_event';
    await this.host.pushEvent(
      {
        type: `wows.${eventType}`,
        ts: nowIso(this.opts.timezone),
        source: this.id,
        origin: 'external',
        senderKey: this.id,
        text: event.text,
      },
      { trigger },
    );
  }

  /** wows_look_now：手动看一眼战场。 */
  private async lookNow(args: Record<string, unknown>): Promise<string | ToolOutcome> {
    const question = typeof args.question === 'string' && args.question.trim() ? args.question.trim() : undefined;
    if (!this.apiKey()) {
      return { text: '还没配置 DashScope API Key（worlds.wows.vlmApiKey 或环境变量 DASHSCOPE_API_KEY），看不见画面。', failed: true };
    }
    const since = this.now() - this.lastVlmAt;
    if (since < MIN_VLM_INTERVAL_BATTLE_MS && this.lastObs) {
      return `距上次观察只有 ${Math.round(since / 1000)} 秒（限速 30 秒一次），先看最近的：\n${observationText(this.lastObs)}`;
    }
    try {
      const frame = await this.capture(this.cfg.screen || undefined);
      const obs = await this.observeAndHandle(frame, question);
      return observationText(obs);
    } catch (error) {
      return { text: `看一眼失败了：${error instanceof Error ? error.message : String(error)}`, failed: true };
    }
  }
}

/** 解析 "我方:对方" 比分；不合法返回 null。 */
function parseScore(score: string | null): [number, number] | null {
  const m = score?.match(/^\s*(\d{1,4})\s*[:：]\s*(\d{1,4})\s*$/);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/**
 * 比分异常波动过滤：相邻两次观察的比分变动超过阈值（如 300 突然变 25），
 * 视为视觉模型误读，丢弃本次比分、沿用上一次，避免把假抖动推给模型。
 * 比分合法地有涨有跌，不做单调性假设。
 */
function sanitizeScore(prev: BattleObservation | null, obs: BattleObservation): void {
  if (!prev?.inBattle || !obs.inBattle || obs.score == null) return;
  const prevScore = parseScore(prev.score);
  const nextScore = parseScore(obs.score);
  if (!nextScore) {
    obs.score = null;
    return;
  }
  if (prevScore) {
    const delta = Math.abs(nextScore[0] - prevScore[0]) + Math.abs(nextScore[1] - prevScore[1]);
    if (delta > 150) {
      obs.score = prev.score;
    }
  }
}
