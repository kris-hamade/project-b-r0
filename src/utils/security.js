const { PermissionsBitField } = require("discord.js");

const SAFE_ALLOWED_MENTIONS = Object.freeze({ parse: [], repliedUser: false });

function sanitizeMessage(text) {
  if (typeof text !== "string") return "";
  return text
    .replace(/@everyone/gi, "@\u200beveryone")
    .replace(/@here/gi, "@\u200bhere");
}

function splitDiscordMessage(text, maxLength = 2000) {
  const chunks = [];
  let remaining = String(text || "");
  while (remaining.length > maxLength) {
    let splitAt = remaining.lastIndexOf("\n", maxLength);
    if (splitAt < Math.floor(maxLength * 0.5)) splitAt = remaining.lastIndexOf(" ", maxLength);
    if (splitAt < Math.floor(maxLength * 0.5)) splitAt = maxLength;
    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function canManageGuild(interaction) {
  return Boolean(
    interaction.guildId &&
    interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)
  );
}

async function requireGuildManager(interaction) {
  if (canManageGuild(interaction)) return true;
  const payload = { content: "You need the Manage Server permission to use this command.", ephemeral: true };
  if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
  else await interaction.reply(payload);
  return false;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = {
  SAFE_ALLOWED_MENTIONS,
  sanitizeMessage,
  splitDiscordMessage,
  canManageGuild,
  requireGuildManager,
  escapeRegex,
};
