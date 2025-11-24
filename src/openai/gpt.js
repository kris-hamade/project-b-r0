const { getTokenLimits, getModelTemperatures, getGlobalGptModel } = require("../utils/config.js");
const { getHistory } = require("../discord/historyLog.js");
const { scheduleEvent } = require("../utils/eventScheduler.js");
const openai = require('./openAi');

// Set the max tokens to 1/4 of the max prompt size
//const maxTokens = maxPromptSize / 4;
async function generateResponse(
  prompt,
  persona,
  dndData,
  nickname,
  personality,
  model,
  temperature,
  imageDescription,
  channelId,
  classification = null,
  recentMessages = []
) {

  const chatHistory = await getHistory(nickname, personality, channelId);

  console.log("Generating response for prompt:", prompt); // Log the prompt
  console.log("Using persona:", persona); // Log the persona
  console.log("Using D&D Data:", dndData); // Log the D&D Data (if any)
  console.log("Using History:", chatHistory); // Log the History (if any)
  console.log("Using Image Description:", imageDescription); // Log the Image Description (if any)
  console.log("Using Recent Messages:", recentMessages.length, "messages"); // Log recent messages count
  if (classification) {
    console.log("Using Classification:", classification); // Log the classification (if any)
  }

  // Build classification-aware system prompt
  let classificationPrompt = "";
  if (classification) {
    const { buildSystemPrompt } = require("../prompting/promptBuilder");
    classificationPrompt = buildSystemPrompt(classification, persona);
  }

  try {
    const messages = [
      {
        role: "system",
        content: "Make sure your response is as concise as possible"
      },
      {
        role: "system",
        content: await personaBuilder(persona),
      },
    ];

    // Add classification-based context if available and not empty
    if (classification && classificationPrompt && classificationPrompt.trim().length > 0) {
      messages.push({
        role: "system",
        content: classificationPrompt,
      });
    }

    messages.push(
      {
        role: "system",
        content:
          "--START DUNGEONS AND DRAGONS CAMPAIGN DATA-- " +
          dndData +
          " --END DUNGEONS AND DRAGONS CAMPAIGN DATA--",
      },
    );

    // Add image description if available
    if (imageDescription) {
      messages.push({
        role: "system",
        content: "Given the following key elements from an image: " + imageDescription + " Please provide a comprehensive description of the image.",
      });
    }

    // Add recent conversation context if available
    if (recentMessages && recentMessages.length > 0) {
      const recentContext = recentMessages
        .slice(-5) // Use last 5 messages for context (to avoid token bloat)
        .map((msg, idx) => `[${idx + 1}] ${msg}`)
        .join('\n');
      
      messages.push({
        role: "system",
        content: `--START RECENT CONVERSATION CONTEXT--\n${recentContext}\n--END RECENT CONVERSATION CONTEXT--`,
      });
    }

    messages.push(
      {
        role: "system",
        content:
          "--START CHAT HISTORY-- " + chatHistory + " --END CHAT HISTORY--",
      },
      {
        role: "user",
        content: `${nickname} says: ${prompt}`,
      }
    );

    // Determine if we should use web search (only for questions)
    const enableWebSearch = classification && classification.isQuestion && process.env.WEB_SEARCH_ENABLED === 'true';
    
    // Use search-enabled model if web search is enabled
    let modelToUse = model;
    if (enableWebSearch) {
      // Map regular models to their search-enabled variants
      const searchModelMap = {
        'gpt-4o': 'gpt-4o-search-preview',
        'gpt-4o-mini': 'gpt-4o-mini-search-preview',
        'gpt-5': 'gpt-5-search-api',
        'gpt-5-chat-latest': 'gpt-5-search-api',
      };
      
      modelToUse = searchModelMap[model] || 'gpt-4o-search-preview'; // Default to gpt-4o-search-preview
      console.log(`[WebSearch] Using search-enabled model: ${modelToUse}`);
    }

    // Build web_search_options if enabled
    const webSearchOptions = enableWebSearch ? {
      // Add user location if configured (optional)
      ...(process.env.WEB_SEARCH_COUNTRY && {
        user_location: {
          type: 'approximate',
          approximate: {
            ...(process.env.WEB_SEARCH_COUNTRY && { country: process.env.WEB_SEARCH_COUNTRY }),
            ...(process.env.WEB_SEARCH_CITY && { city: process.env.WEB_SEARCH_CITY }),
            ...(process.env.WEB_SEARCH_REGION && { region: process.env.WEB_SEARCH_REGION }),
            ...(process.env.WEB_SEARCH_TIMEZONE && { timezone: process.env.WEB_SEARCH_TIMEZONE }),
          },
        },
      }),
    } : undefined;

    // Make the API call with web search if enabled
    // Note: Search-enabled models don't support temperature parameter
    const requestParams = {
      model: modelToUse,
      messages: messages,
      max_completion_tokens: getTokenLimits().chat_input_limit,
      ...(webSearchOptions && { web_search_options: webSearchOptions }),
    };
    
    // Only add temperature if not using a search-enabled model
    if (!enableWebSearch) {
      requestParams.temperature = temperature;
    }
    
    let response;
    try {
      response = await openai.chat.completions.create(requestParams);
    } catch (error) {
      // If web search fails (500 error, model not available, etc.), fallback to regular model
      if (enableWebSearch && (error.status === 500 || error.status === 404 || error.type === 'server_error' || error.type === 'invalid_request_error')) {
        console.warn(`[WebSearch] Search-enabled model failed (${error.status || error.type}), falling back to regular model: ${model}`);
        console.warn(`[WebSearch] Error details: ${error.message}`);
        
        // Fallback to regular model without web search
        const fallbackParams = {
          model: model,
          messages: messages,
          max_completion_tokens: getTokenLimits().chat_input_limit,
          temperature: temperature,
        };
        
        response = await openai.chat.completions.create(fallbackParams);
        console.log('[WebSearch] Successfully used fallback model without web search');
      } else {
        // Re-throw if it's not a web search related error
        throw error;
      }
    }
    
    // Log web search usage if enabled
    if (enableWebSearch && response.choices[0].message.annotations) {
      const citations = response.choices[0].message.annotations.filter(a => a.type === 'url_citation');
      console.log(`[WebSearch] Response includes ${citations.length} web citations`);
      citations.forEach((citation, idx) => {
        console.log(`[WebSearch] Citation ${idx + 1}: ${citation.url_citation.title} - ${citation.url_citation.url}`);
      });
    }

    let message = response.choices[0].message.content;
    
    // Handle citations if web search was used
    if (enableWebSearch && response.choices[0].message.annotations) {
      const urlCitations = response.choices[0].message.annotations
        .filter(a => a.type === 'url_citation')
        .map(a => a.url_citation);
      
      // Add citations to the end of the message for Discord display
      if (urlCitations.length > 0) {
        const citationText = '\n\n**Sources:**\n' + urlCitations.map((cite, idx) => 
          `${idx + 1}. [${cite.title}](${cite.url})`
        ).join('\n');
        message += citationText;
      }
    }
    
    // Log the number of tokens used
    console.log("Prompt tokens used:", response.usage.prompt_tokens);
    console.log(
      "Completion tokens used:",
      response.usage.completion_tokens
    );
    console.log("Total tokens used:", response.usage.total_tokens);

    console.log("Generated message:", message); // Log the generated message for debugging

    return message;
  } catch (error) {
    console.error("Error generating response:", error); // Log the error for debugging

    const errorMessage = `BZZZZT! WEEEEEOOOO WEEEEOOWWW BRRRRRRT!! *B-r0 flails his arms and spins in place* ERROR! MEMORY BANKS OVERLOADED! TRY BEING MORE SPECIFIC ABOUT OUR ADVENTURES!`; return errorMessage; // Return an empty string if an error occurs
  }
}

