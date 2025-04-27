// Load environment variables from a .env file
// Make sure you have a .env file in the same directory as this script
// with variables like GCP_PROJECT_ID, GCP_LOCATION, and potentially
// GOOGLE_APPLICATION_CREDENTIALS (if not using default service account).
require('dotenv').config();

const express = require('express');
const { VertexAI } = require('@google-cloud/vertexai');
const path = require('path'); // Required for resolving service account key path

const app = express();
app.use(express.json()); // Middleware to parse JSON request bodies

// --- Configuration ---
const projectId = process.env.GCP_PROJECT_ID;
const location = process.env.GCP_LOCATION || 'us-central1'; // e.g., 'us-central1'
// Use the model you confirmed is available in your location
const model = process.env.VERTEX_AI_MODEL || 'gemini-1.5-flash-002'; // Default to a commonly available model

// Ensure project ID and location are set
if (!projectId || !location) {
  console.error('Error: GCP_PROJECT_ID and GCP_LOCATION environment variables must be set.');
  process.exit(1);
}

// Configure Vertex AI client
// The GOOGLE_APPLICATION_CREDENTIALS environment variable should point
// to your service account key file path. If you're running on GCP
// services like Cloud Run or GKE with a service account attached,
// this might not be necessary as credentials are automatically handled.
// If running locally, set GOOGLE_APPLICATION_CREDENTIALS:
// process.env.GOOGLE_APPLICATION_CREDENTIALS = path.resolve('./path/to/your/service-account-key.json');
// Ensure this path is correct and the file is secure.

