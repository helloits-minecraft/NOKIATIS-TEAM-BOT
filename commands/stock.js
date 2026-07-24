const fs = require('fs').promises;
const config = require('../config.json');
const users = require('../utils/users');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('stock')
		.setDescription('Display the service stock.'),

	async execute(interaction) {
		if (!users.isAuthorized(interaction.user.id)) {
			return interaction.reply({ content: '❌ You are not authorized to use this bot.', ephemeral: true });
		}
		const freeStock = await getStock(`${__dirname}/../free/`);
