const { z } = require('zod');

const responseCheckSchema = z.object({
  shouldRespond: z.boolean(),
  reason: z.string().max(240),
});

const scheduledEventSchema = z.object({
  eventName: z.string().min(1).max(100),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Calendar date in YYYY-MM-DD format'),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/).describe('Local time in 24-hour HH:mm:ss format'),
  recurrence: z.enum(['once', 'daily', 'weekly', 'biweekly', 'monthly']),
  reminderMinutes: z.array(z.number().int().min(0).max(525600)).max(8),
  timezone: z.string().min(1).describe('IANA timezone, such as America/New_York'),
});

module.exports = { responseCheckSchema, scheduledEventSchema };
