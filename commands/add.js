const config = require('../config.json');
const CatLoggr = require('cat-loggr');
const users = require('../utils/users');

const log = new CatLoggr();

module.exports = {
	data: new SlashCommandBuilder()
		.setName('add')
		.setDescription('Add an account to a service.')
		.addStringOption(option =>
			option.setName('type')
				.setDescription('The type of service (free or premium)')
				.setRequired(true)
				.addChoices(
					{ name: 'Free', value: 'free' },
					{ name: 'Premium', value: 'premium' },
				))
		.addStringOption(option =>
			option.setName('service')
				.setDescription('The service to add the account to')
				.setRequired(true))
		.addStringOption(option =>
			option.setName('account')
				.setDescription('The account to add')
				.setRequired(true)),

	async execute(interaction) {
		const service = interaction.options.getString('service');
		const account = interaction.options.getString('account');
		const type = interaction.options.getString('type');

		if (!users.isAuthorized(interaction.user.id)) {
			return interaction.reply({ content: '❌ You are not authorized to use this bot.', ephemeral: true });
		}

		// Owner bypasses the Discord admin permission check; everyone else still needs MANAGE_CHANNELS.
		if (!users.isOwner(interaction.user.id) && !interaction.member.permissions.has('MANAGE_CHANNELS')) {
