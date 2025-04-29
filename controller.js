const { Pool } = require("pg");

const ledgerDbConfig = {
  user: "admin",
  password: "password",
  host: "35.223.9.138",
  port: "5432",
  database: "ledger-db",
  connectionTimeoutMillis: 300000,
};

const accountsDbConfig = {
  user: "accounts-admin",
  password: "accounts-pwd",
  host: "35.223.9.138",
  port: "5432",
  database: "accounts-db",
  connectionTimeoutMillis: 300000,
};

const retryOptions = {
  maxRetries: 3,
  retryDelay: 1000, // 1 second
  timeout: 5000, // 5 seconds
};

// Create database pools with event listeners
const ledgerPool = new Pool(ledgerDbConfig);
const accountsPool = new Pool(accountsDbConfig);

// Error event handling for the pools
ledgerPool.on("error", (err) => {
  console.error("Unexpected error on idle ledger pool client", err);
});

accountsPool.on("error", (err) => {
  console.error("Unexpected error on idle accounts pool client", err);
});

/**
 * Verify database connection with retry mechanism
 * @param {Pool} pool - Database pool to test
 * @param {string} name - Name for logging purposes
 * @returns {Promise<boolean>} Whether connection is successful
 */
async function testConnection(pool, name) {
  let attempts = 0;
  while (attempts < retryOptions.maxRetries) {
    try {
      console.log(`Attempting to connect to ${name} database...`);
      const client = await Promise.race([
        pool.connect(),
        new Promise((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(`Connection timeout after ${retryOptions.timeout}ms`)
              ),
            retryOptions.timeout
          )
        ),
      ]);

      try {
        await client.query("SELECT 1");
        console.log(`Connected to ${name} database successfully`);
        return true;
      } catch (queryError) {
        console.error(`Query error on ${name} database:`, queryError.message);
        throw queryError;
      } finally {
        client.release();
      }
    } catch (err) {
      attempts++;
      console.error(
        `Failed to connect to ${name} database (attempt ${attempts}/${retryOptions.maxRetries}):`,
        err.message,
        err.code ? `(Code: ${err.code})` : ""
      );

      if (attempts < retryOptions.maxRetries) {
        const delay = retryOptions.retryDelay * attempts; // Exponential backoff
        console.log(`Retrying in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  return false;
}

/**
 * Retrieves transaction data for an account with improved error handling
 * @param {Object} params - Function parameters
 * @param {string} params.accountId - The account ID to retrieve transactions for
 * @returns {Object} Formatted transaction data
 */
async function getTransactionData({ accountId }) {
  if (!accountId) {
    throw new Error("'accountId' is required");
  }

  // Test connections before proceeding
  const [ledgerConnected, accountsConnected] = await Promise.all([
    testConnection(ledgerPool, "ledger"),
    testConnection(accountsPool, "accounts"),
  ]);

  if (!ledgerConnected) {
    throw new Error(
      "Database connection failed after multiple attempts. Please try again later."
    );
  }

  try {
    // Use Promise.allSettled instead of Promise.all for better partial failure handling
    const [transactionResult, userResult] = await Promise.allSettled([
      // Query transactions from ledger database
      ledgerPool.query(
        `SELECT timestamp, amount, from_acct, to_acct
         FROM transactions
         WHERE (from_acct = $1 OR to_acct = $1) 
         ORDER BY timestamp DESC`,
        [accountId]
      ),
      // Query user info from accounts database - try only if connection is good
      accountsConnected
        ? accountsPool.query(
            `SELECT firstname, lastname
           FROM users
           WHERE accountid = $1`,
            [accountId]
          )
        : Promise.reject(new Error("Accounts database not available")),
    ]);

    // Handle transaction query result
    if (transactionResult.status === "rejected") {
      throw new Error(
        `Transaction query failed: ${transactionResult.reason.message}`
      );
    }

    // Handle user query result - use empty data if failed
    let userData = { firstname: "", lastname: "" };
    if (userResult.status === "fulfilled" && userResult.value.rows.length > 0) {
      userData = userResult.value.rows[0];
    } else {
      console.warn(
        "User data unavailable:",
        userResult.status === "rejected"
          ? userResult.reason.message
          : "No matching user found"
      );
    }

    const transactions = transactionResult.value.rows;
    if (transactions.length === 0) {
      return {
        accountOwner:
          `${userData.firstname} ${userData.lastname}`.trim() || "Unknown",
        accountNumber: getLastFour(accountId),
        transactions: [],
        timestamp: new Date().toISOString(),
      };
    }

    // Process transactions with additional validation
    const processedTransactions = transactions.map((row) => {
      // Ensure amount is properly parsed
      const amount = parseFloat(row.amount || 0);
      const isDebit = row.from_acct === accountId;

      return {
        transactionDate: row.timestamp,
        formattedDate: formatDate(row.timestamp),
        amount: isNaN(amount) ? 0 : amount,
        fromAccount: row.from_acct || "",
        toAccount: row.to_acct || "",
        type: isDebit ? "Debit" : "Credit",
        fromAccountLastFour: getLastFour(row.from_acct),
        toAccountLastFour: getLastFour(row.to_acct),
        formattedAmount: formatCurrency(amount),
      };
    });

    // Calculate running balance in a separate step with validation
    let balance = 0;
    processedTransactions.forEach((transaction) => {
      const isDebit = transaction.fromAccount === accountId;
      balance += isDebit ? -transaction.amount : transaction.amount;
      transaction.balance = balance;
      transaction.formattedBalance = formatCurrency(balance);
    });

    return {
      accountOwner:
        `${userData.firstname} ${userData.lastname}`.trim() || "Unknown",
      accountNumber: getLastFour(accountId),
      transactions: processedTransactions,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error("Error retrieving transaction data:", error);
    throw new Error(`Failed to retrieve transaction data: ${error.message}`);
  }
}

/**
 * Format date to YYYY-MM-DD
 * @param {Date|string} date - Date to format
 * @returns {string} Formatted date
 */
function formatDate(date) {
  if (!date) return "";
  try {
    return new Date(date).toISOString().split("T")[0];
  } catch (err) {
    console.warn("Invalid date format:", date);
    return "";
  }
}

/**
 * Format currency with 2 decimal places
 * @param {number} amount - Amount to format
 * @returns {string} Formatted amount
 */
function formatCurrency(amount) {
  const parsedAmount = parseFloat(amount);
  return isNaN(parsedAmount) ? "0.00" : parsedAmount.toFixed(2);
}

/**
 * Get last four characters of account number
 * @param {string} accountNumber - Account number
 * @returns {string} Last four characters
 */
function getLastFour(accountNumber) {
  if (!accountNumber || typeof accountNumber !== "string") return "****";
  return accountNumber.slice(-4);
}

/**
 * Close database connections
 * @returns {Promise<void>}
 */
async function closeConnections() {
  try {
    await Promise.all([ledgerPool.end(), accountsPool.end()]);
    console.log("Database connections closed");
  } catch (err) {
    console.error("Error closing database connections:", err.message);
  }
}

/**
 * Check database connectivity and log versions
 */
async function checkDatabaseConnectivity() {
  console.log("Checking database connectivity...");

  try {
    const ledgerClient = await ledgerPool.connect();
    try {
      const result = await ledgerClient.query("SELECT version()");
      console.log("Ledger DB version:", result.rows[0].version);
    } finally {
      ledgerClient.release();
    }
  } catch (err) {
    console.error("Ledger DB connection error:", {
      host: ledgerDbConfig.host,
      port: ledgerDbConfig.port,
      database: ledgerDbConfig.database,
      error: err.message,
      code: err.code,
    });
  }

  try {
    const accountsClient = await accountsPool.connect();
    try {
      const result = await accountsClient.query("SELECT version()");
      console.log("Accounts DB version:", result.rows[0].version);
    } finally {
      accountsClient.release();
    }
  } catch (err) {
    console.error("Accounts DB connection error:", {
      host: accountsDbConfig.host,
      port: accountsDbConfig.port,
      database: accountsDbConfig.database,
      error: err.message,
      code: err.code,
    });
  }
}

// Handle application shutdown gracefully
process.on("SIGINT", async () => {
  console.log("Shutting down...");
  await closeConnections();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("Shutting down...");
  await closeConnections();
  process.exit(0);
});

module.exports = {
  getTransactionData,
  closeConnections,
  testConnection, // Export for external connection testing
  checkDatabaseConnectivity,
};
