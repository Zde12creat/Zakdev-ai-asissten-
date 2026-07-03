import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_KEY,
});

// Health Check
app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    status: "online",
    message: "Zakdev AI Backend Running 🚀",
  });
});

// Chat Endpoint
app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message || message.trim() === "") {
      return res.status(400).json({
        success: false,
        error: "Message wajib diisi.",
      });
    }

    const prompt = `
Kamu adalah AI Customer Service Zakdev.

Informasi Zakdev:
- Jasa pembuatan website profesional.
- Landing Page.
- Company Profile.
- Website UMKM.
- Toko Online.
- Dashboard Admin.
- Integrasi AI Assistant.
- Optimasi SEO.
- Maintenance Website.

Aturan:
- Jawab singkat, jelas, dan profesional.
- Gunakan bahasa yang sama dengan pengguna.
- Jika pertanyaan di luar layanan Zakdev, tetap bantu sebisa mungkin.
- Jika tidak mengetahui informasi tertentu, sarankan pengguna menghubungi admin.

Pertanyaan pelanggan:
${message}
`;

    const result = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    res.status(200).json({
      success: true,
      reply: result.text,
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      error: error.message || "Internal Server Error",
    });
  }
});

// 404
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Endpoint tidak ditemukan.",
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server berjalan di http://localhost:${PORT}`);
});