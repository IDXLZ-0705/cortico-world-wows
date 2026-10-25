import { describe, expect, it } from 'vitest';
import { Jimp } from 'jimp';
import { diffRatio, MotionSentinel } from '../src/sentinel.ts';

async function solidPng(color: number, size = 64): Promise<Buffer> {
  const image = new Jimp({ width: size, height: size, color });
  return image.getBuffer('image/png');
}

/** 左上四分之一改成另一颜色。 */
async function quarterChangedPng(size = 64): Promise<Buffer> {
  const image = new Jimp({ width: size, height: size, color: 0x000000ff });
  for (let y = 0; y < size / 2; y += 1) {
    for (let x = 0; x < size / 2; x += 1) {
      image.setPixelColor(0xffffffff, x, y);
    }
  }
  return image.getBuffer('image/png');
}

describe('diffRatio', () => {
  it('完全相同为 0，全不同为 1', () => {
    const a = new Uint8Array(400).fill(0);
    const b = new Uint8Array(400).fill(0);
    expect(diffRatio(a, b)).toBe(0);
    expect(diffRatio(a, new Uint8Array(400).fill(255))).toBe(1);
  });

  it('长度不等视为全变', () => {
    expect(diffRatio(new Uint8Array(4), new Uint8Array(8))).toBe(1);
  });
});

describe('MotionSentinel', () => {
  it('首帧返回 0', async () => {
    const sentinel = new MotionSentinel();
    expect(await sentinel.ingest(await solidPng(0x000000ff))).toBe(0);
  });

  it('相同画面变化为 0，四分之一画面变白约 0.25', async () => {
    const sentinel = new MotionSentinel();
    await sentinel.ingest(await solidPng(0x000000ff));
    expect(await sentinel.ingest(await solidPng(0x000000ff))).toBe(0);
    const ratio = await sentinel.ingest(await quarterChangedPng());
    expect(ratio).toBeGreaterThan(0.2);
    expect(ratio).toBeLessThan(0.35);
  });

  it('reset 后下一帧重新计为 0', async () => {
    const sentinel = new MotionSentinel();
    await sentinel.ingest(await solidPng(0x000000ff));
    sentinel.reset();
    expect(await sentinel.ingest(await solidPng(0xffffffff))).toBe(0);
  });
});
