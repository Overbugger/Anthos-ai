// index.js
// Main entry point for the Bank Chatbot Microservice.
// Handles HTTP requests, interacts with Vertex AI, and calls
// database functions via the controller.

// Load environment variables from a .env file
// Make sure you have a .env file in the same directory as this script
// with variables like GCP_PROJECT_ID, GCP_LOCATION, VERTEX_AI_MODEL,
// LEDGER_DB_URL, ACCOUNTS_DB_URL, and potentially
// GOOGLE_APPLICATION_CREDENTIALS (if not using default service account).
require("dotenv").config();

const express = require("express");
const { VertexAI } = require("@google-cloud/vertexai");
const path = require("path"); // Required for resolving service account key path
const cors = require("cors"); // Import the cors package

// Import database interaction functions from the controller file
const dbController = require("./controller"); // Assuming controller.js is in the same directory

const app = express();

// --- CORS Configuration ---
// Use the cors middleware to allow requests from all origins.
// WARNING: For production, configure this to allow requests ONLY from
// your frontend's domain(s) for robust security.
app.use(cors());

// Middleware to parse JSON request bodies
app.use(express.json());

// --- Configuration ---
const projectId = "dreamdev-team4";
const location = "us-central1"; // e.g., 'us-central1'
// Use the model you confirmed is available in your location
const model = "gemini-1.5-flash-002"; // Default to a commonly available model

// Ensure project ID and location are set
if (!projectId || !location) {
  console.error(
    "Error: GCP_PROJECT_ID and GCP_LOCATION environment variables must be set."
  );
  process.exit(1);
}

// --- Vertex AI Initialization ---
let vertex_ai;
let generativeModel;

try {
  // Initialize Vertex AI client
  vertex_ai = new VertexAI({
    project: projectId,
    projectId: projectId,
    location: location,
  });

  // Instantiate the model
  generativeModel = vertex_ai.getGenerativeModel({
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
    //   { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABSOLUTE' }, // Changed to ABSOLUTE for stronger filtering
    //   { category: 'HARM_CATEGORY_DANGEROUS_ART', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
    //   { category: 'HARM_CATEGORY_DANGEROUS_CAPABILITIES', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
    // ]
  });

  console.log(
    `Vertex AI model "${model}" initialized for project "${projectId}" in location "${location}".`
  );
} catch (initError) {
  console.error("Failed to initialize Vertex AI client:", initError);
  console.error(
    "Please ensure your GCP credentials and environment variables are set correctly."
  );
  // Do NOT exit here if database connection is handled in controller.js and is non-blocking initially.
  // Exit only if Vertex AI initialization is critical and failed.
}

// --- Define Tools (Functions) for the AI Model ---
// These function declarations tell the AI model about the capabilities
// your microservice has to retrieve data. The AI will use these
// descriptions to determine if a user's query can be answered by
// calling one of these functions.
// The AI will call 'getTransactionSummary' for most transaction-related queries.
// The parameters defined here guide the AI on what information to extract
// from the user's query. This information will then be used for post-fetch filtering.
const tools = [
  {
    functionDeclarations: [
      {
        name: "getTransactionSummary", // AI will call this for most transaction queries
        description:
          "Retrieves and summarizes transactions for a specific user account based on criteria like recipient, sender, date range, category, or transaction type (credit/debit). Can provide total amount, count, or a list of transactions.",
        parameters: {
          type: "object",
          properties: {
            accountId: {
              // <-- accountId is used by the backend function to fetch data
              type: "string",
              description:
                "The account ID of the user. This should be provided by the system, not extracted from user input.",
              // Note: In a real system, the backend should get the accountId from the authenticated user's session.
              // We add it here in the function declaration to make the AI aware it's a required piece of info
              // for the backend function, even though the backend will provide it.
            },
            summaryType: {
              type: "string",
              enum: ["total_amount", "count", "list"], // Added 'list' as an explicit option
              description:
                'The type of summary requested: "total_amount" for the sum of amounts, "count" for the number of transactions, or "list" to list transactions. REQUIRED. Choose "total_amount" when the user asks for a total amount or sum, and "count" when the user asks for a number of occurrences, and "list" for a list of transactions.',
            },
            recipient: {
              type: "string",
              description:
                'The name or account identifier of the transaction recipient (e.g., "Mike", "Ade", "1234567890"). Optional.',
            },
            sender: {
              type: "string",
              description:
                'The name or account identifier of the transaction sender (e.g., "Mike", "Ade", "0987654321"). Optional.',
            },
            startDate: {
              type: "string",
              format: "date",
              description:
                "The start date for the transaction range (YYYY-MM-DD). Optional.",
            },
            endDate: {
              type: "string",
              format: "date",
              description:
                "The end date for the transaction range (YYYY-MM-DD). Optional.",
            },
            category: {
              type: "string",
              description:
                'The category of the transaction (e.g., "groceries", "salary", "transfer", "shopping"). Optional.',
            },
            transactionType: {
              type: "string",
              enum: ["credit", "debit"],
              description:
                "The type of transaction (credit or debit). Optional.",
            },
            merchantName: {
              // Added merchantName for filtering by either sender or recipient
              type: "string",
              description:
                "The name of a merchant, recipient, or sender to filter transactions by. Optional.",
            },
          },
          required: ["accountId", "summaryType"], // accountId is required for fetching, summaryType helps AI decide processing
        },
      },
      // Removed other function declarations as they are now handled by post-fetch processing
    ],
  },
];

