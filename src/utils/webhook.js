const WebhookSubs = require('../models/webhookSub');
const client = require('../discord/client');
const { generateWebhookReport } = require('../openai/gpt')

let subs = [];

const processedCVEsAggregator = {};
let processedCVEsFullReport = {};

async function loadWebhookSubs() {
    subs = await WebhookSubs.find({});
    console.log(`Loaded ${subs.length} Webhook Subscriptions from the database.`);
    return subs
}

async function processWebhook(data) {
    console.log("Received data:", JSON.stringify(data));

    const matchingChannelIds = [];

    // Re-fetch from the database to keep in sync
    await loadWebhookSubs();
    // Find all subscriptions that match the received webhook's origin
    const matchingSubs = subs.filter(sub => sub.origin === data.origin);

    console.log(`Processing webhook for origin: ${data.origin}`);

    for (const matchingSub of matchingSubs) {
        const channelId = matchingSub.channelId;
        matchingChannelIds.push(channelId);
    }

    if (matchingSubs.length > 0) {
        try {
            switch (data.origin) {
                case "overseer":
                    messageContent = `${data.event}\n${data.subject}\n${data.image}`;
                    await pingChannels(matchingChannelIds, messageContent);
                    break;
                case undefined:
                    console.log("Received an undefined origin.");
                    const report = await generateWebhookReport(data);
                    await sendChunkedMessages(matchingChannelIds, [report]);
                    break;
            }
        } catch (error) {
            console.error(`Error processing webhook: ${error}`);
        }
    } else {
        console.log(`No subscription found for origin: ${data.origin}`);

        if (data.origin) {
            try {
                const newSubscription = new WebhookSubs({
                    origin: data.origin,
                    channelId: 666,  // default channelId
                });

                await newSubscription.save();
                console.log(`Added a default subscription for origin: ${data.origin}`);
            } catch (error) {
                console.error(`Error saving new subscription: ${error}`);
            }
        }
    }
}

async function sendChunkedMessages(matchingChannelIds, messageContents) {
    if (typeof messageContents === 'string') {
        messageContents = [messageContents];
    }

    let chunkedMessage = '';
    for (const content of messageContents) {
        if (content.length > 2000) {
            // Split the large content into multiple pieces and send each separately
            let startIndex = 0;
            while (startIndex < content.length) {
                const subContent = content.substring(startIndex, startIndex + 2000);
                await pingChannels(matchingChannelIds, subContent);
                startIndex += 2000;
            }
        } else {
            if ((chunkedMessage.length + content.length + 1) > 2000) { // give some buffer (+1 for the newline)
                await pingChannels(matchingChannelIds, chunkedMessage.trim()); // Remove any trailing newline
                chunkedMessage = '';
            }
            chunkedMessage += content + '\n';
        }
    }

    if (chunkedMessage.trim()) {  // Remove any trailing newline
        await pingChannels(matchingChannelIds, chunkedMessage.trim());
    }
}

async function pingChannels(matchingChannelIds, message) {
    if (!message) {
        console.warn("Attempted to send an empty message. Skipping.");
        return;
    }

    for (const channelId of matchingChannelIds) {
        try {
            const channel = await client.channels.fetch(channelId);
            if (!channel) {
                console.error(`Channel with ID ${channelId} does not exist.`);
                continue;
            }
            await channel.send(message);
            console.log(`Sent a ping in channel ${channelId}: ${message}`);
        } catch (error) {
            console.error(`Error pinging everyone in channel ${channelId}: ${error}`);
        }
    }
}

module.exports = {
    loadWebhookSubs,
    processWebhook
}