require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const { Client, GatewayIntentBits } = require('discord.js');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 5000;

app.set('trust proxy', 1);

const botClient = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});
botClient.login(process.env.BOT_TOKEN);

app.use(express.json());
app.use(cookieParser());
app.use(cors({
    origin: process.env.FRONTEND_URL,
    credentials: true
}));

app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: true,
        sameSite: 'none'
        path: '/'
    }
}));

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

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

app.get('/auth/discord', passport.authenticate('discord'));

app.get('/auth/discord/callback', 
    passport.authenticate('discord', { failureRedirect: `${process.env.FRONTEND_URL}/unauthorized.html` }),
    (req, res) => {
        res.redirect(`${process.env.FRONTEND_URL}/index.html`);
    }
);

app.get('/auth/check', async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
        return res.status(401).json({ authenticated: false });
    }

    try {
        const guild = await botClient.guilds.fetch(process.env.GUILD_ID);
        const member = await guild.members.fetch(req.user.id).catch(() => null);

        if (!member) {
            req.logout(() => {});
            return res.status(403).json({ authenticated: false, reason: 'removed_from_guild' });
        }

        res.json({ authenticated: true, user: req.user });
    } catch (err) {
        res.status(500).json({ error: 'Server check error' });
    }
});

app.get('/auth/logout', (req, res) => {
    req.logout(() => {
        res.redirect(`${process.env.FRONTEND_URL}/index.html`);
    });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
