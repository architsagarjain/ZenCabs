/** Node-only loader for the Jammu map (reference server + tests). */
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { RawMapData } from './jammuMap';

const DEFAULT_PATH = fileURLToPath(new URL('../../../public/maps/jammu-map.json', import.meta.url));

export async function loadMapDataFromFile(path = DEFAULT_PATH): Promise<RawMapData> {
  return JSON.parse(await readFile(path, 'utf8'));
}

export function loadMapDataSync(path = DEFAULT_PATH): RawMapData {
  return JSON.parse(readFileSync(path, 'utf8'));
}
