// Добавьте этот код в ваш скрипт index.html или подключите отдельным файлом
document.addEventListener("DOMContentLoaded", async () => {
    try {
        const response = await fetch("https://skins-jr2c.onrender.com/auth/check", {
            credentials: "include"
        });
        const data = await response.json();
        
        if (!data.authenticated) {
            window.location.href = "https://skins-jr2c.onrender.com/auth/discord";
        }
    } catch (e) {
        window.location.href = "https://skins-jr2c.onrender.com/auth/discord";
    }
});
