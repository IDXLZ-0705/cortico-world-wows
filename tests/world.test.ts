import { describe, expect, it } from 'vitest';
import { WOWS_DEFAULTS, type WowsConfigSection } from '../src/config.ts';
import { WOWS_SECRET, WowsWorld } from '../src/world.ts';
import type { BattleObservation } from '../src/vision.ts';
import { makeFakeHost } from './helpers/fake-host.ts';

function obs(partial: Partial<BattleObservation>): BattleObservation {
  return {
    inBattle: false,
    phase: '港口',
    kills: null,
    score: null,
    playerHpPct: null,
    spotted: null,
    facts: [],
    summary: '',
    ...partial,
  };
}

interface Rig {
  world: WowsWorld;
  cfg: WowsConfigSection;
  host: ReturnType<typeof makeFakeHost>;
  setNow(ms: number): void;
  pushObservation(): Promise<unknown>;
  observeCalls: Array<{ model: string; question?: string }>;
}

/** 组装一个注入假截屏/假视觉/假时钟的 World；用 wows_look_now 驱动观察。 */
function makeRig(script: BattleObservation[], cfgPatch: Partial<WowsConfigSection> = {}): Rig {
  const cfg: WowsConfigSection = {
    ...WOWS_DEFAULTS,
    autoCommentary: false,
    vlmApiKey: 'sk-test',
    ...cfgPatch,
  };
  const host = makeFakeHost();
  let now = 0;
  let i = 0;
  const observeCalls: Array<{ model: string; question?: string }> = [];
  const world = new WowsWorld({
    cfg,
    timezone: 'Asia/Shanghai',
    now: () => now,
    capture: async () => ({ bytes: Buffer.from('fake-jpeg'), mime: 'image/jpeg' }),
    observe: async (opts, _image, question) => {
      observeCalls.push({ model: opts.model, question });
      const scripted = script[Math.min(i, script.length - 1)];
      i += 1;
      return { observation: scripted, usage: { promptTokens: 100, completionTokens: 20 } };
    },
  });
  return {
    world,
    cfg,
    host,
    setNow: (ms) => { now = ms; },
    observeCalls,
    pushObservation: async () => {
      const tool = world.tools().find((t) => t.name === 'wows_look_now')!;
      return tool.handler({}, { role: 'test', log: host.host.log });
    },
  };
}

