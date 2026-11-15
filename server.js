const express = require("express");
const app = express();

app.get("/", (req, res) => {
  res.send("Discord OAuth2 Panel çalışıyor!");
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Sunucu çalışıyor.");
});