// --- Post-Fetch Filtering and Processing Functions ---
// These functions operate on the full transaction data retrieved by getTransactionData.

// Helper function to filter transactions based on parameters (using fetched data)
// Filters the array of processed transactions based on the AI's requested parameters.
function filterTransactions(transactions, userId, params) {
  console.log(
    `Filtering fetched transactions for user ${userId} with params:`,
    params
  );
  // Ensure transactions is an array before filtering
  if (!Array.isArray(transactions)) {
    console.error("filterTransactions received non-array data:", transactions);
    return [];
  }

  return transactions.filter((tx) => {
    // The data is already filtered by userId by getTransactionData, but filters below
    // apply the AI's specific criteria.

    // Case-insensitive comparison for names and categories
    if (
      params.recipient &&
      tx.toAccount &&
      tx.toAccount.toLowerCase() !== params.recipient.toLowerCase()
    )
      return false;
    if (
      params.sender &&
      tx.fromAccount &&
      tx.fromAccount.toLowerCase() !== params.sender.toLowerCase()
    )
      return false;
    // Filter by merchantName (check both sender and recipient)
    if (params.merchantName) {
      const merchantNameLower = params.merchantName.toLowerCase();
      if (
        !(
          (tx.fromAccount &&
            tx.fromAccount.toLowerCase().includes(merchantNameLower)) ||
          (tx.toAccount &&
            tx.toAccount.toLowerCase().includes(merchantNameLower))
        )
      ) {
        return false;
      }
    }

    if (params.startDate) {
      const startDate = new Date(params.startDate);
      startDate.setHours(0, 0, 0, 0); // Set time to beginning of the day
      const txDate = new Date(tx.transactionDate); // Use transactionDate from processed data
      if (txDate < startDate) return false;
    }
    if (params.endDate) {
      const endDate = new Date(params.endDate);
      endDate.setHours(23, 59, 59, 999); // Set time to end of the day
      const txDate = new Date(tx.transactionDate); // Use transactionDate from processed data
      if (txDate > endDate) return false;
    }
    if (
      params.category &&
      tx.category &&
      tx.category.toLowerCase() !== params.category.toLowerCase()
    )
      return false;
    if (
      params.transactionType &&
      tx.transactionType &&
      tx.transactionType.toLowerCase() !== params.transactionType.toLowerCase()
    )
      return false; // Use transactionType from processed data (lowercase)

    return true; // Keep the transaction if all filters pass
  });
}

