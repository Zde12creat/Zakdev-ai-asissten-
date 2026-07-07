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

// ==== Reliability Layer Helpers (tidak mengubah fitur/prompt/endpoint) ====

const REQUEST_TIMEOUT_MS = 10000; // 10 detik
const MAX_RETRY_503 = 1;

// Custom error untuk menandai timeout
class TimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = "TimeoutError";
  }
}

// Membungkus pemanggilan Gemini dengan batas waktu (timeout)
function callGeminiWithTimeout(requestConfig, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new TimeoutError("Request timeout"));
      }
    }, timeoutMs);

    ai.models
      .generateContent(requestConfig)
      .then((result) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(result);
        }
      })
      .catch((error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(error);
        }
      });
  });
}

// Mengekstrak status code HTTP dari berbagai kemungkinan bentuk error SDK
function extractStatusCode(error) {
  if (!error) return null;

  const candidates = [
    error.status,
    error.code,
    error?.response?.status,
    error?.error?.code,
    error?.cause?.status,
  ];

  for (const c of candidates) {
    const num = Number(c);
    if (!Number.isNaN(num) && (num === 429 || num === 503)) {
      return num;
    }
  }

  // Fallback: cari pola status code di dalam pesan error
  const message = String(error.message || "");
  if (message.includes("429")) return 429;
  if (message.includes("503")) return 503;

  return null;
}

// Logger terstruktur sesuai kebutuhan reliability
function logRequest({ userMessage, responseTimeMs, statusCode, retryCount, errorType }) {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      userMessage,
      responseTimeMs,
      statusCode,
      retryCount,
      errorType: errorType || null,
    })
  );
}

// Chat Endpoint
app.post("/chat", async (req, res) => {
  const startTime = Date.now();
  let retryCount = 0;
  const { message } = req.body;

  try {
    if (!message || message.trim() === "") {
      const responseTimeMs = Date.now() - startTime;
      logRequest({
        userMessage: message,
        responseTimeMs,
        statusCode: 400,
        retryCount,
        errorType: "VALIDATION_ERROR",
      });
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
- Jika tidak mengetahui informasi tertentu, sarankan pengguna menghubungi admin dengan nomer wa: +62 822-2864-7505.

Pertanyaan pelanggan:
${message}
`;

    const requestConfig = {
      model: "gemini-2.5-flash",
      contents: prompt,
    };

    let result;

    try {
      result = await callGeminiWithTimeout(requestConfig, REQUEST_TIMEOUT_MS);
    } catch (firstError) {
      const statusCode = extractStatusCode(firstError);

      // 429 -> tidak retry, langsung balas ramah
      if (statusCode === 429) {
        const responseTimeMs = Date.now() - startTime;
        logRequest({
          userMessage: message,
          responseTimeMs,
          statusCode: 429,
          retryCount,
          errorType: "QUOTA_EXCEEDED",
        });
        return res.status(429).json({
          success: false,
          error:
            "AI sedang mencapai batas penggunaan. Silakan coba beberapa menit lagi atau hubungi admin. no wa : 6282228647505",
        });
      }

      // 503 -> retry maksimal 1 kali
      if (statusCode === 503) {
        if (retryCount < MAX_RETRY_503) {
          retryCount += 1;
          try {
            result = await callGeminiWithTimeout(requestConfig, REQUEST_TIMEOUT_MS);
          } catch (secondError) {
            const secondStatusCode = extractStatusCode(secondError);

            // Jika retry juga timeout, perlakukan sebagai timeout
            if (secondError instanceof TimeoutError) {
              const responseTimeMs = Date.now() - startTime;
              logRequest({
                userMessage: message,
                responseTimeMs,
                statusCode: 408,
                retryCount,
                errorType: "TIMEOUT",
              });
              return res.status(408).json({
                success: false,
                error:
                  "AI membutuhkan waktu lebih lama dari biasanya. Silakan coba kembali. no wa : 6282228647505",
              });
            }

            // Jika retry gagal karena 429, tetap balas sesuai 429
            if (secondStatusCode === 429) {
              const responseTimeMs = Date.now() - startTime;
              logRequest({
                userMessage: message,
                responseTimeMs,
                statusCode: 429,
                retryCount,
                errorType: "QUOTA_EXCEEDED",
              });
              return res.status(429).json({
                success: false,
                error:
                  "AI sedang mencapai batas penggunaan. Silakan coba beberapa menit lagi atau hubungi admin. no wa : 6282228647505",
              });
            }

            // Retry masih gagal (503 atau lainnya) -> pesan server sibuk
            const responseTimeMs = Date.now() - startTime;
            logRequest({
              userMessage: message,
              responseTimeMs,
              statusCode: 503,
              retryCount,
              errorType: "SERVICE_UNAVAILABLE",
            });
            return res.status(503).json({
              success: false,
              error: "Server AI sedang sibuk. Silakan coba beberapa saat lagi. no wa : 6282228647505",
            });
          }
        } else {
          const responseTimeMs = Date.now() - startTime;
          logRequest({
            userMessage: message,
            responseTimeMs,
            statusCode: 503,
            retryCount,
            errorType: "SERVICE_UNAVAILABLE",
          });
          return res.status(503).json({
            success: false,
            error: "Server AI sedang sibuk. Silakan coba beberapa saat lagi. atau hubungi no wa : 6282228647505",
          });
        }
      } else if (firstError instanceof TimeoutError) {
        // Timeout -> batalkan request, tanpa retry
        const responseTimeMs = Date.now() - startTime;
        logRequest({
          userMessage: message,
          responseTimeMs,
          statusCode: 408,
          retryCount,
          errorType: "TIMEOUT",
        });
        return res.status(408).json({
          success: false,
          error:
            "AI membutuhkan waktu lebih lama dari biasanya. Silakan coba kembali atau hubungi admin langsung no wa : 6282228647505.",
        });
      } else {
        // Error lainnya -> tanpa retry
        const responseTimeMs = Date.now() - startTime;
        logRequest({
          userMessage: message,
          responseTimeMs,
          statusCode: 500,
          retryCount,
          errorType: firstError.name || "UNKNOWN_ERROR",
        });
        return res.status(500).json({
          success: false,
          error:
            "Terjadi kendala pada sistem. Silakan hubungi admin no wa : 6282228647505 apabila masalah berlanjut.",
        });
      }
    }

    const responseTimeMs = Date.now() - startTime;
    logRequest({
      userMessage: message,
      responseTimeMs,
      statusCode: 200,
      retryCount,
      errorType: null,
    });

    res.status(200).json({
      success: true,
      reply: result.text,
    });
  } catch (error) {
    const responseTimeMs = Date.now() - startTime;
    logRequest({
      userMessage: message,
      responseTimeMs,
      statusCode: 500,
      retryCount,
      errorType: error.name || "UNKNOWN_ERROR",
    });
    res.status(500).json({
      success: false,
      error:
        "Terjadi kendala pada sistem. Silakan hubungi admin no wa :6282228647505 apabila masalah berlanjut.",
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