// vertex-ai.js
// Handles Vertex AI model initialization and configuration

const { VertexAI } = require("@google-cloud/vertexai");
const { GoogleAuth } = require("google-auth-library");

// Configuration
const projectId = "dreamdev-team4";
const location = "us-central1";
const model = "gemini-1.5-flash-002";

// Initialize Google Auth
const auth = new GoogleAuth({
  keyFile: "./dreamdev-team4-7946c609fd0e.json",
  scopes: ["https://www.googleapis.com/auth/cloud-platform"]
});

// Initialize Vertex AI client with authentication
const vertex_ai = new VertexAI({
  project: projectId,
  location: location,
  auth
});

console.log(`Initializing Vertex AI with project: ${projectId}, location: ${location}, model: ${model}`);

// Initialize the model
const generativeModel = vertex_ai.getGenerativeModel({
  model: model,
  generation_config: {
    max_output_tokens: 2048,
    temperature: 0.1,
    top_p: 0.9,
    top_k: 40
  },
  safety_settings: [
    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
    { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
    { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABSOLUTE' },
    { category: 'HARM_CATEGORY_DANGEROUS_ART', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
    { category: 'HARM_CATEGORY_DANGEROUS_CAPABILITIES', threshold: 'BLOCK_MEDIUM_AND_ABOVE' }
  ]
});

console.log("Generative model initialized");

// Export the initialization function
async function initGenerativeModel() {
  try {
    console.log("Starting model initialization...");

    // Get credentials
    const credentials = await auth.getCredentials();

    // Initialize model with credentials
    const model = vertex_ai.getGenerativeModel({
      model: model,
      generation_config: {
        max_output_tokens: 2048,
        temperature: 0.1,
        top_p: 0.9,
        top_k: 40
      },
      safety_settings: [
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABSOLUTE' },
        { category: 'HARM_CATEGORY_DANGEROUS_ART', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CAPABILITIES', threshold: 'BLOCK_MEDIUM_AND_ABOVE' }
      ]
    });

    console.log("Model initialization completed successfully");
    return model;
  } catch (error) {
    console.error("Failed to initialize Vertex AI model:", error);
    throw error;
  }
}

module.exports = {
  initGenerativeModel
};