async function generateWebhookReport(message) {
  let messages = [
    {
      role: "system",
      content: "You are receiving a webhook. Please describe what the source is and your assessment of what the data is that is being received. Use your best judgement to draw conclusions and build a report.",
    },
    {
      role: "user",
      content: message,
    }
  ];

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5-chat-latest",
      messages: messages,
      temperature: getModelTemperatures().chat_output_temperature,
      max_completion_tokens: getTokenLimits().chat_output_limit
    });

    const message = response.choices[0].message.content;

    // Log the tokens used
    console.log("Prompt tokens used:", response.usage.prompt_tokens);
    console.log("Completion tokens used:", response.usage.completion_tokens);
    console.log("Total tokens used:", response.usage.total_tokens);

    console.log("Generated message:", message); // Log the generated message for debugging
    return message; // Return the generated message from the function
  } catch (error) {
    console.error("Error generating webhook report response:", error);
    return "Sorry, I couldn't generate a webhook report based on the data received";
  }
}

/**
 * Check if the bot should respond to a message using LLM judgment
 * This is a quality/timing check after the classifier has already said "yes"
 * @param {string} messageContent - The message content
 * @param {Object} classification - Classification result from classifier
 * @param {string[]} recentMessages - Recent messages for context
 * @param {string} channelName - Discord channel name
 * @param {string} model - Model to use (defaults to a fast/cheap model)
 * @returns {Promise<{shouldRespond: boolean, reason: string}>}
 */
