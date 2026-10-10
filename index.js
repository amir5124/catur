require('dotenv').config({ path: require('path').join(__dirname, '.env') });
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
const { getDatabase, ref, get, update, set, runTransaction, query, orderByKey, startAt, endAt } = require('firebase/database');

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
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json());

// ============================================================
// 🔐 KONFIGURASI (.env)
// ============================================================
const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;
if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    console.error('❌ TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN belum diisi di .env');
    console.error(`   Lokasi .env yang dicari: ${path.join(__dirname, '.env')}`);
    process.exit(1);
}

const clientId = process.env.LINKQU_CLIENT_ID || "5f5aa496-7e16-4ca1-9967-33c768dac6c7";
const clientSecret = process.env.LINKQU_CLIENT_SECRET || "TM1rVhfaFm5YJxKruHo0nWMWC";
const username = process.env.LINKQU_USERNAME || "LI9019VKS";
const pin = process.env.LINKQU_PIN || "5m6uYAScSxQtCmU";
const serverKey = process.env.LINKQU_SERVER_KEY || "QtwGEr997XDcmMb1Pq8S5X1N";
const LINKQU_HOST = (process.env.LINKQU_BASE_URL || "https://api.linkqu.id").replace(/\/$/, "");

const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
const ADMIN_WHATSAPP = process.env.ADMIN_WHATSAPP || "+6281347423599";
const TWILIO_WA_FROM = process.env.TWILIO_WA_FROM || "whatsapp:+62882005447472";
const TWILIO_CUSTOMER_SID = process.env.TWILIO_CUSTOMER_CONTENT_SID || "HXd8e11e651ea3e0e4da3fe6ca604f9dab";
const TWILIO_ADMIN_SID = process.env.TWILIO_ADMIN_CONTENT_SID || "HX105b7c03b6cca5944322f01b837448ee";
const BASE_URL = (process.env.PUBLIC_URL || "https://catur.siappgo.id").replace(/\/$/, "");
const EVENT_NAME = "TURNAMEN CATUR 2026";

// ============================================================
// 🏷️ KATEGORI — default (kelas peserta)
// ============================================================
const DEFAULT_CATEGORIES = {
    umum: { id: 'umum', label: 'Umum', active: true, order: 1 },
    pelajar: { id: 'pelajar', label: 'Pelajar', active: true, order: 2 }
};

// ============================================================
// 📦 PAKET — default (bentuk pembelian)
// ============================================================
const DEFAULT_PACKAGES = {
    early: { id: 'early', label: 'Early Bird + Jersey', price: 150000, pax: 1, quota: 50, active: true, order: 1 },
    reguler: { id: 'reguler', label: 'Reguler + Jersey', price: 200000, pax: 1, quota: 100, active: true, order: 2 },
    paket5: { id: 'paket5', label: 'Paket 5 Orang', price: 350000, pax: 5, quota: null, active: true, order: 3 },
    nojersey: { id: 'nojersey', label: 'Reguler Tanpa Jersey', price: 150000, pax: 1, quota: null, active: true, order: 4 }
};

// Seed sekali kalau belum ada
async function ensureSeeded() {
    try {
        const [sc, sp] = await Promise.all([
            get(ref(databaseFire, 'catur_categories')),
            get(ref(databaseFire, 'catur_packages'))
        ]);
        if (!sc.exists()) {
            await set(ref(databaseFire, 'catur_categories'), DEFAULT_CATEGORIES);
            console.log('✅ Kategori default di-seed');
        }
        if (!sp.exists()) {
            await set(ref(databaseFire, 'catur_packages'), DEFAULT_PACKAGES);
            console.log('✅ Paket default di-seed');
        }
    } catch (e) { console.error('⚠️ Seed gagal:', e.message); }
}
ensureSeeded();