// Function to process fetched data based on summaryType
// Takes the full list of processed transactions and the AI's requested parameters.
function processTransactionDataForAI(transactions, userId, params) {
  console.log(
    `Processing fetched transactions for user ${userId} with summaryType: ${params.summaryType}`
  );

  const filteredTx = filterTransactions(transactions, userId, params);

  // Handle cases where no transactions are found after filtering
  if (filteredTx.length === 0) {
    let message = "No transactions found matching your criteria.";
    // Add more specific messages based on filters if possible
    if (params.category)
      message = `No transactions found in the '${params.category}' category.`;
    if (params.merchantName)
      message = `No transactions found with '${params.merchantName}'.`;
    if (params.startDate && params.endDate)
      message = `No transactions found between ${params.startDate} and ${params.endDate}.`;
    // Add other specific messages...

    return { result: [], message: message };
  }

  if (params.summaryType === "count") {
    const count = filteredTx.length;
    return {
      result: count,
      unit: "count",
      description: "Number of transactions",
    };
  } else if (params.summaryType === "total_amount") {
    const total = filteredTx.reduce((sum, tx) => {
      const amount = parseFloat(tx.amount || 0);
      // Calculate total based on transaction type relative to the user
      if (tx.fromAccount === userId) {
        return sum + amount; // Sum debit amounts (as positive for total spent)
      } else if (tx.toAccount === userId) {
        return sum + amount; // Sum credit amounts (as positive for total received)
      }
      // If transactionType is specified, only sum that type
      if (params.transactionType) {
        if (
          params.transactionType === "debit" &&
          tx.transactionType === "debit" &&
          tx.fromAccount === userId
        )
          return sum + amount;
        if (
          params.transactionType === "credit" &&
          tx.transactionType === "credit" &&
          tx.toAccount === userId
        )
          return sum + amount;
        return sum; // Ignore other types if specified
      }
      return sum; // Default sum if type isn't handled or specified
    }, 0);
    return { result: total, unit: "currency", description: "Total amount" };
  } else if (params.summaryType === "list") {
    // Return the filtered list of transactions
    // SECURITY NOTE: Format the output to include only necessary, non-sensitive details.
    const formattedTx = filteredTx.map((tx) => ({
      date: tx.formattedDate, // Use formattedDate
      description: tx.description,
      amount: tx.formattedAmount, // Use formattedAmount
      type: tx.transactionType, // Use transactionType (debit/credit)
      from: tx.fromAccountLastFour, // Use last four
      to: tx.toAccountLastFour, // Use last four
      // Note: Running balance is calculated in controller but might not be
      // ideal to send directly to the AI for every transaction in a list.
      // Adjust based on how you want the AI to present the list.
    }));
    return {
      result: formattedTx,
      message: `Found ${formattedTx.length} matching transactions.`,
    };
  } else {
    // Fallback: If summaryType is unexpected, return the filtered list
    const formattedTx = filteredTx.map((tx) => ({
      date: tx.formattedDate,
      description: tx.description,
      amount: tx.formattedAmount,
      type: tx.transactionType,
      from: tx.fromAccountLastFour,
      to: tx.toAccountLastFour,
    }));
    console.warn(
      `Unexpected summaryType: ${params.summaryType}. Returning filtered list.`
    );
    return {
      result: formattedTx,
      message: `Found ${formattedTx.length} matching transactions.`,
    };
  }
}

// Function to find the largest transaction from the fetched data
function findLargestTransaction(transactions, userId, params) {
  console.log(
    `Finding largest transaction for user ${userId} with params:`,
    params
  );

  const filteredTx = filterTransactions(transactions, userId, params);

  if (filteredTx.length === 0) {
    return {
      result: null,
      message: "No transactions found for the given criteria.",
    };
  }

  // Find the largest transaction based on the absolute amount
  const largestTx = filteredTx.reduce((maxTx, currentTx) => {
    const maxAmount = Math.abs(parseFloat(maxTx.amount || 0));
    const currentAmount = Math.abs(parseFloat(currentTx.amount || 0));
    return currentAmount > maxAmount ? currentTx : maxTx;
  }, filteredTx[0]); // Initialize reduction with the first transaction

  // SECURITY NOTE: Only return necessary details.
  return {
    result: {
      // Format transaction details here
      date: largestTx.formattedDate,
      description: largestTx.description,
      amount: largestTx.formattedAmount,
      type: largestTx.transactionType,
      from: largestTx.fromAccountLastFour,
      to: largestTx.toAccountLastFour,
    },
    message: "Largest transaction found.",
  };
}

