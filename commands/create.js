const config = require('../config.json');
const CatLoggr = require('cat-loggr');
const users = require('../utils/users');

const log = new CatLoggr();

module.exports = {
	data: new SlashCommandBuilder()
		.setName('create')
		.setDescription('Create a new service.')
		.addStringOption(option =>
			option.setName('service')
				.setDescription('The name of the service to create')
				.setRequired(true)
		)
		.addStringOption(option =>
			option.setName('type')
				.setDescription('The type of service (free or premium)')
				.setRequired(true)
				.addChoices(
					{ name: 'Free', value: 'free' },
					{ name: 'Premium', value: 'premium' },
				)),

	async execute(interaction) {
		const service = interaction.options.getString('service');
		const type = interaction.options.getString('type');

		if (!users.isAuthorized(interaction.user.id)) {
			return interaction.reply({ content: '❌ You are not authorized to use this bot.', ephemeral: true });
		}

		if (!users.isOwner(interaction.user.id) && !interaction.member.permissions.has('MANAGE_CHANNELS')) {
