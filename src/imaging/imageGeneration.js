const axios = require('axios');
const checkAllImagesAvailability = require('../utils/helperFuncs');

async function generateImage(description) {
    console.log('Description:', description);

    try {
        const response = await axios.post('https://api.openai.com/v1/images/generations', {
            "model": "dall-e-3",
            "prompt": description,
            "n": 1,
            "size": "1024x1024"
        }, {
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
            }
        });

        console.log(response.data);

        // Extract the URL from the response data if it exists
        let imageUrls = response.data.data ? response.data.data.map(item => item.url) : [];
        console.log('Generated Image URLs:', imageUrls);

        // Return the image URLs along with an indication that the operation was successful (eta: 0)
        return { imageUrls, eta: 0 };
    } catch (error) {
        console.error("Error generating image:", error);
        // Return an empty array for imageUrls and an error indicator for eta
        return { imageUrls: [], eta: -1 };
    }
}

module.exports = {
    generateImage
}