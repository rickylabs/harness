/** INTERIM compatibility aliases, #270: https://github.com/rickylabs/harness/issues/270.
 * Concrete IDs come only from the versioned fleet document.
 */
import aliases from '../config/matrix-aliases.v1.json' with { type: 'json' };
import { MATRIX_AUTHORITY } from './delegation-matrix.ts';
export const ROUTING_MODEL_IDS: Readonly<Record<string, string>> = Object.freeze(Object.fromEntries(
  Object.entries(aliases).map(([alias, entry]) => [alias, MATRIX_AUTHORITY.configuration.models[entry.model]!.launches[entry.launch]!.id]),
));
