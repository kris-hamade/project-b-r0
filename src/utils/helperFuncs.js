// Helper function to capitalize the first letter of a string
function capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

async function checkAllImagesAvailability(urls) {
    // Using Promise.all to wait for all images to become available
    await Promise.all(urls.map(url => checkImageAvailability(url)));
}

async function checkImageAvailability(url, attempt = 1) {
    const MAX_RETRIES = 60;  // Maximum number of times to check for image availability
    try {
        const response = await fetch(url, { method: 'HEAD' }); // Using HEAD request to check if resource exists without downloading it

        // If successful response, resolve the promise indicating image is available
        if (response.status === 200) {
            return;  // Resolve the promise
        }
        
        // If a 404 error, it means image is not available yet, so retry
        if (response.status === 404 && attempt <= MAX_RETRIES) {
            return new Promise((resolve, reject) => {
                setTimeout(() => {
                    checkImageAvailability(url, attempt + 1).then(resolve).catch(reject);
                }, 1000);  // Check every second
            });
        }
    } catch (error) {
        // Network or other errors - retry if we haven't exceeded max retries
        if (attempt <= MAX_RETRIES) {
            return new Promise((resolve, reject) => {
                setTimeout(() => {
                    checkImageAvailability(url, attempt + 1).then(resolve).catch(reject);
                }, 1000);
            });
        }
    }

    // If reached here, either max retries exceeded or some other error occurred
    throw new Error('Failed to validate image availability for URL ' + url);
}


module.exports = {
    capitalizeFirstLetter,
    checkAllImagesAvailability
}