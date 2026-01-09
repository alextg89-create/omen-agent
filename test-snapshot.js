// Test script to verify weekly snapshot and recommendations
import http from "http";

const BASE_URL = "http://localhost:3000";

async function makeRequest(path, body = null, method = "POST") {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : "";

    const options = {
      hostname: "localhost",
      port: 3000,
      path,
      method,
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
    if (postData) req.write(postData);
    req.end();
  });
}

async function runTests() {
  console.log("\n🧪 Testing Weekly Snapshot + Recommendations\n");

  try {
    // Test 1: Generate Snapshot
    console.log("1️⃣ Testing snapshot generation...");
    const snapshotResponse = await makeRequest("/snapshot/generate", {});

    if (snapshotResponse.body.ok) {
      console.log("✅ Snapshot generated successfully");
      const { snapshot } = snapshotResponse.body;

      console.log(`   Items: ${snapshot.itemCount}`);
      console.log(`   Average Margin: ${snapshot.metrics.averageMargin}%`);
      console.log(`   Total Profit: $${snapshot.metrics.totalProfit}`);
      console.log(`   Promotions: ${snapshot.recommendations.promotions.length}`);
      console.log(`   Pricing: ${snapshot.recommendations.pricing.length}`);
      console.log(`   Inventory: ${snapshot.recommendations.inventory.length}`);

      // Show top recommendation from each category
      if (snapshot.recommendations.promotions.length > 0) {
        const top = snapshot.recommendations.promotions[0];
        console.log(`   \n   Top Promotion: ${top.name}`);
        console.log(`   Reason: ${top.reason}`);
        console.log(`   Confidence: ${(top.confidence * 100).toFixed(0)}%`);
      }
    } else {
      console.log("❌ Snapshot generation failed:", snapshotResponse.body.error);
    }

    console.log("\n");

    // Test 2: Prepare Email
    console.log("2️⃣ Testing snapshot email preparation...");
    const emailResponse = await makeRequest("/snapshot/send", {
      email: "test@example.com"
    });

    if (emailResponse.body.ok) {
      console.log("✅ Email prepared successfully");
      console.log(`   Subject: ${emailResponse.body.email.subject}`);
      console.log(`   Body length: ${emailResponse.body.email.body.length} characters`);
      console.log("\n   Email Preview (first 500 chars):");
      console.log("   " + emailResponse.body.email.body.substring(0, 500).replace(/\n/g, "\n   "));
    } else {
      console.log("❌ Email preparation failed:", emailResponse.body.error);
    }

    console.log("\n");

    // Test 3: Chat with Recommendations
    console.log("3️⃣ Testing chat recommendation query...");
    const chatResponse = await makeRequest("/chat", {
      message: "what should I promote?",
      conversationHistory: []
    });

    console.log("Response:", chatResponse.body.response.substring(0, 300) + "...");

    if (chatResponse.body.meta?.recommendationsProvided) {
      console.log(`✅ Recommendations provided: ${chatResponse.body.meta.recommendationCount} total`);
    } else {
      console.log("⚠️  No recommendations in response metadata");
    }

    console.log("\n");

    // Test 4: Chat with General Recommendation Query
    console.log("4️⃣ Testing general recommendation query...");
    const generalResponse = await makeRequest("/chat", {
      message: "what are your recommendations?",
      conversationHistory: []
    });

    console.log("Response:", generalResponse.body.response.substring(0, 300) + "...");
    console.log(`Confidence: ${generalResponse.body.confidence}`);
    console.log(`Reason: ${generalResponse.body.reason}`);

    console.log("\n");

    // Test 5: Verify Determinism
    console.log("5️⃣ Testing determinism (generating 2 snapshots)...");
    const snap1 = await makeRequest("/snapshot/generate", {});
    const snap2 = await makeRequest("/snapshot/generate", {});

    if (snap1.body.ok && snap2.body.ok) {
      const metrics1 = snap1.body.snapshot.metrics;
      const metrics2 = snap2.body.snapshot.metrics;

      const isDeterministic =
        metrics1.averageMargin === metrics2.averageMargin &&
        metrics1.totalProfit === metrics2.totalProfit &&
        metrics1.totalRevenue === metrics2.totalRevenue;

      if (isDeterministic) {
        console.log("✅ Snapshots are deterministic (same metrics)");
      } else {
        console.log("❌ Snapshots differ (non-deterministic!)");
        console.log("   Snapshot 1:", metrics1);
        console.log("   Snapshot 2:", metrics2);
      }

      // Check recommendations are also deterministic
      const rec1Count = snap1.body.snapshot.recommendations.promotions.length;
      const rec2Count = snap2.body.snapshot.recommendations.promotions.length;

      if (rec1Count === rec2Count) {
        console.log(`✅ Recommendations are deterministic (${rec1Count} promotions)`);
      } else {
        console.log(`❌ Recommendation counts differ: ${rec1Count} vs ${rec2Count}`);
      }
    }

    console.log("\n✅ All tests completed successfully!\n");

  } catch (err) {
    console.error("\n❌ Test error:", err.message);
    console.error("\nMake sure the server is running: node src/server.js\n");
  }
}

runTests();
