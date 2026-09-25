require('dotenv').config();

const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { Client, GatewayIntentBits } = require('discord.js');

const app = express();
const PORT = process.env.PORT || 5000;

app.set('trust proxy', 1);
app.use(express.json());

// ============================================================
// DISCORD BOT
// ============================================================

const botClient = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers
    ]
});

botClient.once('ready', () => {
    console.log(`Бот авторизован как ${botClient.user.tag}`);

    botClient.user.setPresence({
        activities: [
            {
                name: 'Сайт со скинами',
                type: 0
            }
        ],
        status: 'invisible'
    });
});

botClient.login(process.env.BOT_TOKEN).catch((error) => {
    console.error('Ошибка авторизации Discord-бота:', error);
});

// ============================================================
// CORS
// ============================================================

const allowedOrigins = [
    'https://nuckem.github.io',
    'https://nuckem.github.io/skins'
];

app.use(cors({
    origin: function (origin, callback) {
        // Разрешаем запросы без Origin
        // (например, некоторые серверные запросы)
        if (!origin) {
            return callback(null, true);
        }

        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        }

        console.log('CORS blocked:', origin);
        return callback(new Error('Not allowed by CORS'));
    },
    credentials: true
}));

// ============================================================
// DEBUG
// ============================================================

console.log('=== OAUTH DEBUG ===');
console.log('CLIENT_ID:', process.env.CLIENT_ID ? 'OK' : 'MISSING');
console.log('CLIENT_SECRET:', process.env.CLIENT_SECRET ? 'OK' : 'MISSING');
console.log('BOT_TOKEN:', process.env.BOT_TOKEN ? 'OK' : 'MISSING');
console.log('GUILD_ID:', process.env.GUILD_ID ? 'OK' : 'MISSING');
console.log('JWT_SECRET:', process.env.JWT_SECRET ? 'OK' : 'MISSING');
console.log('BACKEND_URL:', process.env.BACKEND_URL || 'MISSING');
console.log('REDIRECT_URL:', process.env.REDIRECT_URL || 'MISSING');
console.log('FRONTEND_URL:', process.env.FRONTEND_URL || 'MISSING');
console.log('===================');

// ============================================================
// DISCORD OAUTH CONFIG
// ============================================================

const DISCORD_API = 'https://discord.com/api';

const callbackURL =
    `${process.env.BACKEND_URL}/auth/discord/callback`;

// ============================================================
// START DISCORD LOGIN
// ============================================================

app.get('/auth/discord', (req, res) => {
    const params = new URLSearchParams({
        client_id: process.env.CLIENT_ID,
        response_type: 'code',
        redirect_uri: callbackURL,
        scope: 'identify guilds'
    });

    const discordURL =
        `https://discord.com/oauth2/authorize?${params.toString()}`;

    console.log('Redirecting to Discord OAuth');

    res.redirect(discordURL);
});

// ============================================================
// DISCORD OAUTH CALLBACK
// ============================================================

