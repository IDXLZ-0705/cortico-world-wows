import { afterEach, describe, expect, it, vi } from 'vitest';
import { observeBattleImage, parseObservation } from '../src/vision.ts';

describe('parseObservation', () => {
  it('解析严格 JSON', () => {
    const o = parseObservation('{"inBattle":true,"phase":"中期","kills":2,"score":"3:4","playerHpPct":65,"spotted":3,"facts":["我舰起火"],"summary":"打得正酣"}');
    expect(o).toMatchObject({ inBattle: true, phase: '中期', kills: 2, score: '3:4', playerHpPct: 65, spotted: 3, facts: ['我舰起火'] });
  });

  it('容忍代码围栏', () => {
    const o = parseObservation('```json\n{"inBattle":false,"phase":"港口","summary":"在港口"}\n```');
    expect(o.inBattle).toBe(false);
    expect(o.kills).toBeNull();
    expect(o.facts).toEqual([]);
  });

  it('字段缺失给默认值，不猜数值', () => {
    const o = parseObservation('{"inBattle":true}');
    expect(o.phase).toBe('未知');
    expect(o.playerHpPct).toBeNull();
  });

  it('血量百分比超范围（误读绝对血量如 35000）给 null', () => {
    const o = parseObservation('{"inBattle":true,"playerHpPct":35000}');
    expect(o.playerHpPct).toBeNull();
    expect(parseObservation('{"inBattle":true,"playerHpPct":100}').playerHpPct).toBe(100);
  });

  it('非 JSON 抛错', () => {
    expect(() => parseObservation('我看不懂这张图')).toThrow();
  });
});

describe('observeBattleImage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('POST 到 OpenAI 兼容端点并解析 JSON 与用量', async () => {
    const fetchMock = vi.fn(async (_url: unknown, init?: { body?: string }) => {
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe('qwen-vl-flash');
      expect(body.messages[1].content[1].image_url.url).toMatch(/^data:image\/jpeg;base64,/);
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"inBattle":true,"phase":"开局","summary":"战斗开始"}' } }],
          usage: { prompt_tokens: 1200, completion_tokens: 60 },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await observeBattleImage(
      { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/', apiKey: 'sk-x', model: 'qwen-vl-flash' },
      { bytes: new Uint8Array([1, 2, 3]), mime: 'image/jpeg' },
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result.observation.inBattle).toBe(true);
    expect(result.usage).toEqual({ promptTokens: 1200, completionTokens: 60 });
  });

  it('HTTP 非 2xx 抛错带状态码', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('invalid api key', { status: 401 })));
    await expect(
      observeBattleImage(
        { baseUrl: 'https://example.com/v1', apiKey: 'bad', model: 'qwen-vl-flash' },
        { bytes: new Uint8Array([1]), mime: 'image/jpeg' },
      ),
    ).rejects.toThrow('401');
  });
});
