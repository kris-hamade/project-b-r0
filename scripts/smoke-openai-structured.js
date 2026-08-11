require('dotenv').config({ quiet: true });
const { getWorkloadConfig } = require('../src/openai/modelRouting');
const { responseCheckSchema, scheduledEventSchema } = require('../src/openai/schemas');
const { parseStructuredResponse } = require('../src/openai/structuredOutput');
const { extractEventData } = require('../src/openai/gpt');

async function main() {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required');
  const result = await parseStructuredResponse({
    name: 'scheduled_event_smoke_test',
    schema: scheduledEventSchema,
    ...getWorkloadConfig('scheduling'),
    maxOutputTokens: 500,
    input: [
      { role: 'developer', content: 'Extract one scheduling event. Today is 2026-08-06. Use America/New_York unless stated. Convert reminders to minutes.' },
      { role: 'user', content: 'Schedule game night every two weeks starting August 20, 2026 at 7:30 PM. Remind me one day and one hour before.' },
    ],
  });

  if (result.recurrence !== 'biweekly') throw new Error(`Expected biweekly recurrence, received ${result.recurrence}`);

  const decision = await parseStructuredResponse({
    name: 'response_decision_smoke_test',
    schema: responseCheckSchema,
    ...getWorkloadConfig('responseCheck'),
    maxOutputTokens: 160,
    input: 'Decide whether a Discord assistant should answer this direct question: “B-r0, can you help me schedule game night?”',
  });
  if (!decision.shouldRespond) throw new Error('Expected the direct response-check prompt to be accepted');

  const naturalEvent = await extractEventData(
    'Schedule Session 37: Wolf\'s Last Ride Pt. 3 for Thursday, August 13 at 8:30 PM CDT and remind us daily at 5 PM CDT.',
    { creatorId: 'smoke-test-user', timezone: 'America/Chicago' },
  );
  if (naturalEvent.eventName !== "Session 37: Wolf's Last Ride Pt. 3") throw new Error('Natural event name was not preserved');
  if (naturalEvent.date !== '2026-08-13' || naturalEvent.time !== '20:30:00') throw new Error('Natural event date/time was not resolved');
  if (naturalEvent.reminderSchedule?.time !== '17:00' || naturalEvent.reminderSchedule?.timezone !== 'America/Chicago') {
    throw new Error('Daily reminder schedule was not resolved');
  }

  console.log(`Structured OpenAI smoke tests passed with ${getWorkloadConfig('scheduling').model}.`);
}

main().catch(error => {
  console.error(`Structured scheduling smoke test failed: ${error.message}`);
  process.exitCode = 1;
});
