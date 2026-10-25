/**
 * 千问视觉模型客户端：纯 fetch 调 DashScope 的 OpenAI 兼容 chat/completions。
 * 要求模型只回严格 JSON，解析失败按调用失败处理。
 */

/** 一次画面观察的结构化结果；数值读不出来时为 null，不猜。 */
export interface BattleObservation {
  /** 是否在战斗中（区别于港口、加载、结算界面）。 */
  inBattle: boolean;
  /** 战斗阶段：港口 / 加载 / 开局 / 中期 / 残局 / 结算 / 未知。 */
  phase: string;
  /** 我方击沉数（击杀图标计数）。 */
  kills: number | null;
  /** 比分，形如 "3:4"（我方:对方）。 */
  score: string | null;
  /** 我舰血量百分比 0-100。 */
  playerHpPct: number | null;
  /** 已被发现的敌方舰船数。 */
  spotted: number | null;
  /** 画面可确认的简短事实列表，如"右舷发现敌驱逐舰"。 */
  facts: string[];
  /** 一句话战况概括，只说画面事实。 */
  summary: string;
}

export interface VisionClientOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
}

export interface VisionImage {
  bytes: Uint8Array;
  mime: string;
}

export interface ObserveResult {
  observation: BattleObservation;
  usage?: { promptTokens: number; completionTokens: number };
}

const SYSTEM_PROMPT = [
  '你是《战舰世界》(World of Warships) 的观战分析员。看一张游戏截图，只输出一个 JSON 对象，不要输出任何其他文字、不要用代码围栏。',
  '字段：',
  '- inBattle: 布尔。画面处于一场进行中的战斗（能看到海战 HUD、小地图、血量条）为 true；港口、排队、加载、结算界面为 false。',
  '- phase: 字符串。港口/加载/开局/中期/残局/结算/未知 之一。',
  '- kills: 整数或 null。我方已击沉敌舰数量（击杀计数图标），读不清给 null。',
  '- score: 字符串或 null。当前比分，形如 "3:4"（我方:对方），读不清给 null。',
  '- playerHpPct: 0-100 整数或 null。玩家舰船剩余血量百分比。只读屏幕左下方本舰状态面板血条的绿色部分占整条的百分比；不要读面板上的具体血量数字（那些数字常带空格如"35 000"，不是百分比）。读不清给 null。',
  '- spotted: 整数或 null。已被发现的敌方舰船数量，读不清给 null。',
  '《战舰世界》画面规则（读取前先按这些规则定位）：',
  '- 比分在屏幕正上方中央的比分条上，形如 "300:250"（我方:对方）。战斗中飘出的 "+25""+40" 等是加分提示动画，不是比分，绝不能当比分读。比分条上的两个数读不全就给 null，不要只报一个数。',
  '- kills 是比分条附近我方一侧的击沉计数（击杀图标数），与比分是两个不同的数，不要混淆。',
  '- playerHpPct 读屏幕左下方本舰状态面板的血量条：绿色部分占整条的百分比。面板上的具体血量数字（如"35 000"）不是百分比，不要读它。读不清给 null，不要猜。',
  '- 敌我识别：小地图上绿色图标是队友、红色图标是敌人；海面上舰船头顶血条绿色为队友、红色为敌人。facts 里不得把绿色标记的队友说成敌舰。',
  '- facts: 字符串数组。画面上能确认的重要简短事实（0-3 条），如"前方 8 公里发现敌方战列舰""我舰起火"。没有就给空数组。只写事实，不评论，不做战术推测。',
  '- summary: 字符串。一句话客观概括当前画面战况，只说事实，不加情绪。',
].join('\n');

/** 去掉代码围栏后 JSON.parse；输出做字段归一化。解析失败抛错。 */
export function parseObservation(raw: string): BattleObservation {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const value = JSON.parse(text) as Record<string, unknown>;
  const num = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null;
  /** 血量百分比必须是 0-100；超出范围视为读错（如读成了带空格的绝对血量数字），给 null。 */
  const pct = (v: unknown): number | null => {
    const n = num(v);
    return n != null && n >= 0 && n <= 100 ? n : null;
  };
  const str = (v: unknown): string | null =>
    typeof v === 'string' && v.trim() ? v.trim() : null;
  return {
    inBattle: value.inBattle === true,
    phase: str(value.phase) ?? '未知',
    kills: num(value.kills),
    score: str(value.score),
    playerHpPct: pct(value.playerHpPct),
    spotted: num(value.spotted),
    facts: Array.isArray(value.facts)
      ? value.facts.filter((f): f is string => typeof f === 'string' && f.trim().length > 0).map((f) => f.trim()).slice(0, 5)
      : [],
    summary: str(value.summary) ?? '',
  };
}

/** 调一次视觉模型观察一张画面。 */
export async function observeBattleImage(
  opts: VisionClientOptions,
  image: VisionImage,
  question?: string,
): Promise<ObserveResult> {
  const url = `${opts.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const b64 = Buffer.from(image.bytes).toString('base64');
  const userText = question
    ? `请按系统要求输出 JSON；另外请特别回答这个问题（写进 summary）：${question}`
    : '请按系统要求分析这张《战舰世界》截图并输出 JSON。';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify({
        model: opts.model,
        temperature: 0,
        max_tokens: 800,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: userText },
              { type: 'image_url', image_url: { url: `data:${image.mime};base64,${b64}` } },
            ],
          },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 300);
      throw new Error(`视觉模型请求失败 HTTP ${res.status}: ${body}`);
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = data.choices?.[0]?.message?.content;
    const text = typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.map((c) => (typeof c === 'object' && c && 'text' in c ? String((c as { text: unknown }).text) : '')).join('')
        : '';
    if (!text.trim()) throw new Error('视觉模型返回为空');
    const usage = data.usage && typeof data.usage.prompt_tokens === 'number'
      ? { promptTokens: data.usage.prompt_tokens, completionTokens: data.usage.completion_tokens ?? 0 }
      : undefined;
    return { observation: parseObservation(text), usage };
  } finally {
    clearTimeout(timer);
  }
}

/** 把一次观察渲染成只陈述事实的文本，供事件正文与工具回执使用。 */
export function observationText(obs: BattleObservation): string {
  const parts: string[] = [obs.inBattle ? `战斗中（${obs.phase}）` : `不在战斗中（${obs.phase}）`];
  if (obs.kills != null) parts.push(`击沉 ${obs.kills}`);
  if (obs.score != null) parts.push(`比分 ${obs.score}`);
  if (obs.playerHpPct != null) parts.push(`我舰血量 ${obs.playerHpPct}%`);
  if (obs.spotted != null) parts.push(`已发现敌舰 ${obs.spotted}`);
  let text = `战况：${parts.join('，')}。`;
  if (obs.summary) text += `\n概括：${obs.summary}`;
  if (obs.facts.length) text += `\n事实：${obs.facts.join('；')}`;
  return text;
}
