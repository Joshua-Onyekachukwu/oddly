/**
 * ODDLY NVIDIA AI Module
 * 
 * Exports:
 * - Client: getNVIDIAClient, ChatMessage, ChatCompletion
 * - Prompts: SYSTEM_PROMPTS, buildChatMessages, buildPredictionPrompt
 * - Engine: generatePredictionsForFixture, generateTodayPredictions, generateCrownJewel
 */

// Client
export { getNVIDIAClient } from "./client";
export type { ChatMessage, ChatCompletion, ModelEndpoint } from "./client";

// Prompts
export { SYSTEM_PROMPTS, buildChatMessages, buildPredictionPrompt } from "./prompts";

// Prediction Engine
export {
  generatePredictionsForFixture,
  generateTodayPredictions,
  generateCrownJewel,
} from "./prediction-engine";
