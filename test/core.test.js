import test from "node:test";
import assert from "node:assert/strict";
function classify(input=""){const text=input.toLowerCase();if(/code|برمج|موقع|تطبيق|bug|github|repo|react|python/.test(text))return "openhands";if(/browser|متصفح|ابحث|search|website|موقع على الانترنت|scrape|ويب/.test(text))return "browser_use";if(/automation|workflow|أتمت|ربط|telegram|whatsapp|webhook/.test(text))return "n8n";if(/rag|documents|ملفات|knowledge|معرفة|chatbot|بوت/.test(text))return "dify";return "langgraph"}
test("routes coding prompts",()=>assert.equal(classify("ابني موقع React"),"openhands"));
test("routes automation prompts",()=>assert.equal(classify("اعمل workflow مع Telegram"),"n8n"));
test("routes RAG prompts",()=>assert.equal(classify("اعمل chatbot للملفات"),"dify"));
test("defaults to LangGraph",()=>assert.equal(classify("حلل المهمة دي"),"langgraph"));
