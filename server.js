require('dotenv').config();
const express = require('express');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const { Client, GatewayIntentBits } = require('discord.js');
const cors = require('cors');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 5000;

app.set('trust proxy', 1);

const botClient = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});
botClient.login(process.env.BOT_TOKEN);

app.use(express.json());

// Разрешаем запросы как с корня GitHub Pages, так и из подпапки /skins
const allowedOrigins = ['https://nuckem.github.io', 'https://nuckem.github.io/skins'];
app.use(cors({
    origin: function(origin, callback) {
        if (!origin || allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true
}));

// Сессии не нужны, инициализируем только Passport без них
app.use(passport.initialize());

passport.use(new DiscordStrategy({
    clientID: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    callbackURL: `${process.env.BACKEND_URL}/auth/discord/callback`,
    scope: ['identify', 'guilds']
}, async (accessToken, refreshToken, profile, done) => {
    try {
        const guild = await botClient.guilds.fetch(process.env.GUILD_ID);
        const member = await guild.members.fetch(profile.id).catch(() => null);
        
        if (!member) {
            return done(null, false, { message: 'Not in guild' });
        }
        return done(null, profile);
    } catch (error) {
        return done(error, null);
    }
}));

// Запуск авторизации (session: false)
app.get('/auth/discord', passport.authenticate('discord', { session: false }));

// Callback: генерируем JWT (включая аватар и ник) и отправляем на фронтенд
app.get('/auth/discord/callback', 
    passport.authenticate('discord', { 
        session: false, 
        failureRedirect: `https://nuckem.github.io/skins/frontend/unauthorized.html` 
    }),
    (req, res) => {
        const token = jwt.sign(
            { 
                id: req.user.id, 
                username: req.user.username,
                avatar: req.user.avatar,
                discriminator: req.user.discriminator,
                global_name: req.user.global_name
            }, 
            process.env.JWT_SECRET, 
            { expiresIn: '7d' }
        );

        res.redirect(`${process.env.REDIRECT_URL || process.env.FRONTEND_URL}/index.html?token=${token}`);
    }
);

// Middleware для проверки JWT
const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ authenticated: false });

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ authenticated: false });
        req.user = user;
        next();
    });
};

app.get('/auth/check', verifyToken, async (req, res) => {
    try {
        const guild = await botClient.guilds.fetch(process.env.GUILD_ID);
        const member = await guild.members.fetch(req.user.id).catch(() => null);

        if (!member) {
            return res.status(403).json({ authenticated: false, reason: 'removed_from_guild' });
        }

        res.json({ authenticated: true, user: req.user });
    } catch (err) {
        res.status(500).json({ error: 'Server check error' });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
