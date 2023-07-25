const cheerio = require("cheerio");
const fetch = require("node-fetch");
const { Readability } = require("@mozilla/readability");
const { JSDOM } = require("jsdom");
const MAX_TOKENS = 4096;

const BASE_URL = "https://sg.search.yahoo.com/search";

const cleanText = (text) => {
  return text
    .replace(/\s\s+/g, " ") // Replace multiple spaces with a single space
    .replace(/\n/g, " ") // Replace newline characters with a space
    .trim(); // Remove spaces from the start and end of the text
};

async function getWebpageTitleAndText(url, html_str = "", numResults) {
  let html = html_str;
  if (!html) {
    let response;
    try {
      response = await fetch(url.startsWith("http") ? url : `https://${url}`);
    } catch (e) {
      return {
        title: "Could not fetch the page.",
        body: `Could not fetch the page: ${e}.\nMake sure the URL is correct.`,
        url,
      };
    }
    if (!response.ok) {
      return {
        title: "Could not fetch the page.",
        body: `Could not fetch the page: ${response.status} ${response.statusText}`,
        url,
      };
    }
    html = await response.text();
  }
  const { document } = new JSDOM(html).window;
  const parsed = new Readability(document).parse();

  if (!parsed || !parsed.textContent) {
    return {
      title: "Could not fetch the page.",
      body: "Could not parse the page.",
      url,
    };
  }

  let parsedContents;

  if (parsed && parsed.content && parsed.content.trim() !== "") {
      parsedContents = parsed.content.trim();
  }
  else {
      parsedContents = "No content found.";
  }
  

  const text = cleanText(parsedContents.textContent);
  const trimmedText = trimContent(text, parsedContents.length);
  console.log("trimmedText length", trimmedText.length);
  console.log("parsedContents length", parsedContents.length);

  return { title: parsed.title, body: trimmedText, url };
}

async function getHtml({ query, timerange }) {
  const params = new URLSearchParams({
    q: query,
    btf: timerange,
    nojs: "1",
    ei: "UTF-8",
  });
  const response = await fetch(`${BASE_URL}?${params.toString()}`);

  if (!response.ok) {
    throw new Error(
      `Failed to fetch: ${response.status} ${response.statusText}`
    );
  }

  return {
    status: response.status,
    html: await response.text(),
    url: response.url,
  };
}

function extractRealUrl(url) {
  const match = url.match(/RU=([^/]+)/);
  if (match && match[1]) {
    return decodeURIComponent(match[1]);
  }

  return url;
}

/*
const extractContent = async (url) => {
    try {
        const response = await fetch(url);
        const html = await response.text();
        const $ = cheerio.load(html);
        
        const h1 = $('h1').first();
        const h1Title = h1.text().trim();
        
        let content = '';
        let foundFooter = false;
        h1.parent().find('*').each((_, el) => {
            if ($(el).is('footer')) {
                foundFooter = true;
            }
            
            if (!foundFooter && $(el).is('p')) {
                content += '\n' + $(el).text().trim();
            }
        });

        content = cleanText(content);

        return {
            url,
            h1Title,
            content
        };
    } catch (error) {
        console.log(`Failed to fetch and parse content from url: ${url}`, error);
        return null;
    }
};
*/

const extractContent = async (url) => {
  try {
    const response = await fetch(url);
    const html = await response.text();
    const $ = cheerio.load(html);
    const h1Title = $("h1").first().text().trim();
    const extractContent = $("p").text().trim();

    const content = cleanText(extractContent);
    return {
      url,
      h1Title,
      content,
    };
  } catch (error) {
    console.log(`Failed to fetch and parse content from url: ${url}`, error);
    return null;
  }
};

const trimContent = (content, numResults) => {
  const maxTokens = Math.floor(MAX_TOKENS / numResults)-650;
  const words = content.split(' ');

  // If the content has more words than the max tokens, trim it
  if (words.length > maxTokens) {
    console.log("Trimming content from", words.length, "to", maxTokens, "tokens");
    return words.slice(0, maxTokens).join(' ') + "...";
  } else {
    return content;
  }
};


