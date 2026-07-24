const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageEmbed, MessageActionRow, MessageButton } = require('discord.js');
const fs = require('fs');
const config = require('../config.json');
const CatLoggr = require('cat-loggr');
const users = require('../utils/users');
const linkvertise = require('../utils/linkvertise');

const log = new CatLoggr();
const generated = new Set();

// In-memory store of pending verification sessions.
// Key: `${userId}:${service}` -> { hash, service, filePath, createdAt }
const pending = new Map();

// Expose the map on module.exports so the button handler in index.js can read/write it.
function _key(userId, service) { return `${userId}:${service}`; }

module.exports = {
    data: new SlashCommandBuilder()
        .setName('free')
        .setDescription('Generate a specified service if stocked')
        .addStringOption(option =>
            option.setName('service')
                .setDescription('The name of the service to generate')
                .setRequired(true)),

    // Exposed for interactionCreate button handler (see index.js).
    _pending: pending,
    _key,

    async execute(interaction) {
        const service = interaction.options.getString('service');
        const member = interaction.member;
        const userId = interaction.user.id;

        // Channel restriction (preserved from original behavior)
        if (interaction.channelId !== config.genChannel) {
            const wrongChannelEmbed = new MessageEmbed()
                .setColor(config.color.red)
                .setTitle('Wrong command usage!')
                .setDescription(`You cannot use the \`/free\` command in this channel! Try it in <#${config.genChannel}>!`)
                .setFooter(interaction.user.tag, interaction.user.displayAvatarURL({ dynamic: true, size: 64 }))
                .setTimestamp();
            return interaction.reply({ embeds: [wrongChannelEmbed], ephemeral: true });
        }

        // Authorization
        if (!users.isAuthorized(userId)) {
            return interaction.reply({ content: '❌ You are not authorized to use this bot.', ephemeral: true });
        }

        // Generation limit (owner bypasses)
        const limitCheck = users.checkLimit(userId, 'free');
        if (!limitCheck.allowed) {
            if (limitCheck.reason === 'not_authorized') {
                return interaction.reply({ content: '❌ You are not authorized to use this bot.', ephemeral: true });
            }
            return interaction.reply({ content: '❌ You have reached your Free generation limit.', ephemeral: true });
        }

        // Cooldown
        if (generated.has(member.id)) {
            const cooldownEmbed = new MessageEmbed()
                .setColor(config.color.red)
                .setTitle('Cooldown!')
                .setDescription(`Please wait **${config.genCooldown}** seconds before executing that command again!`)
                .setFooter(interaction.user.tag, interaction.user.displayAvatarURL({ dynamic: true, size: 64 }))
                .setTimestamp();
            return interaction.reply({ embeds: [cooldownEmbed], ephemeral: true });
        }

        // Validate service file exists & non-empty before wasting a Linkvertise link
        const filePath = `${__dirname}/../free/${service}.txt`;
        let fileData;
        try {
            fileData = fs.readFileSync(filePath, 'utf-8');
        } catch (e) {
            const notFoundEmbed = new MessageEmbed()
                .setColor(config.color.red)
                .setTitle('Generator error!')
                .setDescription(`Service \`${service}\` does not exist!`)
                .setFooter(interaction.user.tag, interaction.user.displayAvatarURL({ dynamic: true, size: 64 }))
                .setTimestamp();
            return interaction.reply({ embeds: [notFoundEmbed], ephemeral: true });
        }
        const lines = fileData.split(/\r?\n/).filter(l => l.length > 0);
        if (lines.length < 1) {
            const emptyServiceEmbed = new MessageEmbed()
                .setColor(config.color.red)
                .setTitle('Generator error!')
                .setDescription(`The \`${service}\` service is empty!`)
                .setFooter(interaction.user.tag, interaction.user.displayAvatarURL({ dynamic: true, size: 64 }))
                .setTimestamp();
            return interaction.reply({ embeds: [emptyServiceEmbed], ephemeral: true });
        }

        // Generate the Linkvertise link
        let link;
        try {
            link = linkvertise.generateLink(userId);
        } catch (err) {
            return interaction.reply({
                content: `❌ Linkvertise error: ${err.message}`,
                ephemeral: true,
            });
        }

        // Store pending session (no account revealed yet).
        pending.set(_key(userId, service), {
            hash: link.hash,
            service,
            filePath,
            createdAt: Date.now(),
        });

        // Auto-expire pending session after 30 min to keep memory clean.
        setTimeout(() => pending.delete(_key(userId, service)), 30 * 60 * 1000);

        const linkEmbed = new MessageEmbed()
            .setColor(config.color.yellow)
            .setTitle('Complete Linkvertise to receive your account')
            .setDescription(
                `To generate a **free** \`${service}\` account you must first complete the Linkvertise link below.\n\n`
                + `🔗 **[Click here to complete Linkvertise](${link.url})**\n\n`
                + `Once you have completed **all** Linkvertise steps, press the **✅ Verify** button below.\n`
                + `The account will only be delivered after successful verification.`
            )
            .setFooter(interaction.user.tag, interaction.user.displayAvatarURL({ dynamic: true, size: 64 }))
            .setTimestamp();

        const row = new MessageActionRow().addComponents(
            new MessageButton()
                .setCustomId(`lv_verify:${userId}:${service}`)
                .setLabel('✅ Verify')
                .setStyle('SUCCESS'),
            new MessageButton()
                .setURL(link.url)
                .setLabel('🔗 Open Linkvertise')
                .setStyle('LINK'),
        );

        return interaction.reply({ embeds: [linkEmbed], components: [row], ephemeral: true });
    },

    // Called from interactionCreate button handler in index.js.
    async handleVerify(interaction, userId, service) {
        if (interaction.user.id !== userId) {
            return interaction.reply({ content: '❌ This verification is not for you.', ephemeral: true });
        }
        const session = pending.get(_key(userId, service));
        if (!session) {
            return interaction.reply({
                content: '❌ No pending verification found. Please run `/free` again.',
                ephemeral: true,
            });
        }

        // Re-check limit at verification time (protect against limit-race).
        const limitCheck = users.checkLimit(userId, 'free');
        if (!limitCheck.allowed && !limitCheck.ownerBypass) {
            pending.delete(_key(userId, service));
            if (limitCheck.reason === 'not_authorized') {
                return interaction.reply({ content: '❌ You are not authorized to use this bot.', ephemeral: true });
            }
            return interaction.reply({ content: '❌ You have reached your Free generation limit.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        // Verify with Linkvertise anti-bypass API.
        const ok = await linkvertise.verifyCompletion(session.hash);
        if (!ok) {
            return interaction.editReply({
                content: '❌ Verification failed. You must fully complete the Linkvertise link before pressing Verify.',
            });
        }

        // Verified. Now do the delivery:
        // 1) read file, 2) pop first line, 3) DM account, 4) increment usage.
        let data;
        try {
            data = fs.readFileSync(session.filePath, 'utf-8');
        } catch (e) {
            pending.delete(_key(userId, service));
            return interaction.editReply({ content: `❌ Service \`${service}\` no longer exists.` });
        }
        const lines = data.split(/\r?\n/);
        // Skip leading empty lines but keep original behavior of removing lines[0]
        while (lines.length > 0 && lines[0].length === 0) lines.shift();
        if (lines.length < 1) {
            pending.delete(_key(userId, service));
            return interaction.editReply({ content: `❌ The \`${service}\` service is empty.` });
        }
        const generatedAccount = lines[0];
        lines.shift();
        const updatedData = lines.join('\n');

        try {
            fs.writeFileSync(session.filePath, updatedData);
        } catch (writeError) {
            log.error(writeError);
            return interaction.editReply({ content: '❌ An error occurred while redeeming the account.' });
        }

        // Try DM first – do NOT reveal account in public.
        const embedMessage = new MessageEmbed()
            .setColor(config.color.green)
            .setTitle('Generated Free account')
            .addField('Service', `\`\`\`${service[0].toUpperCase()}${service.slice(1).toLowerCase()}\`\`\``, true)
            .addField('Account', `\`\`\`${generatedAccount}\`\`\``, true)
            .setImage(config.banner)
            .setTimestamp();

        try {
            await interaction.user.send({ embeds: [embedMessage] });
        } catch (dmErr) {
            // DM failed. Restore the account to the top of the file so nothing is lost.
            try {
                const current = fs.readFileSync(session.filePath, 'utf-8');
                const restored = generatedAccount + (current.startsWith('\n') || current.length === 0 ? '' : '\n') + current;
                fs.writeFileSync(session.filePath, restored);
            } catch (_) { /* best effort */ }
            return interaction.editReply({ content: '❌ Please enable your DMs and try again.' });
        }

        // Increment usage & save users.json (owner is bypassed inside).
        users.incrementUsage(userId, 'free');

        // Apply cooldown
        generated.add(userId);
        setTimeout(() => generated.delete(userId), config.genCooldown * 1000);

        // Clean up pending session
        pending.delete(_key(userId, service));

        return interaction.editReply({ content: '✅ Check your DMs.' });
    },
};
