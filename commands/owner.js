const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageEmbed } = require('discord.js');
const config = require('../config.json');
const users = require('../utils/users');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('owner')
        .setDescription('Owner-only user management commands.')
        .addSubcommand(sub =>
            sub.setName('adduser')
                .setDescription('Authorize a user (free or premium).')
                .addUserOption(opt =>
                    opt.setName('user').setDescription('The user to authorize').setRequired(true))
                .addStringOption(opt =>
                    opt.setName('type').setDescription('Access type').setRequired(true)
                        .addChoices(
                            { name: 'Free', value: 'free' },
                            { name: 'Premium', value: 'premium' },
                        )))
        .addSubcommand(sub =>
            sub.setName('removeuser')
                .setDescription('Remove an authorized user.')
                .addUserOption(opt =>
                    opt.setName('user').setDescription('The user to remove').setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('listusers')
                .setDescription('List all authorized users.')),

    async execute(interaction) {
        if (!users.isOwner(interaction.user.id)) {
            const noEmbed = new MessageEmbed()
                .setColor(config.color.red)
                .setTitle('Owner only')
                .setDescription('❌ You are not the Owner of this bot.')
                .setTimestamp();
            return interaction.reply({ embeds: [noEmbed], ephemeral: true });
        }

        const sub = interaction.options.getSubcommand();

        if (sub === 'adduser') {
            const target = interaction.options.getUser('user');
            const type = interaction.options.getString('type');
            const result = users.addUser(target.id, type);
            if (!result.ok && result.reason === 'exists') {
                return interaction.reply({ content: 'User already authorized.', ephemeral: true });
            }
            const embed = new MessageEmbed()
                .setColor(config.color.green)
                .setTitle('User authorized')
                .setDescription(`✅ <@${target.id}> has been added as **${type}**.`)
                .addField('User ID', `\`${target.id}\``, true)
                .addField('Type', `\`${type}\``, true)
                .setTimestamp();
            return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        if (sub === 'removeuser') {
            const target = interaction.options.getUser('user');
            const result = users.removeUser(target.id);
            if (!result.ok) {
                return interaction.reply({ content: 'User is not authorized.', ephemeral: true });
            }
            const embed = new MessageEmbed()
                .setColor(config.color.green)
                .setTitle('User removed')
                .setDescription(`🗑️ <@${target.id}> has been removed from the authorized list.`)
                .setTimestamp();
            return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        if (sub === 'listusers') {
            const data = users.readUsers();
            if (!data.users.length) {
                const emptyEmbed = new MessageEmbed()
                    .setColor(config.color.yellow)
                    .setTitle('Authorized Users')
                    .setDescription('No users are currently authorized.')
                    .setTimestamp();
                return interaction.reply({ embeds: [emptyEmbed], ephemeral: true });
            }

            // Resolve usernames – fallback to ID if not fetchable.
            const lines = [];
            for (const u of data.users) {
                let username = `Unknown`;
                try {
                    const fetched = await interaction.client.users.fetch(u.id);
                    username = fetched ? fetched.tag : 'Unknown';
                } catch (_) { /* keep default */ }
                lines.push(
                    `**${username}** (\`${u.id}\`)\n`
                    + `• Type: \`${u.type}\`\n`
                    + `• Free Used: \`${u.freeUsed || 0}\`\n`
                    + `• Premium Used: \`${u.premiumUsed || 0}\``
                );
            }

            // Discord embed description limit ~4096 chars. Chunk if needed.
            const chunks = [];
            let current = '';
            for (const l of lines) {
                if ((current + '\n\n' + l).length > 3800) {
                    chunks.push(current);
                    current = l;
                } else {
                    current = current ? current + '\n\n' + l : l;
                }
            }
            if (current) chunks.push(current);

            const first = new MessageEmbed()
                .setColor(config.color.default)
                .setTitle(`Authorized Users (${data.users.length})`)
                .setDescription(chunks[0])
                .setTimestamp();
            await interaction.reply({ embeds: [first], ephemeral: true });
            for (let i = 1; i < chunks.length; i++) {
                const e = new MessageEmbed()
                    .setColor(config.color.default)
                    .setDescription(chunks[i]);
                await interaction.followUp({ embeds: [e], ephemeral: true });
            }
        }
    },
};
