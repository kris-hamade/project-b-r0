/**
 * Prompt builder that creates system prompts based on classifier results
 * This ensures the LLM receives appropriate context about topic and sensitivity
 */

/**
 * Build additional system prompt context based on classification results
 * This adds topic and sensitivity context to the existing persona prompt
 * @param {Object} classification - Classification result from classifier API
 * @param {string} classification.topic - Topic: "dnd" | "tech" | "gaming" | "other"
 * @param {string} classification.sensitivity - Sensitivity: "low" | "medium" | "high"
 * @param {boolean} classification.isQuestion - Whether the message is a question
 * @param {Object} [currentPersonality] - Current persona/personality object (optional, for future use)
 * @returns {string} Additional system prompt context for the LLM
 */
function buildSystemPrompt(classification, currentPersonality = null) {
  let context = "";

  // Add topic-specific context
  switch (classification.topic) {
    case "dnd":
      context += " You are highly knowledgeable about Dungeons & Dragons 5e and related tabletop RPG topics.";
      break;
    case "tech":
      context += " You are an experienced software engineer and DevOps practitioner.";
      break;
    case "gaming":
      context += " You are a gaming enthusiast familiar with modern games and terminology.";
      break;
    default:
      // "other" - no additional topic context needed
      break;
  }

  // Add sensitivity-aware instructions
  if (classification.sensitivity === "high") {
    context += " The user content may be emotionally sensitive or high-risk. Respond with empathy, avoid giving medical or legal advice, encourage seeking real-world support, and provide general supportive guidance.";
  } else if (classification.sensitivity === "medium") {
    context += " The user may be experiencing emotional difficulty. Respond with understanding and kindness.";
  }

  // Add question context if applicable
  if (classification.isQuestion) {
    context += " The user has asked a question, so provide a clear and helpful answer.";
  }

  return context.trim();
}

/**
 * Build a user prompt with optional context from recent messages
 * @param {string} messageContent - The main message content
 * @param {string[]} [recentMessages] - Optional recent messages for context
 * @returns {string} User prompt for the LLM
 */
function buildUserPrompt(messageContent, recentMessages = []) {
  if (!recentMessages || recentMessages.length === 0) {
    return messageContent;
  }

  // Include recent messages as context (limit to last 3 to avoid token bloat)
  const contextMessages = recentMessages.slice(-3);
  if (contextMessages.length > 0) {
    const context = contextMessages.join('\n');
    return `Context from recent messages:\n${context}\n\nUser message: ${messageContent}`;
  }

  return messageContent;
}

module.exports = {
  buildSystemPrompt,
  buildUserPrompt,
};

