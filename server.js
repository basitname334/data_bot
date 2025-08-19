const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000; // Use Render's PORT env variable
const MAX_RESULTS_PER_SOURCE = 5;

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
          const cuisine = document.getElementById('cuisine').value;
          const city = document.getElementById('city').value;
          const query = \`\${cuisine} in \${city}\`;
          const resultsDiv = document.getElementById('results');
          const errorDiv = document.getElementById('error');
          const loadingDiv = document.getElementById('loading');
          
          errorDiv.innerHTML = '';
          resultsDiv.innerHTML = '';
          loadingDiv.style.display = 'block';

          if (!cuisine || !city) {
            errorDiv.innerHTML = 'Please enter a cuisine and select a city';
            loadingDiv.style.display = 'none';
            return;
          }

          try {
            const response = await fetch('/scrape?query=' + encodeURIComponent(query), {
              method: 'GET',
              headers: { 'Content-Type': 'application/json' },
              timeout: 60000
            });
            if (!response.ok) {
              const errorText = await response.text();
              throw new Error('Network response was not ok: ' + response.status + ' - ' + errorText);
            }
            const data = await response.json();
            if (data.error) {
              throw new Error(data.error);
            }
            if (data.length === 0) {
              errorDiv.innerHTML = 'No results found. Try a different cuisine or city.';
            }
            data.forEach(item => {
              resultsDiv.innerHTML += \`<div class="result"><strong>\${item.title}</strong><br>Industry: \${item.industry}<br>City: \${item.city}<br>URL: <a href="\${item.url}" target="_blank">\${item.url || 'N/A'}</a><br>Rank: \${item.rank}<br>Source: \${item.source}<br>Scraped At: \${item.scrapedAt}<br>Email: \${item.email || 'N/A'}<br>Phone: \${item.phone || 'N/A'}<br>Address: \${item.address || 'N/A'}</div>\`;
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

app.get('/scrape', async (req, res) => {
  let query = req.query.query;
  if (!query) {
    return res.status(400).json({ error: 'Query parameter is required' });
  }
  query = query.replace(/restrurant/i, 'restaurant'); // Fix common typo
  console.log(`Starting scrape for query: ${query}`);

  try {
    console.log('Launching Puppeteer with bundled Chrome...');
    const browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--disable-web-security',
        '--single-process', // Reduce memory usage
      ],
    });

    const data = [];
    
    console.log('Scraping Google Maps and Yellow Pages in parallel...');
    const [googleMapsResults, yellowPagesResults] = await Promise.all([
      scrapeGoogleMaps(browser, query).catch(err => {
        console.error('Google Maps failed:', err.message);
        return [];
      }),
      scrapeYellowPages(browser, query).catch(err => {
        console.error('Yellow Pages failed:', err.message);
        return [];
      })
    ]);

    data.push(...googleMapsResults, ...yellowPagesResults);

    console.log('Enhancing data from websites...');
    const MAX_CONCURRENT_WEBSITES = 2;
    const websitePromises = [];
    for (let item of data) {
      websitePromises.push(enhanceWithWebsite(browser, item));
      if (websitePromises.length >= MAX_CONCURRENT_WEBSITES) {
        await Promise.all(websitePromises);
        websitePromises.length = 0;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    await Promise.all(websitePromises);

    const uniqueData = [...new Map(data.map(item => [item.title.toLowerCase(), item])).values()];
    console.log(`After dedup, ${uniqueData.length} results`);

    await browser.close();
    console.log(`Scraping complete, found ${uniqueData.length} results`);
    res.json(uniqueData);
  } catch (error) {
    console.error('Scrape error:', error);
    res.status(500).json({ error: `Scraping failed: ${error.message}` });
  }
});

async function scrapeGoogleMaps(browser, query) {
  const page = await browser.newPage();
  const items = [];
  const MAX_RETRIES = 3;

  try {
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
    });
    await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(query)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        console.log(`Attempt ${attempt} to find business links...`);
        await page.waitForSelector('.hfpxzc', { timeout: 30000 });
        const businessLinks = await page.$$('.hfpxzc');
        if (businessLinks.length > 0) {
          await page.evaluate(async () => {
            const scrollable = document.querySelector('.m6QErb.DxyBCb');
            if (scrollable) {
              for (let i = 0; i < 5; i++) {
                scrollable.scrollBy(0, 2000);
                await new Promise(resolve => setTimeout(resolve, 2000));
              }
            }
          });

          const freshLinks = await page.$$('.hfpxzc');
          for (let i = 0; i < Math.min(freshLinks.length, MAX_RESULTS_PER_SOURCE); i++) {
            try {
              await page.evaluate((el) => {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }, freshLinks[i]);
              await new Promise(resolve => setTimeout(resolve, 1500));

              await freshLinks[i].click();
              await page.waitForSelector('h1.DUwDvf', { timeout: 20000 });

              const details = await page.evaluate(() => {
                const name = document.querySelector('h1.DUwDvf')?.textContent.trim() || '';
                const phone = document.querySelector('button[data-item-id^="phone"]')?.getAttribute('aria-label')?.replace('Phone: ', '')?.trim() || '';
                const website = document.querySelector('a[data-item-id="authority"]')?.getAttribute('href') || '';
                const address = document.querySelector('button[data-item-id="address"]')?.getAttribute('aria-label')?.replace('Address: ', '')?.trim() || '';
                return { name, phone, website, address, email: '' };
              });

              if (details.name) {
                items.push({
                  industry: 'Restaurants',
                  city: query.split(' in ')[1] || 'Unknown',
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

              await page.goBack({ waitUntil: 'domcontentloaded', timeout: 20000 });
              await new Promise(resolve => setTimeout(resolve, 2000));
            } catch (e) {
              console.error(`Error scraping Maps detail ${i + 1}:`, e.message);
              continue;
            }
          }
          break;
        }
      } catch (e) {
        console.error(`Attempt ${attempt} failed:`, e.message);
        if (attempt === MAX_RETRIES) console.error('Max retries reached for Google Maps.');
      }
    }
  } catch (error) {
    console.error('Google Maps scrape error:', error.message);
  } finally {
    await page.close();
  }
  return items;
}

async function scrapeYellowPages(browser, query) {
  const parts = query.split(' in ');
  const searchTerm = parts[0];
  const location = parts[1] || 'Toronto';
  const page = await browser.newPage();
  try {
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
    });
    await page.goto(`https://www.yellowpages.ca/search/si/1/${encodeURIComponent(searchTerm)}/${encodeURIComponent(location)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 45000
    });
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
          city: location,
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
  if (!item.url) {
    console.log(`Skipping website scrape for ${item.title}: no URL provided`);
    return;
  }

  const page = await browser.newPage();
  const MAX_RETRIES = 2;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`Attempt ${attempt} to scrape website for ${item.title}: ${item.url}`);
      await page.goto(item.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      const content = await page.evaluate(() => document.body.innerText);

      const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
      const emails = content.match(emailRegex) || [];
      const phoneRegex = /\b((\+?1)?[\s.-]?)?(\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}\b/g;
      const phones = content.match(phoneRegex) || [];

      console.log(`Scraped for ${item.title}: emails=${emails.join(', ')}, phones=${phones.join(', ')}`);

      if (emails.length > 0 && !item.email) {
        item.email = emails[0];
        console.log(`Assigned email for ${item.title}: ${item.email}`);
      }
      if (phones.length > 0 && !item.phone) {
        item.phone = phones[0];
        console.log(`Assigned phone for ${item.title}: ${item.phone}`);
      }

      const addressRegex = /\d{1,5}\s+\w+\s+\w+(\s+\w+)*,?\s*${item.city},\s*ON\s*[A-Z0-9]{3}\s*[A-Z0-9]{3}/gi;
      const addresses = content.match(addressRegex) || [];
      if (addresses.length > 0 && !item.address) {
        item.address = addresses[0];
        console.log(`Assigned address for ${item.title}: ${item.address}`);
      }

      break;
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