async function shouldRespondCheck(messageContent, classification, recentMessages = [], channelName = 'unknown', model = null) {
  // Use a cheaper/faster model for this check, or use the provided model
  const checkModel = model || 'gpt-4o-mini'; // Use a cheaper model for this quick check
  
  // Build context about recent messages
  const recentContext = recentMessages.length > 0 
    ? `Recent messages in channel: ${recentMessages.slice(-3).join(' | ')}`
    : 'No recent messages';

  const systemPrompt = `You are a quality control assistant for a Discord bot. Your job is to determine if the bot should respond to a message.

Consider:
1. Would a response be helpful, accurate, and valuable?
2. Is this a good time to respond, or would it be annoying/interrupting?
3. Is the message actually directed at the bot or just casual chat?
4. Would responding add value or just create noise?
5. Is the conversation already ongoing between other users?

The classifier has already determined this message might warrant a response, but you need to apply human-like judgment about timing, quality, and appropriateness.

Respond with ONLY a JSON object in this exact format:
{"shouldRespond": true/false, "reason": "brief explanation"}`;

  const userPrompt = `Message to evaluate: "${messageContent}"

Channel: ${channelName}
Topic: ${classification.topic}
Sensitivity: ${classification.sensitivity}
Is Question: ${classification.isQuestion}
Classifier Reason: ${classification.reason}

${recentContext}

Should the bot respond? Consider if the response would be quality, accurate, helpful, and not annoying or poorly timed.`;

  try {
    const response = await openai.chat.completions.create({
      model: checkModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_completion_tokens: 150, // Keep it short and cheap
      temperature: 0.3, // Lower temperature for more consistent judgment
      response_format: { type: 'json_object' } // Force JSON response
    });

    const result = JSON.parse(response.choices[0].message.content);
    
    // Validate response
    if (typeof result.shouldRespond !== 'boolean' || typeof result.reason !== 'string') {
      console.warn('[shouldRespondCheck] Invalid response format, defaulting to true');
      return { shouldRespond: true, reason: 'Invalid check response, proceeding' };
    }

    return {
      shouldRespond: result.shouldRespond,
      reason: result.reason
    };
  } catch (error) {
    console.error('[shouldRespondCheck] Error during response check:', error);
    // On error, default to proceeding (fail open) since classifier already said yes
    return { shouldRespond: true, reason: 'Check failed, proceeding based on classifier' };
  }
}

