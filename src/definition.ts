import { describeTools, type WorldDefinition } from 'cortico/world.ts';
import { WOWS_DEFAULTS, type WowsConfigSection } from './config.ts';
import { WOWS_TOOL_DECLS, WowsWorld } from './world.ts';

export const WOWS: WorldDefinition<WowsConfigSection> = {
  id: 'wows',
  label: '战舰世界桌宠',
  defaults: () => ({ ...WOWS_DEFAULTS }),
  // `ctx.cfg` 是 `worlds.wows` 的活引用:热改的键现读即生效。密钥经 ctx 的密钥存储读写，不落配置。
  create: (ctx) =>
    new WowsWorld({
      cfg: ctx.cfg,
      timezone: ctx.timezone,
      secret: (name) => ctx.secret(name),
      storeSecret: (name, value) => ctx.storeSecret(name, value),
      persist: (patch) => ctx.persist(patch),
    }),
  // 自描述:可能出现的全部工具与会推出的全部事件,不进提示词。
  describe: {
    tools: describeTools(WOWS_TOOL_DECLS, {
      wows_look_now: { zh: '立刻截屏看一眼《战舰世界》战场，报告当前战况，可附带问题。', en: 'Takes a fresh screenshot of World of Warships and reports the current battle situation, optionally answering a question.' },
    }),
    events: [
      { type: 'wows.started', description: { zh: 'World 挂载完成。', en: 'The World was mounted.' }, trigger: 'flush' },
      { type: 'wows.battle_started', description: { zh: '检测到进入一场战斗。', en: 'A battle started.' }, trigger: 'flush' },
      { type: 'wows.battle_event', description: { zh: '战斗中的战况变化：击沉、比分、血量、阶段、新情况。', en: 'Battle progress: kills, score, HP, phase or new facts.' }, trigger: 'debounce' },
      { type: 'wows.highlight', description: { zh: '画面可确认的高光时刻：连续击沉、残血恢复、短时间发现多艘敌舰。', en: 'A highlight moment confirmed from the screen: multi-kill, HP recovery from low, or many enemies spotted at once.' }, trigger: 'flush' },
      { type: 'wows.battle_ended', description: { zh: '检测到离开战斗（结算或回港口）。', en: 'The battle ended.' }, trigger: 'flush' },
    ],
  },
};
