const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;
const MAX_RESULTS_PER_SOURCE = 5;

// Middleware
app.use(cors({
  origin: ['https://data-bot-3hrl.onrender.com', 'http://localhost:3000'],
  methods: ['GET', 'POST'],
}));
app.use(express.json());

// Serve HTML page
app.get('/', (req, res) => {
  res.send(`
  <!DOCTYPE html>
  <html>
  <head>
    <title>Restaurant Scraper</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 20px; }
      input, select { padding: 8px; width: 200px; margin-right: 10px; }
      button { padding: 8px 16px; }
      #results { margin-top: 20px; }
      .result { border: 1px solid #ccc; padding: 10px; margin-bottom: 10px; }
      #error { color: red; margin-top: 10px; }
      #loading { display: none; margin-top: 10px; }
    </style>
  </head>
  <body>
    <h1>Restaurant Scraper</h1>
    <select id="city">
      <option value="Toronto">Toronto</option>
      <option value="Kamloops">Kamloops</option>
      <option value="Vancouver">Vancouver</option>
    </select>
    <input type="text" id="cuisine" placeholder="Enter cuisine (e.g., Italian)">
    <button onclick="search()">Search</button>
    <div id="loading">Loading...</div>
    <div id="error"></div>
    <div id="results"></div>

    <script>
      async function search() {
        const cuisineInput = document.getElementById('cuisine');
        const cityInput = document.getElementById('city');
        const resultsDiv = document.getElementById('results');
        const errorDiv = document.getElementById('error');
        const loadingDiv = document.getElementById('loading');

        resultsDiv.innerHTML = '';
        errorDiv.innerHTML = '';
        loadingDiv.style.display = 'block';

        const cuisine = cuisineInput.value.trim();
        const city = cityInput.value.trim();

        if (!cuisine || !city) {
          errorDiv.innerHTML = 'Please enter a cuisine and select a city';
          loadingDiv.style.display = 'none';
          return;
        }

        const query = encodeURIComponent(\`\${cuisine} in \${city}\`);

        try {
          const response = await fetch('/scrape?query=' + query, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
          });

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error('Network response was not ok: ' + response.status + ' - ' + errorText);
          }

          const data = await response.json();
          if (data.error) throw new Error(data.error);
          if (data.length === 0) {
            errorDiv.innerHTML = 'No results found. Try a different cuisine or city.';
          }

          data.forEach(item => {
            resultsDiv.innerHTML += \`
              <div class="result">
                <strong>\${item.title}</strong><br>
                Industry: \${item.industry}<br>
                City: \${item.city}<br>
                URL: <a href="\${item.url || '#'}" target="_blank">\${item.url || 'N/A'}</a><br>
                Rank: \${item.rank}<br>
                Source: \${item.source}<br>
                Scraped At: \${item.scrapedAt}<br>
                Email: \${item.email || 'N/A'}<br>
                Phone: \${item.phone || 'N/A'}<br>
                Address: \${item.address || 'N/A'}
              </div>
            \`;
          });
        } catch (error) {
          errorDiv.innerHTML = error.message.includes('Maps')
            ? 'Google Maps scraping failed. Try again or use a different query.'
            : 'Error: ' + error.message;
          console.error('Search error:', error);
        } finally {
          loadingDiv.style.display = 'none';
        }
      }
    </script>
  </body>
  </html>
  `);
});

// --- Scrape endpoint ---
app.get('/scrape', async (req, res) => {
  let query = req.query.query;
  if (!query) return res.status(400).json({ error: 'Query parameter is required' });
  query = query.replace(/restrurant/i, 'restaurant');

  try {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox','--disable-setuid-sandbox','--disable-gpu','--disable-dev-shm-usage','--disable-web-security']
    });

    const data = [];

    const [mapsResults, ypResults] = await Promise.all([
      scrapeGoogleMaps(browser, query).catch(() => []),
      scrapeYellowPages(browser, query).catch(() => [])
    ]);

    data.push(...mapsResults, ...ypResults);

    // Enhance with website info
    const MAX_CONCURRENT = 2;
    const promises = [];
    for (let item of data) {
      promises.push(enhanceWithWebsite(browser, item));
      if (promises.length >= MAX_CONCURRENT) {
        await Promise.all(promises);
        promises.length = 0;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    await Promise.all(promises);

    const uniqueData = [...new Map(data.map(i => [i.title.toLowerCase(), i])).values()];
    await browser.close();
    res.json(uniqueData);
  } catch (error) {
    console.error('Scrape error:', error);
    res.status(500).json({ error: 'Scraping failed: ' + error.message });
  }
});

// --- Puppeteer functions ---
async function scrapeGoogleMaps(browser, query) {
  const page = await browser.newPage();
  const items = [];
  try {
    await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(query)}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(5000);

    const businessNames = await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('.hfpxzc'));
      return elements.slice(0, 5).map(el => el.textContent.trim());
    });

    businessNames.forEach((name, i) => {
      items.push({
        title: name,
        industry: 'Restaurants',
        city: query.split(' in ')[1] || 'Unknown',
        url: '',
        rank: i + 1,
        source: 'maps',
        scrapedAt: new Date().toISOString(),
        email: '',
        phone: '',
        address: ''
      });
    });
  } catch (e) { console.error('Google Maps error:', e.message); }
  finally { await page.close(); }
  return items;
}

async function scrapeYellowPages(browser, query) {
  const parts = query.split(' in ');
  const searchTerm = parts[0];
  const location = parts[1] || 'Toronto';
  const page = await browser.newPage();
  const items = [];
  try {
    await page.goto(`https://www.yellowpages.ca/search/si/1/${encodeURIComponent(searchTerm)}/${encodeURIComponent(location)}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(3000);
    const results = await page.evaluate((max) => {
      const items = [];
      const businesses = document.querySelectorAll('.listing__content__wrap');
      businesses.forEach((b, idx) => {
        if (idx >= max) return;
        const name = b.querySelector('.listing__name a')?.textContent.trim() || '';
        const phone = b.querySelector('.mlr__item--phone')?.textContent.trim() || '';
        const website = b.querySelector('.mlr__item--website a')?.href || '';
        const email = b.querySelector('.mlr__item--email a')?.href.replace('mailto:', '') || '';
        const address = b.querySelector('.listing__address')?.textContent.trim() || '';
        items.push({ title: name, industry:'Restaurants', city: location, url: website, rank: idx+1, source:'yellowpages', scrapedAt: new Date().toISOString(), email, phone, address });
      });
      return items;
    }, MAX_RESULTS_PER_SOURCE);
    items.push(...results);
  } catch (e) { console.error('Yellow Pages error:', e.message); }
  finally { await page.close(); }
  return items;
}

async function enhanceWithWebsite(browser, item) {
  if (!item.url) return;
  const page = await browser.newPage();
  try {
    await page.goto(item.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const content = await page.evaluate(() => document.body.innerText);

    const emails = content.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g) || [];
    const phones = content.match(/\b((\+?1)?[\s.-]?)?(\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}\b/g) || [];

    if (emails.length && !item.email) item.email = emails[0];
    if (phones.length && !item.phone) item.phone = phones[0];
  } catch (e) { console.error('Website enhancement error:', e.message); }
  finally { await page.close(); }
}

// Start server
app.listen(port, () => console.log(`Server running at http://localhost:${port}`));
