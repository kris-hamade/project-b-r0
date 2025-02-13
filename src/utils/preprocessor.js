const fs = require("fs");
const path = require("path");
const natural = require("natural");
const { getCharacterLimit } = require("./config.js");
const { getChatConfig } = require("../discord/chatConfig.js");
const stemmer = natural.PorterStemmer;
const { BrillPOSTagger } = natural;
const lexicon = new natural.Lexicon("EN", "N", "NNP");
const rules = new natural.RuleSet("EN");
const tagger = new BrillPOSTagger(lexicon, rules);
const Roll20Data = require('../models/roll20Data'); // assuming you save the schema in a file called roll20Data.js

async function loadCustomNouns() {
  const customNounsFile = path.join(".", "src", "utils", "data-misc", "custom-nouns.txt");
  const customNouns = fs.readFileSync(customNounsFile, "utf8").trim().split(/\s+/);
  return customNouns.map(noun => noun.toLowerCase());
}

function isCustomToken(token, customNouns) {
  return customNouns.some(customNoun => customNoun.toLowerCase() === token.toLowerCase());
}

async function preprocessUserInput(input, nickname, channelId) {
  const customNouns = await loadCustomNouns();
  const data = {};

  const userConfig = await getChatConfig(nickname, channelId);

  const relevantTags = ["N", "NN", "NNS", "NNP", "NNPS"];

  const tokenizer = new natural.WordTokenizer();

  const stopWordsFile = path.join(
    ".",
    "src",
    "utils",
    "data-misc",
    "stop-words.txt"
  );
  const stopWords = fs.readFileSync(stopWordsFile, "utf8").trim().split(/\s+/);

  function preprocess(userInput, nickname) { 
    let tokens = tokenizer.tokenize(userInput);

    // Append the nickname to the list of tokens
    if (nickname) {
      tokens.push(nickname);
    }

    tokens = tokens.map((token) => token.toLowerCase());
    tokens = tokens.filter((token) => !stopWords.includes(token));

    const taggedTokens = tagger.tag(tokens).taggedWords;

    console.log("Tagged tokens: ", taggedTokens);

    const relevantTokens = taggedTokens
      .filter(
        (token) =>
          relevantTags.includes(token.tag) ||
          isCustomToken(token.token, customNouns)
      )
      .map((token) => token.token);
    console.log("Noun tokens: ", relevantTokens);
    return relevantTokens;
  }

  async function search_data(tokens, data) {
    let relevantDocs = [];

    // Set the max character count for the response
    // characterLimit is set in the config.js file
    const maxChars = getCharacterLimit(userConfig.model);

    // Set the minimum number of tokens that must match based on GPT model
    const minMatchCount = maxChars >= 96000 ? 1 : 2;

    // Stem the tokens
    let stemmedTokens = tokens.map((token) =>
      stemmer.stem(token.toLowerCase())
    );
    console.log("Stemmed tokens: ", stemmedTokens);

    const allDocs = await Roll20Data.find({});

    allDocs.forEach((doc) => {
      // Stem the words in the Name and Bio fields
      let stemmedName =
        doc && doc.Name && typeof doc.Name === "string"
          ? doc.Name.split(" ")
            .map((word) => stemmer.stem(word.toLowerCase()))
            .join(" ")
          : "";
      let stemmedBio =
        doc && doc.Bio && typeof doc.Bio === "string"
          ? doc.Bio.split(" ")
            .map((word) => stemmer.stem(word.toLowerCase()))
            .join(" ")
          : "";

      let matchCount = 0;
      stemmedTokens.forEach((stemmedToken) => {
        if (
          stemmedName.includes(stemmedToken) ||
          stemmedBio.includes(stemmedToken)
        ) {
          matchCount++;
        }
      });

      // Only add the doc to relevantDocs if it matches a certain number of tokens
      if (matchCount >= minMatchCount) {
        relevantDocs.push({
          doc,
          count: matchCount,
        });
      }
    });

    relevantDocs.sort((a, b) => b.count - a.count);

    let totalCharacters = 0;
    let filteredRelevantDocs = [];

    for (let doc of relevantDocs) {
      let docLength = JSON.stringify(doc).length;
      if (totalCharacters + docLength <= maxChars) {
        totalCharacters += docLength;
        filteredRelevantDocs.push(doc);
      } else {
        break;
      }
    }

    return JSON.stringify(filteredRelevantDocs);
  }

  const userInput = input;
  const tokens = preprocess(userInput, nickname);
  const relevantDocs = await search_data(tokens, data);

  console.log(relevantDocs);

  return relevantDocs;
}

module.exports = {
  preprocessUserInput,
};
