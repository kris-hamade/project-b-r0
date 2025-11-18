const AZURE_VISION_ENDPOINT = process.env.AZURE_VISION_ENDPOINT;
const AZURE_VISION_KEY = process.env.AZURE_VISION_KEY;

async function getImageDescription(imageUrl) {
    try {
        const url = new URL(`${AZURE_VISION_ENDPOINT}/computervision/imageanalysis:analyze`);
        url.searchParams.set('visualFeatures', 'Categories');
        url.searchParams.set('details', 'Landmarks');
        url.searchParams.set('features', 'tags,objects,caption,denseCaptions,read,people');
        url.searchParams.set('model-version', 'latest');
        url.searchParams.set('language', 'en');
        url.searchParams.set('gender-neutral-caption', 'false');
        url.searchParams.set('api-version', '2023-02-01-preview');

        const response = await fetch(url.toString(), {
            method: 'POST',
            headers: {
                'Ocp-Apim-Subscription-Key': `${AZURE_VISION_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                url: imageUrl
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        //console.log("Response:", data);
        const transformedData = transformResponse(data);
        const confidenceThreshold = 0.5; // adjust as needed
        const filteredData = filterByConfidence(transformedData, confidenceThreshold);
        //console.log("Filtered data:", filteredData);
        return filteredData;

    } catch (error) {
        console.error("Error analyzing image:", error);
    }
}

function transformResponse(response) {
    const {
        captionResult,
        objectsResult,
        denseCaptionsResult,
        tagsResult,
        readResult
    } = response;

    // Extract caption details
    const caption = {
        text: captionResult.text,
        confidence: captionResult.confidence
    };

    // Extract object details
    const objects = objectsResult.values.flatMap(obj => {
        return obj.tags.map(tag => {
            return {
                name: tag.name,
                confidence: tag.confidence
            };
        });
    });

    // Extract dense captions
    const denseCaptions = denseCaptionsResult.values.map(caption => {
        return {
            text: caption.text,
            confidence: caption.confidence
        };
    });

    // Extract tags
    const tags = tagsResult.values.map(tag => {
        // Adjust the returned structure based on actual tag properties.
        return {
            name: tag.name,
            confidence: tag.confidence
        };
    });

    // Extract read result content
    const readContent = readResult && readResult.content ? readResult.content : null;

    // Construct the result
    const result = {
        caption: caption,
        objects: objects,
        denseCaptions: denseCaptions,
        tags: tags,
        readContent: readContent
    };
    console.log("Transformed data:", result);
    return result;
}

function filterByConfidence(data, threshold = 0.5) {
    // Filtering captions
    const filteredCaption = (data.caption && data.caption.confidence >= threshold) ? data.caption.text : null;

    // Filtering object tags
    const filteredObjectTags = (data.objects || []).filter(tag => tag.confidence >= threshold).map(tag => tag.name);

    // Filtering dense captions
    const filteredDenseCaptions = (data.denseCaptions || []).filter(caption => caption.confidence >= threshold).map(caption => caption.text);

    // Filtering tags
    const filteredTags = (data.tags || []).filter(tag => tag.confidence >= threshold).map(tag => tag.name);

    return {
        caption: filteredCaption,
        objects: filteredObjectTags,
        denseCaptions: filteredDenseCaptions,
        tags: filteredTags,
        readContent: data.readContent
    };
}

module.exports = {
    getImageDescription
};  