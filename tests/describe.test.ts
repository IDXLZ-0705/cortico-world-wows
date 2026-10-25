import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { WOWS } from '../src/definition.ts';

/** 与 `pnpm check:extension` 同向：包内 describe.json 须与代码自描述一致。 */
describe('describe.json', () => {
  const file = fileURLToPath(new URL('../describe.json', import.meta.url));
  const doc = JSON.parse(readFileSync(file, 'utf8')) as {
    tools: unknown[];
    events: unknown[];
    prompts: Array<{ key: string; title: string; role: string; content: string }>;
  };

  it('工具与事件和 definition.describe 一致', () => {
    expect(JSON.parse(JSON.stringify(WOWS.describe?.tools ?? []))).toEqual(doc.tools);
    expect(JSON.parse(JSON.stringify(WOWS.describe?.events ?? []))).toEqual(doc.events);
  });

  it('环境提示词正文与 ENV_PROMPT.md 一致', () => {
    const envPrompt = readFileSync(fileURLToPath(new URL('../src/ENV_PROMPT.md', import.meta.url)), 'utf8');
    expect(doc.prompts).toHaveLength(1);
    expect(doc.prompts[0].key).toBe('worlds.wows.envPrompt');
    expect(doc.prompts[0].role).toBe('envPrompt');
    expect(doc.prompts[0].content).toBe(envPrompt);
  });

  it('webUi 声明配置组与提示词文档', () => {
    const world = WOWS.create({
      id: 'wows',
      cfg: WOWS.defaults(),
      timezone: 'Asia/Shanghai',
      botName: 'test',
      botDir: '',
      packageDir: '',
      dataDir: '',
      repoRoot: '',
      secret: () => '',
      storeSecret: () => {},
      persist: () => {},
      restart: async () => {},
    });
    const ui = world.webUi?.();
    expect(ui?.config?.[0]?.id).toBe('world:wows');
    expect(ui?.promptDocs?.[0]?.key).toBe('worlds.wows.envPrompt');
    expect(ui?.promptDocs?.[0]?.title).toBe(doc.prompts[0].title);
  });
});
