import { getSettings } from './settingsService';

export async function answerQuestion(
  query: string,
  paperTitle: string,
  chunks: Array<{ text: string; page: number }>,
): Promise<string | null> {
  const { llmBaseUrl, llmApiKey, llmModel } = getSettings();
  if (!llmBaseUrl.trim()) return null;

  const context = chunks
    .map((c, i) => `[${i + 1}] (page ${c.page + 1}) ${c.text}`)
    .join('\n\n');

  const base = llmBaseUrl.replace(/\/+$/, '').replace(/\/v1$/i, '');
  const r = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${llmApiKey || 'none'}`,
    },
    body: JSON.stringify({
      model: llmModel,
      temperature: 0.3,
      messages: [
        {
          role: 'system',
          content: 'You are a research assistant helping a scientist understand a paper. Answer questions based strictly on the provided passages.',
        },
        {
          role: 'user',
          content: `Question: ${query}\n\nRelevant passages from "${paperTitle}":\n\n${context}\n\nAnswer the question based only on the passages above. Be concise. If the passages don't contain enough information, say so.`,
        },
      ],
    }),
  });

  if (!r.ok) return null;
  const json = await r.json();
  return (json.choices?.[0]?.message?.content as string | undefined) ?? null;
}
