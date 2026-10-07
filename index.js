require('dotenv').config(); // HARUS paling atas
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const cors = require('cors');
const moment = require('moment-timezone');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const twilio = require('twilio');
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, get, update, set, runTransaction } = require('firebase/database');

// ============================================================
// 🔥 FIREBASE
// ============================================================
const FIREBASE = initializeApp({
    apiKey: "AIzaSyD8P9au26mC8xx8UcjNsm-NMW5JUgTHUBU",
    authDomain: "linku-3ca65.firebaseapp.com",
    databaseURL: "https://linku-3ca65-default-rtdb.firebaseio.com",
    projectId: "linku-3ca65",
    storageBucket: "linku-3ca65.appspot.com",
    messagingSenderId: "759194220603",
    appId: "1:759194220603:web:33e2327dfa94af2552841e"
});
const databaseFire = getDatabase(FIREBASE);

// ============================================================
// ⚙️ EXPRESS
// ============================================================
const app = express();
app.use(cors());
app.use(express.json());

// ============================================================
// 🔐 KONFIGURASI (ISI DI FILE .env)
// ============================================================
const {
    TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, ADMIN_TOKEN
} = process.env;

const clientId = process.env.LINKQU_CLIENT_ID || "5f5aa496-7e16-4ca1-9967-33c768dac6c7";
const clientSecret = process.env.LINKQU_CLIENT_SECRET || "TM1rVhfaFm5YJxKruHo0nWMWC";
const username = process.env.LINKQU_USERNAME || "LI9019VKS";
const pin = process.env.LINKQU_PIN || "5m6uYAScSxQtCmU";
const serverKey = process.env.LINKQU_SERVER_KEY || "QtwGEr997XDcmMb1Pq8S5X1N";

const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
const ADMIN_WHATSAPP = process.env.ADMIN_WHATSAPP || "+6281347423599";
const TWILIO_WA_FROM = process.env.TWILIO_WA_FROM || "whatsapp:+62882005447472";
const TWILIO_CUSTOMER_SID = process.env.TWILIO_CUSTOMER_CONTENT_SID || "HX20148cf297898e2b2b2245c8b3cdcbdb";
const TWILIO_ADMIN_SID = process.env.TWILIO_ADMIN_CONTENT_SID || "HX105b7c03b6cca5944322f01b837448ee";
const BASE_URL = "https://catur.siappgo.id";
const EVENT_NAME = "TURNAMEN CATUR 2026";

// ============================================================
// 📦 PAKET (harga dihitung di server, bukan dari frontend)
// ============================================================
const PACKAGES = {
    early: { label: 'Early Bird + Jersey', price: 100, pax: 1, quota: 50 },
    reguler: { label: 'Reguler + Jersey', price: 200000, pax: 1, quota: 100 },
    paket5: { label: 'Paket 5 Orang', price: 350000, pax: 5, quota: null },
    nojersey: { label: 'Reguler Tanpa Jersey', price: 150000, pax: 1, quota: null }
};

// ============================================================
// 📁 UPLOAD KTP (privat, tidak di-serve publik)
// ============================================================
const KTP_DIR = path.join(__dirname, 'private_uploads', 'ktp');
fs.mkdirSync(KTP_DIR, { recursive: true });

const uploadKtp = multer({
    storage: multer.diskStorage({
        destination: KTP_DIR,
        filename: (req, file, cb) => {
            const ext = path.extname(file.originalname).toLowerCase();
            const safeExt = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext) ? ext : '.jpg';
            cb(null, `ktp-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${safeExt}`);
        }
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => cb(null, /^image\/(jpe?g|png|webp)$/.test(file.mimetype))
});

app.post('/upload-ktp', uploadKtp.single('ktp'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'File tidak valid (JPG/PNG/WEBP, maks 5MB)' });
    res.json({ file: req.file.filename });
});

// Admin melihat KTP:  GET /admin/ktp/<file>   header: x-admin-token: <ADMIN_TOKEN>
app.get('/admin/ktp/:file', (req, res) => {
    if (!ADMIN_TOKEN || req.headers['x-admin-token'] !== ADMIN_TOKEN) return res.status(403).send('Forbidden');
    const file = path.join(KTP_DIR, path.basename(req.params.file));
    if (!fs.existsSync(file)) return res.status(404).send('Not found');
    res.sendFile(file);
});

