import type { EventEnvelope, PushOptions, WorldHost } from 'cortico/core/types.ts';
import { nullLogger } from 'cortico/core/util.ts';

export interface RecordedPush {
  event: Parameters<WorldHost['pushEvent']>[0];
  opts?: PushOptions;
}

export interface RecordedUsage {
  usage: Parameters<WorldHost['reportUsage']>[0];
  opts?: Parameters<WorldHost['reportUsage']>[1];
}

export interface FakeHost {
  host: WorldHost;
  events: RecordedPush[];
  usages: RecordedUsage[];
}

/** 最小 WorldHost 假实现：记录 pushEvent 与 reportUsage。 */
export function makeFakeHost(): FakeHost {
  const events: RecordedPush[] = [];
  const usages: RecordedUsage[] = [];
  const host = {
    pushEvent: async (e: RecordedPush['event'], opts?: PushOptions) => {
      events.push({ event: e, opts });
      return { ...e, cursor: events.length, origin: e.origin ?? 'external' } as EventEnvelope;
    },
    pushDeferred: () => {},
    drainPendingEvents: async () => [],
    reportUsage: (usage: RecordedUsage['usage'], opts?: RecordedUsage['opts']) => {
      usages.push({ usage, opts });
    },
    log: nullLogger(),
  } as unknown as WorldHost;
  return { host, events, usages };
}