app.get('/auth/discord/callback', async (req, res) => {
    console.log('========== DISCORD OAUTH ==========');
    console.log('CODE:', req.query.code ? 'RECEIVED' : 'MISSING');
    console.log('ERROR:', req.query.error || 'NONE');

    try {
        // --------------------------------------------------------
        // Проверка code
        // --------------------------------------------------------

        if (!req.query.code) {
            console.log('Discord OAuth error:', req.query.error);
            console.log('Description:', req.query.error_description);
            console.log('====================================');

            return res.redirect(
                'https://nuckem.github.io/skins/frontend/unauthorized.html'
            );
        }

        const code = req.query.code;

        // --------------------------------------------------------
        // Обмен authorization code на access token
        // --------------------------------------------------------

        const tokenParams = new URLSearchParams();

        tokenParams.append('client_id', process.env.CLIENT_ID);
        tokenParams.append('client_secret', process.env.CLIENT_SECRET);
        tokenParams.append('grant_type', 'authorization_code');
        tokenParams.append('code', code);
        tokenParams.append('redirect_uri', callbackURL);

        console.log('Requesting Discord access token...');

        const tokenResponse = await fetch(
            `${DISCORD_API}/oauth2/token`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: tokenParams.toString()
            }
        );

        const tokenText = await tokenResponse.text();

        console.log(
            'Discord token response:',
            tokenResponse.status,
            tokenText
        );

        if (!tokenResponse.ok) {
            console.log('Discord token request failed');
            console.log('Status:', tokenResponse.status);
            console.log('Response:', tokenText);
            console.log('====================================');

            return res.status(502).json({
                error: 'Discord OAuth token request failed',
                status: tokenResponse.status,
                details: tokenText
            });
        }

        let tokenData;

        try {
            tokenData = JSON.parse(tokenText);
        } catch (error) {
            console.error('Failed to parse Discord token response');

            return res.status(502).json({
                error: 'Invalid Discord token response'
            });
        }

        const accessToken = tokenData.access_token;

        if (!accessToken) {
            console.error('Discord did not return access_token');

            return res.status(502).json({
                error: 'Discord did not return access token'
            });
        }

        console.log('Access token received');

        // --------------------------------------------------------
        // Получаем Discord пользователя
        // --------------------------------------------------------

        const userResponse = await fetch(
            `${DISCORD_API}/users/@me`,
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`
                }
            }
        );

        const userText = await userResponse.text();

        console.log(
            'Discord user response:',
            userResponse.status
        );

        if (!userResponse.ok) {
            console.error('Failed to get Discord user');
            console.error(userText);

            return res.status(502).json({
                error: 'Failed to get Discord user',
                status: userResponse.status
            });
        }

        const profile = JSON.parse(userText);

        console.log(
            'Discord user:',
            profile.username,
            profile.id
        );

        // --------------------------------------------------------
        // Проверяем наличие пользователя на сервере
        // --------------------------------------------------------

        let guild;

        try {
            guild = await botClient.guilds.fetch(
                process.env.GUILD_ID
            );
        } catch (error) {
            console.error('Failed to fetch Discord guild:', error);

            return res.status(500).json({
                error: 'Failed to access Discord server'
            });
        }

        let member;

        try {
            member = await guild.members.fetch(profile.id);
        } catch (error) {
            member = null;
        }

        if (!member) {
            console.log(
                'User is not in guild:',
                profile.username,
                profile.id
            );

            console.log('====================================');

            return res.redirect(
                'https://nuckem.github.io/skins/frontend/unauthorized.html'
            );
        }

        console.log(
            'Guild member verified:',
            profile.username
        );

        // --------------------------------------------------------
        // Создаём JWT
        // --------------------------------------------------------

        const token = jwt.sign(
            {
                id: profile.id,
                username: profile.username,
                avatar: profile.avatar || null,
                discriminator: profile.discriminator || null,
                global_name: profile.global_name || null
            },
            process.env.JWT_SECRET,
            {
                expiresIn: '7d'
            }
        );

        // --------------------------------------------------------
        // Редирект на сайт
        // --------------------------------------------------------

        const frontendURL =
            process.env.REDIRECT_URL ||
            process.env.FRONTEND_URL ||
            'https://nuckem.github.io/skins';

        const redirectURL =
            `${frontendURL}/index.html?token=${encodeURIComponent(token)}`;

        console.log(
            'OAuth successful:',
            profile.username
        );

        console.log('Redirecting to:', frontendURL);
        console.log('====================================');

        return res.redirect(redirectURL);

    } catch (error) {
        console.error('========== DISCORD OAUTH ERROR ==========');
        console.error(error);
        console.error('==========================================');

        return res.status(500).json({
            error: 'Discord OAuth failed',
            message: error.message
        });
    }
});

// ============================================================
// JWT VERIFICATION
// ============================================================

const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];

    const token =
        authHeader &&
        authHeader.startsWith('Bearer ')
            ? authHeader.substring(7)
            : null;

    if (!token) {
        return res.status(401).json({
            authenticated: false
        });
    }

    jwt.verify(
        token,
        process.env.JWT_SECRET,
        (err, user) => {
            if (err) {
                return res.status(403).json({
                    authenticated: false
                });
            }

            req.user = user;
            next();
        }
    );
};

// ============================================================
// AUTH CHECK
// ============================================================

app.get('/auth/check', verifyToken, async (req, res) => {
    try {
        const guild = await botClient.guilds.fetch(
            process.env.GUILD_ID
        );

        const member = await guild.members
            .fetch(req.user.id)
            .catch(() => null);

        if (!member) {
            return res.status(403).json({
                authenticated: false,
                reason: 'removed_from_guild'
            });
        }

        return res.json({
            authenticated: true,
            user: req.user
        });

    } catch (error) {
        console.error('Auth check error:', error);

        return res.status(500).json({
            error: 'Server check error'
        });
    }
});

// ============================================================
// HEALTH CHECK
// ============================================================

app.get('/', (req, res) => {
    res.json({
        status: 'ok',
        service: 'NuckemSkins Backend'
    });
});

// ============================================================
// START SERVER
// ============================================================
fetch('https://api.ipify.org?format=json')
    .then(r => r.json())
    .then(data => console.log('OUTBOUND IP:', data.ip))
    .catch(error => console.error('IP CHECK ERROR:', error));

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