// ============================================================
// 🛡️ HELPER
// ============================================================
function sanitizeName(name) {
    if (!name || typeof name !== 'string') return "Pelanggan";
    const t = name.trim();
    if ((t.startsWith("{") && t.endsWith("}")) || t === "" || t.toLowerCase() === "username") return "Pelanggan";
    return t;
}
function sanitizePhone(phone) {
    if (!phone || typeof phone !== 'string') return null;
    const t = phone.trim();
    return (t.startsWith("{") && t.endsWith("}")) ? null : t;
}
const getExpiredTimestamp = (m = 15) => moment.tz('Asia/Jakarta').add(m, 'minutes').format('YYYYMMDDHHmmss');
const generatePartnerReff = () => `INV-CATUR-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

function makeSignature(pathUrl, parts) {
    const cleaned = parts.join('').replace(/[^0-9a-zA-Z]/g, "").toLowerCase();
    return crypto.createHmac("sha256", serverKey).update(pathUrl + 'POST' + cleaned).digest("hex");
}

// Validasi + pisahkan data turnamen dari body yang diteruskan ke LinkQu
async function splitBody(reqBody) {
    const { participants, package_id, package_name, ktp_file, ...rest } = reqBody;
    const pkg = PACKAGES[package_id];
    if (!pkg) throw new Error('Paket tidak valid');

    const list = Array.isArray(participants) ? participants : [];
    if (list.length !== pkg.pax) throw new Error('Jumlah peserta tidak sesuai paket');
    if (list.some(p => !p.name || !/^\d{16}$/.test(String(p.nik)))) throw new Error('Data peserta/NIK tidak valid');
    if (new Set(list.map(p => String(p.nik))).size !== list.length) throw new Error('NIK ganda dalam satu pendaftaran');
    if (pkg.pax === 1 && !ktp_file) throw new Error('Foto KTP wajib diupload');

    if (pkg.quota) {
        const snap = await get(ref(databaseFire, `catur_quota/${package_id}`));
        if ((snap.exists() ? snap.val() : 0) >= pkg.quota) throw new Error(`Kuota ${pkg.label} sudah penuh`);
    }

    return {
        rest: { ...rest, amount: pkg.price, name: EVENT_NAME, pax: String(pkg.pax) },
        meta: {
            package_id,
            package_name: pkg.label,
            participants: list.map(p => ({ name: String(p.name).trim(), nik: String(p.nik) })),
            ktp_file: ktp_file ? path.basename(String(ktp_file)) : null
        }
    };
}
const errStatus = e => /tidak valid|wajib|sesuai|ganda|Kuota/.test(e.message) ? 400 : 500;

// ============================================================
// ✅ CREATE VA
// ============================================================
app.post('/create-va', async (req, res) => {
    try {
        const { rest: body, meta } = await splitBody(req.body);
        const partner_reff = generatePartnerReff();
        const expired = getExpiredTimestamp();

        const customerName = sanitizeName(body.customer_name || body.name);
        const customerPhone = sanitizePhone(body.customer_phone || body.phone);
        const customerEmail = body.customer_email || "bocahangon64@gmail.com";
        const customerId = body.customer_id || `CUST-${Date.now()}`;

        const signature = makeSignature('/transaction/create/va', [
            body.amount, expired, body.bank_code, partner_reff,
            customerId, customerName, customerEmail, clientId
        ]);

        const payload = {
            ...body, partner_reff, username, pin, expired, signature,
            url_callback: `${BASE_URL}/callback`,
            customer_id: customerId, customer_name: customerName, customer_email: customerEmail
        };

        const response = await axios.post(
            'https://api.linkqu.id/linkqu-partner/transaction/create/va', payload,
            { headers: { 'client-id': clientId, 'client-secret': clientSecret } }
        );
        const result = response.data;

        await set(ref(databaseFire, `inquiry_va/${partner_reff}`), {
            partner_reff, customer_id: customerId, customer_name: customerName,
            amount: body.amount, bank_code: result?.bank_name || null, expired,
            customer_phone: customerPhone, customer_email: customerEmail,
            va_number: result?.virtual_account || null, response_raw: result,
            created_at: new Date().toISOString(), status: "PENDING",
            date: body.date || "-", name: EVENT_NAME, note: body.note || "", pax: body.pax,
            ...meta
        });
        res.json(result);
    } catch (err) {
        console.error('❌ Gagal membuat VA:', err.message);
        res.status(errStatus(err)).json({ error: err.message, detail: err.response?.data || null });
    }
});

// ============================================================
// ✅ CREATE QRIS
// ============================================================
app.post('/create-qris', async (req, res) => {
    try {
        const { rest: body, meta } = await splitBody(req.body);
        const partner_reff = generatePartnerReff();
        const expired = getExpiredTimestamp();

        const customerName = sanitizeName(body.customer_name || body.name);
        const customerPhone = sanitizePhone(body.customer_phone || body.phone);
        const customerEmail = body.customer_email || "bocahangon64@gmail.com";
        const customerId = body.customer_id || `CUST-${Date.now()}`;

        const signature = makeSignature('/transaction/create/qris', [
            body.amount, expired, partner_reff,
            customerId, customerName, customerEmail, clientId
        ]);

        const payload = {
            ...body, partner_reff, username, pin, expired, signature,
            url_callback: `${BASE_URL}/callback`,
            customer_id: customerId, customer_name: customerName, customer_email: customerEmail
        };

        const response = await axios.post(
            'https://api.linkqu.id/linkqu-partner/transaction/create/qris', payload,
            { headers: { 'client-id': clientId, 'client-secret': clientSecret } }
        );
        const result = response.data;

        let qrisBase64 = null;
        if (result?.imageqris) {
            try {
                const img = await axios.get(result.imageqris.trim(), { responseType: 'arraybuffer' });
                qrisBase64 = Buffer.from(img.data).toString('base64');
            } catch (e) { console.error("⚠️ Gagal unduh gambar QRIS:", e.message); }
        }

        await set(ref(databaseFire, `inquiry_qris/${partner_reff}`), {
            partner_reff, customer_id: customerId, customer_name: customerName,
            amount: body.amount, expired, customer_phone: customerPhone, customer_email: customerEmail,
            qris_url: result?.imageqris || null, qris_image_base64: qrisBase64,
            response_raw: result, created_at: new Date().toISOString(), status: "PENDING",
            date: body.date || "-", name: EVENT_NAME, note: body.note || "", pax: body.pax,
            ...meta
        });
        res.json(result);
    } catch (err) {
        console.error('❌ Gagal membuat QRIS:', err.message);
        res.status(errStatus(err)).json({ error: err.message, detail: err.response?.data || null });
    }
});

// ============================================================
// ✅ DOWNLOAD QRIS
// ============================================================
app.get('/download-qr/:partner_reff', async (req, res) => {
    const { partner_reff } = req.params;
    try {
        const snap = await get(ref(databaseFire, `inquiry_qris/${partner_reff}`));
        if (!snap.exists()) return res.status(404).send('QRIS tidak ditemukan.');
        const data = snap.val();

        let buf = null;
        if (data.qris_image_base64) {
            buf = Buffer.from(data.qris_image_base64, 'base64');
        } else if (data.qris_url) {
            const r = await axios.get(data.qris_url.trim(), { responseType: 'arraybuffer' });
            buf = Buffer.from(r.data);
            await set(ref(databaseFire, `inquiry_qris/${partner_reff}/qris_image_base64`), buf.toString('base64'));
        }
        if (!buf) return res.status(404).send('QRIS tidak memiliki data gambar.');

        res.setHeader('Content-Disposition', `attachment; filename="qris-${partner_reff}.png"`);
        res.setHeader('Content-Type', 'image/png');
        res.send(buf);
    } catch (err) {
        console.error('❌ Error download QR:', err.message);
        res.status(500).send('Terjadi kesalahan server.');
    }
});

// ============================================================
// 📱 WHATSAPP (TWILIO)
// ============================================================
function formatToWhatsAppNumber(n) {
    if (typeof n !== 'string') return null;
    const c = n.replace(/\D/g, '');
    if (c.startsWith('0')) return `+62${c.slice(1)}`;
    if (c.startsWith('62')) return `+${c}`;
    return null;
}

async function sendWA(to, contentSid, variables) {
    if (!contentSid) return console.error('❌ Content SID Twilio belum diisi di .env');
    try {
        const r = await client.messages.create({
            from: TWILIO_WA_FROM,
            to: `whatsapp:${to}`,
            contentSid,
            contentVariables: JSON.stringify(variables)
        });
        console.log(`✅ WA terkirim ke ${to}:`, r.sid);
    } catch (e) {
        console.error(`❌ Gagal kirim WA ke ${to}:`, e.message);
    }
}

// Twilio melarang newline/tab & >4 spasi beruntun di variabel
const oneLine = s => String(s ?? '-').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim() || '-';

async function addBalance(partner_reff, va_code, serialnumber) {
    const dbPath = va_code === 'QRIS' ? `inquiry_qris/${partner_reff}` : `inquiry_va/${partner_reff}`;
    const snap = await get(ref(databaseFire, dbPath));
    if (!snap.exists()) throw new Error(`Data ${partner_reff} tidak ditemukan.`);
    const data = snap.val();

    // Hitung kuota paket (callback hanya lolos sekali berkat transaction)
    if (data.package_id) {
        await runTransaction(ref(databaseFire, `catur_quota/${data.package_id}`), n => (n || 0) + 1);
    }

    const peserta = (data.participants || [])
        .map((p, i) => `${i + 1}. ${p.name} (NIK ****${String(p.nik).slice(-4)})`)
        .join(' | ');

    const variables = {
        "1": oneLine(sanitizeName(data.customer_name)),
        "2": oneLine(data.partner_reff || partner_reff),
        "3": `Rp${parseInt(data.amount).toLocaleString('id-ID')}`,
        "4": oneLine(va_code === 'QRIS' ? 'QRIS' : `VA ${va_code}`),
        "5": oneLine(serialnumber),
        "6": oneLine(data.package_name),
        "7": oneLine(peserta),
        "8": oneLine(data.customer_phone)
    };

    const to = formatToWhatsAppNumber(data.customer_phone);
    if (to) sendWA(to, TWILIO_CUSTOMER_SID, variables);
    else console.warn('⚠️ Nomor customer tidak valid:', data.customer_phone);
    sendWA(ADMIN_WHATSAPP, TWILIO_ADMIN_SID, variables);
}

// ============================================================
// ✅ CALLBACK LINKQU (selalu balas 200, WA di background)
// ============================================================
app.post("/callback", async (req, res) => {
    const { partner_reff, va_code, serialnumber } = req.body;
    try {
        const dbPath = va_code === "QRIS" ? `inquiry_qris/${partner_reff}` : `inquiry_va/${partner_reff}`;
        const result = await runTransaction(ref(databaseFire, dbPath), (cur) => {
            if (cur) {
                if (cur.status === "SUKSES") return; // sudah diproses → batal
                cur.status = "SUKSES";
                return cur;
            }
            return cur;
        });

        if (!result.committed) return res.status(200).json({ status: "SUCCESS", message: "Sudah diproses" });

        addBalance(partner_reff, va_code, serialnumber).catch(e => console.error("⚠️ addBalance:", e.message));
        return res.status(200).json({ status: "SUCCESS", message: "Pembayaran berhasil dicatat" });
    } catch (err) {
        console.error(`❌ Callback Error: ${err.message}`);
        return res.status(200).json({ status: "SUCCESS", message: "Callback diterima" });
    }
});

// ============================================================
// ✅ CEK STATUS
// ============================================================
app.get('/check-status/:partnerReff', async (req, res) => {
    try {
        const r = await axios.get(`https://api.linkqu.id/linkqu-partner/transaction/payment/checkstatus`, {
            params: { username, partnerreff: req.params.partnerReff },
            headers: { 'client-id': clientId, 'client-secret': clientSecret }
        });
        res.json(r.data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/check-local-status/:partnerReff', async (req, res) => {
    const id = req.params.partnerReff;
    try {
        let snap = await get(ref(databaseFire, `inquiry_va/${id}`));
        let source = 'va';
        if (!snap.exists()) { snap = await get(ref(databaseFire, `inquiry_qris/${id}`)); source = 'qris'; }
        if (!snap.exists()) return res.status(404).json({ success: false, message: "Transaksi tidak ditemukan" });

        const d = snap.val();
        res.json({
            success: true, source, partner_reff: id, status: d.status,
            customer_name: d.customer_name, amount: d.amount,
            is_paid: d.status === "SUKSES", created_at: d.created_at
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================================
// 📊 SISA KUOTA (opsional, untuk ditampilkan di frontend)
// ============================================================
app.get('/catur-quota', async (req, res) => {
    try {
        const out = {};
        for (const [id, p] of Object.entries(PACKAGES)) {
            if (!p.quota) continue;
            const s = await get(ref(databaseFire, `catur_quota/${id}`));
            out[id] = { quota: p.quota, terisi: s.exists() ? s.val() : 0, sisa: p.quota - (s.exists() ? s.val() : 0) };
        }
        res.json(out);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// 🚀 START
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server berjalan di port ${PORT}`));