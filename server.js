const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');

const app = express();
const port = 3000;
const MAX_RESULTS_PER_SOURCE = 5; // Reduced to 5 to lower resource usage

// Middleware
const corsOptions = {
  origin: ['https://data-bot-3hrl.onrender.com', 'http://localhost:3000'],
  methods: ['GET', 'POST'],
};
app.use(cors(corsOptions));
app.use(express.json());

// Serve static HTML page
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Restaurant Scraper</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        input { padding: 8px; width: 300px; }
        button { padding: 8px 16px; margin-left: 10px; }
        #results { margin-top: 20px; }
        .result { border: 1px solid #ccc; padding: 10px; margin-bottom: 10px; }
        #error { color: red; margin-top: 10px; }
        #loading { display: none; margin-top: 10px; }
      </style>
    </head>
    <body>
      <h1>Restaurant Scraper</h1>
      <input type="text" id="query" placeholder="Enter restaurant search (e.g., Italian in Toronto)">
      <button onclick="search()">Search</button>
      <div id="loading">Loading...</div>
      <div id="error"></div>
      <div id="results"></div>
      <script>
        async function search() {
          const query = document.getElementById('query').value;
          const resultsDiv = document.getElementById('results');
          const errorDiv = document.getElementById('error');
          const loadingDiv = document.getElementById('loading');
          
          errorDiv.innerHTML = '';
          resultsDiv.innerHTML = '';
          loadingDiv.style.display = 'block';

          if (!query) {
            errorDiv.innerHTML = 'Please enter a search query';
            loadingDiv.style.display = 'none';
            return;
          }

          try {
            const response = await fetch('/scrape?query=' + encodeURIComponent(query), {
              method: 'GET',
              headers: { 'Content-Type': 'application/json' },
              timeout: 60000 // Increased timeout
            });
            if (!response.ok) {
              const errorText = await response.text();
              throw new Error('Network response was not ok: ' + response.status + ' - ' + errorText);
            }
            const data = await response.json();
            if (data.error) {
              throw new Error(data.error);
            }
            data.forEach(item => {
              resultsDiv.innerHTML += \`<div class="result"><strong>\${item.title}</strong><br>Industry: \${item.industry}<br>City: \${item.city}<br>URL: <a href="\${item.url}" target="_blank">\${item.url || 'N/A'}</a><br>Rank: \${item.rank}<br>Source: \${item.source}<br>Scraped At: \${item.scrapedAt}<br>Email: \${item.email || 'N/A'}<br>Phone: \${item.phone || 'N/A'}<br>Address: \${item.address || 'N/A'}</div>\`;
            });
          } catch (error) {
            errorDiv.innerHTML = 'Error: ' + error.message;
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

app.get('/scrape', async (req, res) => {
  const query = req.query.query;
  if (!query) {
    return res.status(400).json({ error: 'Query parameter is required' });
  }

  console.log(`Starting scrape for query: ${query}`);

  try {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
    });
    const data = [];

    // Scrape sequentially to reduce resource usage
    console.log('Scraping Google Search...');
    data.push(...await scrapeGoogleSearch(browser, query));

    console.log('Scraping Google Maps...');
    data.push(...await scrapeGoogleMaps(browser, query));

    console.log('Scraping Yellow Pages...');
    data.push(...await scrapeYellowPages(browser, query));

    // Enhance data with website scraping
    console.log('Enhancing data from websites...');
    for (let item of data) {
      await enhanceWithWebsite(browser, item);
      await new Promise(resolve => setTimeout(resolve, 1000)); // Delay to avoid rate limiting
    }

    // Deduplicate by title (case-insensitive)
    const uniqueData = [...new Map(data.map(item => [item.title.toLowerCase(), item])).values()];

    // Filter out items missing both phone and email
    const filteredData = uniqueData.filter(item => item.email || item.phone);
    console.log(`After dedup and filtering, ${filteredData.length} results have at least one contact method`);

    await browser.close();
    console.log(`Scraping complete, found ${filteredData.length} results`);
    res.json(filteredData);
  } catch (error) {
    console.error('Scrape error:', error);
    res.status(500).json({ error: `Scraping failed: ${error.message}` });
  }
});

async function scrapeGoogleSearch(browser, query) {
  const page = await browser.newPage();
  try {
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
    });
    await page.goto(`https://www.google.com/search?q=${encodeURIComponent(query)}`, { waitUntil: 'networkidle2', timeout: 45000 });
    const results = await page.evaluate((max) => {
      const items = [];
      const businesses = document.querySelectorAll('.Nv2PK');
      businesses.forEach((business, index) => {
        if (index >= max) return;
        const name = business.querySelector('.qBF1Pd')?.textContent.trim() || '';
        const phone = business.querySelector(".W4Efsd:last-child > .W4Efsd:nth-of-type(3) > span:last-child")?.textContent.replaceAll("·", "").trim() || '';
        const website = business.querySelector("a.lcr4fd")?.getAttribute("href") || '';
        const email = '';
        const address = business.querySelector('.W4Efsd:last-child > .W4Efsd:nth-of-type(2) > span:last-child')?.textContent.trim() || '';
        items.push({
          industry: 'Restaurants',
          city: 'Toronto',
          title: name,
          url: website,
          rank: index + 1,
          source: 'google',
          scrapedAt: new Date().toISOString(),
          email,
          phone,
          address
        });
      });
      return items;
    }, MAX_RESULTS_PER_SOURCE);
    return results;
  } catch (error) {
    console.error('Google Search scrape error:', error);
    return [];
  } finally {
    await page.close();
  }
}

async function scrapeGoogleMaps(browser, query) {
  const page = await browser.newPage();
  const items = [];
  const MAX_RETRIES = 3;

  try {
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
    });
    await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(query)}`, {
      waitUntil: 'networkidle2',
      timeout: 45000,
    });

    let businessLinks = [];
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        console.log(`Attempt ${attempt} to find business links...`);
        await page.waitForSelector('a[href*="google.com/maps/place"]', { timeout: 20000 });
        businessLinks = await page.$$('a[href*="google.com/maps/place"]');
        if (businessLinks.length > 0) break;
        console.log(`No business links found, retrying (${attempt}/${MAX_RETRIES})...`);
        await new Promise(resolve => setTimeout(resolve, 3000));
      } catch (e) {
        console.error(`Attempt ${attempt} failed:`, e.message);
        if (attempt === MAX_RETRIES) {
          console.error('Max retries reached for selector, skipping Google Maps.');
          return items;
        }
      }
    }

    await page.evaluate(async () => {
      const scrollable = document.querySelector('.m6QErb.DxyBCb');
      if (scrollable) {
        for (let i = 0; i < 5; i++) {
          scrollable.scrollBy(0, 2000);
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }
    });

    businessLinks = await page.$$('a[href*="google.com/maps/place"]');

    for (let i = 0; i < Math.min(businessLinks.length, MAX_RESULTS_PER_SOURCE); i++) {
      try {
        const freshLinks = await page.$$('a[href*="google.com/maps/place"]');
        if (i >= freshLinks.length) break;

        await page.evaluate((el) => {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, freshLinks[i]);
        await new Promise(resolve => setTimeout(resolve, 1500));

        await freshLinks[i].click();
        await page.waitForSelector('h1.DUwDvf', { timeout: 20000 });

        const details = await page.evaluate(() => {
          const name = document.querySelector('h1.DUwDvf')?.textContent.trim() || '';
          const phoneButton = document.querySelector('button[data-item-id^="phone"]');
          const phone = phoneButton ? phoneButton.getAttribute('aria-label')?.replace('Phone: ', '')?.trim() || '' : '';
          const websiteButton = document.querySelector('a[data-item-id="authority"]');
          const website = websiteButton ? websiteButton.getAttribute('href') || '' : '';
          const email = '';
          const addressButton = document.querySelector('button[data-item-id="address"]');
          const address = addressButton ? addressButton.getAttribute('aria-label')?.replace('Address: ', '')?.trim() || '' : '';
          return { name, phone, website, email, address };
        });

        if (details.name) {
          items.push({
            industry: 'Restaurants',
            city: 'Toronto',
            title: details.name,
            url: details.website,
            rank: i + 1,
            source: 'maps',
            scrapedAt: new Date().toISOString(),
            email: details.email,
            phone: details.phone,
            address: details.address,
          });
        }

        await page.goBack({ waitUntil: 'networkidle2', timeout: 20000 });
        await page.waitForSelector('a[href*="google.com/maps/place"]', { timeout: 20000 });
        await new Promise(resolve => setTimeout(resolve, 3000));
      } catch (e) {
        console.error(`Error scraping Maps detail ${i + 1}:`, e.message);
        continue;
      }
    }

    return items;
  } catch (error) {
    console.error('Google Maps scrape error:', error.message);
    return items;
  } finally {
    await page.close();
  }
}

async function scrapeYellowPages(browser, query) {
  const parts = query.split(' in ');
  const searchTerm = parts[0];
  const location = 'Toronto';
  const page = await browser.newPage();
  try {
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
    });
    await page.goto(`https://www.yellowpages.ca/search/si/1/${encodeURIComponent(searchTerm)}/${encodeURIComponent(location)}`, { waitUntil: 'networkidle2', timeout: 45000 });
    const results = await page.evaluate((max) => {
      const items = [];
      const businesses = document.querySelectorAll('.listing__content__wrap');
      businesses.forEach((business, index) => {
        if (index >= max) return;
        const name = business.querySelector('.listing__name a')?.textContent.trim() || '';
        const phone = business.querySelector('.mlr__item--phone')?.textContent.trim() || '';
        const website = business.querySelector('.mlr__item--website a')?.href || '';
        const email = business.querySelector('.mlr__item--email a')?.href.replace('mailto:', '') || '';
        const address = business.querySelector('.listing__address')?.textContent.trim() || '';
        items.push({
          industry: 'Restaurants',
          city: 'Toronto',
          title: name,
          url: website,
          rank: index + 1,
          source: 'yellowpages',
          scrapedAt: new Date().toISOString(),
          email,
          phone,
          address
        });
      });
      return items;
    }, MAX_RESULTS_PER_SOURCE);
    return results;
  } catch (error) {
    console.error('Yellow Pages scrape error:', error);
    return [];
  } finally {
    await page.close();
  }
}

