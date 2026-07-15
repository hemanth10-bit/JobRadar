import { getGeminiClient } from "./ai.js";

/**
 * Generates a deterministic mock embedding vector when the API is unavailable
 */
export function generateMockEmbedding(dimension = 768): number[] {
  const vector: number[] = [];
  for (let i = 0; i < dimension; i++) {
    // Generate deterministic small values based on sine to avoid database zero-vector issues
    vector.push((Math.sin(i) + 1) / 2 * 0.1);
  }
  return vector;
}

/**
 * Generates an embedding vector for the provided text using Gemini
 */
// Must match the `vector(768)` column size in supabase/migrations/01_initial_schema.sql
// (also required for pgvector's HNSW index, which caps out at 2000 dimensions —
// the gemini-embedding models default to 3072 dims unless truncated here).
const EMBEDDING_DIMENSIONS = 768;

export async function generateEmbedding(text: string): Promise<number[]> {
  const ai = getGeminiClient();

  // Truncate text if it's excessively long to fit embedding model input constraints
  const cleanedText = (text || "").substring(0, 8000).replace(/\s+/g, ' ').trim();
  const textToEmbed = cleanedText || "resume skills professional profile";
  try {
    let response: any;
    try {
      response = await ai.models.embedContent({
        model: "gemini-embedding-2-preview",
        contents: textToEmbed,
        config: { outputDimensionality: EMBEDDING_DIMENSIONS },
      }) as any;
    } catch (previewErr) {
      // NOTE: text-embedding-004 was shut down by Google — do not revert to it.
      console.warn("gemini-embedding-2-preview failed, trying gemini-embedding-001 fallback...", previewErr);
      response = await ai.models.embedContent({
        model: "gemini-embedding-001",
        contents: textToEmbed,
        config: { outputDimensionality: EMBEDDING_DIMENSIONS },
      }) as any;
    }
    if (response) {
      if (response.embedding && response.embedding.values) {
        return response.embedding.values;
      }
      if (response.embeddings && response.embeddings[0] && response.embeddings[0].values) {
        return response.embeddings[0].values;
      }
    }

    throw new Error("Invalid embedding response structure from Gemini API");
  } catch (err: any) {
    console.error("Error generating embedding, returning mock vector:", err);
    return generateMockEmbedding(768);
  }
}
