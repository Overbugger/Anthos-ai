// index.js
// Combined Backend for Banking AI Chatbot

// --- 1. Load Environment Variables ---
// Create a .env file in the same directory with your configuration
// Example .env:
// PORT=3000
// GCP_PROJECT_ID="your-gcp-project-id"
// GCP_LOCATION="us-central1"
// VERTEX_AI_MODEL_NAME="gemini-1.0-pro"
require("dotenv").config();

// --- 2. Require Dependencies ---
const express = require("express");
const { VertexAI } = require("@google-cloud/vertexai");

// --- 3. Configuration & Initialization ---
const PORT = 8008;
const GCP_PROJECT_ID = "dreamdev-team4";
const GCP_LOCATION = "us-central1";
const VERTEX_AI_MODEL_NAME = "gemini-1.5-flash-002";

// Validate essential configuration
if (!GCP_PROJECT_ID || !GCP_LOCATION || !VERTEX_AI_MODEL_NAME) {
  console.error(
    "FATAL ERROR: Missing required environment variables (GCP_PROJECT_ID, GCP_LOCATION, VERTEX_AI_MODEL_NAME). Please check your .env file."
  );
  process.exit(1); // Exit if configuration is missing
}

// Initialize Express App
const app = express();

// Initialize Vertex AI Client
let generativeModel;
try {
  const vertex_ai = new VertexAI({
    project: GCP_PROJECT_ID,
    location: GCP_LOCATION,
  });
  generativeModel = vertex_ai.preview.getGenerativeModel({
    model: VERTEX_AI_MODEL_NAME,
    // Optional: Adjust safety settings and generation config as needed
    // safety_settings: [{ category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' }],
    // generation_config: { max_output_tokens: 256, temperature: 0.2 },
  });
  console.log("Vertex AI Client Initialized Successfully.");
} catch (error) {
  console.error("FATAL ERROR: Failed to initialize Vertex AI Client:", error);
  process.exit(1); // Exit if Vertex AI client fails to initialize
}

// --- 4. Vertex AI Interaction Function ---
/**
 * Sends a prompt to the Vertex AI generative model and returns the text response.
 * @param {string} prompt - The complete prompt to send to the AI.
 * @returns {Promise<string>} - A promise that resolves to the AI's text response.
 */
async function getAiResponse(prompt) {
  if (!generativeModel) {
    throw new Error("Vertex AI model not initialized.");
  }
  console.log(`Sending prompt to Vertex AI (${VERTEX_AI_MODEL_NAME})...`);
  try {
    const req = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    };

    const streamingResp = await generativeModel.generateContentStream(req);
    const aggregatedResponse = await streamingResp.response; // Aggregate stream

    // Validate response structure
    if (!aggregatedResponse.candidates?.[0]?.content?.parts?.[0]?.text) {
      console.error(
        "Vertex AI response structure invalid:",
        JSON.stringify(aggregatedResponse)
      );
      throw new Error(
        "Received an empty or invalid response structure from Vertex AI."
      );
    }

    const responseText = aggregatedResponse.candidates[0].content.parts[0].text;
    console.log("Received response from Vertex AI.");
    return responseText;
  } catch (error) {
    console.error("Error calling Vertex AI:", error);
    // Customize error handling based on potential Vertex AI errors
    if (error.message.includes("RESOURCE_EXHAUSTED")) {
      throw new Error("Vertex AI resource exhausted. Please try again later.");
    }
    throw new Error(`Failed to get response from Vertex AI: ${error.message}`);
  }
}

// --- 5. Middleware Setup ---
// Parse JSON request bodies
app.use(express.json());

// Basic request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// --- 6. API Routes ---

// Health Check Endpoint
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "UP",
    timestamp: new Date().toISOString(),
    message: "Banking Chatbot Backend is running.",
    vertexModel: VERTEX_AI_MODEL_NAME,
    location: GCP_LOCATION,
    // Do not expose project ID here unless absolutely necessary and safe
  });
});

// Chat Query Endpoint
app.post("/api/chat/query", async (req, res, next) => {
  try {
    const { question, transactions } = req.body;

    // --- Input Validation ---
    if (!question || typeof question !== "string" || question.trim() === "") {
      // Using return here to stop execution and send response immediately
      return res
        .status(400)
        .json({ error: 'Missing or invalid "question" in request body.' });
    }
    if (!transactions || !Array.isArray(transactions)) {
      // Allow empty transaction list if needed, but it must be an array
      return res
        .status(400)
        .json({
          error: 'Missing or invalid "transactions" array in request body.',
        });
    }
    // Note: Add more specific validation for transaction objects if needed in a real app.

    console.log(
      `Received query: "${question}" with ${transactions.length} transactions.`
    );

    // --- Prompt Engineering ---
    // Convert transactions to a string format (JSON) for the LLM
    // Consider limiting the size/length of this string for very large histories
    // to avoid exceeding model token limits.
    const transactionsString = JSON.stringify(transactions, null, 2); // Pretty print JSON

    // Construct the prompt - This is critical for getting good results
    const prompt = `
You are a helpful and precise banking assistant chatbot.
Your ONLY knowledge source is the user's transaction history provided below.
Analyze the transaction history and answer the user's question accurately based SOLELY on this data.
Do NOT make assumptions, invent information, or use any external knowledge.
If the answer cannot be determined from the provided transactions, clearly state that.
Be concise and directly answer the question. Today's date is ${new Date().toLocaleDateString(
      "en-CA"
    )}.

User Question:
"${question}"

Transaction History:
\`\`\`json
${transactionsString}
\`\`\`

Assistant Answer:
`; // Guiding the AI to provide the answer here

    // --- Call Vertex AI Service ---
    const aiResponse = await getAiResponse(prompt); // Call the function defined above

    // --- Send Response ---
    res.status(200).json({ answer: aiResponse });
  } catch (error) {
    // Pass error to the global error handler (defined below)
    next(error);
  }
});

// --- 7. Global Error Handler ---
// This middleware catches errors passed via next(error)
app.use((err, req, res, next) => {
  console.error("An error occurred:", err.stack); // Log the full error stack
  res.status(err.status || 500).json({
    // Use error status or default to 500
    error: {
      message: err.message || "Internal Server Error",
      // Optionally include stack trace in development environments
      // stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    },
  });
});

// --- 8. Start Server ---
app.listen(PORT, () => {
  console.log(`---------------------------------------------------------`);
  console.log(`Banking Chatbot Backend Server started successfully.`);
  console.log(`Current Time: ${new Date().toString()}`);
  console.log(`Location Context: Lagos, Lagos, Nigeria (Backend Runtime)`);
  console.log(`Listening on port: ${PORT}`);
  console.log(`Connected to GCP Project: ${GCP_PROJECT_ID}`);
  console.log(`Using Vertex AI Location: ${GCP_LOCATION}`);
  console.log(`Using Vertex AI Model: ${VERTEX_AI_MODEL_NAME}`);
  console.log(
    `API Endpoint available at: http://localhost:${PORT}/api/chat/query (POST)`
  );
  console.log(
    `Health Check available at: http://localhost:${PORT}/health (GET)`
  );
  console.log(`---------------------------------------------------------`);
});