async function enhanceWithWebsite(browser, item) {
  if (!item.url || item.email || item.phone) {
    console.log(`Skipping website scrape for ${item.title}: already has contact info (email: ${item.email}, phone: ${item.phone})`);
    return;
  }

  const page = await browser.newPage();
  const MAX_RETRIES = 2;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`Attempt ${attempt} to scrape website for ${item.title}: ${item.url}`);
      await page.goto(item.url, { waitUntil: 'networkidle2', timeout: 20000 });
      const content = await page.evaluate(() => document.body.innerText);

      const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
      const emails = content.match(emailRegex) || [];
      const phoneRegex = /\b((\+?1)?[\s.-]?)?(\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}\b/g;
      const phones = content.match(phoneRegex) || [];

      console.log(`Scraped for ${item.title}: emails=${emails.join(', ')}, phones=${phones.join(', ')}`);

      if (emails.length > 0) {
        item.email = emails[0];
        console.log(`Assigned email for ${item.title}: ${item.email}`);
        break;
      } else if (phones.length > 0) {
        item.phone = phones[0];
        console.log(`Assigned phone for ${item.title}: ${item.phone}`);
        break;
      }

      const addressRegex = /\d{1,5}\s+\w+\s+\w+(\s+\w+)*,?\s*Toronto,\s*ON\s*[A-Z0-9]{3}\s*[A-Z0-9]{3}/gi;
      const addresses = content.match(addressRegex) || [];
      item.address = item.address || addresses[0] || '';
      console.log(`Assigned address for ${item.title}: ${item.address}`);

      if (attempt === MAX_RETRIES) {
        console.warn(`No contact info found for ${item.title} after ${MAX_RETRIES} attempts`);
      }
    } catch (error) {
      console.error(`Website scrape error for ${item.url} (attempt ${attempt}):`, error.message);
      if (attempt === MAX_RETRIES) {
        console.warn(`Failed to scrape contact info for ${item.title} after ${MAX_RETRIES} attempts`);
      }
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }

  await page.close();
}

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});