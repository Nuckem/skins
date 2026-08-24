import express from "express";
import cookieSession from "cookie-session";
import path from "path";
import { fileURLToPath } from "url";

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 10000;

const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const REDIRECT_URI = process.env.DISCORD_REDIRECT_URI;

if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
    console.error("❌ Discord OAuth environment variables are missing!");
    console.error("Required:");
    console.error("DISCORD_CLIENT_ID");
    console.error("DISCORD_CLIENT_SECRET");
    console.error("DISCORD_REDIRECT_URI");
    process.exit(1);
}

app.set("trust proxy", 1);

app.use(
    cookieSession({
        name: "discord_session",
        keys: [process.env.SESSION_SECRET || "change-this-secret"],
        maxAge: 7 * 24 * 60 * 60 * 1000,
        httpOnly: true,
        secure: true,
        sameSite: "lax"
    })
);

/*
 * Главная страница
 */
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

/*
 * Статические файлы:
 * CSS, JS, изображения и т.д.
 */
app.use(express.static(__dirname));

/*
 * Начало Discord OAuth
 */
app.get("/auth/discord", (req, res) => {
    const params = new URLSearchParams({
        client_id: CLIENT_ID,
        response_type: "code",
        redirect_uri: REDIRECT_URI,
        scope: "identify"
    });

    res.redirect(
        `https://discord.com/oauth2/authorize?${params.toString()}`
    );
});

/*
 * Discord возвращает пользователя сюда
 */
app.get("/auth/discord/callback", async (req, res) => {
    const code = req.query.code;

    if (!code) {
        return res.status(400).send("Discord authorization code is missing.");
    }

    try {
        const tokenResponse = await fetch(
            "https://discord.com/api/oauth2/token",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded"
                },
                body: new URLSearchParams({
                    client_id: CLIENT_ID,
                    client_secret: CLIENT_SECRET,
                    grant_type: "authorization_code",
                    code,
                    redirect_uri: REDIRECT_URI
                })
            }
        );

        const tokenData = await tokenResponse.json();

        if (!tokenResponse.ok) {
            console.error("Discord token error:", tokenData);

            return res
                .status(400)
                .send("Discord authorization failed.");
        }

        const userResponse = await fetch(
            "https://discord.com/api/users/@me",
            {
                headers: {
                    Authorization: `Bearer ${tokenData.access_token}`
                }
            }
        );

        const user = await userResponse.json();

        if (!userResponse.ok) {
            console.error("Discord user error:", user);

            return res
                .status(400)
                .send("Failed to get Discord user.");
        }

        /*
         * Сохраняем Discord-пользователя в сессии.
         */
        req.session.user = {
            id: user.id,
            username: user.username,
            global_name: user.global_name,
            avatar: user.avatar
        };

        res.redirect("/");
    } catch (error) {
        console.error("OAuth error:", error);

        res
            .status(500)
            .send("Internal server error during Discord authorization.");
    }
});

/*
 * Получить текущего авторизованного пользователя
 */
app.get("/api/me", (req, res) => {
    if (!req.session?.user) {
        return res.json({
            authenticated: false
        });
    }

    res.json({
        authenticated: true,
        user: req.session.user
    });
});

/*
 * Выход
 */
app.get("/auth/logout", (req, res) => {
    req.session = null;
    res.redirect("/");
});

/*
 * Render требует 0.0.0.0:$PORT
 */
app.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ Server running on port ${PORT}`);
});
