const schedule = require('node-schedule');
const moment = require('moment-timezone');
const ScheduledEvent = require('../models/scheduledEvent');
const cronstrue = require('cronstrue');

// Dictionary to hold jobs by an ID
const jobs = {};

async function loadJobsFromDatabase(client) {
    try {
        const events = await ScheduledEvent.find({}).catch(err => {
            throw new Error(`Failed to load events: ${err}`);
        });
        console.log(`Loaded ${events.length} events from the database.`);
        const now = moment();

        for (const event of events) {
            try {
                const { eventName, time, frequency, timezone } = event;
                const date = time.split('T')[0];
                const timePart = time.split('T')[1];
                const eventTime = moment.tz(`${date}T${timePart}`, "YYYY-MM-DDTHH:mm:ss", timezone);

                if (eventTime.isBefore(now)) {
                    console.log(`Removing expired event: ${eventName}`);
                    await ScheduledEvent.deleteOne({ _id: event._id }).catch(err => {
                        throw new Error(`Failed to delete expired event: ${err}`);
                    });
                    continue;
                }

                await scheduleEvent(event, event.channelId, client, false);
            } catch (err) {
                console.error(`Error processing event ${event.eventName}: ${err}`);
            }
        }
    } catch (err) {
        console.error(`Error loading jobs from database: ${err}`);
    }
}

async function pingEveryone(channelId, messageContent, eventTime, frequency, client) {
    try {
        const channel = await client.channels.fetch(channelId);
        const now = moment();
        const duration = moment.duration(eventTime.diff(now));
        const timeRemaining = [
            duration.years() > 0 ? duration.years() + ' years' : null,
            duration.days() > 0 ? duration.days() + ' days' : null,
            duration.hours() > 0 ? duration.hours() + ' hours' : null,
            duration.minutes() > 0 ? duration.minutes() + ' minutes' : null,
        ].filter(Boolean).join(', ');
        const humanReadableFrequency = frequency ? cronstrue.toString(frequency) : null;
        const fullMessage = `@everyone ${messageContent} (Time Remaining: ${timeRemaining}${humanReadableFrequency ? `, Frequency: ${humanReadableFrequency}` : ''})`;
        console.log(`Pinging everyone in channel ${channelId}: ${fullMessage}`);
        await channel.send({ content: fullMessage, flags: require('discord.js').MessageFlags.SuppressEmbeds });
    } catch (error) {
        console.error(`Error pinging everyone in channel ${channelId}: ${error}`);
    }
}

async function scheduleEvent(eventData, channelId, client, saveToDatabase = true) {
    try {
        if (!eventData || !channelId || !client) {
            throw new Error('Invalid data provided for scheduling the event.');
        }

        const eventName = eventData['Event Name'] || eventData.eventName;
        const date = eventData.Date || eventData.time.split('T')[0];
        const timePart = eventData.Time || eventData.time.split('T')[1];
        const frequency = eventData.Frequency || eventData.frequency;
        const timezone = eventData.Timezone || eventData.timezone;

        if (!eventName || !date || !timePart || !frequency || !timezone) {
            throw new Error('Missing required fields in eventData:', eventData);
        }

        const eventTime = moment.tz(`${date}T${timePart}`, "YYYY-MM-DDTHH:mm:ss", timezone);
        if (!eventTime.isValid()) {
            throw new Error('Invalid date or time provided.');
        }

        const formattedTimezone = eventTime.format('z');
        const formattedTime = eventTime.format(`MMMM D, YYYY [at] h:mm A [${formattedTimezone || timezone}]`);
        if (saveToDatabase) {
            await pingEveryone(channelId, `Scheduling event: ${eventName} on ${formattedTime}`, eventTime, frequency, client);
        }

        const reminderJob = schedule.scheduleJob(frequency, async () => {
            await pingEveryone(channelId, `Reminder for event: ${eventName} on ${formattedTime}`, eventTime, frequency, client);
        });

        if (!reminderJob) {
            throw new Error('Failed to schedule the reminder job.');
        }

        const jobId = getJobId(eventName, date, timePart);
        jobs[jobId] = reminderJob;

        schedule.scheduleJob(eventTime.toDate(), async () => {
            console.log(`Cancelling reminders for event: ${eventName}`);
            cancelJob(jobId);
            await ScheduledEvent.deleteOne({ eventName: eventName });
        });

        if (saveToDatabase) {
            const newEvent = new ScheduledEvent({
                eventName,
                channelId,
                frequency,
                time: `${date}T${timePart}`,
                timezone
            });
            await newEvent.save();
        }

        console.log(`Scheduled recurring reminder for event: ${eventName}`);
        return eventName;
    } catch (error) {
        console.error(`Error scheduling event: ${error}`);
    }
}

function cancelJob(jobId) {
    const job = jobs[jobId];
    if (job) {
        job.cancel();
        delete jobs[jobId];
    } else {
        console.error(`Job with ID ${jobId} not found.`);
    }
}

async function deleteEvent(eventName) {
    try {
        const event = await ScheduledEvent.findOne({ eventName: { $regex: new RegExp(`^${eventName}$`, 'i') } });
        if (event) {
            const date = event.time.split('T')[0];
            const timePart = event.time.split('T')[1];
            const jobId = getJobId(eventName, date, timePart);
            cancelJob(jobId);
            console.log(`Deleted event: ${jobId}`);
            await event.deleteOne();
            console.log(`Deleted event from database: ${eventName}`);
            return true;
        } else {
            return false;
        }
    } catch (error) {
        console.error(`Error deleting event: ${error}`);
        throw error;
    }
}

function getJobId(eventName, date, timePart) {
    return `${eventName}-${date}-${timePart}`.toLowerCase();
}

module.exports = {
    scheduleEvent,
    loadJobsFromDatabase,
    cancelJob,
    deleteEvent
};
