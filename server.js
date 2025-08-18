const express = require("express");
const cors = require("cors");
const chromium = require("chrome-aws-lambda");

const app = express();
app.use(express.json());
app.use(cors());

// -------------------------
// Puppeteer functions
// -------------------------
async function extractEmailFromWebsite(browser, url) {
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });

    const content = await page.content();
    const emailMatch = content.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,}/);
    const phoneMatch = content.match(/(\+?\d{1,3}[-.\s]?)?(\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}/);

    await page.close();
    return { email: emailMatch ? emailMatch[0] : "N/A", phone: phoneMatch ? phoneMatch[0] : "N/A" };
  } catch (err) {
    return { email: "N/A", phone: "N/A" };
  }
}

async function searchGoogleForWebsite(browser, businessName, city, country = "Canada") {
  const page = await browser.newPage();
  const query = encodeURIComponent(`${businessName} ${city} ${country}`);
  const googleUrl = `https://www.google.com/search?q=${query}`;
  await page.goto(googleUrl, { waitUntil: "networkidle2" });

  try {
    const website = await page.evaluate(() => {
      const link = document.querySelector("a[href^='http']");
      return link ? link.href : null;
    });

    if (website) {
      const extracted = await extractEmailFromWebsite(browser, website);
      await page.close();
      return { website, email: extracted.email, phone: extracted.phone };
    }
  } catch (err) {
    console.log("⚠️ Google fallback failed:", businessName);
  }

  await page.close();
  return { website: "N/A", email: "N/A", phone: "N/A" };
}

// -------------------------
// API Endpoint
// -------------------------
app.post("/scrape", async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: "Missing search query" });

  const city = query.split("in ")[1] || "N/A";
  const country = "Canada";
  const scrapedAt = new Date().toISOString();

  const browser = await chromium.puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath,
    headless: chromium.headless,
  });

  try {
    const page = await browser.newPage();

    // ---------- Google Maps ----------
    const mapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}/`;
    await page.goto(mapsUrl, { waitUntil: "networkidle2" });
    await page.waitForSelector(".Nv2PK", { timeout: 60000 });

    const mapsResults = await page.evaluate((scrapedAt, city) => {
      return Array.from(document.querySelectorAll(".Nv2PK")).map((el, index) => {
        const title = el.querySelector(".qBF1Pd")?.textContent.trim() || "N/A";
        const description = el.querySelector(".W4Efsd")?.textContent.trim() || "N/A";
        const url = el.querySelector("a")?.href || "N/A";
        const rating = el.querySelector(".MW4etd")?.textContent.trim() || "N/A";

        return {
          BusinessName: title,
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

    // ---------- YellowPages ----------
    const ypUrl = `https://www.yellowpages.ca/search/si/1/${encodeURIComponent(query)}`;
    await page.goto(ypUrl, { waitUntil: "networkidle2" });

    let ypResults = [];
    try {
      await page.waitForSelector(".listing__content", { timeout: 30000 });
      ypResults = await page.evaluate((scrapedAt, city) => {
        return Array.from(document.querySelectorAll(".listing__content")).map((el, index) => {
          const title = el.querySelector(".listing__name--link")?.textContent.trim() || "N/A";
          const website = el.querySelector(".mlr__item--website a")?.href || el.querySelector(".listing__name--link")?.href || "N/A";
          const phone = el.querySelector(".mlr__item--phone")?.textContent.trim() || "N/A";

          return {
            BusinessName: title,
            Industry: "Business",
            City: city,
            "Title / Business": title,
            URL: website,
            Rank: index + 1,
            Source: "YellowPages",
            ScrapedAt: scrapedAt,
            Phone: phone,
            Email: "N/A",
            Rating: "N/A",
          };
        });
      }, scrapedAt, city);

      for (let biz of ypResults) {
        if (biz.URL && biz.URL.startsWith("http")) {
          const extracted = await extractEmailFromWebsite(browser, biz.URL);
          if (extracted.email !== "N/A") biz.Email = extracted.email;
          if (extracted.phone !== "N/A") biz.Phone = extracted.phone;
        }
      }
    } catch {}

    // ---------- Merge & Deduplicate ----------
    const combined = [...mapsResults, ...ypResults];
    const finalResults = [];
    const seen = new Set();
    for (let biz of combined) {
      const key = biz.BusinessName + biz.City;
      if (!seen.has(key)) {
        seen.add(key);
        finalResults.push(biz);
      }
    }

    // ---------- Fallback ----------
    for (let biz of finalResults) {
      if (biz.Email === "N/A" || biz.Phone === "N/A" || biz.URL === "N/A") {
        const fallback = await searchGoogleForWebsite(browser, biz.BusinessName, biz.City, country);
        if (fallback.website !== "N/A") biz.URL = fallback.website;
        if (fallback.email !== "N/A") biz.Email = fallback.email;
        if (fallback.phone !== "N/A") biz.Phone = fallback.phone;
      }
    }

    await browser.close();
    res.json({ results: finalResults });
  } catch (err) {
    await browser.close();
    res.status(500).json({ error: "Scraping failed", details: err.message });
  }
});

// ---------- Start Server ----------
const PORT = https://data-bot-3hrl.onrender.com/ || 3000;
app.listen(PORT, () => console.log(`🚀 Scraper API running on port ${PORT}`));