try {
  // Initialize Vertex AI client
  const vertex_ai = new VertexAI({ project: projectId, location: location });

  // Instantiate the model
  const generativeModel = vertex_ai.getGenerativeModel({
    model: model,
    // Optional: Configure generation parameters for controlling the response style
    // generation_config: {
    //   max_output_tokens: 2048,
    //   temperature: 0.1, // Lower values make the model more deterministic
    //   top_p: 0.9,
    //   top_k: 40
    // },
    // Optional: Configure safety settings to filter harmful content
    // safety_settings: [
    //   { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
    //   { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
    //   { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
    //   { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
    //   { category: 'HARM_CATEGORY_DANGEROUS_ART', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
    //   { category: 'HARM_CATEGORY_DANGEROUS_CAPABILITIES', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
    // ]
  });

  console.log(`Vertex AI model "${model}" initialized for project "${projectId}" in location "${location}".`);

  // --- Define Tools (Functions) for the AI Model ---
  // These function declarations tell the AI model about the capabilities
  // your microservice has to retrieve data. The AI will use these
  // descriptions to determine if a user's query can be answered by
  // calling one of these functions.
  const tools = [{
    functionDeclarations: [
      {
        name: 'getTransactionSummary',
        description: 'Gets a summary of transactions for a specific user based on criteria like recipient, sender, date range, category, or transaction type (credit/debit). Can return the total amount or the count of transactions.',
        parameters: {
          type: 'object',
          properties: {
            recipient: {
              type: 'string',
              description: 'The name of the transaction recipient (e.g., "Mike", "Ade"). Optional.'
            },
            sender: {
              type: 'string',
              description: 'The name of the transaction sender (e.g., "Mike", "Ade"). Optional.'
            },
            startDate: {
              type: 'string',
              format: 'date',
              description: 'The start date for the transaction range (YYYY-MM-DD). Optional.'
            },
            endDate: {
              type: 'string',
              format: 'date',
              description: 'The end date for the transaction range (YYYY-MM-DD). Optional.'
            },
            category: {
              type: 'string',
              description: 'The category of the transaction (e.g., "groceries", "salary", "transfer", "shopping"). Optional.'
            },
            transactionType: {
              type: 'string',
              enum: ['credit', 'debit'],
              description: 'The type of transaction (credit or debit). Optional.'
            },
            summaryType: {
              type: 'string',
              enum: ['total_amount', 'count'],
              description: 'The type of summary requested: "total_amount" for the sum of amounts, or "count" for the number of transactions. Required.'
            }
          },
          required: ['summaryType'] // The AI must specify what kind of summary is needed
        }
      },
      {
        name: 'getLargestTransaction',
        description: 'Finds the largest transaction for a specific user based on criteria like date range or transaction type (credit/debit).',
        parameters: {
          type: 'object',
          properties: {
            startDate: {
              type: 'string',
              format: 'date',
              description: 'The start date for the transaction range (YYYY-MM-DD). Optional.'
            },
            endDate: {
              type: 'string',
              format: 'date',
              description: 'The end date for the transaction range (YYYY-MM-DD). Optional.'
            },
            transactionType: {
              type: 'string',
              enum: ['credit', 'debit'],
              description: 'The type of transaction (credit or debit). Optional.'
            }
          },
          required: [] // No parameters are strictly required for this function
        }
      }
      // TODO: Add more function declarations here for other types of queries
      // Example: getTransactionsByRecipient, getTransactionsByCategory, etc.
    ]
  }];


  // --- Database Interaction Functions (Mock Data) ---
  // IMPORTANT: Replace these mock functions with actual database queries
  // using your preferred database library (e.g., 'pg', 'mysql2', 'mongoose').
  // Ensure these functions are asynchronous and handle potential database errors.

  const mockTransactions = [
    { id: 1, userId: 'user123', sender: 'Me', receiver: 'Ade', amount: 5000, date: '2024-10-01', description: 'Transfer to Ade', type: 'debit', category: 'transfer' },
    { id: 2, userId: 'user123', sender: 'Mike', receiver: 'Me', amount: 10000, date: '2024-10-05', description: 'Salary deposit', type: 'credit', category: 'salary' },
    { id: 3, userId: 'user123', sender: 'Me', receiver: 'Ade', amount: 7000, date: '2024-10-10', description: 'Payment to Ade', type: 'debit', category: 'transfer' },
    { id: 4, userId: 'user123', sender: 'Me', receiver: 'Grocery Store', amount: 1500, date: '2024-10-12', description: 'Weekly groceries', type: 'debit', category: 'groceries' },
    { id: 5, userId: 'user123', sender: 'Mike', receiver: 'Me', amount: 2000, date: '2024-11-01', description: 'Payment from Mike', type: 'credit', category: 'transfer' },
    { id: 6, userId: 'user123', sender: 'Me', receiver: 'Mike', amount: 3000, date: '2024-11-05', description: 'Transfer to Mike', type: 'debit', category: 'transfer' },
    { id: 7, userId: 'user123', sender: 'Me', receiver: 'Ade', amount: 6000, date: '2024-11-15', description: 'Transfer to Ade', type: 'debit', category: 'transfer' },
    { id: 8, userId: 'user123', sender: 'Me', receiver: 'Book Store', amount: 2500, date: '2024-11-20', description: 'Bought a book', type: 'debit', category: 'shopping' },
    { id: 9, userId: 'user123', sender: 'Me', receiver: 'Mike', amount: 4500, date: '2024-12-01', description: 'Transfer to Mike', type: 'debit', category: 'transfer' },
    { id: 10, userId: 'user123', sender: 'Ade', receiver: 'Me', amount: 8000, date: '2024-12-05', description: 'Payment from Ade', type: 'credit', category: 'transfer' },
  ];

  // Helper function to filter transactions based on parameters
  function filterTransactions(userId, params) {
    console.log(`Filtering transactions for user ${userId} with params:`, params);
    return mockTransactions.filter(tx => {
      // Always filter by userId for security
      if (tx.userId !== userId) return false;

      // Apply filters based on provided parameters
      if (params.recipient && tx.receiver.toLowerCase() !== params.recipient.toLowerCase()) return false;
      if (params.sender && tx.sender.toLowerCase() !== params.sender.toLowerCase()) return false;
      if (params.startDate) {
        const startDate = new Date(params.startDate);
        startDate.setHours(0, 0, 0, 0); // Set time to beginning of the day
        const txDate = new Date(tx.date);
        if (txDate < startDate) return false;
      }
      if (params.endDate) {
        const endDate = new Date(params.endDate);
        endDate.setHours(23, 59, 59, 999); // Set time to end of the day
        const txDate = new Date(tx.date);
        if (txDate > endDate) return false;
      }
      if (params.category && tx.category.toLowerCase() !== params.category.toLowerCase()) return false;
      if (params.transactionType && tx.type !== params.transactionType) return false;

      return true; // Keep the transaction if all filters pass
    });
  }

  // Function to get transaction summary (called by the microservice based on AI's function call)
  // In a real app, this would be an async function querying your DB.
  async function getTransactionSummary(userId, params) {
    console.log(`Executing getTransactionSummary for user ${userId} with params:`, params);
    try {
      // TODO: Replace this with your actual database query logic
      const filteredTx = filterTransactions(userId, params);

      if (params.summaryType === 'total_amount') {
        const total = filteredTx.reduce((sum, tx) => sum + tx.amount, 0);
        // Return the result in a format the AI can easily use to generate a response
        return { result: total, unit: 'currency', description: 'Total amount' };
      } else if (params.summaryType === 'count') {
        const count = filteredTx.length;
        // Return the result in a format the AI can easily use
        return { result: count, unit: 'count', description: 'Number of transactions' };
      } else {
        // Should not happen if AI respects function definition, but good for safety
        console.error('Invalid summaryType requested:', params.summaryType);
        return { error: 'Invalid summary type requested.', requestedSummaryType: params.summaryType };
      }
    } catch (dbError) {
      console.error('Database error in getTransactionSummary:', dbError);
      // Return an error structure that the AI can potentially interpret
      return { error: 'Failed to retrieve transaction summary from database.', details: dbError.message };
    }
  }

  // Function to get the largest transaction (called by the microservice)
  // In a real app, this would be an async function querying your DB.
  async function getLargestTransaction(userId, params) {
    console.log(`Executing getLargestTransaction for user ${userId} with params:`, params);
    try {
      // TODO: Replace this with your actual database query logic
      const filteredTx = filterTransactions(userId, params);

      if (filteredTx.length === 0) {
        // Return a clear message if no transactions are found
        return { result: null, message: 'No transactions found for the given criteria.' };
      }

      const largestTx = filteredTx.reduce((maxTx, currentTx) => {
        return currentTx.amount > maxTx.amount ? currentTx : maxTx;
      }, filteredTx[0]); // Initialize reduction with the first transaction

      // Return the details of the largest transaction
      return {
        result: largestTx,
        message: 'Largest transaction found.',
        details: {
          amount: largestTx.amount,
          date: largestTx.date,
          description: largestTx.description,
          type: largestTx.type,
          recipient: largestTx.receiver,
          sender: largestTx.sender
        }
      };
    } catch (dbError) {
      console.error('Database error in getLargestTransaction:', dbError);
      // Return an error structure
      return { error: 'Failed to retrieve largest transaction from database.', details: dbError.message };
    }
  }

  // --- API Endpoint ---
  // This endpoint receives user questions and interacts with the AI and database.
  app.post('/chat', async (req, res) => {
    const { userId, question } = req.body;

    // Basic input validation
    if (!userId || typeof userId !== 'string' || userId.trim() === '') {
      return res.status(400).json({ error: 'Invalid or missing userId in request body.' });
    }
    if (!question || typeof question !== 'string' || question.trim() === '') {
      return res.status(400).json({ error: 'Invalid or missing question in request body.' });
    }

    console.log(`Received request for user ${userId}: "${question}"`);

    try {
      // Start a chat session with the model.
      // Including history can help the model maintain context over multiple turns.
      // For a stateless microservice, you might manage history on the frontend
      // or use a session store if needed. For a single request/response,
      // starting a new session each time is fine.
      const chat = generativeModel.startChat({
        tools: tools, // Provide the tools the model can use
        // history: [] // Add previous messages here if maintaining conversation history
      });

      // Send the user's message to the model. The model will process the text
      // and decide if a function call is needed based on the provided tools.
      const result = await chat.sendMessage(question);
      const response = result.response; // Get the GenerateContentResponse object

      console.log('Model initial response:', JSON.stringify(response, null, 2));

      // --- Corrected Function Call and Text Extraction Logic ---
      let functionCall = null;
      let directTextResponse = '';

      // Iterate through candidates and parts to find function calls or text
      if (response.candidates && response.candidates.length > 0) {
          const candidate = response.candidates[0]; // Process the first candidate
          if (candidate.content && candidate.content.parts) {
              for (const part of candidate.content.parts) {
                  if (part.functionCall) {
                      functionCall = part.functionCall;
                      // Assuming only one function call per turn for simplicity
                      break; // Exit loop once a function call is found
                  }
                  if (part.text) {
                      directTextResponse += part.text;
                  }
              }
          }
      }
      // --- End Corrected Logic ---


      if (functionCall) {
        const functionName = functionCall.name;
        const functionArgs = functionCall.args;

        console.log(`Model requested function call: "${functionName}" with args:`, functionArgs);

        let functionResponsePayload;
        // Execute the corresponding function in your microservice
        if (functionName === 'getTransactionSummary') {
          // Call your internal function to get data
          functionResponsePayload = await getTransactionSummary(userId, functionArgs);
        } else if (functionName === 'getLargestTransaction') {
          // Call your internal function to get data
          functionResponsePayload = await getLargestTransaction(userId, functionArgs);
        }
        // TODO: Add more else if blocks here for other defined functions
        else {
             console.warn(`Function "${functionName}" requested by AI is not recognized or implemented.`);
             // Send an error back to the model so it knows the function call failed
             functionResponsePayload = { error: `Function "${functionName}" is not implemented in the backend.` };
        }


        if (functionResponsePayload !== undefined) {
          console.log(`Function "${functionName}" executed. Response payload:`, functionResponsePayload);

          // Send the result of the function call back to the model.
          // The model will use this data to generate a natural language response for the user.
          const apiResponseResult = await chat.sendMessage([
            {
              functionResponse: {
                name: functionName,
                response: functionResponsePayload // Send the data retrieved from your system
              }
            }
          ]);

          const apiResponse = apiResponseResult.response; // Get the GenerateContentResponse object from the second turn

          // Now, extract the text from the second response.
          let finalAnswer = '';
          if (apiResponse.candidates && apiResponse.candidates.length > 0) {
              const candidate = apiResponse.candidates[0];
              if (candidate.content && candidate.content.parts) {
                  for (const part of candidate.content.parts) {
                      if (part.text) {
                          finalAnswer += part.text;
                      }
                  }
              }
          }


          if (finalAnswer) {
            console.log('Final answer from model:', finalAnswer);
            // Send the raw text containing markdown to the frontend
            res.json({ answer: finalAnswer });
          } else {
            // Fallback if the model didn't generate a text response after the function call
            console.warn('Model did not return a text response after receiving function results.');
            // You might want to return a more user-friendly message here
            res.status(500).json({ error: 'Could not generate a final answer based on the data.' });
          }

        } else {
          // This case should ideally be covered by the else in the function execution block above
          console.error(`Function "${functionName}" requested by AI returned undefined.`);
          res.status(500).json({ error: `Processing of function "${functionName}" failed.` });
        }

      } else if (directTextResponse) {
        // If the model did not request a function call, but provided direct text
        console.log('Direct text response from model:', directTextResponse);
        // Send the raw text containing markdown to the frontend
        res.json({ answer: directTextResponse });
      }
      else {
        // Fallback if no function call or direct text response was found in the parts
        console.warn('Model did not return a function call or direct text response.');
        // You might want to return a more user-friendly message here
        res.status(500).json({ error: 'Could not understand your request or retrieve relevant information.' });
      }

    } catch (error) {
      console.error('Error processing chat request:', error);
      // Provide a generic error message to the user, log detailed error on the server
      res.status(500).json({ error: 'An internal error occurred while processing your request.' });
    }
  });

  // --- Server Startup ---
  const port = process.env.PORT || 3000; // Use port from environment variable or default to 3000
  app.listen(port, () => {
    console.log(`Bank Chatbot Microservice listening on port ${port}`);
  });

} catch (initError) {
  console.error('Failed to initialize Vertex AI client:', initError);
  console.error('Please ensure your GCP credentials and environment variables are set correctly.');
  process.exit(1); // Exit the process if Vertex AI initialization fails
}
