import { searchWorldRegions } from '../shared/mapFeatures';
self.onmessage = (event: MessageEvent<{ query: string; locale: string; known: string[] }>) => {
  const { query, locale, known } = event.data;
  self.postMessage(searchWorldRegions(query, locale, known));
};
