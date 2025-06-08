// index.js

const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const { createCanvas, loadImage } = require('canvas');
const cors = require('cors');
const sharp = require('sharp');
const path = require('path'); // Yerel dosya yolları için eklendi
const fs = require('fs');     // Dosya sistemi işlemleri için eklendi

const app = express();
// Render.com, portu process.env.PORT ortam değişkeni üzerinden sağlar.
// Eğer bu değişken tanımlı değilse, yerel geliştirme için 3000'i kullanırız.
const port = process.env.PORT || 3000;

// CORS'u etkinleştirin
app.use(cors());
// JSON body parsing'i etkinleştirin
app.use(express.json());

// Oluşturulan görselleri statik olarak sunacağımız dizin
const postsDir = path.join(__dirname, 'posts');
if (!fs.existsSync(postsDir)) {
    fs.mkdirSync(postsDir);
}
app.use('/posts', express.static(postsDir)); // /posts URL'si altında 'posts' klasörünü sun

// Şehir listesi
const cities = [
    "Ankara", "Konya", "Kayseri", "Eskişehir", "Sivas", "Cankırı", "Yozgat", "Aksaray", "Niğde", "Nevşehir",
    "KırıkKale", "Karaman", "Kırşehir"
];

// Ana sayfa için hoş geldiniz mesajı
app.get('/', (req, res) => {
    res.send('News Scraper API is running on Render.com!');
});

// Haberleri çekmek için API endpoint'i
app.get('/api/news/:city', async (req, res) => {
    const city = req.params.city;
    if (!cities.includes(city)) {
        return res.status(400).json({ error: 'Geçersiz şehir adı.' });
    }

    const url = `https://www.sondakika.com/${city}/`; // Haber çekme URL'si doğrudan burada kullanılmalı
    console.log(`Haberler çekiliyor: ${url}`);

    try {
        const response = await axios.get(url);
        const $ = cheerio.load(response.data);

        const news = [];
        $('li.nws.w-100.h-100.gap-xs-0').slice(0, 5).each((i, element) => {
            const title = $(element).find('span.title').text().trim();
            const detail = $(element).find('p.news-detail.news-column > a').text().trim();
            const imageUrl = $(element).find('img.mr-md-0').attr('src');

            if (title && detail && imageUrl) {
                news.push({ title, detail, imageUrl });
            }
        });

        res.json(news);

    } catch (error) {
        console.error(`Haber çekme hatası (${city}):`, error.message);
        res.status(500).json({ error: 'Haberler çekilirken bir hata oluştu.' });
    }
});

// Yardımcı Fonksiyon: Görseli URL'den çek ve JPEG'e dönüştürerek Buffer olarak yükle
async function loadImageAndConvert(url) {
    try {
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        const imageBuffer = Buffer.from(response.data);

        const convertedBuffer = await sharp(imageBuffer)
                                        .jpeg({ quality: 80 })
                                        .toBuffer();

        return await loadImage(convertedBuffer);
    } catch (error) {
        console.error(`Görsel yüklenemedi veya dönüştürülemedi from URL (${url}):`, error.message);
        throw new Error(`Görsel yüklenemedi/dönüştürülemedi: ${error.message}`);
    }
}

