const openai = require("../openai/openAi");

async function generateImage(description) {
    console.log("Description:", description);

    try {
        const response = await openai.images.generate({
            model: "gpt-image-1",
            prompt: description,
            n: 1,
            size: "1024x1024"
        });
        // Extract the URL from the response data if it exists
        const imagesArray = Array.isArray(response.data)
            ? response.data
            : (response.data.data || []);
        const imageBase64 = imagesArray.map(item => item.b64_json).filter(Boolean);
        const revisedPrompt = imagesArray[0]?.revised_prompt || description;
        console.log("Revised Prompt:", revisedPrompt);
        // Return the base64 image strings along with an indication that the operation was successful
        return {
            imageBase64,
            eta: 0
        };
    } catch (error) {
        console.error("Error generating image:", error);
        // Return an empty array for imageBase64 and an error indicator for eta
        return {
            imageBase64: [],
            eta: -1
        };
    }
}

module.exports = {
    generateImage,
};
