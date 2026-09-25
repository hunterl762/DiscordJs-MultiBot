const { SlashCommandBuilder } = require('discord.js');

async function addVotes(message) {
  await message.react('👍');
  await message.react('👎');
}

module.exports = {
  name: 'poll',
  data: new SlashCommandBuilder()
    .setName('poll')
    .setDescription('Create a yes/no poll.')
    .addStringOption((option) => option.setName('question').setDescription('Poll question').setRequired(true)),
  guildOnly: true,
  async executeSlash(interaction) {
    const question = interaction.options.getString('question', true);
    const message = await interaction.reply({ content: `📊 **${question}**`, fetchReply: true });
    await addVotes(message);
  },
  async executePrefix(message, args, { settings }) {
    const question = args.join(' ').trim();
    if (!question) return message.reply(`Usage: ${settings.prefix}poll <question>`);
    const poll = await message.channel.send(`📊 **${question}**`);
    await addVotes(poll);
  },
};
