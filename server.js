// ============================================================
// NuckemSkins — server.js
// ============================================================

require("dotenv").config();

const express = require("express");
const session = require("express-session");
const axios = require("axios");
const path = require("path");

const app = express();

app.set("trust proxy", 1);

app.use(
    session({
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: {
            secure: process.env.NODE_ENV === "production",
            httpOnly: true,
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

    // Дефолтная аватарка Discord, если своей нет
    const fallbackIndex =
        user.discriminator && user.discriminator !== "0"
            ? Number(user.discriminator) % 5
            : Number(BigInt(user.id) >> 22n) % 6;

    return `https://cdn.discordapp.com/embed/avatars/${fallbackIndex}.png`;
}


// ============================================================
// DISCORD OAUTH2
// ============================================================

const DISCORD_API = "https://discord.com/api";

const CLIENT_ID =
    process.env.DISCORD_CLIENT_ID;

const CLIENT_SECRET =
    process.env.DISCORD_CLIENT_SECRET;

const REDIRECT_URI =
    process.env.DISCORD_REDIRECT_URI;

const DISCORD_GUILD_ID =
    process.env.DISCORD_GUILD_ID;


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

    const missing = required.filter(
        key => !process.env[key]
    );

    if (missing.length > 0) {

        console.error(
            "=========================================="
        );

        console.error(
            "ОШИБКА: отсутствуют Environment Variables:"
        );

        missing.forEach(key => {
            console.error(" - " + key);
        });

        console.error(
            "=========================================="
        );

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

        return res.redirect("/");

    }

    const params =
        new URLSearchParams({

            client_id: CLIENT_ID,

            redirect_uri: REDIRECT_URI,

            response_type: "code",

            scope: "identify guilds"

        });

    const discordURL =
        `${DISCORD_API}/oauth2/authorize?${params.toString()}`;

    res.redirect(discordURL);

});


// ============================================================
// DISCORD CALLBACK
// ============================================================

app.get("/auth/discord/callback", async (req, res) => {

    const code =
        req.query.code;

    if (!code) {

        return res.status(400).send(`
            <!DOCTYPE html>
            <html lang="ru">
            <head>
                <meta charset="UTF-8">
                <title>Ошибка авторизации</title>
                <style>
                    body {
                        margin: 0;
                        min-height: 100vh;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        background: #0f172a;
                        color: #e5e7eb;
                        font-family: Arial, sans-serif;
                        text-align: center;
                    }

                    .box {
                        padding: 40px;
                    }

                    h1 {
                        color: #ef4444;
                    }
                </style>
            </head>

            <body>
                <div class="box">
                    <h1>Ошибка авторизации</h1>
                    <p>Discord не вернул код авторизации.</p>
                    <a href="/" style="color:#60a5fa;">
                        Вернуться на сайт
                    </a>
                </div>
            </body>
            </html>
        `);

    }

    try {

        // ----------------------------------------------------
        // ОБМЕН CODE НА ACCESS TOKEN
        // ----------------------------------------------------

        const tokenResponse =
            await axios.post(

                `${DISCORD_API}/oauth2/token`,

                new URLSearchParams({

                    client_id:
                        CLIENT_ID,

                    client_secret:
                        CLIENT_SECRET,

                    grant_type:
                        "authorization_code",

                    code:
                        code,

                    redirect_uri:
                        REDIRECT_URI

                }).toString(),

                {

                    headers: {
                        "Content-Type":
                            "application/x-www-form-urlencoded"
                    }

                }

            );


        const accessToken =
            tokenResponse.data.access_token;


        if (!accessToken) {

            throw new Error(
                "Discord не вернул access_token"
            );

        }


        // ----------------------------------------------------
        // ПОЛУЧАЕМ ПОЛЬЗОВАТЕЛЯ DISCORD
        // ----------------------------------------------------

        const userResponse =
            await axios.get(

                `${DISCORD_API}/users/@me`,

                {

                    headers: {
                        Authorization:
                            `Bearer ${accessToken}`
                    }

                }

            );


        const user =
            userResponse.data;


        if (!user || !user.id) {

            throw new Error(
                "Не удалось получить Discord пользователя"
            );

        }


        // ----------------------------------------------------
        // ПРОВЕРЯЕМ DISCORD SERVER
        // ----------------------------------------------------

        let guilds = [];

        try {

            const guildResponse =
                await axios.get(

                    `${DISCORD_API}/users/@me/guilds`,

                    {

                        headers: {
                            Authorization:
                                `Bearer ${accessToken}`
                        }

                    }

                );

            guilds =
                guildResponse.data || [];

        } catch (guildError) {

            console.error(
                "Ошибка получения Discord серверов:",
                guildError.response?.data ||
                guildError.message
            );

            guilds = [];

        }


        const isMember =
            guilds.some(
                guild =>
                    guild.id ===
                    DISCORD_GUILD_ID
            );


        // ----------------------------------------------------
        // ЕСЛИ ПОЛЬЗОВАТЕЛЬ НЕ НА СЕРВЕРЕ
        // ----------------------------------------------------

        if (!isMember) {

            return res.status(403).send(`
                <!DOCTYPE html>

                <html lang="ru">

                <head>

                    <meta charset="UTF-8">

                    <meta
                        name="viewport"
                        content="width=device-width, initial-scale=1.0"
                    >

                    <title>Доступ запрещён</title>

                    <style>

                        * {
                            box-sizing: border-box;
                        }

                        body {

                            margin: 0;

                            min-height: 100vh;

                            display: flex;

                            align-items: center;

                            justify-content: center;

                            background:
                                radial-gradient(
                                    circle at 50% 0%,
                                    rgba(59,130,246,.12),
                                    transparent 45%
                                ),
                                #0f172a;

                            color: #e5e7eb;

                            font-family:
                                "Segoe UI",
                                Arial,
                                sans-serif;

                            text-align: center;

                        }

                        .box {

                            width: min(
                                90%,
                                500px
                            );

                            padding: 45px 30px;

                            background:
                                rgba(
                                    17,
                                    24,
                                    39,
                                    .9
                                );

                            border:
                                1px solid
                                rgba(
                                    255,
                                    255,
                                    255,
                                    .07
                                );

                            border-radius: 18px;

                            box-shadow:
                                0 20px 50px
                                rgba(0,0,0,.5);

                        }

                        h1 {

                            margin:
                                0 0 12px;

                            font-size: 26px;

                        }

                        p {

                            margin:
                                0 0 25px;

                            color:
                                #94a3b8;

                            line-height: 1.6;

                        }

                        a {

                            display: inline-block;

                            padding:
                                11px 18px;

                            border-radius: 10px;

                            background:
                                #3b82f6;

                            color: white;

                            text-decoration: none;

                            font-weight: 700;

                        }

                        a:hover {

                            background:
                                #2563eb;

                        }

                    </style>

                </head>

                <body>

                    <div class="box">

                        <h1>
                            Доступ запрещён
                        </h1>

                        <p>
                            Для доступа к NuckemSkins
                            необходимо состоять
                            на нашем Discord-сервере.
                        </p>

                        <a href="/">
                            Вернуться
                        </a>

                    </div>

                </body>

                </html>
            `);

        }


        // ----------------------------------------------------
        // СОЗДАЁМ СЕССИЮ
        // ----------------------------------------------------

        req.session.discordUser = {

            id:
                user.id,

            username:
                user.username,

            global_name:
                user.global_name ||
                user.username,

            avatar:
                buildAvatar(user),

            discriminator:
                user.discriminator,

            avatar_hash:
                user.avatar

        };


        // ----------------------------------------------------
        // СОХРАНЯЕМ ACCESS TOKEN
        // ----------------------------------------------------
        //
        // Он понадобится серверу для повторной проверки
        // пользователя при необходимости.
        //
        // В браузер он НИКОГДА не отправляется.
        //

        req.session.discordAccessToken =
            accessToken;


        // ----------------------------------------------------
        // СОХРАНЯЕМ ВРЕМЯ АВТОРИЗАЦИИ
        // ----------------------------------------------------

        req.session.loginTime =
            Date.now();


        // ----------------------------------------------------
        // СОХРАНЯЕМ СЕССИЮ
        // ----------------------------------------------------

        req.session.save(
            err => {

                if (err) {

                    console.error(
                        "Ошибка сохранения сессии:",
                        err
                    );

                    return res.status(500).send(
                        "Ошибка сохранения авторизации."
                    );

                }

                return res.redirect("/");

            }
        );


    } catch (error) {

        console.error(
            "Discord OAuth error:",
            error.response?.data ||
            error.message ||
            error
        );


        return res.status(500).send(`
            <!DOCTYPE html>

            <html lang="ru">

            <head>

                <meta charset="UTF-8">

                <title>Ошибка</title>

                <style>

                    body {

                        margin: 0;

                        min-height: 100vh;

                        display: flex;

                        align-items: center;

                        justify-content: center;

                        background: #0f172a;

                        color: #e5e7eb;

                        font-family: Arial, sans-serif;

                        text-align: center;

                    }

                    .box {

                        max-width: 500px;

                        padding: 40px;

                    }

                    h1 {

                        color: #ef4444;

                    }

                    a {

                        color: #60a5fa;

                    }

                </style>

            </head>

            <body>

                <div class="box">

                    <h1>
                        Ошибка Discord
                    </h1>

                    <p>
                        Не удалось выполнить авторизацию.
                    </p>

                    <a href="/">
                        Вернуться на сайт
                    </a>

                </div>

            </body>

            </html>
        `);

    }

});


// ============================================================
// ТЕКУЩИЙ ПОЛЬЗОВАТЕЛЬ
// ============================================================

app.get("/auth/me", (req, res) => {

    if (!isLogged(req)) {

        return res.json({

            authenticated:
                false

        });

    }


    return res.json({

        authenticated:
            true,

        user:
            req.session.discordUser

    });

});


// ============================================================
// LOGOUT
// ============================================================

app.get("/auth/logout", (req, res) => {

    req.session.destroy(
        err => {

            if (err) {

                console.error(
                    "Ошибка выхода:",
                    err
                );

            }

            res.clearCookie(
                "connect.sid"
            );

            return res.redirect("/");

        }
    );

});


// ============================================================
// LOGIN PAGE
// ============================================================

app.get("/login", (req, res) => {

    if (isLogged(req)) {

        return res.redirect("/");

    }

    res.send(`
        <!DOCTYPE html>

        <html lang="ru">

        <head>

            <meta charset="UTF-8">

            <meta
                name="viewport"
                content="width=device-width, initial-scale=1.0"
            >

            <title>Авторизация — NuckemSkins</title>

            <style>

                * {
                    box-sizing: border-box;
                }

                body {

                    margin: 0;

                    min-height: 100vh;

                    display: flex;

                    align-items: center;

                    justify-content: center;

                    background:
                        radial-gradient(
                            circle at 20% 0%,
                            rgba(59,130,246,.12),
                            transparent 40%
                        ),
                        radial-gradient(
                            circle at 80% 10%,
                            rgba(96,165,250,.08),
                            transparent 35%
                        ),
                        #0f172a;

                    color: #e5e7eb;

                    font-family:
                        "Segoe UI",
                        Arial,
                        sans-serif;

                }

                .auth-box {

                    width: min(
                        90%,
                        460px
                    );

                    padding:
                        50px 35px;

                    text-align: center;

                    background:
                        linear-gradient(
                            180deg,
                            #111827,
                            #0d1420
                        );

                    border:
                        1px solid
                        rgba(
                            255,
                            255,
                            255,
                            .06
                        );

                    border-radius:
                        18px;

                    box-shadow:
                        0 20px 60px
                        rgba(
                            0,
                            0,
                            0,
                            .55
                        );

                }

                h1 {

                    margin:
                        0 0 12px;

                    font-size:
                        28px;

                    letter-spacing:
                        2px;

                }

                p {

                    margin:
                        0 0 28px;

                    color:
                        #94a3b8;

                    line-height:
                        1.6;

                }

                .discord-button {

                    display:
                        inline-flex;

                    align-items:
                        center;

                    justify-content:
                        center;

                    gap:
                        9px;

                    width:
                        100%;

                    padding:
                        13px 18px;

                    border-radius:
                        11px;

                    background:
                        #5865f2;

                    color:
                        #fff;

                    font-size:
                        14px;

                    font-weight:
                        700;

                    text-decoration:
                        none;

                    transition:
                        .15s ease;

                }

                .discord-button:hover {

                    background:
                        #4752c4;

                    transform:
                        translateY(-1px);

                }

            </style>

        </head>

        <body>

            <div class="auth-box">

                <h1>
                    АВТОРИЗАЦИЯ
                </h1>

                <p>
                    Для просмотра скинов
                    необходимо привязать
                    Discord-аккаунт.
                </p>

                <a
                    class="discord-button"
                    href="/auth/discord"
                >
                    Привязать Discord
                </a>

            </div>

        </body>

        </html>
    `);

});


// ============================================================
// СТАТИКА (images/, data.json, favicon.png и т.д.)
// ============================================================
//
// index.html сюда НЕ включается — им управляет отдельный route
// ниже, с проверкой авторизации на сервере.
//

app.use(
    express.static(__dirname, {
        index: false
    })
);


// ============================================================
// ГЛАВНАЯ СТРАНИЦА (защищена)
// ============================================================

app.get("/", (req, res) => {

    if (!isLogged(req)) {
        return res.redirect("/login");
    }

    return res.sendFile(path.join(__dirname, "index.html"));

});


// ============================================================
// ЗАПУСК СЕРВЕРА
// ============================================================

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