function htmlToSearchResults(html, numResults) {
  const $ = cheerio.load(html);
  const results = [];
  const rightPanel = $("#right .searchRightTop");
  if (rightPanel.length) {
    const rightPanelLink = rightPanel.find(".compText a").first();
    const rightPanelInfo = rightPanel.find(".compInfo li");
    const rightPanelInfoText = rightPanelInfo
      .map((_, el) => $(el).text().trim())
      .get()
      .join("\n");

    results.push({
      title: rightPanelLink.text().trim(),
      body: `${rightPanel.find(".compText").text().trim()}${
        rightPanelInfoText ? `\n\n${rightPanelInfoText}` : ""
      }`,
      url: extractRealUrl(rightPanelLink.attr("href") ?? ""),
    });
  }

  $('.algo-sr:not([class*="ad"])')
    .slice(0, numResults)
    .each((_, el) => {
      const element = $(el);
      const titleElement = element.find("h3.title a");

      results.push({
        title: titleElement.attr("aria-label") ?? "",
        body: element.find(".compText").text().trim(),
        url: extractRealUrl(titleElement.attr("href") ?? ""),
      });
    });

  return results;
}

async function webSearch(search, numResults) {
  const response = await getHtml(search);
  let results;
  if (response.url.startsWith(BASE_URL)) {
    results = htmlToSearchResults(response.html, numResults);

    let parsedContents = await Promise.all(
      results.map(({ url }) => extractContent(url, numResults))
    );

    parsedContents = parsedContents.filter(
      (item) => item && item.content && item.content.trim() !== ""
    );
    

    const initialPrompt = contentToPrompt(parsedContents, search);

    return initialPrompt;
  } else {
    const result = await getWebpageTitleAndText(
      response.url,
      response.htm,
      numResults
    );
    return [
      {
        title: result.title,
        body: result.body,
        url: response.url,
      },
    ];
  }
}

const contentToPrompt = (parsedContents, search) => {
  const date = new Date().toISOString();
  let searchResults = "";
  let number = 1;
  let length = parsedContents.length;
  for (let i = 0; i < length; i++) {
    try {
      searchResults += `\nNUMBER ${number}
      \nURL : ${parsedContents[i].url}
      \nTITLE : ${parsedContents[i].h1Title}
      \nCONTENT : ${trimContent(parsedContents[i].content, length)}\n`;
      number++;
    } catch (error) {
      console.error(`Error at index ${i}: ${error}`);
      continue;
    }
  }
  const initialPrompt = `I will give you a question or an instruction. Your objective is to answer my question or fulfill my instruction.
    My question or instruction is: ${search.query} For your reference, today's date is ${date}.\n
    It's possible that the question or instruction, or just a portion of it, requires relevant information from the internet to give a satisfactory answer or complete the task. It's possible that the question or instruction, or just a portion of it, requires relevant information from the internet to give a satisfactory answer or complete the task. I'm providing you with the necessary information already obtained from the internet below. This sets the context for addressing the question or fulfilling the instruction, so you don't need to access the internet to answer my question or fulfill my instruction. Write a comprehensive reply to the given question or instruction using the information provided below in the best way you can. Ensure to cite results using [[NUMBER](URL)] notation after the reference. If the provided information from the internet refers to multiple subjects with the same name, write separate answers for each subject.
    A strict requirement for you is that if the below information I provide does not contain the information you need to address the question or fulfill the instruction, just respond 'The search results do not contain the necessary content. Please try again with different query and/or search options (e.g., number of search results, search engine, etc.).'
    Now, write a comprehensive reply to the given question or instruction with this information:
    ${searchResults}
    Respond in English`;
  return initialPrompt;
};

module.exports = { webSearch };
