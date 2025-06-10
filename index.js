// index.js

const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const cities = [
    "Ankara", "Konya", "Kayseri", "Eskişehir", "Sivas", "Cankırı", "Yozgat", "Aksaray", "Niğde", "Nevşehir",
    "KırıkKale", "Karaman", "Kırşehir"
];

app.get('/', (req, res) => {
    res.send('News Scraper API is running on Render.com!');
});

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

app.listen(port, () => {
    console.log(`Backend API çalışıyor: http://localhost:${port}`);
});
