/** 包入口:默认导出 `WorldDefinition`,加载器按 `cortico.kind === 'world'` 认它。 */
import { WOWS } from './definition.ts';

export default WOWS;
export { WOWS };
export type { WowsConfigSection } from './config.ts';
