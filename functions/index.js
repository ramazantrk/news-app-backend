// NewsBackend/functions/index.js
const functions = require("firebase-functions");
const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const { createCanvas, loadImage } = require('canvas');
const cors = require('cors');
const sharp = require('sharp');
// const path = require('path'); // Firebase Functions'ta yerel path çok kullanılmaz
// const fs = require('fs'); // Firebase Functions'ta yerel dosya yazılmaz

const app = express();

// CORS'u etkinleştirin - Firebase Functions için origin: true kullanmak daha yaygındır
app.use(cors({ origin: true }));
app.use(express.json());

const cities = [
    "Ankara", "Konya", "Kayseri", "Eskişehir", "Sivas", "Cankırı", "Yozgat", "Aksaray", "Niğde", "Nevşehir",
    "KırıkKale", "Karaman", "Kırşehir"
];

// Ana sayfa için hoş geldiniz mesajı
app.get('/', (req, res) => {
    res.send('News Scraper API is running on Firebase Functions!');
});

// Haberleri çekmek için API endpoint'i
app.get('/api/news/:city', async (req, res) => {
    const city = req.params.city;
    if (!cities.includes(city)) {
        return res.status(400).json({ error: 'Geçersiz şehir adı.' });
    }

    const url = `https://www.sondakika.com/${city}/`;
    console.log(`Haberler çekiliyor: ${url}`);

    try {
        const response = await axios.get(url);
        const $ = cheerio.load(response.data);

        const news = [];
        // Son 5 haberi çekiyoruz
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
        const response = await axios.get(url, { responseType: 'arraybuffer' }); // Görseli buffer olarak çek
        const imageBuffer = Buffer.from(response.data);

        // Gelen görseli JPEG'e dönüştür (kalite %80)
        const convertedBuffer = await sharp(imageBuffer)
                                        .jpeg({ quality: 80 })
                                        .toBuffer();

        return await loadImage(convertedBuffer); // Dönüştürülmüş Buffer'ı loadImage'e ver
    } catch (error) {
        console.error(`Görsel yüklenemedi veya dönüştürülemedi from URL (${url}):`, error.message);
        throw new Error(`Görsel yüklenemedi/dönüştürülemedi: ${error.message}`);
    }
}

// Post görseli oluşturmak için API endpoint'i
app.post('/api/create-post-image', async (req, res) => {
    const { imageUrl, title, content, username, altname, logoUrl } = req.body;

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
        // Logo ekleme: Firebase Functions'ta yerel dosya sistemi erişimi sınırlıdır.
        // Logo URL'sini doğrudan bir web kaynağından çekmeliyiz.
        // LogoUrl React Native'den geliyorsa ve genel bir URL'e sahipse kullanılabilir.
        if (logoUrl) {
            try {
                // Logoyu da dönüştürerek yüklemeyi deniyoruz
                const logo = await loadImageAndConvert(logoUrl);
                ctx.drawImage(logo, 30, 30, 150, 150);
            } catch (logoErr) {
                console.error('Logo yüklenemedi (uzak URL):', logoErr.message);
                // Logo yüklenemezse devam et
            }
        }

        // Kullanıcı adı ekleme
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 40px Arial';
        ctx.fillText(username, 200, 100);

        ctx.fillStyle = '#808080';
        ctx.font = '28px Arial';
        ctx.fillText(altname, 200, 140);

        // Haber görseli ekleme
        const newsImage = await loadImageAndConvert(imageUrl);
        const imgHeight = 450;
        const imgWidth = (newsImage.width * imgHeight) / newsImage.height;
        const xOffset = (width - imgWidth) / 2;
        ctx.drawImage(newsImage, xOffset, height - imgHeight - 200, imgWidth, imgHeight);

        // Başlık ekleme
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 50px Arial';
        drawWrappedText(ctx, title, 40, 250, width - 80, 50 + 8);

        // İçerik ekleme
        ctx.font = '36px Arial';
        const contentLines = getLineCount(content, width - 80, 36, ctx);
        if (contentLines > 5) {
            ctx.font = '18px Arial';
        }
        drawWrappedText(ctx, content, 40, 320 + getWrappedTextHeight(ctx, title, width - 80, 50 + 8), width - 80, ctx.font.match(/\d+/)[0] / 1 + 8);

        // Resim dosyasını Buffer olarak alıp Base64 string'i olarak geri döndürüyoruz
        const imageBuffer = canvas.toBuffer('image/png');
        const base64Image = `data:image/png;base64,${imageBuffer.toString('base64')}`;
        
        // Artık fiziksel bir dosya kaydetmiyoruz ve bir URL oluşturmuyoruz.
        // Doğrudan Base64 string'ini döndürüyoruz.
        res.json({ success: true, imageUrl: base64Image });

    } catch (error) {
        console.error('Görsel oluşturma hatası:', error.message);
        res.status(500).json({ error: 'Görsel oluşturulurken bir hata oluştu.' });
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
function getLineCount(text, maxWidth, fontSize, ctx) {
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

// Express uygulamasını bir Firebase Functions HTTP fonksiyonu olarak dışa aktar
exports.api = functions.https.onRequest(app);
