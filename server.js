const express = require("express");
const { chromium } = require("playwright");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

// Helper: Retry navigation with exponential backoff
async function navigateWithRetry(page, url, maxRetries = 2, timeout = 30000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout });
      return true;
    } catch (err) {
      console.warn(`Navigation attempt ${attempt} failed for ${url}: ${err.message}`);
      if (attempt === maxRetries) throw err;
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // Backoff
    }
  }
}

// Extract email & phone from website
async function extractEmailFromWebsite(page, url) {
  try {
    await navigateWithRetry(page, url, 2, 10000);
    const content = await page.content();
    const emailMatch = content.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,}/);
    const phoneMatch = content.match(/(\+?\d{1,3}[-.\s]?)?(\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}/);
    return {
      email: emailMatch ? emailMatch[0] : "N/A",
      phone: phoneMatch ? phoneMatch[0] : "N/A",
    };
  } catch (err) {
    console.error(`Error extracting from ${url}: ${err.message}`);
    return { email: "N/A", phone: "N/A" };
  }
}

// Scrape Google Maps
async function scrapeGoogleMaps(browser, searchQuery, city, scrapedAt) {
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
  });
  const page = await context.newPage();
  try {
    const mapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(searchQuery)}/`;
    console.log(`📍 Scraping Google Maps: ${mapsUrl}`);
    await navigateWithRetry(page, mapsUrl, 2, 30000);
    await page.waitForSelector(".Nv2PK, .hfpxzc", { timeout: 30000 }); // Fallback selector

    return await page.evaluate((scrapedAt, city) => {
      const elements = document.querySelectorAll(".Nv2PK, .hfpxzc"); // Fallback selector
      return Array.from(elements).slice(0, 5).map((el, index) => {
        const title = el.querySelector(".qBF1Pd, .fontHeadlineSmall")?.textContent.trim() || "N/A";
        const description = el.querySelector(".W4Efsd, .fontBodyMedium")?.textContent.trim() || "N/A";
        const url = el.querySelector("a")?.href || "N/A";
        const rating = el.querySelector(".MW4etd, .fontBodyMedium span[aria-hidden]")?.textContent.trim() || "N/A";
        return {
          Industry: description.includes("restaurant") ? "Restaurant" : description,
          City: city,
          "Title / Business": title,
          URL: url,
          Rank: index + 1,
          Source: "Google Maps",
          ScrapedAt: scrapedAt,
          Phone: "N/A",
          Email: "N/A",
          Rating: rating,
        };
      });
    }, scrapedAt, city);
  } catch (err) {
    console.error("⚠️ Google Maps scraping failed:", err.message);
    return [];
  } finally {
    await page.close();
    await context.close();
  }
}

// Scrape Yelp
async function scrapeYelp(browser, searchQuery, city, scrapedAt) {
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
  });
  const page = await context.newPage();
  try {
    const yelpUrl = `https://www.yelp.com/search?find_desc=${encodeURIComponent(searchQuery)}&find_loc=${encodeURIComponent(city)}`;
    console.log(`📞 Scraping Yelp: ${yelpUrl}`);
    await navigateWithRetry(page, yelpUrl, 2, 30000);
    await page.waitForSelector(".css-1qn0b6x, .css-1l5lt1i", { timeout: 30000 }); // Fallback selector

    const results = await page.evaluate((scrapedAt, city) => {
      const elements = document.querySelectorAll(".css-1qn0b6x, .css-1l5lt1i"); // Fallback selector
      return Array.from(elements).slice(0, 5).map((el, index) => {
        const title = el.querySelector("a.css-19v1rkv, a.css-166la90")?.textContent.trim() || "N/A";
        const url = el.querySelector("a.css-19v1rkv, a.css-166la90")?.href || "N/A";
        const phone = el.querySelector(".css-1p9ibgf, .css-1wayfxy")?.textContent.trim() || "N/A";
        const rating = el.querySelector(".css-1fdy0l5, .css-gutk1c")?.getAttribute("aria-label")?.replace(" star rating", "") || "N/A";
        return {
          Industry: "Business",
          City: city,
          "Title / Business": title,
          URL: url.startsWith("http") ? url : `https://www.yelp.com${url}`,
          Rank: index + 1,
          Source: "Yelp",
          ScrapedAt: scrapedAt,
          Phone: phone,
          Email: "N/A",
          Rating: rating,
        };
      });
    }, scrapedAt, city);

    // Reuse page for website extraction
    for (let biz of results.slice(0, 3)) {
      if (biz.URL && biz.URL.startsWith("http")) {
        const extracted = await extractEmailFromWebsite(page, biz.URL);
        if (extracted.email !== "N/A") biz.Email = extracted.email;
        if (extracted.phone !== "N/A") biz.Phone = extracted.phone;
      }
    }

    return results;
  } catch (err) {
    console.error("⚠️ Yelp scraping failed:", err.message);
    return [];
  } finally {
    await page.close();
    await context.close();
  }
}

// Fallback Google search
async function searchGoogleForWebsite(browser, businessName, city, country = "Canada") {
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
  });
  const page = await context.newPage();
  try {
    const query = encodeURIComponent(`${businessName} ${city} ${country}`);
    const googleUrl = `https://www.google.com/search?q=${query}`;
    await navigateWithRetry(page, googleUrl, 2, 10000);

    const website = await page.evaluate(() => {
      const link = document.querySelector("a[href^='http']:not([href*='google'])");
      return link ? link.href : null;
    });

    if (website) {
      const extracted = await extractEmailFromWebsite(page, website);
      return { website, email: extracted.email, phone: extracted.phone };
    }
  } catch (err) {
    console.error(`Google fallback failed for ${businessName}: ${err.message}`);
  } finally {
    await page.close();
    await context.close();
  }
  return { website: "N/A", email: "N/A", phone: "N/A" };
}

// Main route
app.get("/scrape", async (req, res) => {
  const searchQuery = req.query.query;
  if (!searchQuery) {
    return res.status(400).json({ error: "Missing query parameter ?query=" });
  }

  const city = searchQuery.split("in ")[1]?.trim() || "N/A";
  const scrapedAt = new Date().toISOString();

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });

    // Parallelize scraping
    const [mapsResults, yelpResults] = await Promise.all([
      scrapeGoogleMaps(browser, searchQuery, city, scrapedAt),
      scrapeYelp(browser, searchQuery, city, scrapedAt),
    ]);

    // Merge and deduplicate
    const combined = [...mapsResults, ...yelpResults];
    const finalResults = [];
    const seen = new Set();
    for (let biz of combined) {
      const key = (biz["Title / Business"] || "N/A") + (biz.City || "N/A");
      if (!seen.has(key)) {
        seen.add(key);
        finalResults.push(biz);
      }
    }

    // Fallback Google search (limited to 2 businesses)
    let fallbackCount = 0;
    for (let biz of finalResults) {
      if ((biz.Email === "N/A" || biz.Phone === "N/A" || biz.URL === "N/A") && fallbackCount < 2) {
        const fallback = await searchGoogleForWebsite(browser, biz["Title / Business"], biz.City);
        if (fallback.website !== "N/A") biz.URL = fallback.website;
        if (fallback.email !== "N/A") biz.Email = fallback.email;
        if (fallback.phone !== "N/A") biz.Phone = fallback.phone;
        fallbackCount++;
      }
    }

    res.json({ count: finalResults.length, results: finalResults });
  } catch (err) {
    console.error("❌ Scraping error:", err);
    res.status(500).json({ error: `Scraping failed: ${err.message}. Please try again or check the query.` });
  } finally {
    if (browser) await browser.close();
  }
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));