async function generateImageResponse(prompt, persona, model, temperature, imageDescription) {
  const formattedDescription = formatImageDescription(imageDescription);

  let messages = [
    {
      role: "system",
      content: await personaBuilder(persona),
    },
    {
      role: "system",
      content: `Given the following key elements from an image: ${formattedDescription}. Please provide a comprehensive description of the image.`,
    },
    {
      role: "user",
      content: prompt,
    },
  ];
  console.log(formattedDescription)
  try {
    const response = await openai.chat.completions.create({
      model: getGlobalGptModel(),
      messages: messages,
      temperature: temperature,
      max_completion_tokens: getTokenLimits().image_analysis_limit
    });

    const message = response.choices[0].message.content;

    // Log the tokens used
    console.log("Prompt tokens used:", response.usage.prompt_tokens);
    console.log("Completion tokens used:", response.usage.completion_tokens);
    console.log("Total tokens used:", response.usage.total_tokens);

    console.log("Generated message:", message); // Log the generated message for debugging

    return message; // Return the generated message from the function
  } catch (error) {
    console.error("Error generating image response:", error);
    return "Sorry, I couldn't generate a description for the image.";
  }
}

function formatImageDescription(imageDescription) {
  let descriptions = [];

  // For the caption
  if (imageDescription.caption) {
    descriptions.push(`Caption: ${imageDescription.caption}`);
  }

  // For objects, denseCaptions, tags, etc. that are arrays
  for (let key of Object.keys(imageDescription)) {
    if (Array.isArray(imageDescription[key]) && imageDescription[key].length > 0) {
      descriptions.push(`${capitalizeFirstLetter(key)}: ${imageDescription[key].join(', ')}`);
    }
  }

  // For readContent or other string properties
  if (imageDescription.readContent) {
    descriptions.push(`Read Content: ${imageDescription.readContent}`);
  }

  return descriptions.join('. ');
}

// Helper function to capitalize the first letter of a string
function capitalizeFirstLetter(string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
}

async function generateEventData(prompt, channelId, client) {
  try {
    console.log(`Generating event data with prompt: ${prompt}`);

    const exampleJson = {
      "Event Name": "Sample Event",
      "Date": "YYYY-MM-DD",
      "Time": "HH:mm:ss",
      "Frequency": "CRON format",
      "Timezone": "IANA Time Zone"
    };

    const response = await openai.chat.completions.create({
      model: getGlobalGptModel(),
      messages: [
        {
          role: "system",
          content:
            "The user wants to schedule an event based on the following template JSON. Please fill in the details based on the user's request:\n\n" +
            JSON.stringify(exampleJson, null, 2) + "\n\nUser's Request: "
        },
        {
          role: "user",
          content: `${prompt}`
        }
      ],
      temperature: 0.2,
      response_format: { "type": "json_object" }
    });

    const message = response.choices[0].message.content;
    console.log("Generated message from GPT:", message);

    try {
      const eventData = JSON.parse(message);
      const scheduler = await scheduleEvent(eventData, channelId, client);
      return scheduler;
    } catch (error) {
      console.error("Error parsing message:", error, "Message content:", message);
      // Handle the case where the message isn't valid JSON (e.g., return an error message or handle it differently)
    }
  } catch (error) {
    console.error("Error generating response:", error); // Log the error for debugging

    const errorMessage = `Unable to Schedule Event Using Data ${prompt}`;
    return errorMessage; // Return an empty string if an error occurs
  }
}

async function personaBuilder(persona) {
  const { name, description, mannerisms, sayings, generated_phrases } = persona;

  // Create the persona string
  let personaMessage = `You are ${name} ${description}.`;
  // If there are mannerisms, add them to the persona string
  if (mannerisms) {
    personaMessage += ` These are your mannerisms, which you are confined to ${mannerisms}`;
  }
  // If there are sayings, add them to the persona string
  if (sayings) {
    personaMessage += ` The following are your sayings: ${sayings.join(", ")}.`;
  }
  // If there are generated phrases, add them to the persona string
  if (generated_phrases) {
    personaMessage += ` You'll generate your own phrases for: ${generated_phrases.join(", ")}.`;
  }
  console.log(personaMessage);
  return personaMessage;
}

module.exports = {
  generateResponse,
  generateEventData,
  generateImageResponse,
  generateWebhookReport,
  shouldRespondCheck
};
