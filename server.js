const express = require("express");
const ImageKit = require("imagekit");
const cors = require("cors");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

const imagekit = new ImageKit({
  publicKey: "public_RKTEIqYwtaKo9nEtKAzR0PD3/ZE=",
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
  urlEndpoint: "https://ik.imagekit.io/nubian",
});

app.get("/auth", (req, res) => {
  try {
    const result = imagekit.getAuthenticationParameters();
    res.json(result);
  } catch (error) {
    console.error("Auth Error:", error);
    res.status(500).json({ error: "Auth generation failed" });
  }
});

app.listen(PORT, () => {
  console.log(`ImageKit auth server running on port ${PORT}`);
});
