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
  channelId
) {

  const chatHistory = await getHistory(nickname, personality, channelId);

  console.log("Generating response for prompt:", prompt); // Log the prompt
  console.log("Using persona:", persona); // Log the persona
  console.log("Using D&D Data:", dndData); // Log the D&D Data (if any)
  console.log("Using History:", chatHistory); // Log the History (if any)
  console.log("Using Image Description:", imageDescription); // Log the Image Description (if any)

  try {
    const response = await openai.chat.completions.create({
      model: model,
      messages: [
        {
          role: "system",
          content: "Make sure your response is as concise as possible"
        },
        {
          role: "system",
          content: await personaBuilder(persona),
        },
        {
          role: "system",
          content:
            "--START DUNGEONS AND DRAGONS CAMPAIGN DATA-- " +
            dndData +
            " --END DUNGEONS AND DRAGONS CAMPAIGN DATA--",
        },
        {
          role: "system",
          content: "Given the following key elements from an image: " + imageDescription + " Please provide a comprehensive description of the image.",
        },
        {
          role: "system",
          content:
            "--START CHAT HISTORY-- " + chatHistory + " --END CHAT HISTORY--",
        },
        {
          role: "user",
          content: `${nickname} says: ${prompt}`,
        },
      ],
      max_completion_tokens: getTokenLimits().chat_input_limit,
      temperature: temperature
    });

    const message = response.choices[0].message.content;
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
  generateWebhookReport
};