// Post görseli oluşturmak için API endpoint'i
app.post('/api/create-post-image', async (req, res) => {
    const { imageUrl, title, content, username, altname, logoUrl } = req.body;

    console.log(`POST isteği alındı. İşlenecek haber görseli URL: ${imageUrl}`);

    if (!imageUrl || !title || !content || !username || !altname) {
        return res.status(400).json({ error: 'Eksik parametreler.' });
    }

    const width = 900;
    const height = 1200;

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    try {
        if (logoUrl) {
            try {
                const logo = await loadImageAndConvert(logoUrl);
                ctx.drawImage(logo, 30, 30, 150, 150);
            } catch (logoErr) {
                console.error('Logo yüklenemedi (uzak URL):', logoErr.message);
            }
        }

        ctx.fillStyle = '#000000';
        ctx.font = 'bold 40px Arial';
        ctx.fillText(username, 200, 100);

        ctx.fillStyle = '#808080';
        ctx.font = '28px Arial';
        ctx.fillText(altname, 200, 140);

        const newsImage = await loadImageAndConvert(imageUrl);
        const imgHeight = 450;
        const imgWidth = (newsImage.width * imgHeight) / newsImage.height;
        const xOffset = (width - imgWidth) / 2;
        ctx.drawImage(newsImage, xOffset, height - imgHeight - 200, imgWidth, imgHeight);

        ctx.fillStyle = '#000000';
        ctx.font = 'bold 50px Arial';
        drawWrappedText(ctx, title, 40, 250, width - 80, 50 + 8);

        ctx.font = '36px Arial';
        const contentLines = getLineCount(content, width - 80, 36, ctx);
        if (contentLines > 5) {
            ctx.font = '18px Arial';
        }
        drawWrappedText(ctx, content, 40, 320 + getWrappedTextHeight(ctx, title, width - 80, 50 + 8), width - 80, ctx.font.match(/\d+/)[0] / 1 + 8);

        const timestamp = Date.now();
        const fileName = `news_post_${timestamp}.png`;
        const filePath = path.join(postsDir, fileName); // Yerel posts klasörüne kaydet

        const out = fs.createWriteStream(filePath);
        const stream = canvas.createPNGStream();
        stream.pipe(out);

        await new Promise((resolve, reject) => {
            out.on('finish', () => {
                console.log(`✅ Resim kaydedildi: ${filePath}`);
                resolve();
            });
            out.on('error', reject);
        });

        // Oluşturulan görselin URL'sini döndür (Render.com URL'nize göre ayarlanmalı)
        // Render.com'da SERVICE_URL adında bir ortam değişkeni ayarlamanız gerekecek
        const publicUrl = `${process.env.SERVICE_URL}/posts/${fileName}`; // Render.com URL'sini kullan
        console.log('Oluşturulan Post Görseli URL:', publicUrl);

        res.json({ success: true, imageUrl: publicUrl }); // URL'yi geri döndür

    } catch (error) {
        console.error('Görsel oluşturma ve kaydetme hatası:', error.message);
        res.status(500).json({ error: 'Görsel oluşturulurken veya kaydedilirken bir sorun oluştu.' });
    }
});

// Metni sarma yardımcı fonksiyonu
function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight) {
    const words = text.split(' ');
    let line = '';
    for (let n = 0; n < words.length; n++) {
        const testLine = line + words[n] + ' ';
        const metrics = ctx.measureText(testLine);
        const testWidth = metrics.width;
        if (testWidth > maxWidth && n > 0) {
            ctx.fillText(line, x, y);
            line = words[n] + ' ';
            y += lineHeight;
        } else {
            line = testLine;
        }
    }
    ctx.fillText(line, x, y);
}

// Metin satır sayısını hesaplama (yaklaşık)
function getLineCount(ctx, text, maxWidth, fontSize) {
    const words = text.split(' ');
    let line = '';
    let lineCount = 1;
    for (let n = 0; n < words.length; n++) {
        const testLine = line + words[n] + ' ';
        ctx.font = `${fontSize}px Arial`;
        const metrics = ctx.measureText(testLine);
        const testWidth = metrics.width;
        if (testWidth > maxWidth && n > 0) {
            lineCount++;
            line = words[n] + ' ';
        } else {
            line = testLine;
        }
    }
    return lineCount;
}

// Sarılmış metnin toplam yüksekliğini hesaplama
function getWrappedTextHeight(ctx, text, maxWidth, lineHeight) {
    const words = text.split(' ');
    let line = '';
    let totalHeight = 0;
    let currentY = 0;
    for (let n = 0; n < words.length; n++) {
        const testLine = line + words[n] + ' ';
        const metrics = ctx.measureText(testLine);
        const testWidth = metrics.width;
        if (testWidth > maxWidth && n > 0) {
            currentY += lineHeight;
            totalHeight += lineHeight;
            line = words[n] + ' ';
        } else {
            line = testLine;
        }
    }
    totalHeight += lineHeight;
    return totalHeight;
}

// Express uygulamasını belirtilen portta dinlemeye başla
app.listen(port, () => {
    console.log(`Backend API çalışıyor: http://localhost:${port}`); // Yerelde test ederken bu görünecek
});