describe('WowsWorld', () => {
  it('配置里的明文 Key 在挂载时转入密钥存储，配置字段清空', async () => {
    const rig = makeRig([]);
    const stored: Record<string, string> = {};
    const persisted: Array<Partial<WowsConfigSection>> = [];
    const world = new WowsWorld({
      cfg: rig.cfg,
      timezone: 'Asia/Shanghai',
      secret: (name) => stored[name] ?? '',
      storeSecret: (name, value) => { stored[name] = value; },
      persist: (patch) => { persisted.push(patch); },
    });
    await world.start(rig.host.host);
    expect(stored[WOWS_SECRET]).toBe('sk-test');
    expect(rig.cfg.vlmApiKey).toBe('');
    expect(persisted).toEqual([{ vlmApiKey: '' }]);
    // 密钥存储优先于配置字段
    const tool = world.tools().find((t) => t.name === 'wows_look_now')!;
    await tool.handler({}, { role: 'test', log: rig.host.host.log });
    await world.stop();
  });

  it('挂载时推送 wows.started 内部事件', async () => {
    const rig = makeRig([]);
    await rig.world.start(rig.host.host);
    expect(rig.host.events).toHaveLength(1);
    const { event } = rig.host.events[0];
    expect(event.type).toBe('wows.started');
    expect(event.origin).toBe('internal');
    expect(event.text).toContain('wows_look_now');
    await rig.world.stop();
  });

  it('视觉模型限速：30 秒内第二次调用返回最近战况', async () => {
    const rig = makeRig([obs({ inBattle: true, phase: '开局', summary: '战斗刚开始' })]);
    await rig.world.start(rig.host.host);
    rig.setNow(1_000);
    const first = await rig.pushObservation();
    expect(String(first)).toContain('战斗中');
    rig.setNow(5_000);
    const second = await rig.pushObservation();
    expect(String(second)).toContain('限速');
    expect(String(second)).toContain('30 秒');
    expect(rig.observeCalls).toHaveLength(1);
    await rig.world.stop();
  });

  it('未配置 API Key 时工具失败回执', async () => {
    const rig = makeRig([], { vlmApiKey: '' });
    const tool = rig.world.tools().find((t) => t.name === 'wows_look_now')!;
    const outcome = await tool.handler({}, { role: 'test', log: rig.host.host.log });
    expect(outcome).toMatchObject({ failed: true });
  });

  it('进战斗推 battle_started(flush)，出战斗推 battle_ended(flush)', async () => {
    const rig = makeRig([
      obs({ inBattle: false, phase: '港口', summary: '在港口' }),
      obs({ inBattle: true, phase: '开局', kills: 0, summary: '战斗开始' }),
      obs({ inBattle: false, phase: '结算', summary: '战斗结束' }),
    ]);
    await rig.world.start(rig.host.host);
    rig.setNow(1_000);
    await rig.pushObservation();
    rig.setNow(40_000);
    await rig.pushObservation();
    rig.setNow(80_000);
    await rig.pushObservation();
    const types = rig.host.events.map((e) => e.event.type);
    expect(types).toEqual(['wows.started', 'wows.battle_started', 'wows.battle_ended']);
    expect(rig.host.events[1].opts?.trigger).toBe('flush');
    expect(rig.host.events[1].event.text).toContain('战斗开始');
    expect(rig.host.events[2].event.text).toContain('战斗结束');
    await rig.world.stop();
  });

  it('击沉与新情况产生 battle_event，同类别 30 秒冷却', async () => {
    const rig = makeRig([
      obs({ inBattle: true, phase: '开局', kills: 0 }),
      obs({ inBattle: true, phase: '中期', kills: 2, facts: ['右舷发现敌舰'] }),
      obs({ inBattle: true, phase: '中期', kills: 3 }),
    ]);
    await rig.world.start(rig.host.host);
    rig.setNow(1_000);
    await rig.pushObservation();
    rig.setNow(40_000);
    await rig.pushObservation();
    // 距上次观察 39 秒（过限速），距上次 kills 事件 21 秒（冷却内）
    rig.setNow(61_000);
    await rig.pushObservation();
    const battleEvents = rig.host.events.filter((e) => e.event.type === 'wows.battle_event');
    const killsEvents = battleEvents.filter((e) => e.event.text.includes('击沉'));
    expect(killsEvents).toHaveLength(1); // 第二次击沉在冷却内被压住
    expect(battleEvents.some((e) => e.event.text.includes('新情况'))).toBe(true);
    expect(battleEvents.some((e) => e.event.text.includes('阶段'))).toBe(true);
    await rig.world.stop();
  });

  it('emitBattleEvents=false 时战斗过程事件不推，开始结束照推', async () => {
    const rig = makeRig(
      [
        obs({ inBattle: true, phase: '开局', kills: 0 }),
        obs({ inBattle: true, phase: '中期', kills: 1 }),
        obs({ inBattle: false, phase: '结算' }),
      ],
      { emitBattleEvents: false },
    );
    await rig.world.start(rig.host.host);
    rig.setNow(1_000);
    await rig.pushObservation();
    rig.setNow(40_000);
    await rig.pushObservation();
    rig.setNow(80_000);
    await rig.pushObservation();
    const types = rig.host.events.map((e) => e.event.type);
    expect(types).toEqual(['wows.started', 'wows.battle_started', 'wows.battle_ended']);
    await rig.world.stop();
  });

  it('配置热改：vlmModel 现读现生效，用量按次上报', async () => {
    const rig = makeRig([obs({}), obs({})]);
    await rig.world.start(rig.host.host);
    rig.setNow(1_000);
    await rig.pushObservation();
    rig.cfg.vlmModel = 'qwen3-vl-flash';
    rig.setNow(40_000);
    await rig.pushObservation();
    expect(rig.observeCalls[0].model).toBe('qwen3-vl-plus');
    expect(rig.observeCalls[1].model).toBe('qwen3-vl-flash');
    expect(rig.host.usages).toHaveLength(2);
    expect(rig.host.usages[0].usage.promptTokens).toBe(100);
    await rig.world.stop();
  });

  it('比分异常波动被丢弃：300 之后读到 25 不产生比分事件', async () => {
    const rig = makeRig([
      obs({ inBattle: true, phase: '中期', score: '300:250' }),
      obs({ inBattle: true, phase: '中期', score: '25:250' }), // 误读
      obs({ inBattle: true, phase: '中期', score: '312:250' }), // 正常上涨
      obs({ inBattle: true, phase: '中期', score: '瞎编的' }), // 非法格式
    ]);
    await rig.world.start(rig.host.host);
    rig.setNow(1_000);
    await rig.pushObservation();
    rig.setNow(30_000);
    await rig.pushObservation();
    rig.setNow(60_000);
    await rig.pushObservation();
    rig.setNow(90_000);
    await rig.pushObservation();
    const scoreEvents = rig.host.events.filter(
      (e) => e.event.type === 'wows.battle_event' && e.event.text.includes('比分'),
    );
    expect(scoreEvents).toHaveLength(1);
    expect(scoreEvents[0].event.text).toContain('300:250 → 312:250');
    await rig.world.stop();
  });

  it('比分合法下跌也产生事件：300 变成 250 是正常比分变化', async () => {
    const rig = makeRig([
      obs({ inBattle: true, phase: '中期', score: '300:250' }),
      obs({ inBattle: true, phase: '中期', score: '250:250' }), // 正常下跌（如丢点）
    ]);
    await rig.world.start(rig.host.host);
    rig.setNow(1_000);
    await rig.pushObservation();
    rig.setNow(40_000);
    await rig.pushObservation();
    const scoreEvents = rig.host.events.filter(
      (e) => e.event.type === 'wows.battle_event' && e.event.text.includes('比分'),
    );
    expect(scoreEvents).toHaveLength(1);
    expect(scoreEvents[0].event.text).toContain('300:250 → 250:250');
    await rig.world.stop();
  });

  it('高光事件：连续击沉触发 wows.highlight(flush)，不受 30 秒冷却限制', async () => {
    const rig = makeRig([
      obs({ inBattle: true, phase: '中期', kills: 1 }),
      obs({ inBattle: true, phase: '中期', kills: 3 }), // 连杀 2 艘
    ]);
    await rig.world.start(rig.host.host);
    rig.setNow(1_000);
    await rig.pushObservation();
    rig.setNow(32_000);
    await rig.pushObservation();
    const highlights = rig.host.events.filter((e) => e.event.type === 'wows.highlight');
    expect(highlights).toHaveLength(1);
    expect(highlights[0].event.text).toContain('连续击沉 2 艘');
    expect(highlights[0].opts?.trigger).toBe('flush');
    await rig.world.stop();
  });

  it('单杀只产生普通击沉事件，不触发高光', async () => {
    const rig = makeRig([
      obs({ inBattle: true, phase: '中期', kills: 1 }),
      obs({ inBattle: true, phase: '中期', kills: 2 }),
    ]);
    await rig.world.start(rig.host.host);
    rig.setNow(1_000);
    await rig.pushObservation();
    rig.setNow(32_000);
    await rig.pushObservation();
    expect(rig.host.events.filter((e) => e.event.type === 'wows.highlight')).toHaveLength(0);
    expect(rig.host.events.some((e) => e.event.text.includes('击沉'))).toBe(true);
    await rig.world.stop();
  });

  it('工具参数 question 透传给视觉模型', async () => {
    const rig = makeRig([obs({ inBattle: true, summary: '在中路' })]);
    await rig.world.start(rig.host.host);
    const tool = rig.world.tools().find((t) => t.name === 'wows_look_now')!;
    await tool.handler({ question: '我还在中路吗' }, { role: 'test', log: rig.host.host.log });
    expect(rig.observeCalls[0].question).toBe('我还在中路吗');
    await rig.world.stop();
  });
});
