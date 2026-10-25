/** 截屏封装：screenshot-desktop 在 Windows 上走系统自带组件，产出 JPEG 字节。 */
import { Jimp } from 'jimp';
import screenshot from 'screenshot-desktop';

export interface CapturedFrame {
  bytes: Buffer;
  mime: 'image/jpeg';
}

/** 截一帧当前画面；screen 为显示器 id，省略截主屏。 */
export async function captureScreen(screen?: string): Promise<CapturedFrame> {
  const bytes = await screenshot(screen ? { format: 'jpeg', screen } : { format: 'jpeg' });
  return { bytes, mime: 'image/jpeg' };
}

/** 等比缩放到最大宽度，节省视觉模型 token；原帧已小于等于该宽度时原样返回。 */
export async function resizeToMaxWidth(frame: CapturedFrame, maxWidth: number): Promise<CapturedFrame> {
  if (maxWidth <= 0 || !frame.bytes) return frame;
  const image = await Jimp.fromBuffer(frame.bytes);
  if (image.bitmap.width <= maxWidth) return frame;
  image.scaleToFit({ w: maxWidth, h: image.bitmap.height });
  const bytes = await image.getBuffer('image/jpeg');
  return { bytes, mime: 'image/jpeg' };
}

export interface ScreenInfo {
  id: string;
  width: number;
  height: number;
}

/** 列出系统显示器，供配置参考。 */
export async function listScreens(): Promise<ScreenInfo[]> {
  const displays = await screenshot.listDisplays();
  return displays.map((d) => ({ id: d.id, width: d.width, height: d.height }));
}
