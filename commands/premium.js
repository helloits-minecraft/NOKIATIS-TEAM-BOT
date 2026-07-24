const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageEmbed } = require('discord.js');
const fs = require('fs');
const config = require('../config.json');
const CatLoggr = require('cat-loggr');
const users = require('../utils/users');

const log = new CatLoggr();
const generated = new Set();

module.exports = {
    data: new SlashCommandBuilder()
        .setName('premium')
        .setDescription('Generate a specified service if stocked')
        .addStringOption(option =>
            option.setName('service')
                .setDescription('The name of the service to generate')
                .setRequired(true)),

    async execute(interaction) {
        const service = interaction.options.getString('service');
        const member = interaction.member;
        const userId = interaction.user.id;

        // Channel restriction (preserved)
        if (interaction.channelId !== config.premiumChannel) {
            const wrongChannelEmbed = new MessageEmbed()
                .setColor(config.color.red)
                .setTitle('Wrong command usage!')
                .setDescription(`You cannot use the \`/premium\` command in this channel! Try it in <#${config.premiumChannel}>!`)
                .setFooter(interaction.user.tag, interaction.user.displayAvatarURL({ dynamic: true, size: 64 }))
                .setTimestamp();
            return interaction.reply({ embeds: [wrongChannelEmbed], ephemeral: true });
        }

        // Authorization
        if (!users.isAuthorized(userId)) {
            return interaction.reply({ content: '❌ You are not authorized to use this bot.', ephemeral: true });
        }

        // Premium-only (owner bypasses)
        if (!users.isOwner(userId)) {
            const u = users.findUser(userId);
            if (!u || u.type !== 'premium') {
                return interaction.reply({ content: '❌ Premium users only.', ephemeral: true });
            }
        }

        // Limit
        const limitCheck = users.checkLimit(userId, 'premium');
        if (!limitCheck.allowed && !limitCheck.ownerBypass) {
            if (limitCheck.reason === 'premium_only') {
                return interaction.reply({ content: '❌ Premium users only.', ephemeral: true });
            }
            return interaction.reply({ content: '❌ You have reached your Premium generation limit.', ephemeral: true });
        }

        // Cooldown
        if (generated.has(member.id)) {
            const cooldownEmbed = new MessageEmbed()
                .setColor(config.color.red)
                .setTitle('Cooldown!')
                .setDescription(`Please wait **${config.premiumCooldown}** seconds before executing that command again!`)
                .setFooter(interaction.user.tag, interaction.user.displayAvatarURL({ dynamic: true, size: 64 }))
                .setTimestamp();
            return interaction.reply({ embeds: [cooldownEmbed], ephemeral: true });
        }

        const filePath = `${__dirname}/../premium/${service}.txt`;

        fs.readFile(filePath, 'utf-8', async (error, data) => {
            if (error) {
                const notFoundEmbed = new MessageEmbed()
                    .setColor(config.color.red)
                    .setTitle('Generator error!')
                    .setDescription(`Service \`${service}\` does not exist!`)
                    .setFooter(interaction.user.tag, interaction.user.displayAvatarURL({ dynamic: true, size: 64 }))
                    .setTimestamp();
                return interaction.reply({ embeds: [notFoundEmbed], ephemeral: true });
            }

            const lines = data.split(/\r?\n/);
            const nonEmpty = lines.filter(l => l.length > 0);
            if (nonEmpty.length < 1) {
                const emptyServiceEmbed = new MessageEmbed()
                    .setColor(config.color.red)
                    .setTitle('Generator error!')
                    .setDescription(`The \`${service}\` service is empty!`)
                    .setFooter(interaction.user.tag, interaction.user.displayAvatarURL({ dynamic: true, size: 64 }))
                    .setTimestamp();
                return interaction.reply({ embeds: [emptyServiceEmbed], ephemeral: true });
            }

            // Original stock removal semantics: remove the FIRST line exactly like current implementation.
            const generatedAccount = lines[0];
            lines.shift();
            const updatedData = lines.join('\n');

            fs.writeFile(filePath, updatedData, async (writeError) => {
                if (writeError) {
                    log.error(writeError);
                    return interaction.reply({ content: '❌ An error occurred while redeeming the account.', ephemeral: true });
                }

                const embedMessage = new MessageEmbed()
                    .setColor(config.color.green)
                    .setTitle('Generated Premium account')
                    .setFooter(interaction.user.tag, interaction.user.displayAvatarURL({ dynamic: true, size: 64 }))
                    .setDescription('🙏 Thank you so much for being a premium member! \n 🌟 Your support means the world to us! 💖😊')
                    .addField('Service', `\`\`\`${service[0].toUpperCase()}${service.slice(1).toLowerCase()}\`\`\``, true)
                    .addField('Account', `\`\`\`${generatedAccount}\`\`\``, true)
                    .setImage(config.banner)
                    .setTimestamp();

                try {
                    await interaction.user.send({ embeds: [embedMessage] });
                } catch (dmErr) {
                    // Restore account to top of file – DMs closed.
                    try {
                        const current = fs.readFileSync(filePath, 'utf-8');
                        const restored = generatedAccount + (current.startsWith('\n') || current.length === 0 ? '' : '\n') + current;
                        fs.writeFileSync(filePath, restored);
                    } catch (_) { /* best effort */ }
                    return interaction.reply({ content: '❌ Please enable your DMs and try again.', ephemeral: true });
                }

                // Increment usage & save
                users.incrementUsage(userId, 'premium');

                interaction.reply({ content: '✅ Check your DMs.', ephemeral: true });

                generated.add(member.id);
                setTimeout(() => generated.delete(member.id), config.premiumCooldown * 1000);
            });
        });
    },
};
