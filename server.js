// scraper.js
const puppeteer = require("puppeteer");
const fs = require("fs");
const readline = require("readline");

// Ask for user input
function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) =>
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans);
    })
  );
}

// Extract email from a website by visiting it
async function extractEmailFromWebsite(browser, url) {
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });

    const content = await page.content();
    const emailMatch = content.match(
      /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,}/
    );

    const phoneMatch = content.match(
      /(\+?\d{1,3}[-.\s]?)?(\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}/
    );

    await page.close();
    return {
      email: emailMatch ? emailMatch[0] : "N/A",
      phone: phoneMatch ? phoneMatch[0] : "N/A",
    };
  } catch (err) {
    return { email: "N/A", phone: "N/A" };
  }
}

// Fallback Google search for missing websites/emails
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

(async () => {
  try {
    const searchQuery = await askQuestion(
      "Enter what to search (e.g. restaurants in Vernon): "
    );
    const city = searchQuery.split("in ")[1] || "N/A";
    const country = "Canada"; // Change if needed
    const scrapedAt = new Date().toISOString();

    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    // ==========================
    // 🔹 1. Google Maps Scraper
    // ==========================
    const mapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(
      searchQuery
    )}/`;

    console.log(`📍 Scraping Google Maps: ${mapsUrl}`);
    await page.goto(mapsUrl, { waitUntil: "networkidle2" });
    await page.waitForSelector(".Nv2PK", { timeout: 60000 });

    const mapsResults = await page.evaluate(
      (scrapedAt, city) => {
        return Array.from(document.querySelectorAll(".Nv2PK")).map(
          (el, index) => {
            const title =
              el.querySelector(".qBF1Pd")?.textContent.trim() || "N/A";
            const description =
              el.querySelector(".W4Efsd")?.textContent.trim() || "N/A";
            const url = el.querySelector("a")?.href || "N/A";
            const rating =
              el.querySelector(".MW4etd")?.textContent.trim() || "N/A";

            return {
              Industry: description.includes("restaurant")
                ? "Restaurant"
                : description,
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
          }
        );
      },
      scrapedAt,
      city
    );

    // ==========================
    // 🔹 2. YellowPages Scraper
    // ==========================
    const ypUrl = `https://www.yellowpages.ca/search/si/1/${encodeURIComponent(
      searchQuery
    )}`;

    console.log(`📞 Scraping YellowPages: ${ypUrl}`);
    await page.goto(ypUrl, { waitUntil: "networkidle2" });

    let ypResults = [];
    try {
      await page.waitForSelector(".listing__content", { timeout: 30000 });
      ypResults = await page.evaluate(
        (scrapedAt, city) => {
          return Array.from(
            document.querySelectorAll(".listing__content")
          ).map((el, index) => {
            const title =
              el.querySelector(".listing__name--link")?.textContent.trim() ||
              "N/A";
            const profileUrl =
              el.querySelector(".listing__name--link")?.href || "N/A";
            const phone =
              el.querySelector(".mlr__item--phone")?.textContent.trim() ||
              "N/A";
            const website =
              el.querySelector(".mlr__item--website a")?.href || "N/A";

            return {
              Industry: "Business",
              City: city,
              "Title / Business": title,
              URL: website !== "N/A" ? website : profileUrl,
              Rank: index + 1,
              Source: "YellowPages",
              ScrapedAt: scrapedAt,
              Phone: phone,
              Email: "N/A", // Will fill later
              Rating: "N/A",
            };
          });
        },
        scrapedAt,
        city
      );

      // Visit each website and try to extract email & phone
      for (let biz of ypResults) {
        if (biz.URL && biz.URL.startsWith("http")) {
          console.log(`🔍 Checking email & phone for: ${biz["Title / Business"]}`);
          const extracted = await extractEmailFromWebsite(browser, biz.URL);
          if (extracted.email !== "N/A") biz.Email = extracted.email;
          if (extracted.phone !== "N/A") biz.Phone = extracted.phone;
        }
      }
    } catch (err) {
      console.log("⚠️ No YellowPages results found or structure changed.");
    }

    // ==========================
    // 🔹 3. Merge & Remove Duplicates
    // ==========================
    const combined = [...mapsResults, ...ypResults];
    const finalResults = [];
    const seen = new Set();

    for (let biz of combined) {
      const key = biz["Title / Business"] + biz.City;
      if (!seen.has(key)) {
        seen.add(key);
        finalResults.push(biz);
      }
    }

    // ==========================
    // 🔹 4. Fallback Google search for missing email/phone
    // ==========================
    for (let biz of finalResults) {
      if (
        biz.Email === "N/A" ||
        biz.Phone === "N/A" ||
        biz.URL === "N/A"
      ) {
        console.log(`🔍 Fallback search for: ${biz["Title / Business"]}`);
        const fallback = await searchGoogleForWebsite(
          browser,
          biz["Title / Business"],
          biz.City,
          country
        );
        if (fallback.website !== "N/A") biz.URL = fallback.website;
        if (fallback.email !== "N/A") biz.Email = fallback.email;
        if (fallback.phone !== "N/A") biz.Phone = fallback.phone;
      }
    }

    // ==========================
    // 🔹 5. Save Results
    // ==========================
    fs.writeFileSync("results.json", JSON.stringify(finalResults, null, 2));
    console.log(
      `✅ Scraping complete. Saved ${finalResults.length} records to results.json`
    );

    await browser.close();
  } catch (error) {
    console.error("❌ Error during scraping:", error);
  }
})();
