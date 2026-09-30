/**
 * TOFA7-AI: Web Application Server (With Multimodal Vision & Gemini Engine)
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
let GoogleGenerativeAI;
try {
  ({ GoogleGenerativeAI } = require('@google/generative-ai'));
} catch (e) {
  console.warn("Gemini SDK not loaded:", e.message);
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '25mb' }));

// Anti-caching middleware
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  maxAge: 0
}));

// Load .env configuration if present
if (fs.existsSync('.env') && process.loadEnvFile) {
  try {
    process.loadEnvFile('.env');
  } catch (e) {
    console.warn("Could not load .env file:", e.message);
  }
}

let nodemailer;
try {
  nodemailer = require('nodemailer');
} catch (e) {
  console.warn("Nodemailer not loaded:", e.message);
}

// In-Memory Secure OTP Store: identifier -> { code, expires, attempts }
const otpStore = new Map();

function getMailTransporter() {
  if (!nodemailer) return null;
  const user = (process.env.SMTP_USER || '').trim();
  const pass = (process.env.SMTP_PASS || '').replace(/\s+/g, '');
  if (!user || !pass) return null;

  if (process.env.SMTP_HOST) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user, pass }
    });
  }

  return nodemailer.createTransport({
    service: process.env.SMTP_SERVICE || 'gmail',
    auth: { user, pass }
  });
}

// Route: Standalone Login Page
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// API: Send Real OTP Code (Email or SMS)
app.post('/api/auth/send-code', async (req, res) => {
  const { identifier } = req.body;
  if (!identifier || typeof identifier !== 'string') {
    return res.status(400).json({ success: false, message: 'يرجى إدخال بريد إلكتروني أو رقم هاتف صالح' });
  }

  const cleanId = identifier.trim().toLowerCase();
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  otpStore.set(cleanId, {
    code,
    expires: Date.now() + 5 * 60 * 1000,
    attempts: 0
  });

  const isEmail = cleanId.includes('@');

  // Case A: Real Email Transmission
  if (isEmail) {
    const transporter = getMailTransporter();
    if (transporter) {
      try {
        await transporter.sendMail({
          from: `"NEXUS-AI Security" <${process.env.SMTP_USER}>`,
          to: cleanId,
          subject: `🔐 رمز التحقق الأمني الخاص بك في NEXUS-AI: ${code}`,
          html: `
            <div dir="rtl" style="font-family: Arial, sans-serif; background:#08080c; color:#f0f0f5; padding:30px; border-radius:16px; border:1px solid #ff1744;">
              <h2 style="color:#ff1744; margin-top:0;">🛡️ بوابة الأمان | NEXUS-AI</h2>
              <p style="font-size:16px;">مرحباً بك،</p>
              <p style="font-size:15px; color:#ccc;">لقد طلبت تسجيل الدخول إلى منصة NEXUS-AI. رمز التحقق الأمني الخاص بك هو:</p>
              <div style="text-align:center; margin:25px 0;">
                <span style="font-size:32px; font-weight:bold; letter-spacing:6px; color:#ffffff; background:#1c0d14; padding:12px 24px; border-radius:10px; border:2px dashed #ff1744; display:inline-block;">
                  ${code}
                </span>
              </div>
              <p style="font-size:13px; color:#888;">هذا الرمز صالح لمدة 5 دقائق فقط. إذا لم تكن أنت من طلب هذا الرمز، يمكنك تجاهل هذه الرسالة بأمان.</p>
              <hr style="border:none; border-top:1px solid #222; margin:20px 0;">
              <small style="color:#555;">© 2026 NEXUS CORE AI</small>
            </div>
          `
        });
        console.log(`✅ [REAL EMAIL SENT] To: ${cleanId}`);
        return res.json({
          success: true,
          method: 'real_email',
          message: `تم إرسال كود التحقق بنجاح إلى بريدك الإلكتروني (${cleanId}). تفقد تطبيق Gmail أو البريد في هاتفك الآن وأدخل الرمز!`
        });
      } catch (mailErr) {
        console.error("Nodemailer send error:", mailErr.message);
        return res.status(500).json({
          success: false,
          error: 'mail_failed',
          message: `فشل إرسال البريد لهاتفك: ${mailErr.message}. يرجى مراجعة إعدادات البريد في ملف .env`
        });
      }
    } else {
      console.log(`\n======================================================`);
      console.log(`🔒 [SERVER OTP SECRET FOR: ${cleanId}] => [${code}]`);
      console.log(`💡 إيميل المرسل مضبوط: ${process.env.SMTP_USER || 'غير محدد'}`);
      console.log(`💡 لإرسال بريد حقيقي عبر Gmail، يتطلب جوجل App Password (16 حرف) في خانة SMTP_PASS في ملف .env`);
      console.log(`======================================================\n`);
      return res.json({
        success: false,
        notConfigured: true,
        message: `⚠️ إيميل الإرسال مسجل (${process.env.SMTP_USER || 'Gmail'})، لكن جوجل تتطلب كلمة مرور تطبيقات (App Password من 16 حرف) في ملف .env للسماح بالسيرفر بالإرسال. الأسهل فوراً: اضغط على زر [المتابعة بحساب Google الحقيقي] بالأعلى للدخول المباشر!`
      });
    }
  }

  // Case B: Real Cellular SMS Transmission (Twilio Gateway)
  const twilioSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioAuth = process.env.TWILIO_AUTH_TOKEN;
  const twilioFrom = process.env.TWILIO_PHONE_NUMBER;

  if (twilioSid && twilioAuth && twilioFrom) {
    try {
      const authHeader = 'Basic ' + Buffer.from(`${twilioSid}:${twilioAuth}`).toString('base64');
      const params = new URLSearchParams();
      params.append('To', cleanId);
      params.append('From', twilioFrom);
      params.append('Body', `رمز التحقق الأمني الخاص بك في NEXUS-AI هو: ${code}`);

      const twilioRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`, {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params.toString()
      });

      if (twilioRes.ok) {
        console.log(`✅ [REAL SMS SENT] To: ${cleanId}`);
        return res.json({
          success: true,
          method: 'real_sms',
          message: `تم إرسال رسالة SMS حقيقية إلى هاتفك (${cleanId}). تفقد صندوق رسائل SMS في هاتفك وأدخل الرمز!`
        });
      } else {
        const errData = await twilioRes.json();
        console.error("Twilio send error:", errData);
      }
    } catch (smsErr) {
      console.error("Twilio SMS error:", smsErr);
    }
  }

  console.log(`\n======================================================`);
  console.log(`🔒 [SERVER SMS OTP SECRET FOR: ${cleanId}] => [${code}]`);
  console.log(`💡 لإرسال رسالة SMS حقيقية لشبكات المحمول، أضف بيانات Twilio في ملف .env`);
  console.log(`======================================================\n`);
  return res.json({
    success: false,
    notConfigured: true,
    message: `⚠️ شبكات المحمول تتطلب مزود SMS (مثل Twilio) في ملف .env، أو استخدم بريد Gmail أو زر الدخول بجوجل مباشرة!`
  });
});

// API: Verify OTP Code
app.post('/api/auth/verify-code', (req, res) => {
  const { identifier, code } = req.body;
  if (!identifier || !code) {
    return res.status(400).json({ success: false, message: 'البيانات غير مكتملة' });
  }

  const cleanId = identifier.trim().toLowerCase();
  const record = otpStore.get(cleanId);

  if (!record) {
    return res.status(400).json({ success: false, message: 'انتهت صلاحية الرمز أو لم يتم طلبه، يرجى طلب رمز جديد' });
  }

  if (Date.now() > record.expires) {
    otpStore.delete(cleanId);
    return res.status(400).json({ success: false, message: 'انتهت صلاحية رمز التحقق (5 دقائق)، يرجى طلب رمز جديد' });
  }

  if (record.code !== code.trim()) {
    record.attempts = (record.attempts || 0) + 1;
    if (record.attempts >= 5) {
      otpStore.delete(cleanId);
      return res.status(400).json({ success: false, message: 'تم تجاوز الحد الأقصى للمحاولات الخاطئة، يرجى طلب رمز جديد' });
    }
    return res.status(400).json({ success: false, message: 'رمز التحقق غير صحيح، يرجى التأكد والمحاولة مجدداً' });
  }

  // Verification Succeeded
  otpStore.delete(cleanId);
  return res.json({
    success: true,
    user: {
      name: cleanId.split('@')[0],
      email: cleanId,
      provider: cleanId.includes('@') ? 'Real Email Verification' : 'Real Phone Verification',
      avatar: '👤'
    }
  });
});

// API: System Status
app.get('/api/status', (req, res) => {
  res.json({
    status: 'online',
    system: 'TOFA7-AI Multimodal Vision Core',
    version: '3.0.0',
    hasGeminiSdk: !!GoogleGenerativeAI
  });
});

// API: Multimodal Chat & Vision Processing
app.post('/api/chat', async (req, res) => {
  try {
    const { message, imageBase64, mimeType, apiKey } = req.body;
    const key = apiKey || process.env.GEMINI_API_KEY;

    if (key && GoogleGenerativeAI) {
      try {
        const genAI = new GoogleGenerativeAI(key);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const parts = [];
        if (message) {
          parts.push(message);
        } else {
          parts.push("حلل هذه الصورة بالتفصيل واشرح ما فيها واقترح أي كود أو أفكار متعلقة بها.");
        }

        if (imageBase64) {
          const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
          parts.push({
            inlineData: {
              data: cleanBase64,
              mimeType: mimeType || 'image/jpeg'
            }
          });
        }

        const result = await model.generateContent(parts);
        const response = await result.response;
        return res.json({ success: true, text: response.text(), provider: 'gemini-vision' });
      } catch (geminiErr) {
        console.error("Gemini API error:", geminiErr.message);
        // If Gemini key failed, let fallback handle it
      }
    }

    // Default intelligent response fallback if no key
    res.json({
      success: false,
      fallbackNeeded: true,
      message: "No API key configured or fallback requested."
    });
  } catch (err) {
    console.error("Chat API error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 TOFA7-AI (نظام تفاحة للذكاء الاصطناعي والرؤية البصرية)`);
  console.log(`📡 الخادم يعمل على: http://localhost:${PORT}`);
  console.log(`====================================================`);
});