// Helper kategori
async function getCategories() {
    const snap = await get(ref(databaseFire, 'catur_categories'));
    const all = snap.exists() ? snap.val() : DEFAULT_CATEGORIES;
    return Object.values(all).sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
}
async function getCategory(id) {
    if (!id) return null;
    const snap = await get(ref(databaseFire, `catur_categories/${id}`));
    return snap.exists() ? snap.val() : null;
}

// Helper paket
async function getPackages() {
    const snap = await get(ref(databaseFire, 'catur_packages'));
    const all = snap.exists() ? snap.val() : DEFAULT_PACKAGES;
    return Object.values(all).sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
}
async function getPackage(id) {
    if (!id) return null;
    const snap = await get(ref(databaseFire, `catur_packages/${id}`));
    return snap.exists() ? snap.val() : null;
}

// ============================================================
// 📁 UPLOAD KTP (privat)
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

// ============================================================
// 🖥️ ADMIN
// ============================================================
app.get(['/admin', '/admin/'], (req, res) => {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// Foto KTP
app.get('/ktp', (req, res) => {
    const name = path.basename(String(req.query.f || ''));
    const full = path.join(KTP_DIR, name);
    if (!name || !fs.existsSync(full)) {
        console.warn(`⚠️ KTP tidak ditemukan: ${full}`);
        return res.status(404).send('File tidak ditemukan');
    }
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Cache-Control', 'private, no-store');
    res.sendFile(full);
});

// robots.txt
app.get('/robots.txt', (req, res) => {
    res.type('text/plain').send("User-agent: *\nDisallow: /admin\nDisallow: /ktp\nDisallow: /admin/categories\nDisallow: /admin/packages\nDisallow: /admin/reset-catur\n");
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

async function saveRegistry(partner_reff, source, d) {
    try {
        await set(ref(databaseFire, `catur_registrations/${partner_reff}`), {
            partner_reff,
            source,
            status: 'PENDING',
            created_at: d.created_at,
            amount: Number(d.amount) || 0,
            method: source === 'qris' ? 'QRIS' : `VA ${d.bank_code || ''}`.trim(),
            va_number: d.va_number || null,
            category_id: d.category_id || null,
            category_label: d.category_label || null,
            package_id: d.package_id || null,
            package_name: d.package_name || null,
            combo_label: d.combo_label || null,
            phone: d.customer_phone || null,
            customer_name: d.customer_name || null,
            participants: d.participants || [],
            ktp_file: d.ktp_file || null
        });
    } catch (e) {
        console.error('⚠️ saveRegistry gagal:', e.message);
    }
}

// Validasi: butuh kategori + paket
async function splitBody(reqBody) {
    const { participants, category_id, package_id, ktp_file, ...rest } = reqBody;

    if (!category_id) throw new Error('Kategori wajib dipilih');
    if (!package_id) throw new Error('Paket wajib dipilih');

    const [cat, pkg] = await Promise.all([getCategory(category_id), getPackage(package_id)]);
    if (!cat) throw new Error('Kategori tidak valid');
    if (!pkg) throw new Error('Paket tidak valid');
    if (cat.active === false) throw new Error('Kategori sudah tidak aktif');
    if (pkg.active === false) throw new Error('Paket sudah tidak aktif');

    const pax = Number(pkg.pax) || 1;
    const list = Array.isArray(participants) ? participants : [];
    if (list.length !== pax) throw new Error('Jumlah peserta tidak sesuai paket');
    if (list.some(p => !p.name || !/^\d{16}$/.test(String(p.nik)))) throw new Error('Data peserta/NIK tidak valid');
    if (new Set(list.map(p => String(p.nik))).size !== list.length) throw new Error('NIK ganda dalam satu pendaftaran');
    if (pax === 1 && !ktp_file) throw new Error('Foto KTP wajib diupload');

    if (pkg.quota) {
        const snap = await get(ref(databaseFire, `catur_quota/${package_id}`));
        if ((snap.exists() ? snap.val() : 0) >= pkg.quota) throw new Error(`Kuota ${pkg.label} sudah penuh`);
    }

    const comboLabel = `${pkg.label} — ${cat.label}`;

    return {
        rest: { ...rest, amount: Number(pkg.price), name: EVENT_NAME, pax: String(pax) },
        meta: {
            category_id: cat.id,
            category_label: cat.label,
            package_id: pkg.id,
            package_name: pkg.label,
            combo_label: comboLabel,
            participants: list.map(p => ({ name: String(p.name).trim(), nik: String(p.nik) })),
            ktp_file: ktp_file ? path.basename(String(ktp_file)) : null
        }
    };
}
const errStatus = e => /tidak valid|wajib|sesuai|ganda|Kuota|aktif/.test(e.message) ? 400 : 500;

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
            `${LINKQU_HOST}/linkqu-partner/transaction/create/va`, payload,
            { headers: { 'client-id': clientId, 'client-secret': clientSecret } }
        );
        const result = response.data;
        const createdAt = new Date().toISOString();

        await set(ref(databaseFire, `inquiry_va/${partner_reff}`), {
            partner_reff, customer_id: customerId, customer_name: customerName,
            amount: body.amount, bank_code: result?.bank_name || null, expired,
            customer_phone: customerPhone, customer_email: customerEmail,
            va_number: result?.virtual_account || null, response_raw: result,
            created_at: createdAt, status: "PENDING",
            date: body.date || "-", name: EVENT_NAME, note: body.note || "", pax: body.pax,
            ...meta
        });

        await saveRegistry(partner_reff, 'va', {
            created_at: createdAt, amount: body.amount, bank_code: result?.bank_name || null,
            va_number: result?.virtual_account || null,
            customer_phone: customerPhone, customer_name: customerName, ...meta
        });

        res.json(result);
    } catch (err) {
        console.error('❌ Gagal membuat VA:', err.message, err.response?.status || '', err.response?.data ? JSON.stringify(err.response.data) : '');
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
            `${LINKQU_HOST}/linkqu-partner/transaction/create/qris`, payload,
            { headers: { 'client-id': clientId, 'client-secret': clientSecret } }
        );
        const result = response.data;
        const createdAt = new Date().toISOString();

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
            response_raw: result, created_at: createdAt, status: "PENDING",
            date: body.date || "-", name: EVENT_NAME, note: body.note || "", pax: body.pax,
            ...meta
        });

        await saveRegistry(partner_reff, 'qris', {
            created_at: createdAt, amount: body.amount,
            customer_phone: customerPhone, customer_name: customerName, ...meta
        });

        res.json(result);
    } catch (err) {
        console.error('❌ Gagal membuat QRIS:', err.message, err.response?.status || '', err.response?.data ? JSON.stringify(err.response.data) : '');
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
// 📱 WHATSAPP
// ============================================================
function formatToWhatsAppNumber(n) {
    if (typeof n !== 'string') return null;
    const c = n.replace(/\D/g, '');
    if (c.startsWith('0')) return `+62${c.slice(1)}`;
    if (c.startsWith('62')) return `+${c}`;
    return null;
}

async function sendWA(to, contentSid, variables) {
    if (!contentSid) return console.error('❌ Content SID Twilio belum diisi');
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

const oneLine = s => String(s ?? '-').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim() || '-';

async function addBalance(partner_reff, va_code, serialnumber) {
    const dbPath = va_code === 'QRIS' ? `inquiry_qris/${partner_reff}` : `inquiry_va/${partner_reff}`;
    const snap = await get(ref(databaseFire, dbPath));
    if (!snap.exists()) throw new Error(`Data ${partner_reff} tidak ditemukan.`);
    const data = snap.val();

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
        "6": oneLine(data.combo_label || `${data.package_name || '-'} — ${data.category_label || '-'}`),
        "7": oneLine(peserta),
        "8": oneLine(data.customer_phone)
    };

    const to = formatToWhatsAppNumber(data.customer_phone);
    if (to) sendWA(to, TWILIO_CUSTOMER_SID, variables);
    else console.warn('⚠️ Nomor customer tidak valid:', data.customer_phone);
    sendWA(ADMIN_WHATSAPP, TWILIO_ADMIN_SID, variables);
}

// ============================================================
// ✅ CALLBACK LINKQU
// ============================================================
app.post("/callback", async (req, res) => {
    const { partner_reff, va_code, serialnumber } = req.body;
    try {
        const dbPath = va_code === "QRIS" ? `inquiry_qris/${partner_reff}` : `inquiry_va/${partner_reff}`;
        const result = await runTransaction(ref(databaseFire, dbPath), (cur) => {
            if (cur) {
                if (cur.status === "SUKSES") return;
                cur.status = "SUKSES";
                return cur;
            }
            return cur;
        });

        if (!result.committed) return res.status(200).json({ status: "SUCCESS", message: "Sudah diproses" });

        update(ref(databaseFire, `catur_registrations/${partner_reff}`), {
            status: 'SUKSES',
            paid_at: new Date().toISOString(),
            bank_ref: serialnumber ? String(serialnumber) : null,
            va_code: va_code ? String(va_code) : null
        }).catch(e => console.error('⚠️ update registry:', e.message));

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
        const r = await axios.get(`${LINKQU_HOST}/linkqu-partner/transaction/payment/checkstatus`, {
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
// 📋 PUBLIK — daftar kategori & paket + kuota
// ============================================================
app.get('/catur-categories', async (req, res) => {
    try {
        const cats = await getCategories();
        res.json(cats.filter(c => c.active !== false));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/catur-packages', async (req, res) => {
    try {
        const pkgs = await getPackages();
        res.json(pkgs.filter(p => p.active !== false));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/catur-quota', async (req, res) => {
    try {
        const pkgs = await getPackages();
        const out = {};
        for (const p of pkgs) {
            if (!p.quota) continue;
            const s = await get(ref(databaseFire, `catur_quota/${p.id}`));
            const terisi = s.exists() ? s.val() : 0;
            out[p.id] = { quota: p.quota, terisi, sisa: p.quota - terisi };
        }
        res.json(out);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// 🏷️ CRUD KATEGORI
// ============================================================
const toSlug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

app.get(['/admin/categories', '/admin/categories/'], async (req, res) => {
    try {
        const snap = await get(ref(databaseFire, 'catur_categories'));
        const all = snap.exists() ? snap.val() : DEFAULT_CATEGORIES;
        res.json(Object.values(all).sort((a, b) => (a.order ?? 999) - (b.order ?? 999)));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post(['/admin/categories', '/admin/categories/'], async (req, res) => {
    try {
        const { id, label, active, order } = req.body || {};
        if (!label) return res.status(400).json({ error: 'label wajib' });
        const slug = toSlug(id || label);
        if (!slug) return res.status(400).json({ error: 'id tidak valid' });
        if (await getCategory(slug)) return res.status(409).json({ error: `Kategori "${slug}" sudah ada` });

        const cat = {
            id: slug,
            label: String(label).trim(),
            active: active !== false,
            order: Number(order) || Date.now()
        };
        await set(ref(databaseFire, `catur_categories/${slug}`), cat);
        res.json(cat);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put(['/admin/categories/:id', '/admin/categories/:id/'], async (req, res) => {
    try {
        const id = req.params.id;
        const cur = await getCategory(id);
        if (!cur) return res.status(404).json({ error: 'Kategori tidak ditemukan' });
        const { label, active, order } = req.body || {};
        const upd = {};
        if (label !== undefined) upd.label = String(label).trim();
        if (active !== undefined) upd.active = !!active;
        if (order !== undefined) upd.order = Number(order) || cur.order;
        await update(ref(databaseFire, `catur_categories/${id}`), upd);
        res.json({ ...cur, ...upd });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete(['/admin/categories/:id', '/admin/categories/:id/'], async (req, res) => {
    try {
        const id = req.params.id;
        if (!await getCategory(id)) return res.status(404).json({ error: 'Kategori tidak ditemukan' });
        await set(ref(databaseFire, `catur_categories/${id}`), null);
        res.json({ ok: true, deleted: id });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// 📦 CRUD PAKET
// ============================================================
app.get(['/admin/packages', '/admin/packages/'], async (req, res) => {
    try {
        const snap = await get(ref(databaseFire, 'catur_packages'));
        const all = snap.exists() ? snap.val() : DEFAULT_PACKAGES;
        res.json(Object.values(all).sort((a, b) => (a.order ?? 999) - (b.order ?? 999)));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post(['/admin/packages', '/admin/packages/'], async (req, res) => {
    try {
        const { id, label, price, pax, quota, active, order } = req.body || {};
        if (!label) return res.status(400).json({ error: 'label wajib' });
        if (!Number.isFinite(Number(price)) || Number(price) <= 0) return res.status(400).json({ error: 'price wajib > 0' });
        const slug = toSlug(id || label);
        if (!slug) return res.status(400).json({ error: 'id tidak valid' });
        if (await getPackage(slug)) return res.status(409).json({ error: `Paket "${slug}" sudah ada` });

        const pkg = {
            id: slug,
            label: String(label).trim(),
            price: Number(price),
            pax: Number(pax) || 1,
            quota: quota === null || quota === '' || quota === undefined ? null : Number(quota),
            active: active !== false,
            order: Number(order) || Date.now()
        };
        await set(ref(databaseFire, `catur_packages/${slug}`), pkg);
        res.json(pkg);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put(['/admin/packages/:id', '/admin/packages/:id/'], async (req, res) => {
    try {
        const id = req.params.id;
        const cur = await getPackage(id);
        if (!cur) return res.status(404).json({ error: 'Paket tidak ditemukan' });
        const { label, price, pax, quota, active, order } = req.body || {};
        const upd = {};
        if (label !== undefined) upd.label = String(label).trim();
        if (price !== undefined) {
            if (!Number.isFinite(Number(price)) || Number(price) <= 0) return res.status(400).json({ error: 'price wajib > 0' });
            upd.price = Number(price);
        }
        if (pax !== undefined) upd.pax = Number(pax) || 1;
        if (quota !== undefined) upd.quota = quota === null || quota === '' ? null : Number(quota);
        if (active !== undefined) upd.active = !!active;
        if (order !== undefined) upd.order = Number(order) || cur.order;
        await update(ref(databaseFire, `catur_packages/${id}`), upd);
        res.json({ ...cur, ...upd });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete(['/admin/packages/:id', '/admin/packages/:id/'], async (req, res) => {
    try {
        const id = req.params.id;
        if (!await getPackage(id)) return res.status(404).json({ error: 'Paket tidak ditemukan' });
        await set(ref(databaseFire, `catur_packages/${id}`), null);
        await set(ref(databaseFire, `catur_quota/${id}`), null);
        res.json({ ok: true, deleted: id });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// 🧹 RESET DATA UJICOBA
// ------------------------------------------------------------
// GET  /admin/reset-catur                      → SIMULASI
// POST /admin/reset-catur?yes=1                → HAPUS beneran
// POST /admin/reset-catur?yes=1&before=2026-10-15
// POST /admin/reset-catur?yes=1&resetCategories=1&resetPackages=1
// ============================================================
const RESET_PREFIX = 'INV-CATUR-';

app.all(['/admin/reset-catur', '/admin/reset-catur/'], async (req, res) => {
    const apply = req.method === 'POST' && (req.query.yes === '1' || req.query.yes === 'true');
    const resetCats = req.query.resetCategories === '1' || req.query.resetCategories === 'true';
    const resetPkgs = req.query.resetPackages === '1' || req.query.resetPackages === 'true';
    const beforeArg = String(req.query.before || '').trim();
    const BEFORE = beforeArg ? new Date(beforeArg + 'T00:00:00+07:00') : null;
    if (beforeArg && isNaN(BEFORE)) {
        return res.status(400).json({ error: 'Format before salah. Contoh: before=2026-10-15' });
    }

    const log = [];
    const ktpFiles = [];
    let removedTotal = 0, paidTotal = 0;

    try {
        for (const col of ['inquiry_va', 'inquiry_qris']) {
            const snap = await get(query(ref(databaseFire, col), orderByKey(), startAt(RESET_PREFIX), endAt(RESET_PREFIX + '\uf8ff')));
            const all = snap.exists() ? snap.val() : {};
            const keys = Object.keys(all).filter(k => !BEFORE || new Date(all[k].created_at) < BEFORE);
            const paid = keys.filter(k => all[k].status === 'SUKSES').length;
            keys.forEach(k => all[k].ktp_file && ktpFiles.push(all[k].ktp_file));

            log.push({ target: col, akan_dihapus: keys.length, lunas: paid });

            if (apply && keys.length) {
                await update(ref(databaseFire, col), Object.fromEntries(keys.map(k => [k, null])));
            }
            removedTotal += keys.length;
            paidTotal += paid;
        }

        const regSnap = await get(ref(databaseFire, 'catur_registrations'));
        const regCount = regSnap.exists() ? Object.keys(regSnap.val()).length : 0;
        log.push({ target: 'catur_registrations', akan_dihapus: regCount });

        const pkgs = await getPackages();
        const quotaSnap = await get(ref(databaseFire, 'catur_quota'));
        log.push({
            target: 'catur_quota',
            saat_ini: quotaSnap.exists() ? quotaSnap.val() : null,
            setelah_reset: Object.fromEntries(pkgs.filter(p => p.quota).map(p => [p.id, 0]))
        });

        log.push({ target: 'file_ktp', akan_dihapus: ktpFiles.length });
        if (resetCats) log.push({ target: 'catur_categories', aksi: 'reset ke default' });
        if (resetPkgs) log.push({ target: 'catur_packages', aksi: 'reset ke default' });

        if (!apply) {
            return res.json({
                mode: 'SIMULASI',
                catatan: 'Tidak ada data yang dihapus. Kirim POST dengan ?yes=1 untuk benar-benar menghapus.',
                before: BEFORE ? beforeArg : null,
                reset_categories: resetCats,
                reset_packages: resetPkgs,
                total_transaksi: removedTotal,
                total_lunas: paidTotal,
                detail: log
            });
        }

        await set(ref(databaseFire, 'catur_registrations'), null);
        await set(ref(databaseFire, 'catur_quota'), null);
        if (resetCats) await set(ref(databaseFire, 'catur_categories'), DEFAULT_CATEGORIES);
        if (resetPkgs) await set(ref(databaseFire, 'catur_packages'), DEFAULT_PACKAGES);

        let fileDeleted = 0;
        for (const f of ktpFiles) {
            const p = path.join(KTP_DIR, path.basename(f));
            if (fs.existsSync(p)) { fs.unlinkSync(p); fileDeleted++; }
        }

        console.log(`🧹 RESET: ${removedTotal} transaksi, ${fileDeleted} KTP${resetCats ? ', kategori reset' : ''}${resetPkgs ? ', paket reset' : ''}`);
        return res.json({
            mode: 'HAPUS',
            before: BEFORE ? beforeArg : null,
            reset_categories: resetCats,
            reset_packages: resetPkgs,
            total_transaksi_dihapus: removedTotal,
            total_lunas: paidTotal,
            file_ktp_dihapus: fileDeleted,
            kuota_direset: true,
            detail: log
        });
    } catch (err) {
        console.error('❌ Reset gagal:', err.message);
        return res.status(500).json({ error: err.message });
    }
});

// ============================================================
// 🚀 START
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server berjalan di port ${PORT} | LinkQu: ${LINKQU_HOST} | Callback: ${BASE_URL}/callback`));