// Test script to verify inventory-aware chat endpoint
import http from "http";

const BASE_URL = "http://localhost:3000";

async function makeRequest(path, body) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(body);

    const options = {
      hostname: "localhost",
      port: 3000,
      path,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData),
      },
    };

    const req = http.request(options, (res) => {
      let data = "";

      res.on("data", (chunk) => {
        data += chunk;
      });

      res.on("end", () => {
        try {
          resolve({
            status: res.statusCode,
            body: JSON.parse(data),
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            body: data,
          });
        }
      });
    });

    req.on("error", reject);
    req.write(postData);
    req.end();
  });
}

async function runTests() {
  console.log("\n🧪 Testing Inventory-Aware Chat Endpoint\n");

  try {
    // Test 1: Margins query (requires inventory)
    console.log("1️⃣ Testing margins query...");
    const marginsResponse = await makeRequest("/chat", {
      message: "what are my margins?",
      conversationHistory: [],
    });

    console.log("Response:", JSON.stringify(marginsResponse.body, null, 2));

    if (marginsResponse.body.meta?.inventoryRequired) {
      console.log("✅ Correctly detected inventory intent");
    } else {
      console.log("❌ Failed to detect inventory intent");
    }

    if (marginsResponse.body.meta?.inventoryAvailable) {
      console.log("✅ Inventory data was fetched and used");
    } else {
      console.log("⚠️  Inventory data unavailable (may need to ingest first)");
    }

    if (marginsResponse.body.conversationContext) {
      console.log("✅ Conversation context updated:", marginsResponse.body.conversationContext);
    }

    console.log("\n");

    // Test 2: Profit query
    console.log("2️⃣ Testing profit query...");
    const profitResponse = await makeRequest("/chat", {
      message: "what is my total profit?",
      conversationHistory: [
        { role: "user", content: "what are my margins?" },
      ],
    });

    console.log("Response:", profitResponse.body.response);
    console.log("Context:", profitResponse.body.conversationContext);
    console.log("\n");

    // Test 3: General query (no inventory needed)
    console.log("3️⃣ Testing general query (no inventory)...");
    const generalResponse = await makeRequest("/chat", {
      message: "hello, how are you?",
      conversationHistory: [],
    });

    console.log("Response:", generalResponse.body.response);

    if (!generalResponse.body.meta?.inventoryRequired) {
      console.log("✅ Correctly identified as non-inventory query");
    } else {
      console.log("❌ Incorrectly flagged as inventory query");
    }

    console.log("\n");

    // Test 4: Check debug endpoint for inventory availability
    console.log("4️⃣ Checking inventory availability...");
    const debugResponse = await makeRequest("/debug/inventory", {});

    console.log(`Inventory count: ${debugResponse.body.count}`);

    if (debugResponse.body.count === 0) {
      console.log("\n⚠️  WARNING: No inventory data found.");
      console.log("To test with real data, first ingest inventory:");
      console.log("POST /ingest/njweedwizard with your CSV data\n");
    } else {
      console.log("✅ Inventory data is available");
      console.log("Sample items:", JSON.stringify(debugResponse.body.sample, null, 2));
    }

    console.log("\n✅ All tests completed successfully!");

  } catch (err) {
    console.error("\n❌ Test error:", err.message);
    console.error("\nMake sure the server is running: node src/server.js");
  }
}

runTests();
