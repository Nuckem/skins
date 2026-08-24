// ============================================================
// NuckemSkins — server.js
// Архитектура: GitHub Pages frontend + Render backend
// ============================================================

require("dotenv").config();

const express = require("express");
const session = require("express-session");
const axios   = require("axios");
const path    = require("path");
const fs      = require("fs");

const app = express();

app.set("trust proxy", 1);


// ============================================================
// CORS — разрешаем GitHub Pages слать cookies
// ============================================================

const ALLOWED_ORIGINS = [
    "https://nuckem.github.io"
];

app.use((req, res, next) => {

    const origin = req.headers.origin;

    if (ALLOWED_ORIGINS.includes(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
    }

    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
        return res.sendStatus(204);
    }

    next();

});


// ============================================================
// SESSION
// ============================================================

app.use(
    session({
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: {
            secure: true,
            httpOnly: true,
            sameSite: "none",
            maxAge: 1000 * 60 * 60 * 24 * 7 // 7 дней
        }
    })
);


// ============================================================
// ПОМОЩНИКИ
// ============================================================

function isLogged(req) {
    return !!(req.session && req.session.discordUser);
}

function buildAvatar(user) {
    if (user.avatar) {
        return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`;
    }

    const fallbackIndex =
        user.discriminator && user.discriminator !== "0"
            ? Number(user.discriminator) % 5
            : Number(BigInt(user.id) >> 22n) % 6;

    return `https://cdn.discordapp.com/embed/avatars/${fallbackIndex}.png`;
}


// ============================================================
// DISCORD OAUTH2
// ============================================================

const DISCORD_API    = "https://discord.com/api";
const CLIENT_ID      = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET  = process.env.DISCORD_CLIENT_SECRET;
const REDIRECT_URI   = process.env.DISCORD_REDIRECT_URI;
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;
const FRONTEND_URL   = "https://nuckem.github.io/skins";


// ============================================================
// ПРОВЕРКА КОНФИГА
// ============================================================

function checkConfig() {

    const required = [
        "SESSION_SECRET",
        "DISCORD_CLIENT_ID",
        "DISCORD_CLIENT_SECRET",
        "DISCORD_REDIRECT_URI",
        "DISCORD_GUILD_ID"
    ];

    const missing = required.filter(key => !process.env[key]);

    if (missing.length > 0) {
        console.error("ОШИБКА: отсутствуют Environment Variables:");
        missing.forEach(key => console.error(" - " + key));
        return false;
    }

    return true;

}

checkConfig();


// ============================================================
// DISCORD LOGIN
// ============================================================

app.get("/auth/discord", (req, res) => {

    if (isLogged(req)) {
        return res.redirect(FRONTEND_URL);
    }

    const params = new URLSearchParams({
        client_id:     CLIENT_ID,
        redirect_uri:  REDIRECT_URI,
        response_type: "code",
        scope:         "identify guilds"
    });

    res.redirect(`${DISCORD_API}/oauth2/authorize?${params.toString()}`);

});


// ============================================================
// DISCORD CALLBACK
// ============================================================

app.get("/auth/discord/callback", async (req, res) => {

    const code = req.query.code;

    if (!code) {
        return res.redirect(`${FRONTEND_URL}?auth=error`);
    }

    try {

        // Обмен code на access_token
        const tokenResponse = await axios.post(
            `${DISCORD_API}/oauth2/token`,
            new URLSearchParams({
                client_id:     CLIENT_ID,
                client_secret: CLIENT_SECRET,
                grant_type:    "authorization_code",
                code:          code,
                redirect_uri:  REDIRECT_URI
            }).toString(),
            { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
        );

        const accessToken = tokenResponse.data.access_token;

        if (!accessToken) {
            throw new Error("Discord не вернул access_token");
        }

        // Получаем пользователя
        const userResponse = await axios.get(`${DISCORD_API}/users/@me`, {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        const user = userResponse.data;

        if (!user || !user.id) {
            throw new Error("Не удалось получить пользователя");
        }

        // Проверяем членство в Discord сервере
        let guilds = [];

        try {
            const guildResponse = await axios.get(`${DISCORD_API}/users/@me/guilds`, {
                headers: { Authorization: `Bearer ${accessToken}` }
            });
            guilds = guildResponse.data || [];
        } catch (e) {
            console.error("Ошибка получения серверов:", e.message);
        }

        const isMember = guilds.some(g => g.id === DISCORD_GUILD_ID);

        if (!isMember) {
            return res.redirect(`${FRONTEND_URL}?auth=denied`);
        }

        // Создаём сессию
        req.session.discordUser = {
            id:          user.id,
            username:    user.username,
            global_name: user.global_name || user.username,
            avatar:      buildAvatar(user)
        };

        req.session.discordAccessToken = accessToken;
        req.session.loginTime = Date.now();

        req.session.save(err => {
            if (err) {
                console.error("Ошибка сохранения сессии:", err);
                return res.redirect(`${FRONTEND_URL}?auth=error`);
            }
            return res.redirect(FRONTEND_URL);
        });

    } catch (error) {
        console.error("OAuth error:", error.response?.data || error.message);
        return res.redirect(`${FRONTEND_URL}?auth=error`);
    }

});


// ============================================================
// AUTH/ME — проверка сессии (вызывается с GitHub Pages)
// ============================================================

app.get("/auth/me", (req, res) => {

    if (!isLogged(req)) {
        return res.json({ authenticated: false });
    }

    return res.json({
        authenticated: true,
        user: req.session.discordUser
    });

});


// ============================================================
// LOGOUT
// ============================================================

app.get("/auth/logout", (req, res) => {

    req.session.destroy(err => {
        if (err) console.error("Ошибка выхода:", err);
        res.clearCookie("connect.sid");

        // Возвращаем на GitHub Pages
        return res.redirect(FRONTEND_URL);
    });

});


// ============================================================
// API — защищённые ресурсы
// ============================================================

function requireAuth(req, res, next) {
    if (!isLogged(req)) {
        return res.status(403).json({ error: "Не авторизован" });
    }
    next();
}

// data.json
app.get("/api/data", requireAuth, (req, res) => {

    const filePath = path.join(__dirname, "data.json");

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "data.json не найден" });
    }

    res.setHeader("Content-Type", "application/json");
    res.sendFile(filePath);

});

// images
app.get("/api/images/:filename", requireAuth, (req, res) => {

    const filename = path.basename(req.params.filename);
    const filePath = path.join(__dirname, "images", filename);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "Файл не найден" });
    }

    res.sendFile(filePath);

});

// images в папках (например images/Folder/skin.png)
app.get("/api/images/:folder/:filename", requireAuth, (req, res) => {

    const folder   = path.basename(req.params.folder);
    const filename = path.basename(req.params.filename);
    const filePath = path.join(__dirname, "images", folder, filename);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "Файл не найден" });
    }

    res.sendFile(filePath);

});


// ============================================================
// ЗАПУСК СЕРВЕРА
// ============================================================

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
