require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const ImageKit = require("imagekit");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json()); // ليقبل JSON data في الريكويست

// إعدادات multer لحفظ الصور بشكل مؤقت
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// إعدادات ImageKit
const imageKit = new ImageKit({
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT,
});

// راوت الرفع
app.post("/upload", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).send("No file provided");
  }

  const file = req.file;

  // رفع الصورة إلى ImageKit
  imageKit.upload(
    {
      file: file.buffer, // هنا نرسل الصورة التي تم رفعها باستخدام multer
      fileName: Date.now() + path.extname(file.originalname),
    },
    (error, result) => {
      if (error) {
        return res.status(500).send("Error uploading image: " + error);
      }
      res.send(result); // النتيجة ستتضمن رابط الصورة
    }
  );
});

// بدء السيرفر
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
