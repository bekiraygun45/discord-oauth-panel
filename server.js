
const express = require("express");
const session = require("express-session");
const crypto = require("crypto");

const app = express();

app.set("trust proxy", 1);

app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === "production",
        httpOnly: true,
        sameSite: "lax",
        maxAge: 24 * 60 * 60 * 1000
    }
}));

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;
const BOT_PERMISSIONS = process.env.BOT_PERMISSIONS || "0";

function escapeHTML(text) {
    return String(text).replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
    })[char]);
}

function requireLogin(req, res, next) {
    if (!req.session.user) {
        return res.redirect("/");
    }
    next();
}

app.get("/", (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="tr">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>1709 | Discord Bot</title>
        <style>
            * { box-sizing: border-box; }
            body {
                margin: 0;
                background: #0b0d14;
                color: white;
                font-family: Arial, sans-serif;
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
                text-align: center;
            }
            .panel {
                width: 90%;
                max-width: 600px;
                padding: 55px 30px;
                background: #151824;
                border: 1px solid #292d40;
                border-radius: 20px;
            }
            h1 { font-size: 42px; margin-bottom: 12px; }
            p { color: #a4a9bb; line-height: 1.7; }
            a {
                display: inline-block;
                margin-top: 25px;
                padding: 15px 30px;
                background: #5865f2;
                color: white;
                text-decoration: none;
                border-radius: 9px;
                font-weight: bold;
            }
            a:hover { background: #4752c4; }
        </style>
    </head>
    <body>
        <div class="panel">
            <h1>1709</h1>
            <p>Yeni nesil Discord bot yönetim paneline hoş geldin.</p>
            <p>Sunucunu yönetmek ve botumuzu eklemek için Discord hesabınla giriş yap.</p>
            <a href="/login">Discord ile Giriş Yap</a>
        </div>
    </body>
    </html>
    `);
});

app.get("/login", (req, res) => {
    if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
        return res.status(500).send("Discord OAuth2 ayarları eksik.");
    }

    const state = crypto.randomBytes(24).toString("hex");
    req.session.oauthState = state;

    const params = new URLSearchParams({
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        response_type: "code",
        scope: "identify guilds",
        state: state
    });

    res.redirect(
        "https://discord.com/oauth2/authorize?" + params.toString()
    );
});

app.get("/auth/callback", async (req, res) => {
    try {
        const { code, state } = req.query;

        if (!code || !state || state !== req.session.oauthState) {
            return res.status(400).send("Geçersiz OAuth2 isteği.");
        }

        delete req.session.oauthState;

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
                    code: code,
                    redirect_uri: REDIRECT_URI
                })
            }
        );

        const tokenData = await tokenResponse.json();

        if (!tokenResponse.ok || !tokenData.access_token) {
            return res.status(400).send("Discord giriş doğrulaması başarısız.");
        }

        const headers = {
            Authorization: `Bearer ${tokenData.access_token}`
        };

        const [userResponse, guildResponse] = await Promise.all([
            fetch("https://discord.com/api/users/@me", { headers }),
            fetch("https://discord.com/api/users/@me/guilds", { headers })
        ]);

        if (!userResponse.ok || !guildResponse.ok) {
            return res.status(400).send("Discord kullanıcı bilgileri alınamadı.");
        }

        const user = await userResponse.json();
        const guilds = await guildResponse.json();

        req.session.user = {
            id: user.id,
            username: user.username
        };

        req.session.guilds = guilds.filter(guild => {
            const permissions = BigInt(guild.permissions || "0");

            return guild.owner ||
                (permissions & 0x8n) === 0x8n ||
                (permissions & 0x20n) === 0x20n;
        });

        res.redirect("/dashboard");

    } catch (error) {
        console.error(error);
        res.status(500).send("Bir hata oluştu.");
    }
});

app.get("/dashboard", requireLogin, (req, res) => {
    const guilds = req.session.guilds || [];

    const cards = guilds.map(guild => {
        const inviteURL = new URL(
            "https://discord.com/oauth2/authorize"
        );

        inviteURL.search = new URLSearchParams({
            client_id: CLIENT_ID,
            scope: "bot applications.commands",
            permissions: BOT_PERMISSIONS,
            guild_id: guild.id,
            disable_guild_select: "true"
        }).toString();

        return `
            <div class="guild">
                <h3>${escapeHTML(guild.name)}</h3>
                <a href="${escapeHTML(inviteURL.toString())}">
                    Botu Sunucuna Ekle
                </a>
            </div>
        `;
    }).join("");

    res.send(`
    <!DOCTYPE html>
    <html lang="tr">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>1709 | Dashboard</title>
        <style>
            body {
                margin: 0;
                padding: 35px;
                background: #0b0d14;
                color: white;
                font-family: Arial, sans-serif;
            }
            .container { max-width: 900px; margin: auto; }
            .guild {
                background: #171a27;
                border: 1px solid #292d40;
                padding: 22px;
                margin: 15px 0;
                border-radius: 12px;
            }
            a {
                display: inline-block;
                background: #5865f2;
                color: white;
                padding: 12px 18px;
                text-decoration: none;
                border-radius: 8px;
            }
            .logout { background: #363b50; }
            p { color: #a4a9bb; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>1709 Dashboard</h1>
            <p>Hoş geldin, ${escapeHTML(req.session.user.username)}</p>
            <h2>Yönetebildiğin sunucular</h2>
            ${cards || "<p>Yönetebildiğin bir sunucu bulunamadı.</p>"}
            <a class="logout" href="/logout">Çıkış Yap</a>
        </div>
    </body>
    </html>
    `);
});

app.get("/logout", (req, res) => {
    req.session.destroy(() => {
        res.redirect("/");
    });
});

app.listen(process.env.PORT || 3000, () => {
    console.log("1709 OAuth2 Panel çalışıyor.");
});
