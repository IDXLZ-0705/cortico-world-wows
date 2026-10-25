declare module 'screenshot-desktop' {
  export interface DisplayInfo {
    id: string;
    name: string;
    top: number;
    right: number;
    bottom: number;
    left: number;
    dpiScale: number;
    width: number;
    height: number;
  }

  export interface ScreenshotOptions {
    format?: 'jpg' | 'jpeg' | 'png' | 'bmp';
    filename?: string;
    /** Windows 显示器 id（如 \\.\DISPLAY1），省略时截主屏。 */
    screen?: string;
  }

  function screenshot(options?: ScreenshotOptions): Promise<Buffer>;
  namespace screenshot {
    function listDisplays(): Promise<DisplayInfo[]>;
  }
  export default screenshot;
}