// --- API Endpoint ---

app.get("/hello", (req, res) => {
  try {
    return res.json({ message: "Hello from the Anthos Chatbot Microservice!" });
  } catch (error) {
    return res.status(500).json({
      error: "An internal error occurred while processing your request.",
    });
  }
});

// This endpoint receives user questions and interacts with the AI and database.
app.post("/chat", async (req, res) => {
  const { userId, question } = req.body; // userId should come from authentication

  // Basic input validation
  if (!userId || typeof userId !== "string" || userId.trim() === "") {
    return res
      .status(400)
      .json({ error: "Invalid or missing userId in request body." });
  }
  if (!question || typeof question !== "string" || question.trim() === "") {
    return res
      .status(400)
      .json({ error: "Invalid or missing question in request body." });
  }

  console.log(`Received request for user ${userId}: "${question}"`);

  // Ensure generativeModel is initialized before proceeding
  if (!generativeModel) {
    console.error("Vertex AI model not initialized.");
    return res.status(500).json({ error: "Chat service is not ready." });
  }

  try {
    // Start a chat session with the model.
    // Including history can help the model maintain context over multiple turns.
    // For a stateless microservice, you might manage history on the frontend
    // or use a session store if needed. For a single request/response,
    // starting a new session each time is fine.
    const chat = generativeModel.startChat({
      tools: tools, // Provide the tools the model can use
      // Add a system instruction to guide the model's behavior
      systemInstruction: {
        parts: [
          // Updated system instruction to reflect the ability to filter/summarize
          {
            text: "You are a helpful banking assistant. Use the provided tools to answer questions about the user's transaction history. You can retrieve transaction data and perform filtering and summaries (like total amount, count, or listing transactions) based on criteria like date range, recipient, sender, category, or transaction type. When the user asks 'how much', prioritize using the 'total_amount' summaryType. When the user asks 'how many times', prioritize using the 'count' summaryType. For requests to 'show' or 'list' transactions, use the 'list' summaryType. If a question cannot be answered by the available tools or data, inform the user about the limitations.",
          },
        ],
      },
      // history: [] // Add previous messages here if maintaining conversation history
    });

    // Send the user's message to the model. The model will process the text
    // and decide if a function call is needed based on the provided tools.
    const result = await chat.sendMessage(question);
    const response = result.response; // Get the GenerateContentResponse object

    console.log("Model initial response:", JSON.stringify(response, null, 2));

    // --- Extract Function Call or Text Response ---
    let functionCall = null;
    let directTextResponse = "";

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
    // --- End Extraction Logic ---

    if (functionCall) {
      const functionName = functionCall.name;
      const functionArgs = functionCall.args;

      console.log(
        `Model requested function call: "${functionName}" with args:`,
        functionArgs
      );

      let functionResponsePayload;
      // Execute the corresponding function in your microservice
      // IMPORTANT: Pass the userId from the authenticated request to the controller functions
      // This ensures data is always filtered by the correct user.
      if (functionName === "getTransactionSummary") {
        // AI will call this for various queries
        // 1. Fetch ALL transaction data for the user from the database
        const transactionDataResult = await dbController.getTransactionData({
          accountId: userId,
        });

        if (transactionDataResult.error) {
          // If fetching data failed, return the error payload
          functionResponsePayload = transactionDataResult;
        } else if (
          !transactionDataResult.transactions ||
          transactionDataResult.transactions.length === 0
        ) {
          // If no transactions were found, inform the AI
          functionResponsePayload = {
            message:
              transactionDataResult.message ||
              "No transactions found for your account.",
          };
          // Include account owner and number even if no transactions found
          functionResponsePayload.accountOwner =
            transactionDataResult.accountOwner;
          functionResponsePayload.accountNumber =
            transactionDataResult.accountNumber;
        } else {
          // 2. Process and filter the fetched data based on the AI's requested parameters
          // Note: We are calling a single post-fetch processing function
          // that handles different summaryTypes.
          functionResponsePayload = processTransactionDataForAI(
            transactionDataResult.transactions,
            userId,
            functionArgs
          );

          // Include account owner and number in the payload for the AI to use in the response
          functionResponsePayload.accountOwner =
            transactionDataResult.accountOwner;
          functionResponsePayload.accountNumber =
            transactionDataResult.accountNumber;
          functionResponsePayload.requestParams = functionArgs; // Include original request params for AI context
        }
      }
      // Removed handlers for other function calls as they are now processed after fetching data
      else {
        console.warn(
          `Function "${functionName}" requested by AI is not recognized or implemented.`
        );
        // Send an error back to the model so it knows the function call failed
        functionResponsePayload = {
          error: `Function "${functionName}" is not implemented in the backend.`,
        };
      }

      if (functionResponsePayload !== undefined) {
        console.log(
          `Function "${functionName}" executed. Response payload:`,
          JSON.stringify(functionResponsePayload, null, 2)
        );

        // Send the result of the function call back to the model.
        // The model will use this data to generate a natural language response for the user.
        // The response payload now contains the filtered/summarized data.
        const apiResponseResult = await chat.sendMessage([
          {
            functionResponse: {
              name: functionName,
              response: functionResponsePayload, // Send the processed data
            },
          },
        ]);

        const apiResponse = apiResponseResult.response; // Get the GenerateContentResponse object from the second turn

        // Now, extract the text from the second response.
        let finalAnswer = "";
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
          console.log("Final answer from model:", finalAnswer);
          // Send the raw text containing markdown to the frontend
          res.json({ answer: finalAnswer });
        } else {
          // Fallback if the model didn't generate a text response after the function call
          console.warn(
            "Model did not return a text response after receiving function results."
          );
          // You might want to return a more user-friendly message here
          res.status(500).json({
            error: "Could not generate a final answer based on the data.",
          });
        }
      } else {
        // This case should ideally be covered by the else in the function execution block above
        console.error(
          `Function "${functionName}" requested by AI returned undefined.`
        );
        res
          .status(500)
          .json({ error: `Processing of function "${functionName}" failed.` });
      }
    } else if (directTextResponse) {
      // If the model did not request a function call, but provided direct text
      console.log("Direct text response from model:", directTextResponse);
      // Send the raw text containing markdown to the frontend
      res.json({ answer: directTextResponse });
    } else {
      // Fallback if no function call or direct text response was found in the parts
      console.warn(
        "Model did not return a function call or direct text response."
      );
      // You might want to return a more user-friendly message here
      res.status(500).json({
        error:
          "Could not understand your request or retrieve relevant information.",
      });
    }
  } catch (error) {
    console.error("Error processing chat request:", error);

    // Provide more specific error messages
    if (error.message.includes("Database connection failed")) {
      return res.status(503).json({
        error:
          "The service is temporarily unavailable. Please try again in a few minutes.",
      });
    }

    return res.status(500).json({
      error: "An internal error occurred while processing your request.",
    });
  }
});

// --- Server Startup ---
const port = process.env.PORT || 3000;
const server = app.listen(port, async () => {
  console.log(`Bank Chatbot Microservice listening on port ${port}`);

  // Check database connectivity on startup
  try {
    await dbController.checkDatabaseConnectivity();
  } catch (err) {
    console.error("Failed to verify database connections:", err);
  }
});

// --- Graceful Shutdown ---
// Close database connections when the process receives termination signals.
process.on("SIGINT", async () => {
  console.log("Received SIGINT. Shutting down gracefully...");
  server.close(async (err) => {
    if (err) {
      console.error("Error closing server:", err);
      process.exit(1);
    }
    await dbController.closeDatabaseConnections(); // Close DB connections
    console.log("Server shut down.");
    process.exit(0);
  });
});

process.on("SIGTERM", async () => {
  console.log("Received SIGTERM. Shutting down gracefully...");
  server.close(async (err) => {
    if (err) {
      console.error("Error closing server:", err);
      process.exit(1);
    }
    await dbController.closeDatabaseConnections(); // Close DB connections
    console.log("Server shut down.");
    process.exit(0);
  });
});
